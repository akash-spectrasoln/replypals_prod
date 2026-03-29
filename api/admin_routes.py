"""
ReplyPals Admin Dashboard — API Routes
All endpoints require JWT auth via require_admin dependency.
"""

import os
import re
import secrets
import time
import json
import uuid
import asyncio
import smtplib
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText
from typing import Optional, Dict, Any

import jwt
from fastapi import APIRouter, Request, HTTPException, Header, Depends, BackgroundTasks
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

# ═══════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "changeme123!")
ADMIN_SECRET_KEY = os.getenv("ADMIN_SECRET_KEY", secrets.token_hex(32))
ADMIN_ALLOWED_IP = os.getenv("ADMIN_ALLOWED_IP", "")

# In-memory stores
_login_attempts: Dict[str, list] = {}   # ip -> [timestamps]
_blocked_ips: Dict[str, float] = {}     # ip -> blocked_until
_active_sessions: Dict[str, dict] = {}  # jti -> {issued, expires, ip}
_announcement_tasks: Dict[str, dict] = {}  # task_id -> progress

router = APIRouter(prefix="/admin", tags=["admin"])


# ═══════════════════════════════════════════
# AUTH HELPERS
# ═══════════════════════════════════════════
def _check_ip_block(ip: str):
    if ip in _blocked_ips:
        if time.time() < _blocked_ips[ip]:
            raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")
        else:
            del _blocked_ips[ip]
            _login_attempts.pop(ip, None)


def _record_attempt(ip: str):
    now = time.time()
    attempts = _login_attempts.get(ip, [])
    attempts = [t for t in attempts if now - t < 900]  # 15 min window
    attempts.append(now)
    _login_attempts[ip] = attempts
    if len(attempts) >= 5:
        _blocked_ips[ip] = now + 900  # block 15 min


def require_admin(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, ADMIN_SECRET_KEY, algorithms=["HS256"])
        if payload.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Not admin")
        jti = payload.get("jti", "")
        # Multi-worker-safe: only enforce in-memory session revocation
        # when this worker has an active session map populated.
        if jti and _active_sessions and jti not in _active_sessions:
            raise HTTPException(status_code=401, detail="Session revoked")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def _audit(action: str, details: dict, ip: str, supabase):
    if supabase:
        try:
            supabase.table("admin_audit_log").insert({
                "action": action, "details": details, "ip": ip
            }).execute()
        except Exception:
            pass


def _mask_key(key: str) -> str:
    if not key or len(key) < 8:
        return "••••••••"
    return key[:4] + "•" * max(len(key) - 8, 8) + key[-4:]


# ═══════════════════════════════════════════
# MODELS
# ═══════════════════════════════════════════
class LoginRequest(BaseModel):
    username: str
    password: str

class CreateLicenseReq(BaseModel):
    email: str
    plan: str = "pro"
    note: str = ""
    send_email: bool = True

class UpdateLicenseReq(BaseModel):
    active: bool

class UpdateTeamReq(BaseModel):
    name: Optional[str] = None
    seat_count: Optional[int] = None
    brand_voice: Optional[str] = None

class SendEmailReq(BaseModel):
    to: str
    subject: str
    body: str

class AnnouncementReq(BaseModel):
    target: str  # all_free | pro | starter | team_admins | everyone
    subject: str
    body: str

class ChangePasswordReq(BaseModel):
    current_password: str
    new_password: str


class AdminOverridePlanBody(BaseModel):
    plan: str


class AdminAdjustCreditsBody(BaseModel):
    delta: int

class UpdateSettingsReq(BaseModel):
    settings: dict


class PlanLimitsPutReq(BaseModel):
    """Body for PUT /admin/plan-limits — full plan → {monthly, daily} map."""

    limits: Dict[str, Any]


class UpdateEnvKeyReq(BaseModel):
    key: str
    value: str

class TestKeyReq(BaseModel):
    provider: str
    api_key: str


# ═══════════════════════════════════════════
# SERVE ADMIN PAGE
# ═══════════════════════════════════════════
@router.get("", response_class=HTMLResponse, include_in_schema=False)
@router.get("/", response_class=HTMLResponse, include_in_schema=False)
async def admin_page():
    admin_path = os.path.join(os.path.dirname(__file__), "admin", "index.html")
    if os.path.exists(admin_path):
        return FileResponse(admin_path)
    raise HTTPException(404, "Admin panel not found")


# ═══════════════════════════════════════════
# LOGIN
# ═══════════════════════════════════════════
@router.post("/login")
async def admin_login(body: LoginRequest, request: Request):
    ip = request.client.host if request.client else "unknown"

    if ADMIN_ALLOWED_IP and ip not in ADMIN_ALLOWED_IP.split(","):
        raise HTTPException(403, "IP not allowed")

    _check_ip_block(ip)

    valid = (
        secrets.compare_digest(body.username, ADMIN_USERNAME) and
        secrets.compare_digest(body.password, ADMIN_PASSWORD)
    )

    if not valid:
        _record_attempt(ip)
        await asyncio.sleep(1)  # brute-force delay
        raise HTTPException(401, "Invalid credentials")

    # Clear attempts on success
    _login_attempts.pop(ip, None)

    jti = uuid.uuid4().hex
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    token = jwt.encode(
        {"role": "admin", "jti": jti, "exp": exp, "iat": datetime.now(timezone.utc)},
        ADMIN_SECRET_KEY,
        algorithm="HS256"
    )
    _active_sessions[jti] = {
        "issued": datetime.now(timezone.utc).isoformat(),
        "expires": exp.isoformat(),
        "ip": ip
    }
    return {"token": token, "expires_at": exp.isoformat()}


