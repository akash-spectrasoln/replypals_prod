"""
ReplyPals — usage_logs–based rate limits and cost guardrails.

Plan caps, bundles, PPP, and system knobs load from Supabase via ``commerce_config``
(cached TTL from ``system_config``; bust with ``invalidate_commerce_cache``).
"""

from __future__ import annotations

import asyncio
import calendar
import json
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Literal, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field

from commerce_config import (
    CommerceSnapshot,
    cheapest_active_bundle,
    format_money,
    format_upgrade_price_for_plan,
    get_commerce_snapshot,
    invalidate_commerce_cache,
    load_commerce_snapshot_sync,
    localize_usd_price,
    plan_monthly_cap,
    resolve_country_row,
)

# Legacy: empty dict shape for callers that still merge JSON (prefer plan_config in DB).
APP_SETTINGS_PLAN_LIMITS_KEY = "plan_limits"
DEFAULT_PLAN_LIMITS: dict[str, dict[str, Optional[int]]] = {}
PLAN_LIMITS: dict[str, dict[str, Optional[int]]] = {}


def merge_plan_limits_from_raw(
    base: dict[str, dict[str, Optional[int]]],
    raw: Any,
) -> dict[str, dict[str, Optional[int]]]:
    """Overlay ``raw`` (from JSON) onto ``base``; unknown keys ignored."""
    out = {k: {"monthly": v.get("monthly"), "daily": v.get("daily")} for k, v in base.items()}
    if not isinstance(raw, dict):
        return out
    for plan_key, caps in raw.items():
        if plan_key not in out or not isinstance(caps, dict):
            continue
        if "monthly" in caps:
            mv = caps["monthly"]
            out[plan_key]["monthly"] = None if mv is None else int(mv)
        if "daily" in caps:
            dv = caps["daily"]
            out[plan_key]["daily"] = None if dv is None else int(dv)
    return out


def snapshot_to_limits_dict(snap: CommerceSnapshot) -> dict[str, dict[str, Optional[int]]]:
    out: dict[str, dict[str, Optional[int]]] = {}
    for k, p in snap.plans.items():
        out[k] = {"monthly": p.monthly_rewrites, "daily": None}
    return out


def load_plan_limits_merged(supabase: Any) -> dict[str, dict[str, Optional[int]]]:
    """Sync: plan monthly caps from ``plan_config`` (same source as rate limits)."""
    snap = load_commerce_snapshot_sync(supabase)
    return snapshot_to_limits_dict(snap)


def invalidate_plan_limits_cache() -> None:
    invalidate_commerce_cache()


def serialize_plan_limits_for_public(
    merged: dict[str, dict[str, Optional[int]]],
) -> dict[str, Any]:
    """Raw caps + labels (monthly only — no daily caps)."""
    raw = {k: {"monthly": v.get("monthly"), "daily": None} for k, v in merged.items()}

    def _label(plan_key: str) -> str:
        caps = merged.get(plan_key) or {}
        m = caps.get("monthly")
        if plan_key == "enterprise":
            return "Custom"
        if m is None:
            return "Unlimited"
        return f"{m} rewrites/mo"

    labels = {k: _label(k) for k in raw.keys()}
    return {"raw": raw, "labels": labels}


def serialize_plan_limits_from_snapshot(snap: CommerceSnapshot) -> dict[str, Any]:
    return serialize_plan_limits_for_public(snapshot_to_limits_dict(snap))


async def get_plan_limits(supabase: Any, sb_execute: Callable) -> dict[str, dict[str, Optional[int]]]:
    snap = await get_commerce_snapshot(supabase, sb_execute)
    return snapshot_to_limits_dict(snap)


# Fallback only when DB unreachable (rewrite should not rely on this long-term).
COST_GUARDRAIL_USD = 0.50
COST_PAUSE_HOURS = 24

# ─── Pydantic error / response schemas (v2) ──────────────────────────────────


UpgradePlan = Literal["starter", "pro", "growth", "team", "enterprise", "free"]
LimitBlockType = Literal["monthly", "no_credits"]


class NudgePayload(BaseModel):
    show: bool = False
    upgrade_to: str = ""
    message: str = ""


