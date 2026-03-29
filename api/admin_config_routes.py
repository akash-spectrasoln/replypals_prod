"""
Admin API — DB-driven commerce config (plans, bundles, PPP, system, nudges).
Mounted under /admin/config/*. Uses same JWT auth as the admin panel.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from admin_routes import require_admin
from commerce_config import invalidate_commerce_cache
from stripe_ppp import ensure_ppp_coupon

router = APIRouter(prefix="/config", tags=["admin-config"])


def _cfg_audit(
    supabase,
    request: Request,
    action: str,
    table_name: str,
    record_id: str,
    old_value: Any,
    new_value: Any,
):
    ip = request.client.host if request.client else ""
    if not supabase:
        return
    try:
        supabase.table("admin_audit_log").insert(
            {
                "action": action,
                "table_name": table_name,
                "record_id": record_id,
                "old_value": old_value,
                "new_value": new_value,
                "details": {"source": "config_api"},
                "ip": ip,
            }
        ).execute()
    except Exception:
        pass


# ─── Cache ────────────────────────────────────────────────────────────────────


@router.post("/refresh")
async def config_refresh(request: Request, admin=Depends(require_admin)):
    from main import supabase

    invalidate_commerce_cache()
    if supabase:
        _cfg_audit(
            supabase,
            request,
            "config_cache_refresh",
            "commerce_cache",
            "all",
            None,
            {"refreshed": True},
        )
    return {"refreshed": True, "at": datetime.now(timezone.utc).isoformat()}


# ─── Plans ───────────────────────────────────────────────────────────────────


class PlanCreateBody(BaseModel):
    plan_key: str = Field(..., min_length=2, max_length=32)
    display_name: str = ""
    monthly_rewrites: Optional[int] = None
    base_price_usd: Optional[float] = None
    seat_count: int = 1
    is_active: bool = True
    sort_order: int = 0
    stripe_price_id: Optional[str] = None


class PlanPatchBody(BaseModel):
    display_name: Optional[str] = None
    monthly_rewrites: Optional[int] = None
    base_price_usd: Optional[float] = None
    seat_count: Optional[int] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None
    stripe_price_id: Optional[str] = None


@router.get("/plans")
async def config_list_plans(admin=Depends(require_admin)):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    r = supabase.table("plan_config").select("*").order("sort_order").execute()
    return {"plans": r.data or []}


@router.put("/plans/{plan_key}")
async def config_put_plan(
    plan_key: str,
    body: PlanPatchBody,
    request: Request,
    admin=Depends(require_admin),
):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    pk = plan_key.strip().lower()
    cur = supabase.table("plan_config").select("*").eq("plan_key", pk).maybe_single().execute()
    if not cur.data:
        raise HTTPException(404, detail="Plan not found")
    patch: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    patch.update(body.model_dump(exclude_unset=True))
    supabase.table("plan_config").update(patch).eq("plan_key", pk).execute()
    invalidate_commerce_cache()
    _cfg_audit(supabase, request, "update_plan_price", "plan_config", pk, cur.data, patch)
    nr = supabase.table("plan_config").select("*").eq("plan_key", pk).single().execute()
    return {"plan": nr.data}


@router.post("/plans")
async def config_create_plan(body: PlanCreateBody, request: Request, admin=Depends(require_admin)):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    pk = body.plan_key.strip().lower()
    ex = supabase.table("plan_config").select("id").eq("plan_key", pk).maybe_single().execute()
    if ex.data:
        raise HTTPException(400, detail="plan_key already exists")
    row = {
        "plan_key": pk,
        "display_name": body.display_name or pk.title(),
        "monthly_rewrites": body.monthly_rewrites,
        "base_price_usd": body.base_price_usd,
        "seat_count": body.seat_count,
        "is_active": body.is_active,
        "sort_order": body.sort_order,
        "stripe_price_id": body.stripe_price_id,
    }
    supabase.table("plan_config").insert(row).execute()
    invalidate_commerce_cache()
    _cfg_audit(supabase, request, "create_plan", "plan_config", pk, None, row)
    return {"ok": True, "plan_key": pk}


@router.delete("/plans/{plan_key}")
async def config_delete_plan(plan_key: str, request: Request, admin=Depends(require_admin)):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    pk = plan_key.strip().lower()
    cur = supabase.table("plan_config").select("*").eq("plan_key", pk).maybe_single().execute()
    if not cur.data:
        raise HTTPException(404, detail="Plan not found")
    supabase.table("plan_config").update({"is_active": False, "updated_at": datetime.now(timezone.utc).isoformat()}).eq(
        "plan_key", pk
    ).execute()
    invalidate_commerce_cache()
    _cfg_audit(supabase, request, "soft_delete_plan", "plan_config", pk, cur.data, {"is_active": False})
    return {"ok": True}


# ─── Credit bundles ───────────────────────────────────────────────────────────


class BundleCreateBody(BaseModel):
    bundle_key: str = Field(..., min_length=2, max_length=64)
    display_name: str = ""
    credits: int = Field(..., ge=1)
    base_price_usd: float = Field(..., ge=0)
    is_active: bool = True
    sort_order: int = 0
    stripe_price_id: Optional[str] = None


class BundlePatchBody(BaseModel):
    display_name: Optional[str] = None
    credits: Optional[int] = Field(None, ge=1)
    base_price_usd: Optional[float] = Field(None, ge=0)
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None
    stripe_price_id: Optional[str] = None


@router.get("/credits")
async def config_list_bundles(admin=Depends(require_admin)):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    r = supabase.table("credit_bundle_config").select("*").order("sort_order").execute()
    return {"bundles": r.data or []}


@router.put("/credits/{bundle_key}")
async def config_put_bundle(
    bundle_key: str,
    body: BundlePatchBody,
    request: Request,
    admin=Depends(require_admin),
):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    bk = bundle_key.strip().lower()
    cur = supabase.table("credit_bundle_config").select("*").eq("bundle_key", bk).maybe_single().execute()
    if not cur.data:
        raise HTTPException(404, detail="Bundle not found")
    patch: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    patch.update(body.model_dump(exclude_unset=True))
    supabase.table("credit_bundle_config").update(patch).eq("bundle_key", bk).execute()
    invalidate_commerce_cache()
    _cfg_audit(supabase, request, "update_credit_bundle", "credit_bundle_config", bk, cur.data, patch)
    nr = supabase.table("credit_bundle_config").select("*").eq("bundle_key", bk).single().execute()
    return {"bundle": nr.data}


@router.post("/credits")
async def config_create_bundle(body: BundleCreateBody, request: Request, admin=Depends(require_admin)):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    bk = body.bundle_key.strip().lower()
    ex = supabase.table("credit_bundle_config").select("id").eq("bundle_key", bk).maybe_single().execute()
    if ex.data:
        raise HTTPException(400, detail="bundle_key already exists")
    row = body.model_dump()
    row["bundle_key"] = bk
    row["display_name"] = row.get("display_name") or bk.title()
    supabase.table("credit_bundle_config").insert(row).execute()
    invalidate_commerce_cache()
    _cfg_audit(supabase, request, "create_credit_bundle", "credit_bundle_config", bk, None, row)
    return {"ok": True, "bundle_key": bk}


@router.delete("/credits/{bundle_key}")
async def config_delete_bundle(bundle_key: str, request: Request, admin=Depends(require_admin)):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    bk = bundle_key.strip().lower()
    cur = supabase.table("credit_bundle_config").select("*").eq("bundle_key", bk).maybe_single().execute()
    if not cur.data:
        raise HTTPException(404, detail="Bundle not found")
    supabase.table("credit_bundle_config").update({"is_active": False, "updated_at": datetime.now(timezone.utc).isoformat()}).eq(
        "bundle_key", bk
    ).execute()
    invalidate_commerce_cache()
    _cfg_audit(supabase, request, "soft_delete_bundle", "credit_bundle_config", bk, cur.data, {"is_active": False})
    return {"ok": True}


# ─── Country PPP ──────────────────────────────────────────────────────────────


class CountryCreateBody(BaseModel):
    country_code: str = Field(..., min_length=2, max_length=2)
    country_name: str = ""
    currency_code: str = "USD"
    currency_symbol: str = "$"
    price_multiplier: float = Field(1.0, ge=0.01, le=2.0)
    is_active: bool = True


class CountryPatchBody(BaseModel):
    country_name: Optional[str] = None
    currency_code: Optional[str] = None
    currency_symbol: Optional[str] = None
    price_multiplier: Optional[float] = Field(None, ge=0.01, le=2.0)
    is_active: Optional[bool] = None


@router.get("/countries")
async def config_list_countries(admin=Depends(require_admin)):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    r = supabase.table("country_pricing").select("*").order("country_code").execute()
    return {"countries": r.data or []}


@router.put("/countries/{country_code}")
async def config_put_country(
    country_code: str,
    body: CountryPatchBody,
    request: Request,
    admin=Depends(require_admin),
):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    cc = country_code.strip().upper()
    cur = supabase.table("country_pricing").select("*").eq("country_code", cc).maybe_single().execute()
    if not cur.data:
        raise HTTPException(404, detail="Country not found")
    old = dict(cur.data)
    patch: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            patch[k] = v
    mult = float(patch.get("price_multiplier", old.get("price_multiplier") or 1))
    if "price_multiplier" in patch:
        cid = ensure_ppp_coupon(cc, mult, old.get("stripe_coupon_id"))
        if cid:
            patch["stripe_coupon_id"] = cid
    supabase.table("country_pricing").update(patch).eq("country_code", cc).execute()
    invalidate_commerce_cache()
    _cfg_audit(supabase, request, "update_country_ppp", "country_pricing", cc, old, patch)
    nr = supabase.table("country_pricing").select("*").eq("country_code", cc).single().execute()
    return {"country": nr.data}


@router.post("/countries")
async def config_create_country(body: CountryCreateBody, request: Request, admin=Depends(require_admin)):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    cc = body.country_code.strip().upper()
    ex = supabase.table("country_pricing").select("id").eq("country_code", cc).maybe_single().execute()
    if ex.data:
        raise HTTPException(400, detail="country_code already exists")
    cid = ensure_ppp_coupon(cc, float(body.price_multiplier), None)
    row = {
        "country_code": cc,
        "country_name": body.country_name or cc,
        "currency_code": body.currency_code.upper(),
        "currency_symbol": body.currency_symbol,
        "price_multiplier": body.price_multiplier,
        "is_active": body.is_active,
        "stripe_coupon_id": cid,
    }
    supabase.table("country_pricing").insert(row).execute()
    invalidate_commerce_cache()
    _cfg_audit(supabase, request, "create_country_ppp", "country_pricing", cc, None, row)
    return {"ok": True, "country_code": cc}


@router.delete("/countries/{country_code}")
async def config_delete_country(country_code: str, request: Request, admin=Depends(require_admin)):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    cc = country_code.strip().upper()
    cur = supabase.table("country_pricing").select("*").eq("country_code", cc).maybe_single().execute()
    if not cur.data:
        raise HTTPException(404, detail="Country not found")
    supabase.table("country_pricing").update({"is_active": False, "updated_at": datetime.now(timezone.utc).isoformat()}).eq(
        "country_code", cc
    ).execute()
    invalidate_commerce_cache()
    _cfg_audit(supabase, request, "soft_delete_country", "country_pricing", cc, cur.data, {"is_active": False})
    return {"ok": True}


# ─── System config ───────────────────────────────────────────────────────────


class SystemPatchBody(BaseModel):
    value: str
    description: Optional[str] = None


@router.get("/system")
async def config_list_system(admin=Depends(require_admin)):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    r = supabase.table("system_config").select("*").order("key").execute()
    return {"settings": r.data or []}


@router.put("/system/{key}")
async def config_put_system(key: str, body: SystemPatchBody, request: Request, admin=Depends(require_admin)):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    k = key.strip()
    cur = supabase.table("system_config").select("*").eq("key", k).maybe_single().execute()
    if not cur.data:
        raise HTTPException(404, detail="Unknown system key")
    old = dict(cur.data)
    patch = {"value": body.value, "updated_at": datetime.now(timezone.utc).isoformat()}
    if body.description is not None:
        patch["description"] = body.description
    supabase.table("system_config").update(patch).eq("key", k).execute()
    invalidate_commerce_cache()
    _cfg_audit(supabase, request, "update_system_config", "system_config", k, old, patch)
    return {"ok": True, "key": k}


# ─── Nudges ─────────────────────────────────────────────────────────────────


class NudgePatchBody(BaseModel):
    nudge_at_spend_usd: Optional[float] = Field(None, ge=0)
    nudge_to_plan: Optional[str] = None
    message_template: Optional[str] = None


@router.get("/nudges")
async def config_list_nudges(admin=Depends(require_admin)):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    r = supabase.table("upgrade_nudge_config").select("*").order("from_plan").execute()
    return {"nudges": r.data or []}


@router.put("/nudges/{from_plan}")
async def config_put_nudge(
    from_plan: str,
    body: NudgePatchBody,
    request: Request,
    admin=Depends(require_admin),
):
    from main import supabase

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    fp = from_plan.strip().lower()
    cur = supabase.table("upgrade_nudge_config").select("*").eq("from_plan", fp).maybe_single().execute()
    if not cur.data:
        raise HTTPException(404, detail="Nudge row not found")
    old = dict(cur.data)
    patch: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            patch[k] = v
    supabase.table("upgrade_nudge_config").update(patch).eq("from_plan", fp).execute()
    invalidate_commerce_cache()
    _cfg_audit(supabase, request, "update_nudge", "upgrade_nudge_config", fp, old, patch)
    nr = supabase.table("upgrade_nudge_config").select("*").eq("from_plan", fp).single().execute()
    return {"nudge": nr.data}


# ─── Config audit query ───────────────────────────────────────────────────────


@router.get("/audit-log")
async def config_audit_log(
    admin=Depends(require_admin),
    table_name: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
):
    from main import supabase

    if not supabase:
        return {"logs": [], "total": 0}
    try:
        q = supabase.table("admin_audit_log").select("*", count="exact").order("created_at", desc=True)
        if table_name:
            q = q.eq("table_name", table_name)
        q = q.range(offset, offset + limit - 1)
        r = q.execute()
        return {"logs": r.data or [], "total": getattr(r, "count", None)}
    except Exception:
        return {"logs": [], "total": 0}