# ═══════════════════════════════════════════
# DASHBOARD STATS
# ═══════════════════════════════════════════
@router.get("/dashboard-stats")
async def dashboard_stats(request: Request, admin=Depends(require_admin)):
    from main import supabase
    stats = {
        "total_users": 0, "users_today": 0,
        "registered_users_total": 0, "registered_users_today": 0,
        "anonymous_users_total": 0, "anonymous_users_today": 0,
        "lead_users_total": 0, "lead_users_today": 0,
        "active_licenses": 0, "licenses_today": 0,
        "rewrites_today": 0, "rewrites_yesterday": 0,
        "mrr": 0, "mrr_today": 0,
        "recent_activity": [],
        "db_connected": True,
        "db_error": None,
    }
    if not supabase:
        stats["db_connected"] = False
        stats["db_error"] = "Supabase client not configured"
        return stats

    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday = today - timedelta(days=1)
    had_db_error = False
    first_db_error = None

    try:
        # User census from DB:
        # - registered users: user_profiles rows
        # - anonymous temporary users: free_users with synthetic anon email
        # - lead users: free_users non-anon rows not yet linked to user_id
        pr = supabase.table("user_profiles").select("id,created_at", count="exact").execute()
        stats["registered_users_total"] = pr.count if hasattr(pr, 'count') and pr.count else len(pr.data or [])
        stats["registered_users_today"] = sum(
            1 for row in (pr.data or [])
            if (row.get("created_at") or "") >= today.isoformat()
        )

        # Use exact count queries so we are not capped by PostgREST default max rows (~1000)
        # when scanning free_users for anon/lead badges.
        try:
            ar = supabase.table("free_users").select("id", count="exact").like(
                "email", "anon_%@replypal.internal"
            ).execute()
            anon_total = int(ar.count or 0)
        except Exception:
            anon_total = 0
        try:
            ar2 = supabase.table("free_users").select("id", count="exact").like(
                "email", "anon_%@replypal.internal"
            ).gte("created_at", today.isoformat()).execute()
            anon_today = int(ar2.count or 0)
        except Exception:
            anon_today = 0
        try:
            lr = supabase.table("free_users").select("id", count="exact").is_(
                "user_id", "null"
            ).not_.like("email", "anon_%@replypal.internal").execute()
            lead_total = int(lr.count or 0)
        except Exception:
            lead_total = 0
        try:
            lr2 = supabase.table("free_users").select("id", count="exact").is_(
                "user_id", "null"
            ).not_.like("email", "anon_%@replypal.internal").gte(
                "created_at", today.isoformat()
            ).execute()
            lead_today = int(lr2.count or 0)
        except Exception:
            lead_today = 0

        stats["anonymous_users_total"] = anon_total
        stats["anonymous_users_today"] = anon_today
        stats["lead_users_total"] = lead_total
        stats["lead_users_today"] = lead_today

        # Expose a consistent total used by dashboard cards.
        stats["total_users"] = (
            stats["registered_users_total"] + anon_total + lead_total
        )
        stats["users_today"] = (
            stats["registered_users_today"] + anon_today + lead_today
        )
    except Exception as e:
        had_db_error = True
        if not first_db_error:
            first_db_error = str(e)

    try:
        # Licenses
        r = supabase.table("licenses").select("id,plan", count="exact").eq("active", True).execute()
        stats["active_licenses"] = r.count if hasattr(r, 'count') and r.count else len(r.data or [])

        r2 = supabase.table("licenses").select("id", count="exact").gte("created_at", today.isoformat()).execute()
        stats["licenses_today"] = r2.count if hasattr(r2, 'count') and r2.count else len(r2.data or [])

        # MRR calc
        plans = r.data or []
        price_map = {"starter": 2, "pro": 9, "team": 25}
        stats["mrr"] = sum(price_map.get(p.get("plan", "pro"), 9) for p in plans)
    except Exception as e:
        had_db_error = True
        if not first_db_error:
            first_db_error = str(e)

    try:
        # Rewrites today — use llm_call_logs (source of truth, same as rate limit)
        r = supabase.table("llm_call_logs").select("id", count="exact") \
            .eq("status", "success").gte("created_at", today.isoformat()).execute()
        stats["rewrites_today"] = r.count if hasattr(r, 'count') and r.count else len(r.data or [])

        r2 = supabase.table("llm_call_logs").select("id", count="exact") \
            .eq("status", "success") \
            .gte("created_at", yesterday.isoformat()).lt("created_at", today.isoformat()).execute()
        stats["rewrites_yesterday"] = r2.count if hasattr(r2, 'count') and r2.count else len(r2.data or [])
    except Exception as e:
        had_db_error = True
        if not first_db_error:
            first_db_error = str(e)

    try:
        # Recent activity
        r = supabase.table("api_logs").select("*").order("created_at", desc=True).limit(20).execute()
        stats["recent_activity"] = r.data or []
    except Exception as e:
        had_db_error = True
        if not first_db_error:
            first_db_error = str(e)

    if had_db_error:
        stats["db_connected"] = False
        stats["db_error"] = first_db_error or "Database temporarily unavailable"

    return stats