class LimitExceededBody(BaseModel):
    """429 when plan caps are hit and no credits remain."""

    error: Literal["limit_exceeded"] = "limit_exceeded"
    type: LimitBlockType
    reset_in: Optional[str] = None
    upgrade_to: str
    buy_credits: bool = True
    message: str
    localized_price: str = ""
    cheapest_bundle: str = ""
    cheapest_bundle_price: str = ""


class CostGuardrailBody(BaseModel):
    """429 when cost guardrail trips (unusual usage)."""

    error: Literal["cost_guardrail"] = "cost_guardrail"
    message: str = (
        "Unusual usage detected. Your account has been temporarily paused. Contact support."
    )


class AccountPausedBody(BaseModel):
    """429 when account is paused until cost_paused_until."""

    error: Literal["account_paused"] = "account_paused"
    reset_in: str
    message: str = (
        "Unusual usage detected. Your account has been temporarily paused. Contact support."
    )


class UsageMetadata(BaseModel):
    """Returned on successful rewrite/generate alongside legacy rewrite counters."""

    allowed: bool = True
    source: Optional[Literal["subscription", "credits"]] = None
    remaining_daily: Optional[int] = None
    remaining_monthly: Optional[int] = None
    credit_balance: int = 0
    percent_used: float = 0.0
    usage_warning: bool = False
    reset_in: str = ""
    message: Optional[str] = None
    localized_upgrade_price: str = ""
    nudge: dict[str, Any] = Field(default_factory=lambda: {"show": False, "upgrade_to": "", "message": ""})


class EnterpriseUsageResponse(BaseModel):
    total_rewrites: int
    per_seat: list[dict[str, Any]]
    cost_estimate_usd: float
    total_cost_estimate_usd: float = 0.0
    credit_balance: int = 0


class EnterpriseSeatsRequest(BaseModel):
    action: Literal["add", "remove"]
    user_ids: list[str] = Field(default_factory=list)


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _synthetic_email_from_anon_id(anon_id: Optional[str]) -> Optional[str]:
    if not anon_id:
        return None
    v = str(anon_id).strip()
    if not v:
        return None
    return f"anon_{v[:16]}@replypal.internal"


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


def _month_key(d: Optional[date] = None) -> str:
    d = d or _today_utc()
    return f"{d.year:04d}-{d.month:02d}"


def _seconds_until_end_of_day_utc() -> int:
    now = datetime.now(timezone.utc)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((tomorrow - now).total_seconds()))


def _seconds_until_end_of_month_utc() -> int:
    now = datetime.now(timezone.utc)
    last_day = calendar.monthrange(now.year, now.month)[1]
    end = datetime(now.year, now.month, last_day, 23, 59, 59, tzinfo=timezone.utc)
    # next month start is cleaner
    if now.month == 12:
        nxt = datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        nxt = datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)
    return max(1, int((nxt - now).total_seconds()))


def format_reset_in(seconds: int) -> str:
    h = seconds // 3600
    m = (seconds % 3600) // 60
    return f"{h}h {m}m"


