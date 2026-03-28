"""
ReplyPals — plan limits, usage_logs–based rate limits, and cost guardrails.

Effective limits = merge of DEFAULT_PLAN_LIMITS with JSON stored in Supabase
`app_settings` row key ``plan_limits`` (editable from the admin UI).
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

# ─── app_settings key ────────────────────────────────────────────────────────
APP_SETTINGS_PLAN_LIMITS_KEY = "plan_limits"

# Built-in defaults (used when DB row missing or invalid; also the merge base)
DEFAULT_PLAN_LIMITS: dict[str, dict[str, Optional[int]]] = {
    "free": {"monthly": 10, "daily": None},
    "starter": {"monthly": 25, "daily": None},
    "pro": {"monthly": 300, "daily": 20},
    "team": {"monthly": 150, "daily": 15},  # per seat
    "enterprise": {"monthly": None, "daily": None},
}

# Backward-compatible alias
PLAN_LIMITS = DEFAULT_PLAN_LIMITS

_PLAN_LIMITS_CACHE: dict[str, Any] = {"data": None, "ts": 0.0}
PLAN_LIMITS_TTL_SEC = 60.0


def _copy_default_limits() -> dict[str, dict[str, Optional[int]]]:
    return {k: {"monthly": v["monthly"], "daily": v["daily"]} for k, v in DEFAULT_PLAN_LIMITS.items()}


def merge_plan_limits_from_raw(
    base: dict[str, dict[str, Optional[int]]],
    raw: Any,
) -> dict[str, dict[str, Optional[int]]]:
    """Overlay ``raw`` (from JSON) onto ``base``; unknown keys ignored."""
    out = {k: {"monthly": v["monthly"], "daily": v["daily"]} for k, v in base.items()}
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


def load_plan_limits_merged(supabase: Any) -> dict[str, dict[str, Optional[int]]]:
    """Synchronous load: defaults merged with ``app_settings.plan_limits`` JSON."""
    merged = _copy_default_limits()
    if not supabase:
        return merged
    try:
        r = (
            supabase.table("app_settings")
            .select("value")
            .eq("key", APP_SETTINGS_PLAN_LIMITS_KEY)
            .maybe_single()
            .execute()
        )
        if r.data and r.data.get("value"):
            raw = json.loads(r.data["value"])
            merged = merge_plan_limits_from_raw(merged, raw)
    except Exception as e:
        print(f"[plan_limits] load_plan_limits_merged: {e}")
    return merged


def invalidate_plan_limits_cache() -> None:
    _PLAN_LIMITS_CACHE["data"] = None
    _PLAN_LIMITS_CACHE["ts"] = 0.0


async def get_plan_limits(supabase: Any, sb_execute: Callable) -> dict[str, dict[str, Optional[int]]]:
    """Cached effective limits for rate limiting (60s TTL)."""
    now = time.time()
    if (
        _PLAN_LIMITS_CACHE["data"] is not None
        and now - float(_PLAN_LIMITS_CACHE["ts"] or 0) < PLAN_LIMITS_TTL_SEC
    ):
        return _PLAN_LIMITS_CACHE["data"]

    def _sync_load() -> dict[str, dict[str, Optional[int]]]:
        return load_plan_limits_merged(supabase)

    merged = await asyncio.to_thread(_sync_load)
    _PLAN_LIMITS_CACHE["data"] = merged
    _PLAN_LIMITS_CACHE["ts"] = now
    return merged

COST_GUARDRAIL_USD = 0.50
COST_PAUSE_HOURS = 24

# ─── Pydantic error / response schemas (v2) ──────────────────────────────────


class LimitExceededBody(BaseModel):
    """429 when plan daily/monthly rewrite cap is exceeded."""

    error: Literal["limit_exceeded"] = "limit_exceeded"
    type: Literal["daily", "monthly"]
    reset_in: str
    upgrade_to: Literal["starter", "pro", "team", "enterprise"]
    message: str


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
    remaining_daily: Optional[int] = None
    remaining_monthly: Optional[int] = None
    percent_used: float = 0.0
    usage_warning: bool = False
    reset_in: str = ""
    message: Optional[str] = None


class EnterpriseUsageResponse(BaseModel):
    total_rewrites: int
    per_seat: list[dict[str, Any]]
    cost_estimate_usd: float


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


def _upgrade_to(plan: str) -> Literal["starter", "pro", "team", "enterprise"]:
    if plan == "free":
        return "starter"
    if plan == "starter":
        return "pro"
    if plan == "pro":
        return "team"
    return "enterprise"


def _friendly_limit_message(plan: str, limit_type: str, reset_in: str) -> str:
    if limit_type == "monthly":
        if plan == "free":
            return (
                "You've used all 10 free rewrites. "
                "Upgrade to Starter for just $2/mo!"
            )
        if plan == "starter":
            return "Upgrade to Pro for 300 rewrites/month!"
        if plan == "pro":
            return "Upgrade to Team — 5 seats for $25/mo!"
        return "Contact us to adjust your Enterprise limits."
    # daily
    if plan == "pro":
        return f"Daily limit reached. Resets in {reset_in}."
    return f"Daily limit reached. Resets in {reset_in}."


def _warning_message_if_needed(percent_used: float) -> Optional[str]:
    if percent_used >= 80.0:
        return "You've used 80% of your plan this month."
    return None


async def _exec_sb(builder, sb_execute: Callable) -> Any:
    return await sb_execute(builder, timeout_sec=3.0)


def _normalize_plan(raw: Optional[str], limits: dict[str, dict[str, Optional[int]]]) -> str:
    p = (raw or "free").strip().lower()
    if p not in limits:
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
                "id,email,plan,stripe_customer_id,billing_cycle_start,seat_count,cost_paused_until"
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
) -> None:
    """Upsert today's usage_logs row (+rewrite, +cost)."""
    if not supabase:
        return
    today = _today_utc()
    ds = today.isoformat()
    month = _month_key(today)
    cost_usd = round(float(cost_usd or 0.0), 6)

    try:
        existing = await _exec_sb(
            supabase.table("usage_logs")
            .select("id,rewrite_count,estimated_cost_usd")
            .eq("user_id", user_id)
            .eq("date", ds)
            .maybe_single(),
            sb_execute,
        )
        row = getattr(existing, "data", None) if existing is not None else None
        if row and row.get("id"):
            new_c = int(row.get("rewrite_count") or 0) + 1
            new_cost = float(row.get("estimated_cost_usd") or 0.0) + cost_usd
            await _exec_sb(
                supabase.table("usage_logs")
                .update(
                    {
                        "rewrite_count": new_c,
                        "estimated_cost_usd": round(new_cost, 6),
                        "month": month,
                        "team_id": team_id,
                    }
                )
                .eq("id", row["id"]),
                sb_execute,
            )
        else:
            await _exec_sb(
                supabase.table("usage_logs").insert(
                    {
                        "user_id": user_id,
                        "team_id": team_id,
                        "rewrite_count": 1,
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
            .update({"cost_paused_until": until})
            .eq("id", user_id),
            sb_execute,
        )
    except Exception as e:
        print(f"[cost_pause] failed: {e}")


def _monthly_cap(
    plan: str,
    seat_count: int,
    limits: dict[str, dict[str, Optional[int]]],
) -> Optional[int]:
    caps = limits.get(plan, limits["free"])
    m = caps.get("monthly")
    if m is None:
        return None
    # Team: "150/mo per seat" = per seat holder (not pooled × seats)
    return int(m)


def _daily_cap(
    plan: str,
    seat_count: int,
    limits: dict[str, dict[str, Optional[int]]],
) -> Optional[int]:
    caps = limits.get(plan, limits["free"])
    d = caps.get("daily")
    if d is None:
        return None
    return int(d)


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
    Returns a dict merged with legacy keys (used, limit, plan, …) plus usage metadata fields.
    """
    empty_usage = UsageMetadata(
        allowed=True,
        remaining_daily=None,
        remaining_monthly=None,
        percent_used=0.0,
        usage_warning=False,
        reset_in=format_reset_in(_seconds_until_end_of_month_utc()),
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

    limits = await get_plan_limits(supabase, sb_execute)

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

    plan = "free"
    seat_count = 1
    if billing:
        plan = _normalize_plan(billing.get("plan"), limits)
        seat_count = int(billing.get("seat_count") or 1)
    elif license_row:
        plan = _normalize_plan(license_row.get("plan", "starter"), limits)

    raw_monthly_cap = _monthly_cap(plan, seat_count, limits)
    raw_daily_cap = _daily_cap(plan, seat_count, limits)
    if raw_monthly_cap is None and raw_daily_cap is None:
        reset_m = format_reset_in(_seconds_until_end_of_month_utc())
        um = UsageMetadata(
            allowed=True,
            remaining_daily=None,
            remaining_monthly=None,
            percent_used=0.0,
            usage_warning=False,
            reset_in=reset_m,
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
            "remaining_daily": None,
            "remaining_monthly": None,
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

    m_cap = _monthly_cap(plan, seat_count, limits)
    d_cap = _daily_cap(plan, seat_count, limits)
    if plan == "free" and m_cap is not None:
        m_cap = int(m_cap) + bonus

    month_k = _month_key()
    monthly_used, _month_cost = await _sum_usage_for_month(supabase, sb_execute, resolved_uid, month_k)
    daily_used, _ = await _get_today_usage_row(supabase, sb_execute, resolved_uid, _today_utc())

    remaining_m: Optional[int] = None
    remaining_d: Optional[int] = None
    if m_cap is not None:
        remaining_m = max(0, m_cap - monthly_used)
    if d_cap is not None:
        remaining_d = max(0, d_cap - daily_used)

    pct = 0.0
    if m_cap and m_cap > 0:
        pct = min(100.0, (monthly_used / m_cap) * 100.0)
    elif d_cap and d_cap > 0:
        pct = min(100.0, (daily_used / d_cap) * 100.0)

    warn = pct >= 80.0
    reset_daily = format_reset_in(_seconds_until_end_of_day_utc())
    reset_monthly = format_reset_in(_seconds_until_end_of_month_utc())
    reset_in = reset_monthly

    # Enforce caps
    if d_cap is not None and daily_used >= d_cap:
        msg = _friendly_limit_message(plan, "daily", reset_daily)
        raise HTTPException(
            status_code=429,
            detail=LimitExceededBody(
                type="daily",
                reset_in=reset_daily,
                upgrade_to=_upgrade_to(plan),
                message=msg,
            ).model_dump(),
        )
    if m_cap is not None and monthly_used >= m_cap:
        msg = _friendly_limit_message(plan, "monthly", reset_monthly)
        raise HTTPException(
            status_code=429,
            detail=LimitExceededBody(
                type="monthly",
                reset_in=reset_monthly,
                upgrade_to=_upgrade_to(plan),
                message=msg,
            ).model_dump(),
        )

    um = UsageMetadata(
        allowed=True,
        remaining_daily=remaining_d,
        remaining_monthly=remaining_m,
        percent_used=round(pct, 2),
        usage_warning=warn,
        reset_in=reset_in,
        message=_warning_message_if_needed(pct),
    )

    legacy_used = monthly_used
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
        "remaining_daily": remaining_d,
        "remaining_monthly": remaining_m,
        "percent_used": um.percent_used,
        "usage_warning": warn,
        "reset_in": um.reset_in,
        "usage_meta": um.model_dump(),
        "team_id": team_id,
        "resolved_user_id": resolved_uid,
    }