# ═══════════════════════════════════════════
# USERS
# ═══════════════════════════════════════════
@router.get("/users")
async def list_users(
    request: Request,
    page: int = 1, limit: int = 50,
    search: str = "", sort: str = "created_at",
    filter: str = "all",
    admin=Depends(require_admin)
):
    from main import supabase, _free_monthly_cap_from_db
    if not supabase:
        return {
            "users": [], "total": 0, "page": page, "limit": limit,
            "db_connected": False, "db_error": "Supabase client not configured"
        }

    free_cap = _free_monthly_cap_from_db()

    try:
        # 1. Fetch all user_profiles
        pr_query = supabase.table("user_profiles").select("*")
        if search:
            pr_query = pr_query.or_(f"email.ilike.%{search}%,full_name.ilike.%{search}%")
        pr_res = pr_query.execute()
        profiles = pr_res.data or []

        # 2. Fetch active licenses (high cap to avoid silently missing records)
        lic_res = supabase.table("licenses").select("*").eq("active", True).limit(20000).execute()
        licenses = lic_res.data or []

        # 3. Fetch free_users (high cap so anonymous/temp users are visible in admin)
        free_res = supabase.table("free_users").select("*").limit(20000).execute()
        free_users = free_res.data or []
    except Exception as e:
        # Degrade gracefully if DB is temporarily unreachable.
        return {
            "users": [], "total": 0, "page": page, "limit": limit,
            "db_connected": False, "db_error": str(e)
        }

    # 4. Merge in Python by email/user_id
    lic_by_uid = {l["user_id"]: l for l in licenses if l.get("user_id")}
    lic_by_email = {l["email"]: l for l in licenses if l.get("email")}
    
    free_by_uid = {f["user_id"]: f for f in free_users if f.get("user_id")}
    free_by_email = {f["email"]: f for f in free_users if f.get("email")}

    merged_users = []
    
    # Process profiles first
    processed_emails = set()
    for p in profiles:
        uid = p["id"]
        email = p.get("email") or ""
        
        lic = lic_by_uid.get(uid) or lic_by_email.get(email) or {}
        free = free_by_uid.get(uid) or free_by_email.get(email) or {}
        
        plan = lic.get("plan") or "free"
        active = lic.get("active") if lic else True
        
        if plan != "free":
            rewrites_used = lic.get("rewrites_used", 0)
            rewrites_limit = lic.get("rewrites_limit", -1)
            reset_date = lic.get("reset_date")
        else:
            rewrites_used = free.get("total_rewrites", free.get("rewrites_used", 0))  # overwritten below from llm_call_logs
            bonus = free.get("bonus_rewrites", 0)
            rewrites_limit = free_cap + bonus
            reset_date = None
            
        merged_users.append({
            "user_id": uid,
            "email": email,
            "plan": plan,
            "active": active,
            "rewrites_used": rewrites_used,
            "rewrites_limit": rewrites_limit,
            "reset_date": reset_date,
            "total_rewrites_alltime": p.get("total_rewrites", 0),
            "avg_score": p.get("avg_score", 0),
            "last_seen": p.get("last_seen", p.get("created_at"))
        })
        if email:
            processed_emails.add(email)

    # Process free users who don't have a profile yet (anonymous)
    for f in free_users:
        if f.get("email") not in processed_emails and f.get("email"):
            email = f["email"]
            uid = f.get("user_id")
            
            lic = lic_by_uid.get(uid) or lic_by_email.get(email) or {}
            plan = lic.get("plan") or "free"
            active = lic.get("active") if lic else True
            
            if plan != "free":
                rewrites_used = lic.get("rewrites_used", 0)
                rewrites_limit = lic.get("rewrites_limit", -1)
                reset_date = lic.get("reset_date")
            else:
                rewrites_used = f.get("total_rewrites", f.get("rewrites_used", 0))
                bonus = f.get("bonus_rewrites", 0)
                rewrites_limit = free_cap + bonus
                reset_date = None
                
            merged_users.append({
                "user_id": uid,
                "email": email,
                "plan": plan,
                "active": active,
                "rewrites_used": rewrites_used,
                "rewrites_limit": rewrites_limit,
                "reset_date": reset_date,
                "total_rewrites_alltime": f.get("total_rewrites", 0),
                "avg_score": f.get("avg_score", 0),
                "last_seen": f.get("last_active", f.get("created_at"))
            })
            processed_emails.add(email)

    # Filtering logic mapping
    filtered = []
    from datetime import datetime, timezone, timedelta
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    
    for u in merged_users:
        email_l = (u.get("email") or "").strip().lower()
        is_anon = email_l.startswith("anon_") and email_l.endswith("@replypal.internal")
        is_registered = bool(u.get("user_id")) and not is_anon
        is_lead = (not u.get("user_id")) and not is_anon

        if filter == "active" and (not u.get("last_seen") or u.get("last_seen") < week_ago):
            continue
        if filter == "inactive" and (u.get("last_seen") and u.get("last_seen") >= week_ago):
            continue
        if filter == "anonymous" and not is_anon:
            continue
        if filter == "registered" and not is_registered:
            continue
        if filter == "lead" and not is_lead:
            continue
        # Since bonus info is only in free_users, we check the original map
        if filter == "referred":
            free = free_by_uid.get(u["user_id"]) or free_by_email.get(u["email"]) or {}
            if free.get("bonus_rewrites", 0) <= 0:
                continue
        if search and search.lower() not in u["email"].lower():
            continue
            
        filtered.append(u)

    # Sorting
    sort_col = sort.replace("-", "")
    desc = sort.startswith("-") or sort_col in ("total_rewrites_alltime", "avg_score", "created_at", "last_seen", "last_active")
    
    # Map sort column if frontend sends old names
    if sort_col == "total_rewrites": sort_col = "total_rewrites_alltime"
    if sort_col == "created_at" or "active" in sort_col: sort_col = "last_seen"
    
    try:
        filtered.sort(key=lambda x: x.get(sort_col, 0) if x.get(sort_col) is not None else "", reverse=desc)
    except Exception:
        pass

    # Pagination
    total = len(filtered)
    offset = (page - 1) * limit
    page_data = filtered[offset:offset+limit]

    # Recompute usage from llm_call_logs (source-of-truth) for visible page.
    # This avoids stale cache values in free_users/licenses rewrite counters.
    try:
        from datetime import datetime, timezone
        month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
        for u in page_data:
            plan = (u.get("plan") or "free").lower()
            if plan in ("pro", "team"):
                # Unlimited plans: keep display simple.
                u["rewrites_used"] = 0
                u["rewrites_limit"] = -1
                continue

            if plan == "starter":
                # Starter is monthly-capped by license key if available.
                lk = None
                lic = lic_by_uid.get(u.get("user_id")) or lic_by_email.get(u.get("email"))
                if lic:
                    lk = lic.get("license_key")
                if lk:
                    c = supabase.table("llm_call_logs").select("id", count="exact") \
                        .eq("status", "success").eq("license_key", lk).gte("created_at", month_start).execute()
                    u["rewrites_used"] = c.count or 0
                continue

            # Free users: all successful calls in rolling 30-day window by user_id/email.
            # (matches entitlement semantics in check_rate_limit)
            from dateutil.relativedelta import relativedelta
            window_start = (datetime.now(timezone.utc) - relativedelta(months=1)).isoformat()
            # Count by both user_id and email, then dedupe by log row id.
            # This captures usage across pre-signup (email/anon) and post-signup (user_id) phases.
            seen_ids = set()
            uid = u.get("user_id")
            em = (u.get("email") or "").strip().lower()
            if uid:
                r_uid = supabase.table("llm_call_logs").select("id") \
                    .eq("status", "success").eq("user_id", uid).gte("created_at", window_start) \
                    .limit(5000).execute()
                for row in (r_uid.data or []):
                    rid = row.get("id")
                    if rid is not None:
                        seen_ids.add(rid)
            if em:
                r_em = supabase.table("llm_call_logs").select("id") \
                    .eq("status", "success").eq("email", em).gte("created_at", window_start) \
                    .limit(5000).execute()
                for row in (r_em.data or []):
                    rid = row.get("id")
                    if rid is not None:
                        seen_ids.add(rid)
            u["rewrites_used"] = len(seen_ids)
            fu_row = None
            if uid:
                fu_row = free_by_uid.get(uid)
            if not fu_row and em:
                fu_row = free_by_email.get(em)
            bsum = int((fu_row or {}).get("bonus_rewrites") or 0)
            u["rewrites_limit"] = free_cap + bsum
    except Exception:
        # Keep page available even if live recount fails.
        pass

    return {
        "users": page_data, "total": total, "page": page, "limit": limit,
        "db_connected": True, "db_error": None
    }

@router.get("/users/{user_id}")
async def get_user_detail(user_id: str, request: Request, admin=Depends(require_admin)):
    from main import supabase, _free_monthly_cap_from_db, _free_monthly_used_llm_logs
    if not supabase:
        raise HTTPException(500, "DB not configured")
        
    # Get profile
    profile = {}
    pr_res = supabase.table("user_profiles").select("*").eq("id", user_id).execute()
    if pr_res.data:
        profile = pr_res.data[0]
        
    email = profile.get("email")
    if not email:
        # Check free_users if no profile
        fr_res = supabase.table("free_users").select("email").eq("user_id", user_id).execute()
        if fr_res.data:
            email = fr_res.data[0].get("email")
            
    # Get free_user data
    free_data = {}
    if email:
        f_res = supabase.table("free_users").select("*").eq("email", email).execute()
        if f_res.data:
            free_data = f_res.data[0]
    elif user_id:
        f_res = supabase.table("free_users").select("*").eq("user_id", user_id).execute()
        if f_res.data:
            free_data = f_res.data[0]
            
    # Get license data
    lic_data = {}
    if email:
        l_res = supabase.table("licenses").select("*").eq("email", email).order("created_at", desc=True).limit(1).execute()
        if l_res.data:
            lic_data = l_res.data[0]
    elif user_id:
        l_res = supabase.table("licenses").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(1).execute()
        if l_res.data:
            lic_data = l_res.data[0]
            
    # Get recent LLM call logs for this user (actual activity history)
    api_logs = []
    try:
        seen_ids = set()
        if profile.get("id"):
            log_res = supabase.table("llm_call_logs").select(
                "id,action,tone,ai_provider,ai_model,status,cost_usd,latency_ms,created_at"
            ).eq("user_id", profile["id"]).order("created_at", desc=True).limit(20).execute()
            api_logs = log_res.data or []
            seen_ids.update([row.get("id") for row in api_logs if row.get("id") is not None])

        # Include pre-signup or anonymous-attributed rows by email too.
        if email:
            log_res_email = supabase.table("llm_call_logs").select(
                "id,action,tone,ai_provider,ai_model,status,cost_usd,latency_ms,created_at"
            ).eq("email", email).order("created_at", desc=True).limit(20).execute()
            for row in (log_res_email.data or []):
                rid = row.get("id")
                if rid not in seen_ids:
                    api_logs.append(row)
                    if rid is not None:
                        seen_ids.add(rid)

            api_logs.sort(key=lambda r: r.get("created_at") or "", reverse=True)
            api_logs = api_logs[:20]
    except Exception:
        pass

    # Source-of-truth usage for detail view
    rewrites_used = 0
    rewrites_limit = 0
    try:
        from datetime import datetime, timezone
        plan = (lic_data.get("plan") or "free").lower() if lic_data else "free"
        if plan in ("pro", "team"):
            rewrites_used = 0
            rewrites_limit = -1
        elif plan == "starter":
            rewrites_limit = int(lic_data.get("rewrites_limit") or 50)
            lk = lic_data.get("license_key")
            if lk:
                c = supabase.table("llm_call_logs").select("id", count="exact") \
                    .eq("status", "success").eq("license_key", lk) \
                    .gte("created_at", datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()) \
                    .execute()
                rewrites_used = c.count or 0
        else:
            em_low = (email or "").strip().lower()
            rewrites_used = await _free_monthly_used_llm_logs(profile.get("id"), em_low)
            rewrites_limit = _free_monthly_cap_from_db() + int(
                (free_data.get("bonus_rewrites") or 0) if free_data else 0
            )
    except Exception:
        pass
        
    return {
        "user_id": user_id,
        "email": email,
        "profile": profile,
        "free_user": free_data,
        "license": lic_data,
        "api_logs": api_logs,
        "rewrites_used": rewrites_used,
        "rewrites_limit": rewrites_limit,
    }