def format_reset_days_month_utc() -> str:
    now = datetime.now(timezone.utc)
    if now.month == 12:
        nxt = datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        nxt = datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)
    days = max(1, int((nxt - now).total_seconds() // 86400))
    return f"{days} days"


def _upgrade_to(plan: str) -> str:
    if plan == "free":
        return "starter"
    if plan == "starter":
        return "pro"
    if plan == "pro":
        return "growth"
    if plan == "growth":
        return "team"
    return "enterprise"


def _resolve_user_country(billing: Optional[dict[str, Any]]) -> str:
    if not billing:
        return "US"
    o = (billing.get("country_override") or "").strip().upper()
    if o:
        return o
    d = (billing.get("detected_country") or "").strip().upper()
    return d or "US"


def _build_nudge_payload(
    snap: CommerceSnapshot,
    plan: str,
    credit_spent_usd: float,
    country_code: str,
) -> dict[str, Any]:
    cfg = snap.nudges.get(plan)
    if not cfg or credit_spent_usd < float(cfg.nudge_at_spend_usd):
        return {"show": False, "upgrade_to": "", "message": ""}
    tgt = cfg.nudge_to_plan
    tp = snap.plans.get(tgt)
    if not tp:
        return {"show": False, "upgrade_to": "", "message": ""}
    crow, mult = resolve_country_row(snap, country_code)
    price_loc = ""
    if tp.base_price_usd is not None:
        loc = localize_usd_price(float(tp.base_price_usd), mult)
        price_loc = format_money(crow.currency_symbol, loc)
    spent_s = format_money("$", round(float(credit_spent_usd), 2))
    try:
        msg = cfg.message_template.format(
            spent=spent_s,
            plan=tp.display_name,
            price=price_loc,
        )
    except Exception:
        msg = cfg.message_template
    return {"show": True, "upgrade_to": tgt, "message": msg}


def _friendly_limit_message(
    plan: str,
    limit_type: LimitBlockType,
    snap: CommerceSnapshot,
    country_code: str,
    m_cap: Optional[int],
) -> str:
    free_n = plan_monthly_cap(snap, "free", 0) or 10
    upg = _upgrade_to(plan)
    upg_disp = (snap.plans.get(upg).display_name if snap.plans.get(upg) else upg).title()
    cheap = cheapest_active_bundle(snap)
    crow, mult = resolve_country_row(snap, country_code)
    if limit_type == "no_credits":
        return "No credits left. Buy more or upgrade!"
    used_m = m_cap if m_cap is not None else free_n
    if plan == "free":
        cmsg = ""
        if cheap:
            cloc = localize_usd_price(float(cheap.base_price_usd), mult)
            cmsg = (
                f" Buy {cheap.credits} credits for {format_money(crow.currency_symbol, cloc)} "
                f"or upgrade to Starter ({format_upgrade_price_for_plan(snap, 'starter', country_code)})!"
            )
        return f"You've used all {used_m} free rewrites.{cmsg}"
    if plan == "starter":
        return (
            f"You've used all {used_m} Starter rewrites. Top up with credits or upgrade to "
            f"Pro ({format_upgrade_price_for_plan(snap, 'pro', country_code)}) for more monthly rewrites!"
        )
    if plan == "pro":
        return (
            f"You've used all {used_m} Pro rewrites. Top up with credits or upgrade to "
            f"Growth ({format_upgrade_price_for_plan(snap, 'growth', country_code)})!"
        )
    if plan == "growth":
        return (
            f"You've used all {used_m} Growth rewrites. Top up with credits or upgrade to "
            f"Team ({format_upgrade_price_for_plan(snap, 'team', country_code)})!"
        )
    return f"You've hit your monthly limit on {plan}. Upgrade to {upg_disp} or buy credits."


def _warning_message_if_needed(percent_used: float, warn_pct: float) -> Optional[str]:
    if percent_used >= warn_pct:
        return (
            f"You've used {int(warn_pct)}% of your monthly rewrites. "
            "Consider upgrading or buying credits."
        )
    return None


async def _exec_sb(builder, sb_execute: Callable) -> Any:
    return await sb_execute(builder, timeout_sec=3.0)


def _normalize_plan(raw: Optional[str], snap: CommerceSnapshot) -> str:
    p = (raw or "free").strip().lower()
    if p not in snap.plans:
        return "free"
    return p


async def _fetch_user_billing_row(
    supabase: Any,
    sb_execute: Callable,
    user_id: Optional[str],
) -> Optional[dict[str, Any]]:
    if not supabase or not user_id:
        return None
    try:
        r = await _exec_sb(
            supabase.table("user_profiles")
            .select(
                "id,email,plan,stripe_customer_id,billing_cycle_start,seat_count,"
                "cost_paused_until,credit_balance,cost_flagged,credit_spent_usd,"
                "detected_country,country_override,price_multiplier"
            )
            .eq("id", user_id)
            .maybe_single(),
            sb_execute,
        )
        return getattr(r, "data", None) if r is not None else None
    except Exception:
        return None


async def _sum_usage_for_month(
    supabase: Any,
    sb_execute: Callable,
    user_id: str,
    month: str,
) -> tuple[int, float]:
    """Returns (total rewrite_count, total estimated_cost_usd) for calendar month."""
    if not supabase:
        return 0, 0.0
    try:
        r = await _exec_sb(
            supabase.table("usage_logs")
            .select("rewrite_count,estimated_cost_usd")
            .eq("user_id", user_id)
            .eq("month", month),
            sb_execute,
        )
        rows = r.data or []
        total_r = sum(int(x.get("rewrite_count") or 0) for x in rows)
        total_c = sum(float(x.get("estimated_cost_usd") or 0) for x in rows)
        return total_r, round(total_c, 6)
    except Exception:
        return 0, 0.0


async def _sum_subscription_rewrites_month(
    supabase: Any,
    sb_execute: Callable,
    user_id: str,
    month: str,
) -> int:
    """Subscription-attributed rewrites this calendar month (excludes credit rewrites)."""
    if not supabase:
        return 0
    try:
        r = await _exec_sb(
            supabase.table("usage_logs")
            .select("subscription_rewrites,rewrite_count")
            .eq("user_id", user_id)
            .eq("month", month),
            sb_execute,
        )
        rows = r.data or []
        s = 0
        for x in rows:
            v = x.get("subscription_rewrites")
            if v is None:
                s += int(x.get("rewrite_count") or 0)
            else:
                s += int(v or 0)
        return s
    except Exception:
        m, _ = await _sum_usage_for_month(supabase, sb_execute, user_id, month)
        return m


async def _get_today_usage_row(
    supabase: Any,
    sb_execute: Callable,
    user_id: str,
    day: date,
) -> tuple[int, float]:
    if not supabase:
        return 0, 0.0
    ds = day.isoformat()
    try:
        r = await _exec_sb(
            supabase.table("usage_logs")
            .select("rewrite_count,estimated_cost_usd")
            .eq("user_id", user_id)
            .eq("date", ds)
            .maybe_single(),
            sb_execute,
        )
        row = getattr(r, "data", None) if r is not None else None
        if not row:
            return 0, 0.0
        return int(row.get("rewrite_count") or 0), float(row.get("estimated_cost_usd") or 0.0)
    except Exception:
        return 0, 0.0


async def _get_today_subscription_count(
    supabase: Any,
    sb_execute: Callable,
    user_id: str,
    day: date,
) -> int:
    """Today's subscription rewrites only (daily caps ignore credit usage)."""
    if not supabase:
        return 0
    ds = day.isoformat()
    try:
        r = await _exec_sb(
            supabase.table("usage_logs")
            .select("subscription_rewrites,rewrite_count")
            .eq("user_id", user_id)
            .eq("date", ds)
            .maybe_single(),
            sb_execute,
        )
        row = getattr(r, "data", None) if r is not None else None
        if not row:
            return 0
        v = row.get("subscription_rewrites")
        if v is None:
            return int(row.get("rewrite_count") or 0)
        return int(v or 0)
    except Exception:
        u, _ = await _get_today_usage_row(supabase, sb_execute, user_id, day)
        return u


async def ensure_user_profile_row(
    supabase: Any,
    sb_execute: Callable,
    *,
    resolved_uid: str,
    email: Optional[str],
) -> None:
    """Minimal user_profiles row so usage_logs FK succeeds (anon / edge cases)."""
    if not supabase or not resolved_uid:
        return
    try:
        ex = await _exec_sb(
            supabase.table("user_profiles").select("id").eq("id", resolved_uid).maybe_single(),
            sb_execute,
        )
        if ex and getattr(ex, "data", None):
            return
        await _exec_sb(
            supabase.table("user_profiles").upsert(
                {
                    "id": resolved_uid,
                    "email": (email or "").strip() or None,
                    "plan": "free",
                },
                on_conflict="id",
            ),
            sb_execute,
        )
    except Exception as e:
        print(f"[user_profiles ensure] {e}")


async def fetch_active_license_row(
    supabase: Any,
    sb_execute: Callable,
    req_key: str,
    user_id: Optional[str],
    req_email: str,
) -> tuple[Optional[dict[str, Any]], Optional[str]]:
    """
    Mirrors main.py license resolution (key → user_id → email).
    Returns (license_row, brand_voice).
    """
    license_row = None
    brand_voice = None
    if not supabase:
        return None, None

    if req_key:
        try:
            r = await _exec_sb(
                supabase.table("licenses")
                .select("*")
                .eq("license_key", req_key)
                .eq("active", True)
                .maybe_single(),
                sb_execute,
            )
            license_row = getattr(r, "data", None) if r is not None else None
        except Exception:
            license_row = None

    if not license_row and user_id:
        try:
            r = await _exec_sb(
                supabase.table("licenses")
                .select("*")
                .eq("user_id", user_id)
                .eq("active", True)
                .maybe_single(),
                sb_execute,
            )
            license_row = getattr(r, "data", None) if r is not None else None
        except Exception:
            pass

    if not license_row and req_email:
        try:
            r = await _exec_sb(
                supabase.table("licenses")
                .select("*")
                .eq("email", req_email)
                .eq("active", True)
                .maybe_single(),
                sb_execute,
            )
            license_row = getattr(r, "data", None) if r is not None else None
        except Exception:
            pass

    if license_row and license_row.get("plan") == "team":
        try:
            key = license_row.get("license_key") or req_key
            if key:
                tr = await _exec_sb(
                    supabase.table("teams")
                    .select("brand_voice")
                    .eq("license_key", key)
                    .eq("active", True)
                    .maybe_single(),
                    sb_execute,
                )
                if tr and getattr(tr, "data", None):
                    brand_voice = tr.data.get("brand_voice")
                else:
                    mr = await _exec_sb(
                        supabase.table("team_members")
                        .select("teams(brand_voice)")
                        .eq("member_key", key)
                        .maybe_single(),
                        sb_execute,
                    )
                    if mr and mr.data and mr.data.get("teams"):
                        brand_voice = mr.data["teams"].get("brand_voice")
        except Exception:
            pass

    return license_row, brand_voice


async def record_rewrite_usage(
    supabase: Any,
    sb_execute: Callable,
    *,
    user_id: str,
    team_id: Optional[str],
    cost_usd: float,
    usage_source: Literal["subscription", "credits"] = "subscription",
) -> None:
    """Upsert today's usage_logs row; split subscription vs credit rewrites."""
    if not supabase:
        return
    today = _today_utc()
    ds = today.isoformat()
    month = _month_key(today)
    cost_usd = round(float(cost_usd or 0.0), 6)

    if usage_source == "credits":
        try:
            bal_row = await _exec_sb(
                supabase.table("user_profiles")
                .select("credit_balance")
                .eq("id", user_id)
                .maybe_single(),
                sb_execute,
            )
            bdata = getattr(bal_row, "data", None) if bal_row is not None else None
            cur = int(bdata.get("credit_balance") or 0) if bdata else 0
            if cur < 1:
                print(f"[usage_logs] credit_balance exhausted for {user_id}")
                return
            await _exec_sb(
                supabase.table("user_profiles")
                .update({"credit_balance": cur - 1})
                .eq("id", user_id),
                sb_execute,
            )
        except Exception as e:
            print(f"[user_profiles] credit decrement failed: {e}")
            return

    try:
        existing = await _exec_sb(
            supabase.table("usage_logs")
            .select(
                "id,rewrite_count,estimated_cost_usd,subscription_rewrites,credit_rewrites"
            )
            .eq("user_id", user_id)
            .eq("date", ds)
            .maybe_single(),
            sb_execute,
        )
        row = getattr(existing, "data", None) if existing is not None else None
        if row and row.get("id"):
            sub0 = int(row.get("subscription_rewrites") or 0)
            cr0 = int(row.get("credit_rewrites") or 0)
            if usage_source == "subscription":
                sub0 += 1
            else:
                cr0 += 1
            new_total = sub0 + cr0
            new_cost = float(row.get("estimated_cost_usd") or 0.0) + cost_usd
            await _exec_sb(
                supabase.table("usage_logs")
                .update(
                    {
                        "rewrite_count": new_total,
                        "subscription_rewrites": sub0,
                        "credit_rewrites": cr0,
                        "estimated_cost_usd": round(new_cost, 6),
                        "month": month,
                        "team_id": team_id,
                    }
                )
                .eq("id", row["id"]),
                sb_execute,
            )
        else:
            sub1 = 1 if usage_source == "subscription" else 0
            cr1 = 1 if usage_source == "credits" else 0
            await _exec_sb(
                supabase.table("usage_logs").insert(
                    {
                        "user_id": user_id,
                        "team_id": team_id,
                        "rewrite_count": sub1 + cr1,
                        "subscription_rewrites": sub1,
                        "credit_rewrites": cr1,
                        "date": ds,
                        "month": month,
                        "estimated_cost_usd": cost_usd,
                    }
                ),
                sb_execute,
            )
    except Exception as e:
        print(f"[usage_logs] upsert failed: {e}")


async def today_total_cost_usd(
    supabase: Any,
    sb_execute: Callable,
    user_id: str,
) -> float:
    _, c = await _get_today_usage_row(supabase, sb_execute, user_id, _today_utc())
    return round(c, 6)


async def apply_cost_pause(
    supabase: Any,
    sb_execute: Callable,
    user_id: str,
) -> None:
    until = (datetime.now(timezone.utc) + timedelta(hours=COST_PAUSE_HOURS)).isoformat()
    try:
        await _exec_sb(
            supabase.table("user_profiles")
            .update({"cost_paused_until": until, "cost_flagged": True})
            .eq("id", user_id),
            sb_execute,
        )
    except Exception as e:
        print(f"[cost_pause] failed: {e}")


def _normalize_pause_dt(raw: Any) -> Optional[datetime]:
    if not raw:
        return None
    try:
        if isinstance(raw, str):
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        else:
            dt = raw
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


async def check_rate_limit_impl(
    *,
    supabase: Any,
    sb_execute: Callable,
    get_user_from_token: Callable[[Optional[str]], Optional[dict]],
    request: Any,
    authorization: Optional[str],
) -> dict[str, Any]:
    """
    Core rate limit for /rewrite and /generate.
    Monthly subscription quota first, then credits. Config from ``plan_config`` (cached).
    """
    empty_usage = UsageMetadata(
        allowed=True,
        remaining_daily=None,
        remaining_monthly=None,
        percent_used=0.0,
        usage_warning=False,
        reset_in=format_reset_days_month_utc(),
    )

    if not supabase:
        u = get_user_from_token(authorization)
        uid = u.get("sub") if u else None
        return {
            "user_id": uid,
            "email": "",
            "license_key": "",
            "plan": "free",
            "limit": -1,
            "used": 0,
            "has_license": False,
            "brand_voice": None,
            "degraded": False,
            "persistence": "none",
            "allowed": True,
            "remaining_daily": None,
            "remaining_monthly": None,
            "percent_used": 0.0,
            "usage_warning": False,
            "reset_in": empty_usage.reset_in,
            "usage_meta": empty_usage.model_dump(),
            "team_id": None,
            "resolved_user_id": None,
        }

    snap = await get_commerce_snapshot(supabase, sb_execute)
    if snap.maintenance_mode():
        raise HTTPException(
            status_code=503,
            detail={"error": "maintenance", "message": "ReplyPals is temporarily unavailable. Try again soon."},
        )

    user = get_user_from_token(authorization)
    user_id = user.get("sub") if user else None
    user_email = user.get("email") if user else None

    try:
        body_bytes = await request.body()
        body_raw = json.loads(body_bytes) if body_bytes else {}
        req_email = (user_email or body_raw.get("email", "")).strip().lower()
        req_anon = (body_raw.get("anon_id") or "").strip()
        req_key = (body_raw.get("license_key") or "").strip()
        if not req_email and req_anon:
            req_email = _synthetic_email_from_anon_id(req_anon) or ""
    except Exception:
        req_email = (user_email or "").strip().lower()
        req_anon = ""
        req_key = ""

    license_row, bv = await fetch_active_license_row(
        supabase, sb_execute, req_key, user_id, req_email
    )
    brand_voice = bv
    license_key = ""
    has_license = False
    team_id: Optional[str] = None

    if license_row:
        has_license = True
        license_key = (license_row.get("license_key") or req_key or "").strip()
        lk = license_row.get("license_key") or req_key
        if license_row.get("plan") == "team" and lk:
            try:
                tr = await _exec_sb(
                    supabase.table("teams")
                    .select("id")
                    .eq("license_key", lk)
                    .eq("active", True)
                    .maybe_single(),
                    sb_execute,
                )
                if tr and getattr(tr, "data", None):
                    team_id = tr.data.get("id")
            except Exception:
                pass

    resolved_uid: Optional[str] = None
    if user_id:
        try:
            resolved_uid = str(uuid.UUID(str(user_id)))
        except Exception:
            resolved_uid = None
    if not resolved_uid and license_row and license_row.get("user_id"):
        try:
            resolved_uid = str(uuid.UUID(str(license_row["user_id"])))
        except Exception:
            resolved_uid = None
    if not resolved_uid and req_email:
        try:
            resolved_uid = str(
                uuid.uuid5(uuid.NAMESPACE_DNS, f"replypals:{req_email.lower().strip()}")
            )
        except Exception:
            resolved_uid = None
    if not resolved_uid and license_row and license_row.get("email"):
        em = (license_row.get("email") or "").strip().lower()
        if em:
            try:
                resolved_uid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"replypals:{em}"))
            except Exception:
                resolved_uid = None

    billing = await _fetch_user_billing_row(supabase, sb_execute, resolved_uid)
    cost_paused_until = _normalize_pause_dt(billing.get("cost_paused_until") if billing else None)
    credit_balance = int(billing.get("credit_balance") or 0) if billing else 0
    credit_spent = float(billing.get("credit_spent_usd") or 0) if billing else 0.0
    country_code = _resolve_user_country(billing)

    if billing and billing.get("cost_flagged"):
        raise HTTPException(
            status_code=429,
            detail=CostGuardrailBody().model_dump(),
        )

    plan = "free"
    seat_count = 1
    if billing:
        plan = _normalize_plan(billing.get("plan"), snap)
        seat_count = int(billing.get("seat_count") or 1)
    elif license_row:
        plan = _normalize_plan(license_row.get("plan", "starter"), snap)

    warn_pct = snap.usage_warning_percent()
    upg_plan = _upgrade_to(plan)
    loc_upgrade = format_upgrade_price_for_plan(snap, upg_plan, country_code)
    nudge_payload = _build_nudge_payload(snap, plan, credit_spent, country_code)

    m_cap_prebonus = plan_monthly_cap(snap, plan, 0)
    if m_cap_prebonus is None:
        reset_m = format_reset_days_month_utc()
        um = UsageMetadata(
            allowed=True,
            source="subscription",
            remaining_daily=None,
            remaining_monthly=None,
            credit_balance=credit_balance,
            percent_used=0.0,
            usage_warning=False,
            reset_in=reset_m,
            localized_upgrade_price=loc_upgrade,
            nudge=nudge_payload,
        )
        return {
            "user_id": user_id,
            "email": req_email,
            "license_key": license_key,
            "plan": plan,
            "limit": -1,
            "used": 0,
            "has_license": has_license,
            "brand_voice": brand_voice,
            "degraded": False,
            "persistence": "strong",
            "allowed": True,
            "usage_source": "subscription",
            "remaining_daily": None,
            "remaining_monthly": None,
            "credit_balance": credit_balance,
            "percent_used": 0.0,
            "usage_warning": False,
            "reset_in": reset_m,
            "usage_meta": um.model_dump(),
            "team_id": team_id,
            "resolved_user_id": resolved_uid,
        }

    now_utc = datetime.now(timezone.utc)
    if cost_paused_until and now_utc < cost_paused_until:
        sec = max(1, int((cost_paused_until - now_utc).total_seconds()))
        raise HTTPException(
            status_code=429,
            detail=AccountPausedBody(
                reset_in=format_reset_in(sec),
            ).model_dump(),
        )

    if not resolved_uid:
        raise HTTPException(
            status_code=400,
            detail="Missing identity: sign in, pass anon_id, email, or a valid license_key.",
        )

    bonus = 0
    if plan == "free":
        try:
            r = await _exec_sb(
                supabase.table("free_users")
                .select("bonus_rewrites")
                .eq("user_id", resolved_uid)
                .maybe_single(),
                sb_execute,
            )
            if r and getattr(r, "data", None):
                bonus = int(r.data.get("bonus_rewrites") or 0)
            elif req_email:
                r2 = await _exec_sb(
                    supabase.table("free_users")
                    .select("bonus_rewrites")
                    .eq("email", req_email)
                    .maybe_single(),
                    sb_execute,
                )
                if r2 and getattr(r2, "data", None):
                    bonus = int(r2.data.get("bonus_rewrites") or 0)
        except Exception:
            bonus = 0

    m_cap = plan_monthly_cap(snap, plan, 0)
    if plan == "free" and m_cap is not None:
        m_cap = int(m_cap) + bonus

    month_k = _month_key()
    monthly_sub_used = await _sum_subscription_rewrites_month(
        supabase, sb_execute, resolved_uid, month_k
    )
    monthly_used_total, _month_cost = await _sum_usage_for_month(
        supabase, sb_execute, resolved_uid, month_k
    )

    blocked_monthly = m_cap is not None and monthly_sub_used >= m_cap
    can_use_subscription = not blocked_monthly

    usage_source: Literal["subscription", "credits"] = "subscription"
    if can_use_subscription:
        usage_source = "subscription"
    elif credit_balance > 0:
        usage_source = "credits"
    else:
        reset_m = format_reset_days_month_utc()
        upg = _upgrade_to(plan)
        crow, mult = resolve_country_row(snap, country_code)
        tgt = snap.plans.get(upg)
        loc_price = ""
        if tgt and tgt.base_price_usd is not None:
            loc_price = format_money(
                crow.currency_symbol,
                localize_usd_price(float(tgt.base_price_usd), mult),
            )
        cheap = cheapest_active_bundle(snap)
        cb_key = cheap.bundle_key if cheap else ""
        cb_price = ""
        if cheap:
            cb_price = format_money(
                crow.currency_symbol,
                localize_usd_price(float(cheap.base_price_usd), mult),
            )
        if blocked_monthly:
            msg = _friendly_limit_message(plan, "monthly", snap, country_code, m_cap)
            raise HTTPException(
                status_code=429,
                detail=LimitExceededBody(
                    type="monthly",
                    reset_in=reset_m,
                    upgrade_to=upg,
                    buy_credits=True,
                    message=msg,
                    localized_price=loc_price,
                    cheapest_bundle=cb_key,
                    cheapest_bundle_price=cb_price,
                ).model_dump(),
            )
        msg = _friendly_limit_message(plan, "no_credits", snap, country_code, m_cap)
        raise HTTPException(
            status_code=429,
            detail=LimitExceededBody(
                type="no_credits",
                reset_in=None,
                upgrade_to=upg,
                buy_credits=True,
                message=msg,
                localized_price=loc_price,
                cheapest_bundle=cb_key,
                cheapest_bundle_price=cb_price,
            ).model_dump(),
        )

    remaining_m: Optional[int] = None
    remaining_d: Optional[int] = None
    if usage_source == "subscription":
        if m_cap is not None:
            remaining_m = max(0, m_cap - monthly_sub_used)
    else:
        remaining_m = max(0, credit_balance - 1)
        remaining_d = None

    pct = 0.0
    if m_cap and m_cap > 0:
        pct = min(100.0, (monthly_sub_used / m_cap) * 100.0)

    warn = pct >= warn_pct and usage_source == "subscription"
    reset_in = format_reset_days_month_utc()

    bal_after = credit_balance if usage_source == "subscription" else max(0, credit_balance - 1)

    um = UsageMetadata(
        allowed=True,
        source=usage_source,
        remaining_daily=remaining_d,
        remaining_monthly=remaining_m,
        credit_balance=bal_after,
        percent_used=round(pct, 2),
        usage_warning=warn,
        reset_in=reset_in,
        message=_warning_message_if_needed(pct, warn_pct) if usage_source == "subscription" else None,
        localized_upgrade_price=loc_upgrade,
        nudge=nudge_payload,
    )

    legacy_used = monthly_used_total if usage_source == "subscription" else monthly_sub_used
    legacy_limit = m_cap if m_cap is not None else -1

    return {
        "user_id": user_id,
        "email": req_email,
        "license_key": license_key,
        "plan": plan,
        "limit": legacy_limit,
        "used": legacy_used,
        "has_license": has_license,
        "brand_voice": brand_voice,
        "degraded": False,
        "persistence": "strong",
        "window_start": None,
        "allowed": True,
        "usage_source": usage_source,
        "remaining_daily": remaining_d,
        "remaining_monthly": remaining_m,
        "credit_balance": bal_after,
        "percent_used": um.percent_used,
        "usage_warning": warn,
        "reset_in": um.reset_in,
        "usage_meta": um.model_dump(),
        "team_id": team_id,
        "resolved_user_id": resolved_uid,
    }