@router.get("/users/{user_id}/logs")
async def get_user_logs(
    user_id: str,
    request: Request,
    limit: int = 100,
    action: str = "all",
    status: str = "all",
    provider: str = "all",
    admin=Depends(require_admin)
):
    from main import supabase
    if not supabase:
        return {"logs": [], "total": 0}

    # Resolve email for joining pre-signup logs.
    email = None
    try:
        pr = supabase.table("user_profiles").select("email").eq("id", user_id).maybe_single().execute()
        if pr.data:
            email = pr.data.get("email")
    except Exception:
        email = None
    if not email:
        try:
            fu = supabase.table("free_users").select("email").eq("user_id", user_id).maybe_single().execute()
            if fu.data:
                email = fu.data.get("email")
        except Exception:
            email = None

    logs = []
    try:
        q_uid = supabase.table("llm_call_logs").select(
            "id,action,tone,ai_provider,ai_model,status,cost_usd,latency_ms,created_at,email,user_id"
        ).eq("user_id", user_id).order("created_at", desc=True).limit(max(10, min(limit, 1000)))
        r_uid = q_uid.execute()
        logs = r_uid.data or []
    except Exception:
        logs = []

    if email:
        try:
            q_email = supabase.table("llm_call_logs").select(
                "id,action,tone,ai_provider,ai_model,status,cost_usd,latency_ms,created_at,email,user_id"
            ).eq("email", email).order("created_at", desc=True).limit(max(10, min(limit, 1000)))
            r_email = q_email.execute()
            seen = {x.get("id") for x in logs if x.get("id") is not None}
            for row in (r_email.data or []):
                rid = row.get("id")
                if rid not in seen:
                    logs.append(row)
                    if rid is not None:
                        seen.add(rid)
        except Exception:
            pass

    if action != "all":
        logs = [x for x in logs if (x.get("action") or "") == action]
    if status != "all":
        logs = [x for x in logs if (x.get("status") or "") == status]
    if provider != "all":
        logs = [x for x in logs if (x.get("ai_provider") or "") == provider]

    logs.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    logs = logs[:max(10, min(limit, 1000))]
    return {"logs": logs, "total": len(logs)}


@router.get("/users/{user_id}/logs/export")
async def export_user_logs_csv(
    user_id: str,
    request: Request,
    action: str = "all",
    status: str = "all",
    provider: str = "all",
    admin=Depends(require_admin)
):
    data = await get_user_logs(
        user_id=user_id,
        request=request,
        limit=1000,
        action=action,
        status=status,
        provider=provider,
        admin=admin,
    )
    rows = data.get("logs", [])
    headers = ["id", "user_id", "email", "action", "tone", "ai_provider", "ai_model", "status", "latency_ms", "cost_usd", "created_at"]
    csv_lines = [",".join(headers)]
    for r in rows:
        vals = [str(r.get(h, "") if r.get(h, "") is not None else "") for h in headers]
        vals = ['"' + v.replace('"', '""') + '"' for v in vals]
        csv_lines.append(",".join(vals))
    csv_text = "\n".join(csv_lines)
    from fastapi.responses import Response
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=user_{user_id}_logs.csv"},
    )


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request, admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        raise HTTPException(500, "DB not configured")
    # Delete across all tables using user_id (Supabase auth UUID).
    # Note: user_id param is the auth UUID, NOT free_users.id
    deleted = {}
    try:
        r = supabase.table("user_profiles").delete().eq("id", user_id).execute()
        deleted["user_profiles"] = len(r.data or [])
    except Exception: pass
    try:
        r = supabase.table("free_users").delete().eq("user_id", user_id).execute()
        deleted["free_users"] = len(r.data or [])
    except Exception: pass
    # Note: licenses are kept for billing audit trail — just deactivate
    try:
        supabase.table("licenses").update({"active": False}).eq("user_id", user_id).execute()
        deleted["licenses_deactivated"] = True
    except Exception: pass
    _audit("user_deleted", {"user_id": user_id, "deleted": deleted}, request.client.host, supabase)
    return {"deleted": True, "details": deleted}


@router.put("/users/{user_id}/plan")
async def admin_override_user_plan(
    user_id: str,
    body: AdminOverridePlanBody,
    request: Request,
    admin=Depends(require_admin),
):
    from main import supabase

    if not supabase:
        raise HTTPException(500, detail="DB not configured")
    cur = supabase.table("user_profiles").select("plan").eq("id", user_id).maybe_single().execute()
    old_plan = (cur.data or {}).get("plan") if cur and cur.data else None
    supabase.table("user_profiles").update({"plan": body.plan.strip().lower()}).eq("id", user_id).execute()
    try:
        supabase.table("admin_audit_log").insert(
            {
                "action": "admin_override_plan",
                "table_name": "user_profiles",
                "record_id": user_id,
                "old_value": {"plan": old_plan},
                "new_value": {"plan": body.plan},
                "details": {},
                "ip": request.client.host if request.client else "",
            }
        ).execute()
    except Exception:
        pass
    _audit("user_plan_override", {"user_id": user_id, "plan": body.plan}, request.client.host, supabase)
    return {"ok": True}


@router.put("/users/{user_id}/credits")
async def admin_adjust_user_credits(
    user_id: str,
    body: AdminAdjustCreditsBody,
    request: Request,
    admin=Depends(require_admin),
):
    from main import supabase

    if not supabase:
        raise HTTPException(500, detail="DB not configured")
    cur = supabase.table("user_profiles").select("credit_balance").eq("id", user_id).maybe_single().execute()
    old_bal = int((cur.data or {}).get("credit_balance") or 0) if cur and cur.data else 0
    new_bal = max(0, old_bal + int(body.delta))
    supabase.table("user_profiles").update({"credit_balance": new_bal}).eq("id", user_id).execute()
    try:
        supabase.table("admin_audit_log").insert(
            {
                "action": "admin_adjust_credits",
                "table_name": "user_profiles",
                "record_id": user_id,
                "old_value": {"credit_balance": old_bal},
                "new_value": {"credit_balance": new_bal, "delta": body.delta},
                "details": {},
                "ip": request.client.host if request.client else "",
            }
        ).execute()
    except Exception:
        pass
    _audit("user_credits_adjust", {"user_id": user_id, "delta": body.delta}, request.client.host, supabase)
    return {"ok": True, "credit_balance": new_bal}


@router.post("/users/{user_id}/unflag")
async def admin_unflag_user(user_id: str, request: Request, admin=Depends(require_admin)):
    from main import supabase

    if not supabase:
        raise HTTPException(500, detail="DB not configured")
    supabase.table("user_profiles").update(
        {"cost_flagged": False, "cost_paused_until": None}
    ).eq("id", user_id).execute()
    try:
        supabase.table("admin_audit_log").insert(
            {
                "action": "admin_unflag_cost",
                "table_name": "user_profiles",
                "record_id": user_id,
                "old_value": {"cost_flagged": True},
                "new_value": {"cost_flagged": False},
                "details": {},
                "ip": request.client.host if request.client else "",
            }
        ).execute()
    except Exception:
        pass
    _audit("user_unflagged", {"user_id": user_id}, request.client.host, supabase)
    return {"ok": True}


# ═══════════════════════════════════════════
# LICENSES
# ═══════════════════════════════════════════
@router.get("/licenses")
async def list_licenses(
    request: Request,
    page: int = 1, limit: int = 50,
    search: str = "", filter: str = "all",
    admin=Depends(require_admin)
):
    from main import supabase
    if not supabase:
        return {"licenses": [], "total": 0, "page": page, "limit": limit, "stats": {}}

    query = supabase.table("licenses").select("*", count="exact")

    if search:
        query = query.or_(f"email.ilike.%{search}%,license_key.ilike.%{search}%")

    if filter == "active":
        query = query.eq("active", True)
    elif filter == "revoked":
        query = query.eq("active", False)
    elif filter in ("starter", "pro", "team"):
        query = query.eq("plan", filter).eq("active", True)

    query = query.order("created_at", desc=True)
    offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)

    result = query.execute()
    total = result.count if hasattr(result, 'count') and result.count else len(result.data or [])

    # Stats
    stats = {"active_pro": 0, "active_starter": 0, "active_team": 0, "revoked": 0}
    try:
        all_lic = supabase.table("licenses").select("plan,active").execute()
        for l in (all_lic.data or []):
            if l.get("active"):
                p = l.get("plan", "pro")
                if p == "pro": stats["active_pro"] += 1
                elif p == "starter": stats["active_starter"] += 1
                elif p == "team": stats["active_team"] += 1
            else:
                stats["revoked"] += 1
    except Exception:
        pass

    return {"licenses": result.data or [], "total": total, "page": page, "limit": limit, "stats": stats}


@router.post("/licenses")
async def create_license(body: CreateLicenseReq, request: Request, admin=Depends(require_admin)):
    from main import supabase, _send_license_email
    if not supabase:
        raise HTTPException(500, "DB not configured")

    license_key = f"RP-{uuid.uuid4().hex[:8].upper()}-{uuid.uuid4().hex[:8].upper()}"
    supabase.table("licenses").insert({
        "email": body.email, "license_key": license_key,
        "plan": body.plan, "active": True,
    }).execute()

    if body.send_email:
        _send_license_email(body.email, license_key, body.plan)

    _audit("license_created", {"email": body.email, "plan": body.plan, "key_prefix": license_key[:8]}, request.client.host, supabase)
    return {"license_key": license_key}


@router.patch("/licenses/{lic_id}")
async def toggle_license(lic_id: str, body: UpdateLicenseReq, request: Request, admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        raise HTTPException(500, "DB not configured")
    supabase.table("licenses").update({"active": body.active}).eq("id", lic_id).execute()
    _audit("license_toggled", {"id": lic_id, "active": body.active}, request.client.host, supabase)
    return {"updated": True}


@router.delete("/licenses/{lic_id}")
async def delete_license(lic_id: str, request: Request, admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        raise HTTPException(500, "DB not configured")
    supabase.table("licenses").update({"active": False}).eq("id", lic_id).execute()
    _audit("license_deleted", {"id": lic_id}, request.client.host, supabase)
    return {"deleted": True}


@router.post("/licenses/{lic_id}/resend")
async def resend_license(lic_id: str, request: Request, admin=Depends(require_admin)):
    from main import supabase, _send_license_email
    if not supabase:
        raise HTTPException(500, "DB not configured")
    r = supabase.table("licenses").select("*").eq("id", lic_id).execute()
    if not r.data:
        raise HTTPException(404, "Not found")
    lic = r.data[0]
    _send_license_email(lic["email"], lic["license_key"], lic.get("plan", "pro"))
    _audit("license_resent", {"id": lic_id, "email": lic["email"]}, request.client.host, supabase)
    return {"sent": True}


# ═══════════════════════════════════════════
# TEAMS
# ═══════════════════════════════════════════
@router.get("/teams")
async def list_teams(request: Request, admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        return {"teams": []}

    teams = supabase.table("teams").select("*").order("created_at", desc=True).execute()
    result = []
    for t in (teams.data or []):
        members = supabase.table("team_members").select("*").eq("team_id", t["id"]).execute()
        t["members"] = members.data or []
        t["member_count"] = len(t["members"])
        t["total_rewrites"] = sum(m.get("rewrites", 0) for m in t["members"])
        avgs = [m.get("avg_score", 0) for m in t["members"] if m.get("avg_score")]
        t["avg_score"] = round(sum(avgs) / len(avgs), 1) if avgs else 0
        result.append(t)
    return {"teams": result}


@router.patch("/teams/{team_id}")
async def update_team(team_id: str, body: UpdateTeamReq, request: Request, admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        raise HTTPException(500, "DB not configured")
    updates = {}
    if body.name is not None: updates["name"] = body.name
    if body.seat_count is not None: updates["seat_count"] = body.seat_count
    if body.brand_voice is not None: updates["brand_voice"] = body.brand_voice
    if updates:
        supabase.table("teams").update(updates).eq("id", team_id).execute()
    _audit("team_updated", {"id": team_id, **updates}, request.client.host, supabase)
    return {"updated": True}


@router.delete("/teams/{team_id}")
async def delete_team(team_id: str, request: Request, admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        raise HTTPException(500, "DB not configured")
    members = supabase.table("team_members").select("id").eq("team_id", team_id).execute()
    supabase.table("team_members").delete().eq("team_id", team_id).execute()
    supabase.table("teams").delete().eq("id", team_id).execute()
    _audit("team_deleted", {"id": team_id, "members_removed": len(members.data or [])}, request.client.host, supabase)
    return {"deleted": True, "members_removed": len(members.data or [])}


# ═══════════════════════════════════════════
# SETTINGS
# ═══════════════════════════════════════════
@router.get("/settings")
async def get_settings(request: Request, admin=Depends(require_admin)):
    from main import supabase, GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, \
        SUPABASE_URL, SUPABASE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, \
        GMAIL_ADDRESS, GMAIL_APP_PASSWORD, AI_PROVIDER

    result = {
        "ai_provider": os.getenv("AI_PROVIDER", "gemini"),
        "gemini_key": _mask_key(os.getenv("GEMINI_API_KEY", "")),
        "openai_key": _mask_key(os.getenv("OPENAI_API_KEY", "")),
        "anthropic_key": _mask_key(os.getenv("ANTHROPIC_API_KEY", "")),
        "supabase_url": os.getenv("SUPABASE_URL", ""),
        "supabase_key": _mask_key(os.getenv("SUPABASE_SERVICE_KEY", "")),
        "supabase_connected": supabase is not None,
        "stripe_key": _mask_key(os.getenv("STRIPE_SECRET_KEY", "")),
        "stripe_webhook": _mask_key(os.getenv("STRIPE_WEBHOOK_SECRET", "")),
        "stripe_prices": {k: _mask_key(os.getenv(k, "")) for k in [
            "STRIPE_PRICE_T1_STARTER", "STRIPE_PRICE_T1_PRO", "STRIPE_PRICE_T1_TEAM",
            "STRIPE_PRICE_T2_STARTER", "STRIPE_PRICE_T2_PRO", "STRIPE_PRICE_T2_TEAM",
            "STRIPE_PRICE_T3_STARTER", "STRIPE_PRICE_T3_PRO", "STRIPE_PRICE_T3_TEAM",
            "STRIPE_PRICE_T4_STARTER", "STRIPE_PRICE_T4_PRO", "STRIPE_PRICE_T4_TEAM",
            "STRIPE_PRICE_T5_STARTER", "STRIPE_PRICE_T5_PRO", "STRIPE_PRICE_T5_TEAM",
            "STRIPE_PRICE_T6_STARTER", "STRIPE_PRICE_T6_PRO", "STRIPE_PRICE_T6_TEAM",
        ]},
        "gmail_address": os.getenv("GMAIL_ADDRESS", ""),
        "gmail_password": _mask_key(os.getenv("GMAIL_APP_PASSWORD", "")),
        "app_settings": {},
        "db_stats": {},
    }

    if supabase:
        try:
            s = supabase.table("app_settings").select("*").execute()
            result["app_settings"] = {r["key"]: r["value"] for r in (s.data or [])}
        except Exception:
            pass

        for table in ["licenses", "free_users", "teams", "team_members", "rewrite_logs", "email_log", "api_logs"]:
            try:
                r = supabase.table(table).select("id", count="exact").execute()
                result["db_stats"][table] = r.count if hasattr(r, 'count') and r.count else len(r.data or [])
            except Exception:
                result["db_stats"][table] = -1

    return result


@router.patch("/settings")
async def update_settings(body: UpdateSettingsReq, request: Request, admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        raise HTTPException(500, "DB not configured")
    for key, value in body.settings.items():
        supabase.table("app_settings").upsert({"key": key, "value": str(value), "updated_at": datetime.now(timezone.utc).isoformat()}).execute()
    _audit("settings_updated", {"keys": list(body.settings.keys())}, request.client.host, supabase)
    return {"updated": True}


@router.get("/plan-limits")
async def admin_get_plan_limits(admin=Depends(require_admin)):
    """Effective monthly rewrite caps from ``plan_config`` (same source as /rewrite)."""
    from main import supabase
    from billing_usage import load_plan_limits_merged

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    merged = load_plan_limits_merged(supabase)
    return {"limits": merged, "defaults": {}, "source": "plan_config"}


@router.put("/plan-limits")
async def admin_put_plan_limits(
    body: PlanLimitsPutReq,
    request: Request,
    admin=Depends(require_admin),
):
    """Update ``plan_config.monthly_rewrites`` per plan key and bust commerce cache."""
    from main import supabase
    from billing_usage import load_plan_limits_merged, merge_plan_limits_from_raw, invalidate_plan_limits_cache

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    base = load_plan_limits_merged(supabase)
    merged = merge_plan_limits_from_raw(base, body.limits or {})
    for pk, caps in merged.items():
        mv = caps.get("monthly")
        try:
            supabase.table("plan_config").update(
                {
                    "monthly_rewrites": mv,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            ).eq("plan_key", pk).execute()
        except Exception:
            pass
    invalidate_plan_limits_cache()
    _audit("plan_limits_updated", {"plans": list(merged.keys())}, request.client.host, supabase)
    return {"ok": True, "limits": merged}


@router.patch("/env-key")
async def update_env_key(body: UpdateEnvKeyReq, request: Request, admin=Depends(require_admin)):
    allowed = {"GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AI_PROVIDER",
               "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
               "STRIPE_PRICE_T1_STARTER", "STRIPE_PRICE_T1_PRO", "STRIPE_PRICE_T1_TEAM",
               "STRIPE_PRICE_T2_STARTER", "STRIPE_PRICE_T2_PRO", "STRIPE_PRICE_T2_TEAM",
               "STRIPE_PRICE_T3_STARTER", "STRIPE_PRICE_T3_PRO", "STRIPE_PRICE_T3_TEAM",
               "STRIPE_PRICE_T4_STARTER", "STRIPE_PRICE_T4_PRO", "STRIPE_PRICE_T4_TEAM",
               "STRIPE_PRICE_T5_STARTER", "STRIPE_PRICE_T5_PRO", "STRIPE_PRICE_T5_TEAM",
               "STRIPE_PRICE_T6_STARTER", "STRIPE_PRICE_T6_PRO", "STRIPE_PRICE_T6_TEAM",
               "GMAIL_ADDRESS", "GMAIL_APP_PASSWORD"}
    if body.key not in allowed:
        raise HTTPException(400, f"Cannot update key: {body.key}")
    os.environ[body.key] = body.value
    # Re-configure AI if needed
    if body.key == "GEMINI_API_KEY":
        import google.generativeai as genai
        genai.configure(api_key=body.value)
    from main import supabase
    _audit("env_key_updated", {"key": body.key}, request.client.host, supabase)
    return {"updated": True, "note": "Temporary until server restart. Update Railway/Render env vars too."}


# ═══════════════════════════════════════════
# TEST ENDPOINTS
# ═══════════════════════════════════════════
@router.post("/test-key")
async def test_ai_key(body: TestKeyReq, request: Request, admin=Depends(require_admin)):
    start = time.time()
    try:
        if body.provider == "gemini":
            import google.generativeai as genai
            genai.configure(api_key=body.api_key)
            model = genai.GenerativeModel("gemini-2.0-flash")
            model.generate_content("Say OK", generation_config=genai.types.GenerationConfig(max_output_tokens=5))
        elif body.provider == "openai":
            import openai
            c = openai.OpenAI(api_key=body.api_key)
            c.chat.completions.create(model="gpt-4o-mini", messages=[{"role":"user","content":"Say OK"}], max_tokens=5)
        elif body.provider == "anthropic":
            import anthropic
            c = anthropic.Anthropic(api_key=body.api_key)
            c.messages.create(model="claude-sonnet-4-20250514", max_tokens=5, messages=[{"role":"user","content":"Say OK"}])
        else:
            return {"valid": False, "error": "Unknown provider"}
        latency = int((time.time() - start) * 1000)
        return {"valid": True, "latency_ms": latency}
    except Exception as e:
        return {"valid": False, "error": str(e)[:200]}


@router.get("/test-supabase")
async def test_supabase(request: Request, admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        return {"connected": False, "error": "Supabase not configured"}
    try:
        tables_found = 0
        for t in ["licenses", "free_users", "teams", "team_members", "rewrite_logs"]:
            try:
                supabase.table(t).select("id").limit(1).execute()
                tables_found += 1
            except Exception:
                pass
        return {"connected": True, "tables_found": tables_found}
    except Exception as e:
        return {"connected": False, "error": str(e)[:200]}


@router.get("/stripe-status")
async def stripe_status(request: Request, admin=Depends(require_admin)):
    try:
        import stripe as _stripe
        key = os.getenv("STRIPE_SECRET_KEY", "")
        if not key:
            return {"connected": False, "error": "No key"}
        mode = "live" if key.startswith("sk_live") else "test"
        return {"connected": True, "mode": mode}
    except Exception as e:
        return {"connected": False, "error": str(e)[:200]}


@router.get("/pricing-preview")
async def pricing_preview(request: Request, country: str = "US", admin=Depends(require_admin)):
    """Preview PPP-adjusted display amounts from ``plan_config`` + ``country_pricing``."""
    from main import supabase
    from commerce_config import (
        format_money,
        load_commerce_snapshot_sync,
        localize_usd_price,
        resolve_country_row,
    )

    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    snap = load_commerce_snapshot_sync(supabase)
    crow, mult = resolve_country_row(snap, country.upper())
    plans = {}
    for pk, prow in sorted(snap.plans.items(), key=lambda x: x[1].sort_order):
        if not prow.is_active or pk in ("free", "enterprise") or prow.base_price_usd is None:
            continue
        loc = localize_usd_price(float(prow.base_price_usd), mult)
        plans[pk] = {
            "display": format_money(crow.currency_symbol, loc),
            "per": "/mo",
            "currency": "usd",
            "stripe_price_id": prow.stripe_price_id or "",
        }
    note = None if mult >= 0.999 else "PPP multiplier applied"
    return {
        "country": country.upper(),
        "multiplier": mult,
        "currency_symbol": crow.currency_symbol,
        "plans": plans,
        "note": note,
    }


# ═══════════════════════════════════════════
# ANALYTICS
# ═══════════════════════════════════════════
@router.get("/analytics")
async def analytics(request: Request, days: int = 30, admin=Depends(require_admin)):
    from main import supabase
    result = {
        "rewrites_by_day": [], "users_by_day": [],
        "score_distribution": [], "tone_usage": [],
        "top_patterns": [], "plan_distribution": [],
    }
    if not supabase:
        return result

    start = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    try:
        logs = supabase.table("rewrite_logs").select("*").gte("created_at", start).execute()
        by_day = {}; tone_count = {}; score_buckets = {f"{i}-{i+20}": 0 for i in range(0, 100, 20)}
        for l in (logs.data or []):
            day = l.get("created_at", "")[:10]
            by_day[day] = by_day.get(day, 0) + 1
            t = l.get("tone", "confident")
            tone_count[t] = tone_count.get(t, 0) + 1
            sc = l.get("score", 0)
            for bucket_start in range(0, 100, 20):
                if bucket_start <= sc < bucket_start + 20:
                    score_buckets[f"{bucket_start}-{bucket_start+20}"] += 1
                    break
        result["rewrites_by_day"] = [{"date": d, "count": c} for d, c in sorted(by_day.items())]
        result["tone_usage"] = [{"tone": t, "count": c} for t, c in sorted(tone_count.items(), key=lambda x: -x[1])]
        result["score_distribution"] = [{"range": r, "count": c} for r, c in score_buckets.items()]
    except Exception:
        pass

    try:
        users = supabase.table("free_users").select("created_at,tips_log").gte("created_at", start).execute()
        uday = {}
        word_freq = {}
        for u in (users.data or []):
            day = u.get("created_at", "")[:10]
            uday[day] = uday.get(day, 0) + 1
            for tip_entry in (u.get("tips_log") or []):
                tip = tip_entry.get("tip", "") if isinstance(tip_entry, dict) else str(tip_entry)
                for match in re.findall(r"'([^']+)'", tip):
                    w = match.lower().strip()
                    if len(w) > 2:
                        word_freq[w] = word_freq.get(w, 0) + 1
        result["users_by_day"] = [{"date": d, "count": c} for d, c in sorted(uday.items())]
        result["top_patterns"] = [{"pattern": p, "count": c} for p, c in sorted(word_freq.items(), key=lambda x: -x[1])[:20]]
    except Exception:
        pass

    try:
        lic_all = supabase.table("licenses").select("plan,active").execute()
        plans = {"free": 0, "starter": 0, "pro": 0, "team": 0}
        for l in (lic_all.data or []):
            if l.get("active"):
                plans[l.get("plan", "pro")] = plans.get(l.get("plan", "pro"), 0) + 1
        fu = supabase.table("free_users").select("id", count="exact").execute()
        plans["free"] = fu.count if hasattr(fu, 'count') and fu.count else len(fu.data or [])
        result["plan_distribution"] = [{"plan": p, "count": c} for p, c in plans.items()]
    except Exception:
        pass

    return result


# ═══════════════════════════════════════════
# EMAIL LOGS
# ═══════════════════════════════════════════
@router.get("/email-logs")
async def email_logs(request: Request, page: int = 1, limit: int = 50, admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        return {"logs": [], "total": 0}
    try:
        offset = (page - 1) * limit
        r = supabase.table("email_log").select("*", count="exact").order("sent_at", desc=True).range(offset, offset + limit - 1).execute()
        total = r.count if hasattr(r, 'count') and r.count else len(r.data or [])
        return {"logs": r.data or [], "total": total, "page": page}
    except Exception:
        return {"logs": [], "total": 0}


@router.post("/send-email")
async def send_single_email(body: SendEmailReq, request: Request, admin=Depends(require_admin)):
    from main import supabase, _send_email
    _send_email(body.to, body.subject, body.body)
    if supabase:
        try:
            supabase.table("email_log").insert({"to_email": body.to, "subject": body.subject, "type": "manual", "status": "sent"}).execute()
        except Exception:
            pass
    _audit("email_sent", {"to": body.to, "subject": body.subject}, request.client.host, supabase)
    return {"sent": True}


@router.post("/send-announcement")
async def send_announcement(body: AnnouncementReq, request: Request, bg: BackgroundTasks, admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        raise HTTPException(500, "DB not configured")

    # Get recipients
    query = supabase.table("free_users").select("email")
    if body.target == "pro":
        emails_r = supabase.table("licenses").select("email").eq("plan", "pro").eq("active", True).execute()
        emails = [e["email"] for e in (emails_r.data or []) if e.get("email")]
    elif body.target == "starter":
        emails_r = supabase.table("licenses").select("email").eq("plan", "starter").eq("active", True).execute()
        emails = [e["email"] for e in (emails_r.data or []) if e.get("email")]
    elif body.target == "team_admins":
        emails_r = supabase.table("teams").select("admin_email").eq("active", True).execute()
        emails = [e["admin_email"] for e in (emails_r.data or []) if e.get("admin_email")]
    elif body.target == "everyone":
        fu = supabase.table("free_users").select("email").execute()
        li = supabase.table("licenses").select("email").execute()
        all_emails = set()
        for e in (fu.data or []): all_emails.add(e.get("email"))
        for e in (li.data or []): all_emails.add(e.get("email"))
        emails = [e for e in all_emails if e]
    else:  # all_free
        r = query.execute()
        emails = [e["email"] for e in (r.data or []) if e.get("email")]

    task_id = uuid.uuid4().hex[:12]
    _announcement_tasks[task_id] = {"sent": 0, "total": len(emails), "failed": 0, "status": "running"}

    async def _do_send():
        from main import _send_email as send_fn
        for i, email in enumerate(emails):
            try:
                send_fn(email, body.subject, body.body)
                _announcement_tasks[task_id]["sent"] += 1
                if supabase:
                    try:
                        supabase.table("email_log").insert({"to_email": email, "subject": body.subject, "type": "manual", "status": "sent"}).execute()
                    except Exception:
                        pass
            except Exception:
                _announcement_tasks[task_id]["failed"] += 1
            if (i + 1) % 50 == 0:
                await asyncio.sleep(1)
        _announcement_tasks[task_id]["status"] = "done"

    bg.add_task(_do_send)
    _audit("announcement_sent", {"target": body.target, "count": len(emails)}, request.client.host, supabase)
    return {"task_id": task_id, "recipient_count": len(emails)}


@router.get("/announcement-status/{task_id}")
async def announcement_status(task_id: str, admin=Depends(require_admin)):
    task = _announcement_tasks.get(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return task


# ═══════════════════════════════════════════
# LOGS
# ═══════════════════════════════════════════
@router.get("/logs")
async def api_logs(request: Request, filter: str = "all", limit: int = 200, admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        return {"logs": [], "stats": {}}
    try:
        query = supabase.table("api_logs").select("*").order("created_at", desc=True).limit(limit)
        if filter == "errors":
            query = query.gte("status_code", 400)
        elif filter == "slow":
            query = query.gte("latency_ms", 2000)
        elif filter == "rewrite":
            query = query.eq("endpoint", "/rewrite")
        r = query.execute()
        logs = r.data or []

        # Stats
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        today_logs = supabase.table("api_logs").select("latency_ms,status_code", count="exact").gte("created_at", today).execute()
        tl = today_logs.data or []
        total_today = today_logs.count if hasattr(today_logs, 'count') and today_logs.count else len(tl)
        avg_lat = round(sum(l.get("latency_ms", 0) for l in tl) / max(len(tl), 1))
        errors = sum(1 for l in tl if (l.get("status_code") or 0) >= 400)
        error_rate = round(errors / max(total_today, 1) * 100, 1)
        slowest = max((l.get("latency_ms", 0) for l in tl), default=0)

        return {
            "logs": logs,
            "stats": {"requests_today": total_today, "avg_latency": avg_lat, "error_rate": error_rate, "slowest_ms": slowest}
        }
    except Exception:
        return {"logs": [], "stats": {}}


# ═══════════════════════════════════════════
# SECURITY
# ═══════════════════════════════════════════
@router.post("/change-password")
async def change_password(body: ChangePasswordReq, request: Request, admin=Depends(require_admin)):
    global ADMIN_PASSWORD, ADMIN_SECRET_KEY
    if not secrets.compare_digest(body.current_password, ADMIN_PASSWORD):
        raise HTTPException(400, "Current password incorrect")
    if len(body.new_password) < 12:
        raise HTTPException(400, "Password must be at least 12 characters")
    ADMIN_PASSWORD = body.new_password
    os.environ["ADMIN_PASSWORD"] = body.new_password
    # Rotate secret to invalidate all sessions
    ADMIN_SECRET_KEY = secrets.token_hex(32)
    os.environ["ADMIN_SECRET_KEY"] = ADMIN_SECRET_KEY
    _active_sessions.clear()
    from main import supabase
    _audit("password_changed", {}, request.client.host, supabase)
    return {"changed": True, "note": "All sessions invalidated. Please log in again."}


@router.get("/sessions")
async def list_sessions(request: Request, admin=Depends(require_admin)):
    return {"sessions": [{"jti": k, **v} for k, v in _active_sessions.items()]}


@router.delete("/sessions/{jti}")
async def revoke_session(jti: str, request: Request, admin=Depends(require_admin)):
    _active_sessions.pop(jti, None)
    return {"revoked": True}


@router.delete("/sessions")
async def revoke_all_sessions(request: Request, admin=Depends(require_admin)):
    _active_sessions.clear()
    return {"revoked": True}


@router.get("/blocked-ips")
async def list_blocked_ips(request: Request, admin=Depends(require_admin)):
    now = time.time()
    result = []
    for ip, until in list(_blocked_ips.items()):
        if now < until:
            result.append({"ip": ip, "blocked_until": datetime.fromtimestamp(until, timezone.utc).isoformat(), "remaining_s": int(until - now)})
        else:
            del _blocked_ips[ip]
    return {"blocked": result}


@router.delete("/blocked-ips/{ip}")
async def unblock_ip(ip: str, request: Request, admin=Depends(require_admin)):
    _blocked_ips.pop(ip, None)
    _login_attempts.pop(ip, None)
    return {"unblocked": True}


@router.get("/audit-log")
async def audit_log(request: Request, limit: int = 100, admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        return {"logs": []}
    try:
        q = supabase.table("admin_audit_log").select("*").order("created_at", desc=True).limit(limit)
        r = q.execute()
        return {"logs": r.data or []}
    except Exception:
        return {"logs": []}


from admin_config_routes import router as admin_commerce_config_router

router.include_router(admin_commerce_config_router)


@router.get("/diagnostics")
async def diagnostics(request: Request, admin=Depends(require_admin)):
    from main import supabase, _entitlement_diag, _supabase_in_backoff
    return {
        "db_configured": bool(supabase),
        "degraded_active": bool(_entitlement_diag.get("degraded_active")),
        "degraded_reason": _entitlement_diag.get("degraded_reason"),
        "degraded_since": _entitlement_diag.get("degraded_since"),
        "supabase_backoff_active": bool(_supabase_in_backoff()),
        "last_entitlement_ok_ts": _entitlement_diag.get("last_entitlement_ok_ts"),
        "log_write_errors": int(_entitlement_diag.get("log_write_errors") or 0),
    }


# ═══════════════════════════════════════════
# DANGER ZONE
# ═══════════════════════════════════════════
@router.post("/clear-logs")
async def clear_logs(request: Request, admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        raise HTTPException(500, "DB not configured")
    supabase.table("api_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    _audit("logs_cleared", {}, request.client.host, supabase)
    return {"cleared": True}


@router.post("/revoke-all-licenses")
async def revoke_all_licenses(request: Request, admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        raise HTTPException(500, "DB not configured")
    supabase.table("licenses").update({"active": False}).neq("id", "00000000-0000-0000-0000-000000000000").execute()
    _audit("all_licenses_revoked", {}, request.client.host, supabase)
    return {"revoked": True}


@router.get("/export-data")
async def export_data(request: Request, table: str = "free_users", admin=Depends(require_admin)):
    from main import supabase
    if not supabase:
        raise HTTPException(500, "DB not configured")
    allowed = {"free_users", "licenses", "teams", "team_members", "rewrite_logs", "email_log"}
    if table not in allowed:
        raise HTTPException(400, "Invalid table")
    r = supabase.table(table).select("*").execute()
    return {"data": r.data or [], "table": table, "count": len(r.data or [])}
