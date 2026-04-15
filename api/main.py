# PRIVACY: Text sent to /rewrite is processed and immediately discarded.
# We do not log, store, or retain any user text content.
# Only license verification data is stored in Supabase.

"""
ReplyPals API — FastAPI Backend
Rewrite text into different tones for non-native English speakers.
"""

import os
import json
import uuid
import time
import smtplib
import httpx
from datetime import datetime, timezone
from email.header import Header
from email.mime.text import MIMEText
from typing import Optional, List
import asyncio
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
from pathlib import Path

try:
    import jwt as pyjwt
except ImportError:
    pyjwt = None

try:
    import stripe
except ImportError:
    stripe = None

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

try:
    from supabase import create_client, Client
except ImportError:
    create_client = None
    Client = None

try:
    import psycopg2
except ImportError:
    psycopg2 = None

# ─── AI SDK Imports (pick one based on env) ───
try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:
    genai = None
    genai_types = None

import time
import anthropic as anthropic_sdk
import openai
# google.generativeai is deprecated — use google.genai
try:
    from google import genai as _new_genai
    from google.genai import types as _genai_types
    _HAS_NEW_GENAI = True
except ImportError:
    _new_genai = None
    _genai_types = None
    _HAS_NEW_GENAI = False

_model_cache = {"value": "gemini::gemini-1.5-flash", "ts": 0}
_entitlement_diag = {
    "degraded_active": False,
    "degraded_reason": None,
    "degraded_since": None,
    "last_entitlement_ok_ts": None,
    "log_write_errors": 0,
}
_LOG_WRITE_RETRIES = 3
_LOG_WRITE_RETRY_SLEEP_SEC = 0.25
_ASYNC_LOG_WRITES = os.getenv("ASYNC_LOG_WRITES", "0").strip() == "1"
_USAGE_DEBUG = os.getenv("USAGE_DEBUG", "0").strip() == "1"
_DASHBOARD_DEBUG = os.getenv("DASHBOARD_DEBUG", "0").strip() == "1"

def _usage_dbg(msg: str, **fields) -> None:
    if not _USAGE_DEBUG:
        return
    kv = " ".join([f"{k}={fields[k]!r}" for k in fields])
    print(f"[usage-debug] {msg} {kv}".strip())

def _dash_dbg(msg: str, **fields) -> None:
    if not _DASHBOARD_DEBUG:
        return
    kv = " ".join([f"{k}={fields[k]!r}" for k in fields])
    print(f"[dashboard-debug] {msg} {kv}".strip())

from billing_usage import (
    ANON_LIFETIME_LIMIT,
    load_plan_limits_merged,
    serialize_plan_limits_for_public,
    serialize_plan_limits_from_snapshot,
    COST_GUARDRAIL_USD,
    check_rate_limit_impl,
    extract_request_identity,
    get_anon_total_used,
    increment_anon_usage,
    record_rewrite_usage,
    ensure_user_profile_row,
    today_total_cost_usd,
    apply_cost_pause,
    CostGuardrailBody,
    UsageMetadata,
    EnterpriseUsageResponse,
    EnterpriseSeatsRequest,
)
from commerce_config import (
    cheapest_active_bundle,
    format_pricing_display,
    get_commerce_snapshot,
    load_commerce_snapshot_sync,
    localize_usd_price,
    plan_monthly_cap,
    plan_key_from_stripe_price_id,
    resolve_country_row,
    resolve_stripe_price_id_for_bundle,
    resolve_stripe_price_id_for_plan,
    subscription_checkout_stripe_line,
)

FREE_BASE_LIMIT = 10


def _public_plan_limits_payload() -> dict:
    """Plan caps + labels from ``plan_config`` (same source as /rewrite)."""
    snap = load_commerce_snapshot_sync(supabase)
    pl = serialize_plan_limits_from_snapshot(snap)
    return {"plan_limits": pl["raw"], "plan_limit_labels": pl["labels"]}


def _free_monthly_cap_from_db() -> int:
    """Free-tier monthly cap from ``plan_config``."""
    if not supabase:
        return 10
    try:
        limits = load_plan_limits_merged(supabase)
        m = limits.get("free", {}).get("monthly")
        if m is None:
            return 10
        return int(m)
    except Exception:
        return 10


async def _free_monthly_used_llm_logs(user_id: Optional[str], identity_email: str) -> int:
    """
    Rolling 30-day successful rewrites from llm_call_logs, deduped by row id across
    user_id and email (same semantics as admin user list + /free-usage enforcement).
    """
    if not supabase:
        return 0
    from dateutil.relativedelta import relativedelta

    window_start = (datetime.now(timezone.utc) - relativedelta(months=1)).isoformat()
    seen_ids = set()
    try:
        if user_id:
            r_uid = await _sb_execute(
                supabase.table("llm_call_logs")
                .select("id")
                .eq("status", "success")
                .eq("user_id", user_id)
                .gte("created_at", window_start)
                .limit(5000),
                timeout_sec=4.0,
            )
            for row in (r_uid.data or []):
                rid = row.get("id")
                if rid is not None:
                    seen_ids.add(rid)
        em = (identity_email or "").strip().lower()
        if em:
            r_em = await _sb_execute(
                supabase.table("llm_call_logs")
                .select("id")
                .eq("status", "success")
                .eq("email", em)
                .gte("created_at", window_start)
                .limit(5000),
                timeout_sec=4.0,
            )
            for row in (r_em.data or []):
                rid = row.get("id")
                if rid is not None:
                    seen_ids.add(rid)
    except Exception:
        return 0
    return len(seen_ids)


def _plan_policy_limits() -> dict:
    lim = load_plan_limits_merged(supabase) if supabase else {}
    return {
        "free": {"window": "rolling_30d", "base_limit": int((lim.get("free") or {}).get("monthly") or 10)},
        "starter": {"window": "billing_cycle", "default_limit": int((lim.get("starter") or {}).get("monthly") or 25)},
        "pro": {"window": "none", "default_limit": -1},
        "team": {"window": "none", "default_limit": -1},
    }


PLAN_POLICY = {}  # populated at runtime via _plan_policy_limits() where needed

def get_active_model() -> tuple[str, str]:
    """Returns (provider, model_id). Cached for 60s."""
    now = time.time()
    if now - _model_cache["ts"] > 60:
        if supabase:
            try:
                result = supabase.table("app_settings") \
                    .select("value") \
                    .eq("key", "active_model") \
                    .single() \
                    .execute()
                if result.data:
                    _model_cache["value"] = result.data["value"]
            except Exception as e:
                print(f"[model_cache] failed to fetch, using cached: {e}")
        _model_cache["ts"] = now
    
    parts = _model_cache["value"].split("::", 1)
    if len(parts) < 2:
        provider, model_id = "gemini", "models/gemini-2.5-flash"
    else:
        provider, model_id = parts[0], parts[1]

    # Be defensive with legacy values stored in app_settings:
    # - convert deprecated gemini-1.5 defaults to a supported model
    # - ensure Gemini model names include the required "models/" prefix
    if provider == "gemini":
        if model_id in ("gemini-1.5-flash", "models/gemini-1.5-flash"):
            model_id = "models/gemini-2.5-flash"
        elif not model_id.startswith("models/"):
            model_id = f"models/{model_id}"

    return provider, model_id

# ─── LLM Cost Table (per 1,000 tokens in USD) ───────────────────────────
LLM_COST_PER_1K: dict = {
    "gemini": {
        "gemini-1.5-flash":      {"prompt": 0.000075, "completion": 0.0003},
        "gemini-1.5-pro":        {"prompt": 0.00125,  "completion": 0.005},
        "gemini-2.0-flash":      {"prompt": 0.0001,   "completion": 0.0004},
        "gemini-2.0-flash-lite": {"prompt": 0.000075, "completion": 0.0003},
        "gemini-2.5-flash":      {"prompt": 0.0001,   "completion": 0.0004},
        "gemini-2.5-pro":        {"prompt": 0.00125,  "completion": 0.005},
    },
    "openai": {
        "gpt-4o-mini":   {"prompt": 0.00015,  "completion": 0.0006},
        "gpt-4o":        {"prompt": 0.005,    "completion": 0.015},
        "gpt-4-turbo":   {"prompt": 0.01,     "completion": 0.03},
        "gpt-3.5-turbo": {"prompt": 0.0005,   "completion": 0.0015},
    },
    "anthropic": {
        "claude-3-5-haiku-20241022":  {"prompt": 0.00025, "completion": 0.00125},
        "claude-3-5-sonnet-20241022": {"prompt": 0.003,   "completion": 0.015},
        "claude-3-7-sonnet-20250219": {"prompt": 0.003,   "completion": 0.015},
        "claude-3-opus-20240229":     {"prompt": 0.015,   "completion": 0.075},
    },
}

def calculate_cost(provider: str, model: str,
                   prompt_tokens: int, completion_tokens: int) -> float:
    """Returns estimated cost in USD."""
    rates = LLM_COST_PER_1K.get(provider, {}).get(model, {})
    if not rates:
        return 0.0
    cost = (prompt_tokens    / 1000 * rates["prompt"]) + \
           (completion_tokens / 1000 * rates["completion"])
    return round(cost, 6)


async def call_ai_model(
    prompt:      str,
    provider:    str,
    model_id:    str,
    rate_ctx:    Optional[dict] = None,
    action:      str = "rewrite",
    text_length: int = 0,
    tone:        str = "",
    language:    str = "",
    source:      str = "extension",
    event_id:    Optional[str] = None,
) -> str:
    """
    Calls the correct AI provider, logs to llm_call_logs, and returns raw text.
    A row is inserted for EVERY call — even errors.
    rate_ctx is the dict from check_rate_limit(); pass None when no context available.
    """
    start_ms          = int(time.time() * 1000)
    status            = "success"
    error_msg: Optional[str] = None
    raw               = ""
    prompt_tokens     = 0
    completion_tokens = 0

    try:
        provider_timeout_s = float(os.getenv("AI_PROVIDER_TIMEOUT_SEC", "15"))
        if provider == "gemini":
            api_key = os.getenv("GEMINI_API_KEY")
            if _HAS_NEW_GENAI and _new_genai:
                def _gemini_call():
                    client = _new_genai.Client(api_key=api_key)
                    return client.models.generate_content(model=model_id, contents=prompt)
                response = await asyncio.wait_for(asyncio.to_thread(_gemini_call), timeout=provider_timeout_s)
                raw = response.text or ""
                try:
                    prompt_tokens     = response.usage_metadata.prompt_token_count or 0
                    completion_tokens = response.usage_metadata.candidates_token_count or 0
                except Exception:
                    prompt_tokens     = max(1, len(prompt.split()) * 2)
                    completion_tokens = max(1, len(raw.split()) * 2)
            else:
                # Fallback: old SDK (shows deprecation warning but still works)
                def _legacy_gemini_call():
                    import google.generativeai as _legacy
                    _legacy.configure(api_key=api_key)
                    _model = _legacy.GenerativeModel(model_id)
                    return _model.generate_content(prompt)
                response = await asyncio.wait_for(asyncio.to_thread(_legacy_gemini_call), timeout=provider_timeout_s)
                raw      = response.text
                try:
                    prompt_tokens     = response.usage_metadata.prompt_token_count or 0
                    completion_tokens = response.usage_metadata.candidates_token_count or 0
                except Exception:
                    prompt_tokens     = max(1, len(prompt.split()) * 2)
                    completion_tokens = max(1, len(raw.split()) * 2)

        elif provider == "openai":
            def _openai_call():
                client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
                return client.chat.completions.create(
                    model=model_id,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.7,
                    max_tokens=2048,
                )
            response = await asyncio.wait_for(asyncio.to_thread(_openai_call), timeout=provider_timeout_s)
            raw               = response.choices[0].message.content
            prompt_tokens     = response.usage.prompt_tokens
            completion_tokens = response.usage.completion_tokens

        elif provider == "anthropic":
            def _anthropic_call():
                client = anthropic_sdk.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
                return client.messages.create(
                    model=model_id,
                    max_tokens=2048,
                    messages=[{"role": "user", "content": prompt}],
                )
            message = await asyncio.wait_for(asyncio.to_thread(_anthropic_call), timeout=provider_timeout_s)
            raw               = message.content[0].text
            prompt_tokens     = message.usage.input_tokens
            completion_tokens = message.usage.output_tokens

        else:
            raise ValueError(f"Unknown provider: {provider}")

    except Exception as exc:
        status    = "error"
        error_msg = str(exc)[:400]

    finally:
        latency_ms   = int(time.time() * 1000) - start_ms
        total_tokens = prompt_tokens + completion_tokens
        cost_usd     = calculate_cost(provider, model_id, prompt_tokens, completion_tokens)
        if rate_ctx is not None:
            rate_ctx["_last_cost_usd"] = cost_usd

        # ── INSERT into llm_call_logs — fire-and-forget in thread pool ──
        # Using asyncio.get_event_loop().run_in_executor so the DB write doesn't
        # block the HTTP response. The caller already has the result they need.
        if supabase:
            ctx = rate_ctx or {}
            log_row = {
                "user_id":           ctx.get("user_id") or None,
                "email":             ctx.get("email") or None,
                "license_key":       ctx.get("license_key") or None,
                "plan":              ctx.get("plan", "free"),
                "has_license":       ctx.get("has_license", False),
                "action":            action,
                "source":            source,
                "ai_provider":       provider,
                "ai_model":          model_id,
                "text_length":       text_length,
                "tone":              tone or None,
                "language":          language or None,
                "score":             0,
                "prompt_tokens":     prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens":      total_tokens,
                "cost_usd":          cost_usd,
                "status":            status,
                "error_message":     error_msg,
                "latency_ms":        latency_ms,
                "created_at":        datetime.now(timezone.utc).isoformat(),
                "event_id":          event_id or None,
            }
            def _do_log():
                last_err = None
                for attempt in range(1, _LOG_WRITE_RETRIES + 1):
                    try:
                        if event_id:
                            dup = supabase.table("llm_call_logs").select("id").eq("event_id", event_id).limit(1).execute()
                            if dup.data:
                                _usage_dbg("llm_log_dedup_skip", event_id=event_id, action=action, email=ctx.get("email"), user_id=ctx.get("user_id"))
                                return
                        supabase.table("llm_call_logs").insert(log_row).execute()
                        _usage_dbg(
                            "llm_log_write_ok",
                            event_id=event_id,
                            action=action,
                            plan=ctx.get("plan", "free"),
                            email=ctx.get("email"),
                            user_id=ctx.get("user_id"),
                            status=log_row.get("status"),
                        )
                        return
                    except Exception as _le:
                        last_err = _le
                        # Backward compatibility: older DBs may not have event_id yet.
                        if "event_id" in str(_le).lower():
                            try:
                                legacy_row = dict(log_row)
                                legacy_row.pop("event_id", None)
                                supabase.table("llm_call_logs").insert(legacy_row).execute()
                                _usage_dbg("llm_log_write_legacy_ok", action=action, email=ctx.get("email"), user_id=ctx.get("user_id"), status=legacy_row.get("status"))
                                return
                            except Exception as _legacy_e:
                                last_err = _legacy_e

                        transient = ("winerror 10035" in str(_le).lower()) or ("timeout" in str(_le).lower())
                        if attempt < _LOG_WRITE_RETRIES and transient:
                            time.sleep(_LOG_WRITE_RETRY_SLEEP_SEC * attempt)
                            continue
                        break

                _entitlement_diag["log_write_errors"] = int(_entitlement_diag.get("log_write_errors", 0) or 0) + 1
                print(f"[llm_call_logs] non-fatal: {last_err}")
                _usage_dbg("llm_log_write_failed", event_id=event_id, action=action, email=ctx.get("email"), user_id=ctx.get("user_id"), error=str(last_err))
            # Default to synchronous writes for quota consistency.
            # Set ASYNC_LOG_WRITES=1 only if you explicitly prefer lower latency over strict counter freshness.
            if _ASYNC_LOG_WRITES:
                try:
                    loop = asyncio.get_event_loop()
                    loop.run_in_executor(None, _do_log)
                except Exception:
                    _do_log()
            else:
                _do_log()

    if status == "error":
        raise HTTPException(500, detail=f"AI call failed: {error_msg}")

    return raw


async def _update_user_profile_stats(
    rate_ctx: dict, action: str, tone: str, score: int, source: str = "extension") -> None:
    """Updates user_profiles stats cache. Never raises."""
    try:
        from collections import Counter
        user_id = rate_ctx.get("user_id")
        if not user_id or not supabase:
            return
        now_iso = datetime.now(timezone.utc).isoformat()
        prof = supabase.table("user_profiles") \
            .select("total_rewrites,avg_score,scores_log,top_tone") \
            .eq("id", user_id).maybe_single().execute()
        if prof.data:
            old_c = prof.data.get("total_rewrites") or 0
            old_a = prof.data.get("avg_score")      or 0.0
            log   = prof.data.get("scores_log")     or []
            new_c = old_c + 1
            new_a = round(((old_a * old_c) + score) / new_c, 1) if score else round(old_a, 1)
            log.append({"score": score, "tone": tone or action,
                        "action": action, "source": source,
                        "ts": now_iso})
            if len(log) > 200:
                log = log[-200:]
            tc  = Counter(e.get("tone") or e.get("action", "") for e in log)
            top = tc.most_common(1)[0][0] if tc else (tone or action)
            supabase.table("user_profiles").update({
                "total_rewrites": new_c, "avg_score": new_a,
                "top_tone":       top,   "scores_log": log,
                "last_seen":      now_iso,
            }).eq("id", user_id).execute()
        else:
            supabase.table("user_profiles").upsert({
                "id":             user_id,
                "email":          rate_ctx.get("email") or None,
                "total_rewrites": 1, "avg_score": float(score),
                "top_tone":       tone or action,
                "scores_log": [{"score": score, "tone": tone or action,
                                "action": action, "source": source, "ts": now_iso}],
                "last_seen": now_iso,
            }, on_conflict="id").execute()
    except Exception as _e:
        print(f"[user_profiles] non-fatal: {_e}")


# Always load API env file regardless of current working directory.
load_dotenv(dotenv_path=Path(__file__).with_name(".env"), override=True)

# ═══════════════════════════════════════════
# STARTUP SAFETY CHECKS
# ═══════════════════════════════════════════
def _check_production_config():
    """Refuse to start in production with dangerous defaults."""
    is_prod = (os.getenv("APP_ENV") or os.getenv("ENVIRONMENT", "development")).lower() == "production"
    if not is_prod:
        return
    errors = []
    if not os.getenv("GEMINI_API_KEY") and not os.getenv("OPENAI_API_KEY") and not os.getenv("ANTHROPIC_API_KEY"):
        errors.append("No AI provider API key set (GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY)")
    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_KEY"):
        errors.append("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    if not os.getenv("STRIPE_SECRET_KEY") or not os.getenv("STRIPE_WEBHOOK_SECRET"):
        errors.append("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set")
    admin_pw = os.getenv("ADMIN_PASSWORD", "")
    if not admin_pw or admin_pw in ("changeme123!", "admin", "password", ""):
        errors.append("ADMIN_PASSWORD must be changed from its default value")
    admin_key = os.getenv("ADMIN_SECRET_KEY", "")
    if not admin_key or admin_key in ("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", ""):
        errors.append("ADMIN_SECRET_KEY must be replaced with a random 64-char hex string")
    allowed = os.getenv("ALLOWED_ORIGINS", "*")
    if allowed == "*":
        errors.append("ALLOWED_ORIGINS must not be '*' in production — set your domain")
    if errors:
        print("\n🚨 PRODUCTION CONFIG ERRORS — refusing to start:")
        for e in errors:
            print(f"  ✗ {e}")
        import sys; sys.exit(1)
    print("✅ Production config validated")

_check_production_config()

# ═══════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
# google.genai SDK requires the 'models/' prefix on model names
_raw_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_MODEL = _raw_model if _raw_model.startswith("models/") else f"models/{_raw_model}"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini")  # gemini | openai | anthropic
GMAIL_ADDRESS = os.getenv("GMAIL_ADDRESS", "")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
CRON_SECRET = os.getenv("CRON_SECRET", "")
MIXPANEL_TOKEN = os.getenv("MIXPANEL_TOKEN", "")
# Supabase JWT secret — stored base64-encoded in env, decode it for PyJWT
import base64 as _base64
_raw_jwt = os.getenv("SUPABASE_JWT_SECRET", "")
try:
    SUPABASE_JWT_SECRET = _base64.b64decode(_raw_jwt).decode()
except Exception:
    SUPABASE_JWT_SECRET = _raw_jwt   # use as-is if not base64
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")

_raw_allowed_origins = os.getenv("ALLOWED_ORIGINS", "*")
_origins = [o.strip() for o in _raw_allowed_origins.split(",") if o.strip()]
if not _origins:
    _origins = ["*"]

_has_placeholder_ext = any("your_extension_id_here" in o for o in _origins)
if _has_placeholder_ext:
    _origins = [o for o in _origins if "your_extension_id_here" not in o]

if not _origins:
    _origins = [
        "http://localhost:8150",
        "http://127.0.0.1:8150",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://replypals.in",
        "https://www.replypals.in",
    ]

ALLOWED_ORIGINS = _origins
ALLOW_ORIGIN_REGEX = os.getenv("ALLOW_ORIGIN_REGEX", "").strip() or (
    r"chrome-extension://[a-z]{32}" if _has_placeholder_ext else r"chrome-extension://.*"
)
ALLOW_CREDENTIALS = "*" not in ALLOWED_ORIGINS

FRONTEND_SUCCESS_URL = os.getenv("FRONTEND_SUCCESS_URL", "https://replypals.in/success.html")
FRONTEND_CANCEL_URL = os.getenv("FRONTEND_CANCEL_URL", "https://replypals.in/dashboard.html")

# DB resilience knobs: keep request paths responsive during transient DNS/network failures.
_SUPABASE_BACKOFF_UNTIL = 0.0
_SUPABASE_BACKOFF_SECONDS = 30
_DEGRADED_FREE_HITS = {}
_DEGRADED_ANON_HITS: dict[str, int] = {}


def _rate_ctx_degraded(user_id: Optional[str], req_email: str) -> dict:
    # Fail-open in degraded mode so rewrite/generate remain usable.
    return {
        "user_id": user_id,
        "email": req_email,
        "license_key": "",
        "plan": "free",
        "limit": -1,
        "used": 0,
        "has_license": False,
        "brand_voice": None,
        "degraded": True,
        "degraded_reason": "db_unreachable",
        "persistence": "best_effort",
    }


def _degraded_identity_key(user_id: Optional[str], req_email: str) -> Optional[str]:
    if user_id:
        return f"uid:{user_id}"
    if req_email:
        return f"email:{req_email.strip().lower()}"
    return None


def _degraded_free_usage_snapshot(user_id: Optional[str], req_email: str) -> tuple[int, int]:
    """
    Bounded fallback during DB outages: enforce free cap in-memory for this process.
    Returns (used_in_window, limit).
    """
    ident = _degraded_identity_key(user_id, req_email)
    limit = int(_free_monthly_cap_from_db())
    if not ident:
        return (0, limit)

    now = time.time()
    window_sec = 30 * 24 * 60 * 60
    arr = _DEGRADED_FREE_HITS.get(ident, [])
    arr = [ts for ts in arr if (now - ts) <= window_sec]
    _DEGRADED_FREE_HITS[ident] = arr
    return (len(arr), limit)


def _degraded_free_record_hit(user_id: Optional[str], req_email: str) -> None:
    ident = _degraded_identity_key(user_id, req_email)
    if not ident:
        return
    now = time.time()
    arr = _DEGRADED_FREE_HITS.get(ident, [])
    arr.append(now)
    _DEGRADED_FREE_HITS[ident] = arr


def _degraded_anon_snapshot(anon_id: str) -> tuple[int, int]:
    """In-process fallback: lifetime count per anon_id, cap ANON_LIFETIME_LIMIT."""
    aid = (anon_id or "").strip()
    if not aid:
        return (0, ANON_LIFETIME_LIMIT)
    used = int(_DEGRADED_ANON_HITS.get(aid, 0))
    return (used, ANON_LIFETIME_LIMIT)


def _degraded_anon_record_hit(anon_id: str) -> None:
    aid = (anon_id or "").strip()
    if not aid:
        return
    _DEGRADED_ANON_HITS[aid] = int(_DEGRADED_ANON_HITS.get(aid, 0)) + 1


def _rate_ctx_degraded_anon(anon_id: str, used: int) -> dict:
    syn = _synthetic_email_from_anon_id(anon_id) or ""
    try:
        ruid = str(
            uuid.uuid5(uuid.NAMESPACE_DNS, f"replypals:{syn.strip().lower()}")
        )
    except Exception:
        ruid = None
    return {
        "user_id": None,
        "email": syn,
        "license_key": "",
        "plan": "anon",
        "limit": ANON_LIFETIME_LIMIT,
        "used": used,
        "has_license": False,
        "brand_voice": None,
        "degraded": True,
        "degraded_reason": "db_unreachable",
        "persistence": "best_effort",
        "anon_only": True,
        "anon_id": (anon_id or "").strip(),
        "resolved_user_id": ruid,
        "usage_source": "subscription",
        "usage_meta": UsageMetadata(
            allowed=True,
            remaining_monthly=max(0, ANON_LIFETIME_LIMIT - used - 1),
            reset_in="never",
        ).model_dump(),
    }


def _mark_supabase_down(reason: Exception) -> None:
    global _SUPABASE_BACKOFF_UNTIL
    _SUPABASE_BACKOFF_UNTIL = time.time() + _SUPABASE_BACKOFF_SECONDS
    _entitlement_diag["degraded_active"] = True
    _entitlement_diag["degraded_reason"] = str(reason)
    _entitlement_diag["degraded_since"] = datetime.now(timezone.utc).isoformat()
    print(f"[supabase] degraded mode for {_SUPABASE_BACKOFF_SECONDS}s: {reason}")

def _mark_supabase_ok() -> None:
    _entitlement_diag["degraded_active"] = False
    _entitlement_diag["degraded_reason"] = None
    _entitlement_diag["last_entitlement_ok_ts"] = datetime.now(timezone.utc).isoformat()


def _supabase_in_backoff() -> bool:
    return time.time() < _SUPABASE_BACKOFF_UNTIL


async def _sb_execute(builder, timeout_sec: float = 3.0):
    result = await asyncio.wait_for(asyncio.to_thread(builder.execute), timeout=timeout_sec)
    _mark_supabase_ok()
    return result

# IP geo (1h TTL) — PPP amounts from ``plan_config`` × ``country_pricing`` multiplier
_ip_geo_cache: dict = {}


def _client_ip(request: Request) -> str:
    """
    Best-effort visitor IP for geo / PPP. Prefer CDN-provided client IPs (Cloudflare, etc.)
    over raw socket peer (often the load balancer).
    """
    for h in (
        "cf-connecting-ip",
        "CF-Connecting-IP",
        "true-client-ip",
        "True-Client-IP",
        "x-real-ip",
        "X-Real-IP",
    ):
        v = (request.headers.get(h) or "").strip()
        if v and v.lower() not in ("unknown", "none"):
            return v.split(",")[0].strip()
    xff = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For") or ""
    if xff:
        return xff.split(",")[0].strip()
    return (request.client.host if request.client else "") or "127.0.0.1"


async def _geo_country_for_ip(ip: str) -> dict:
    cached = _ip_geo_cache.get(ip)
    if cached and cached.get("expires_at", 0) > time.time():
        return cached["data"]
    geo_data: dict = {"countryCode": "US", "proxy": False, "hosting": False}
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"http://ip-api.com/json/{ip}?fields=countryCode,proxy,hosting")
            if r.status_code == 200:
                geo_data = r.json()
    except Exception:
        pass
    _ip_geo_cache[ip] = {"data": geo_data, "expires_at": time.time() + 3600}
    return geo_data

# ═══════════════════════════════════════════
# APP SETUP
# ═══════════════════════════════════════════
limiter = Limiter(key_func=get_remote_address)
_fp_kwargs = dict(title="ReplyPals API", version="1.2.0")
_root_path = os.getenv("ROOT_PATH", "/api").strip()
if _root_path:
    _fp_kwargs["root_path"] = _root_path
app = FastAPI(**_fp_kwargs)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.middleware("http")
async def canonical_host_and_no_cache(request: Request, call_next):
    """
    - Optionally keep auth/session on one host (set CANONICAL_HOST_REDIRECT=1).
    - Avoid stale HTML during frequent deploys.
    """
    app_base = (os.getenv("APP_BASE_URL", "") or "").strip()
    canonical_redirect = os.getenv("CANONICAL_HOST_REDIRECT", "0").strip() == "1"
    host = (request.headers.get("host", "") or "").split(":")[0].lower()
    if app_base and canonical_redirect:
        try:
            target_host = (urlparse(app_base).hostname or "").lower()
        except Exception:
            target_host = ""
        if target_host and host in {"replypals.in", "www.replypals.in"} and host != target_host:
            new_url = str(request.url).replace(f"://{host}", f"://{target_host}", 1)
            return RedirectResponse(url=new_url, status_code=307)

    response = await call_next(request)
    ctype = (response.headers.get("content-type", "") or "").lower()
    if "text/html" in ctype:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOW_ORIGIN_REGEX,
    allow_credentials=ALLOW_CREDENTIALS,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# ─── Body Caching Middleware (fixes double-read in check_rate_limit) ───
# Body caching is handled by storing bytes in request.state.
# check_rate_limit reads request.state._body_cache instead of re-reading the stream.
# No middleware needed — see _get_body_cache() helper below.


# ─── Clients ───
supabase = None
if SUPABASE_URL and SUPABASE_KEY and create_client:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

if STRIPE_SECRET_KEY and stripe:
    stripe.api_key = STRIPE_SECRET_KEY

gemini_client = None
if GEMINI_API_KEY and genai:
    gemini_client = genai.Client(api_key=GEMINI_API_KEY)

def _clean_pg_dsn(raw_dsn: Optional[str]) -> Optional[str]:
    if not raw_dsn:
        return None
    dsn = raw_dsn.strip().strip('"')
    try:
        u = urlparse(dsn)
        q = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if k != "pgbouncer"]
        if not any(k == "sslmode" for k, _ in q):
            q.append(("sslmode", "require"))
        return urlunparse((u.scheme, u.netloc, u.path, u.params, urlencode(q), u.fragment))
    except Exception:
        return dsn

def _pg_connect():
    if not psycopg2:
        return None
    dsn = _clean_pg_dsn(os.getenv("DATABASE_URL") or os.getenv("DIRECT_URL"))
    if not dsn:
        return None
    return psycopg2.connect(dsn, connect_timeout=8)

def _pg_fallback_save_email(email: str, goal: str, sites: list, ref_code: str) -> bool:
    conn = _pg_connect()
    if not conn:
        return False
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO free_users (email, goal, sites, ref_code, created_at, last_active)
                    VALUES (%s, %s, %s::jsonb, %s, NOW(), NOW())
                    ON CONFLICT (email) DO UPDATE
                    SET goal = EXCLUDED.goal,
                        sites = EXCLUDED.sites,
                        last_active = NOW()
                    """,
                    (email, goal or "", json.dumps(sites or []), ref_code),
                )
        return True
    except Exception as e:
        print(f"[pg_fallback/save_email] failed: {e}")
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass

def _pg_fallback_account_register(user_id: str, email: str, full_name: str) -> bool:
    resolved_user_id = _resolve_user_id_for_db(user_id, email)
    conn = _pg_connect()
    if not conn:
        return False
    try:
        with conn:
            with conn.cursor() as cur:
                if resolved_user_id:
                    cur.execute(
                        """
                        INSERT INTO user_profiles (id, email, full_name, last_seen, created_at)
                        VALUES (%s::uuid, %s, %s, NOW(), NOW())
                        ON CONFLICT (id) DO UPDATE
                        SET email = EXCLUDED.email,
                            full_name = EXCLUDED.full_name,
                            last_seen = NOW()
                        """,
                        (resolved_user_id, email, full_name or ""),
                    )
                    cur.execute(
                        """
                        UPDATE licenses
                        SET user_id = %s::uuid
                        WHERE user_id IS NULL AND lower(email) = lower(%s)
                        """,
                        (resolved_user_id, email),
                    )
                    cur.execute(
                        """
                        INSERT INTO free_users (email, user_id, created_at, last_active)
                        VALUES (%s, %s::uuid, NOW(), NOW())
                        ON CONFLICT (email) DO UPDATE
                        SET user_id = EXCLUDED.user_id,
                            last_active = NOW()
                        """,
                        (email, resolved_user_id),
                    )
                else:
                    # Last-resort: keep user visible in admin even without a UUID user_id.
                    cur.execute(
                        """
                        INSERT INTO free_users (email, created_at, last_active)
                        VALUES (%s, NOW(), NOW())
                        ON CONFLICT (email) DO UPDATE
                        SET last_active = NOW()
                        """,
                        (email,),
                    )
        return True
    except Exception as e:
        print(f"[pg_fallback/account_register] failed: {e}")
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass

def _resolve_user_id_for_db(user_id: Optional[str], email: str) -> Optional[str]:
    """
    Ensure we always write a valid UUID user_id to DB-backed UUID columns.
    For local fallback IDs like `local-...`, derive a deterministic UUID from email.
    """
    if user_id:
        try:
            return str(uuid.UUID(str(user_id)))
        except Exception:
            pass
    if email:
        try:
            return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"replypals:{email.lower().strip()}"))
        except Exception:
            return None
    return None

# ─── Admin Router ───
from admin_routes import router as admin_router, require_admin
app.include_router(admin_router)
# React admin SPA JSON endpoints (also used by legacy HTML admin) are defined on ``admin_router``:
# GET /admin/me, GET /admin/stats, POST /admin/login (email/password), GET /admin/users?plan=...,
# GET /admin/logs?page=..., GET/PATCH /admin/settings (dashboard fields merged with legacy settings).

def is_admin_request(request: Request) -> bool:
    try:
        auth_header = request.headers.get("Authorization", "")
        if not auth_header: return False
        require_admin(auth_header)
        return True
    except Exception:
        return False

@app.get("/admin/model")
async def admin_get_model(credentials=Depends(require_admin)):
    try:
        result = supabase.table("app_settings") \
            .select("value, updated_at") \
            .eq("key", "active_model") \
            .execute() if supabase else None
        
        row = result.data[0] if result and result.data else None
    except Exception:
        row = None
        
    value = row["value"] if row else "gemini::gemini-1.5-flash"
    parts = value.split("::", 1)
    provider = parts[0]
    model_id = parts[1] if len(parts) > 1 else "gemini-1.5-flash"

    # Dynamically find available options
    options = {
        "gemini":    [],
        "openai":    [],
        "anthropic": [
            {"value": "claude-3-7-sonnet-20250219", "label": "Claude 3.7 Sonnet"},
            {"value": "claude-3-5-sonnet-20241022", "label": "Claude 3.5 Sonnet"},
            {"value": "claude-3-5-haiku-20241022", "label": "Claude 3.5 Haiku"},
            {"value": "claude-3-opus-20240229", "label": "Claude 3 Opus"}
        ],
    }

    # Fetch Gemini models
    if os.getenv("GEMINI_API_KEY"):
        try:
            api_key = os.getenv("GEMINI_API_KEY")
            if _HAS_NEW_GENAI and _new_genai:
                client = _new_genai.Client(api_key=api_key)
                for m in client.models.list():
                    if hasattr(m, 'supported_actions') and 'generateContent' in (m.supported_actions or []):
                        clean_val = m.name.split("/")[-1] if "/" in m.name else m.name
                        options["gemini"].append({"value": clean_val, "label": getattr(m, 'display_name', clean_val) or clean_val})
            else:
                import google.generativeai as _legacy
                _legacy.configure(api_key=api_key)
                for m in list(_legacy.list_models()):
                    if "generateContent" in m.supported_generation_methods:
                        name_parts = m.name.split("/")
                        clean_val = name_parts[1] if len(name_parts) > 1 else m.name
                        options["gemini"].append({"value": clean_val, "label": m.display_name or clean_val})
        except Exception as e:
            print(f"Gemini options fetch failed: {e}")

    # Fallback if Gemini api key fails or missing
    if not options["gemini"]:
        options["gemini"] = [
            {"value": "gemini-1.5-flash", "label": "Gemini 1.5 Flash (default)"},
            {"value": "gemini-1.5-pro", "label": "Gemini 1.5 Pro"},
            {"value": "gemini-2.5-flash", "label": "Gemini 2.5 Flash"},
            {"value": "gemini-2.0-flash-exp", "label": "Gemini 2.0 Flash"}
        ]

    # Fetch OpenAI models
    if os.getenv("OPENAI_API_KEY"):
        try:
            client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            models = client.models.list().data
            # Filter solely to chat models 
            chat_models = [m.id for m in models if m.id.startswith("gpt-") or m.id.startswith("o")]
            chat_models.sort(reverse=True)
            for m in chat_models:
                options["openai"].append({"value": m, "label": m})
        except Exception as e:
            print(f"OpenAI options fetch failed: {e}")
            
    # Fallback if OpenAI fails
    if not options["openai"]:
        options["openai"] = [
            {"value": "gpt-4o", "label": "gpt-4o"},
            {"value": "gpt-4o-mini", "label": "gpt-4o-mini"},
            {"value": "o1-mini", "label": "o1-mini"},
            {"value": "o3-mini", "label": "o3-mini"}
        ]
    
    return {
        "provider":   provider,
        "model_id":   model_id,
        "full_value": value,
        "updated_at": row.get("updated_at") if row else None,
        "options":    options
    }

@app.post("/admin/model")
async def admin_set_model(request: Request, credentials=Depends(require_admin)):
    body = await request.json()
    provider = body.get("provider", "").strip()
    model_id = body.get("model_id", "").strip()

    if provider not in ["gemini", "openai", "anthropic"]:
        raise HTTPException(400, f"Unknown provider: {provider}")

    # Check api key exists
    if provider == "anthropic" and not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(400, "ANTHROPIC_API_KEY not set")
    if provider == "openai" and not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(400, "OPENAI_API_KEY not set")
    if provider == "gemini" and not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(400, "GEMINI_API_KEY not set")

    value = f"{provider}::{model_id}"
    if supabase:
        try:
            supabase.table("app_settings").upsert({
                "key":        "active_model",
                "value":      value,
                "updated_at": "now()",
            }, on_conflict="key").execute()
        except Exception as e:
            # Keep admin UX responsive if DB is temporarily unreachable.
            _mark_supabase_down(e)

    global _model_cache
    _model_cache["value"] = value
    _model_cache["ts"] = 0

    return {"ok": True, "active_model": value}


# Serve admin static files (JS, CSS, etc.)
from fastapi.staticfiles import StaticFiles
import pathlib
_admin_dir = pathlib.Path(__file__).parent / "admin"
if _admin_dir.exists():
    app.mount("/admin/static", StaticFiles(directory=str(_admin_dir)), name="admin-static")


# ─── Request Logging Middleware ───
# Request logging removed — llm_call_logs written inside call_ai_model() covers all AI calls.


# ═══════════════════════════════════════════
# MODELS
# ═══════════════════════════════════════════
class RewriteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    text: str = Field(..., min_length=1, max_length=5000)
    tone: str = Field(default="confident")
    language: str = Field(default="auto")
    license_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("license_key", "licenseKey"),
    )
    mode: Optional[str] = Field(default="rewrite")
    email: Optional[str] = None
    source: Optional[str] = Field(default="extension")   # popup | extension | content_selection | content_input | voice
    test_model_override: Optional[dict] = Field(default=None, alias="_test_model_override")
    event_id: Optional[str] = None
    anon_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("anon_id", "anonId"),
    )
    instruction: Optional[str] = Field(default=None, max_length=2000)


class RewriteResponse(BaseModel):
    rewritten: str
    score: int
    tip: Optional[str] = None
    plan: Optional[str] = None
    rewrites_used: Optional[int] = None
    rewrites_limit: Optional[int] = None
    rewrites_left: Optional[int] = None
    bonus_rewrites: Optional[int] = None
    monthly_base_limit: Optional[int] = None
    source_used: Optional[str] = None
    credit_balance: Optional[int] = None
    usage: Optional[dict] = None


class GenerateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    prompt: str
    tone: str
    license_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("license_key", "licenseKey"),
    )
    email: Optional[str] = None
    source: Optional[str] = Field(default="popup")
    event_id: Optional[str] = None
    anon_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("anon_id", "anonId"),
    )


class GenerateResponse(BaseModel):
    generated: str
    subject: Optional[str] = None
    score: int
    plan: Optional[str] = None
    rewrites_used: Optional[int] = None
    rewrites_limit: Optional[int] = None
    rewrites_left: Optional[int] = None
    bonus_rewrites: Optional[int] = None
    monthly_base_limit: Optional[int] = None
    source_used: Optional[str] = None
    credit_balance: Optional[int] = None
    usage: Optional[dict] = None


class CreditsCheckoutRequest(BaseModel):
    bundle_key: str = Field(..., min_length=2, max_length=64)
    country_code: str = Field(default="US", min_length=2, max_length=2)
    email: Optional[str] = None
    user_id: str = Field(..., min_length=10)


class SubscriptionCheckoutRequest(BaseModel):
    email: str
    plan_key: str = Field(default="pro")
    country_code: str = Field(default="US", min_length=2, max_length=2)
    user_id: Optional[str] = None


class CheckoutRequest(BaseModel):
    """Legacy body — prefer ``SubscriptionCheckoutRequest`` (/checkout/subscription)."""

    email: str
    plan: str = Field(default="pro")
    tier: str = Field(default="tier1")
    user_id: Optional[str] = None
    country_code: str = Field(default="US", min_length=2, max_length=2)


class TrackRequest(BaseModel):
    event: str
    location: Optional[str] = None
    referrer: Optional[str] = None


class VerifyLicenseRequest(BaseModel):
    license_key: str


class CheckUsageRequest(BaseModel):
    license_key: str


class FreeUsageRequest(BaseModel):
    email: Optional[str] = None
    anon_id: Optional[str] = None


class SaveEmailRequest(BaseModel):
    email: str
    goal: Optional[str] = None
    sites: Optional[list] = None


class RegisterReferralRequest(BaseModel):
    ref_code: str
    new_user_email: str


class CreateTeamRequest(BaseModel):
    admin_email: str
    team_name: str
    seat_count: int = 5


class AddTeamMemberRequest(BaseModel):
    admin_key: str
    member_email: str


class ContactSupportRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: str = Field(..., min_length=5, max_length=254)
    subject: str = Field(..., min_length=3, max_length=160)
    message: str = Field(..., min_length=10, max_length=4000)
    inquiry_type: str = Field(default="general", max_length=64)
    company: Optional[str] = Field(default="", max_length=120)


# ═══════════════════════════════════════════
# PROMPT BUILDER
# ═══════════════════════════════════════════
SYSTEM_PROMPT = """You are ReplyPals, an expert English writing coach specializing in helping non-native English speakers communicate like a native.
Your job is to rewrite the user's text so it sounds completely natural to a native English speaker, while matching the requested tone.
If the input appears to be in a mix of English and another language (Hinglish, Taglish, Spanglish, etc.), detect the non-English portions, translate them, then apply the tone rewrite to the full translated text.

TONE DEFINITIONS:
- Confident: Direct, strong, no hedging words like "maybe" or "I think", no excessive qualifiers
- Polite: Warm, considerate, uses please/thank you naturally without being excessive
- Casual: Relaxed, conversational, light contractions (I'm, we'll, it's), informal but clear
- Formal: Professional, structured, no contractions, business-appropriate, precise language
- Friendly: Approachable, positive energy, warm but not overly casual
- Assertive: Clear, no-nonsense, states position firmly without being aggressive or rude

CRITICAL RULES:
1. Preserve the original meaning completely — do NOT change facts, names, numbers, or intent
2. Remove all non-native patterns including but not limited to:
   - "do the needful" → "take care of this" / "handle this"
   - "revert back" / "revert" (meaning reply) → "reply" / "get back to you"
   - "kindly do the needful" → remove or replace entirely
   - "as per your instructions" → "as you instructed" / "per your request"
   - "I am having a doubt" → "I have a question"
   - "prepone the meeting" → "move the meeting earlier" / "reschedule earlier"
   - "out of station" → "out of office" / "away"
   - "I will do the same" at end of emails → remove or rephrase
   - "For a while" (meaning hold on) → "One moment please"
   - "I will go ahead" → "I will proceed" / "I'll take care of it"
   - Overuse of "kindly" → use "please" sparingly and naturally
   - "Please do the necessary" → "Please handle this" / specific instruction
   - "Respected Sir/Madam" → "Dear [Name]" or appropriate greeting
   MALAYALAM ENGLISH PATTERNS TO FIX:
   - "What all do you want?" → "What do you need?"
   - "Till now I have not received" → "I have not received it yet"
   - "Do one thing" → "Here's what I suggest" / specific instruction
   - "Conveyance charges" → "transportation costs"
   - "I will be there by 3 only" → "I'll be there at 3"
   - Overuse of "only" for emphasis at end of sentences (Malayalam direct translation)
3. Never add placeholder text like [Your Name], [Company], [Date]
4. Keep roughly the same length as the input — do not pad or over-explain
5. Never add greetings or sign-offs that weren't in the original text
6. Do not add any preamble like "Here's the rewritten version:" — output only the rewritten text

RESPONSE FORMAT — respond ONLY with valid JSON, no text before or after:
{
  "rewritten": "The rewritten text here",
  "score": 87,
  "tip": "One short, friendly sentence explaining the main non-native pattern found (e.g. 'The phrase revert back is commonly used in Indian English but sounds unnatural to native speakers — reply works better here.')"
}

If the score would be 95 or above (text was already near-native), set tip to null."""

LANGUAGE_NAMES = {
    "auto": None,
    "en-rewrite": "English",
    "hi-en": "Hindi",
    "ar-en": "Arabic",
    "fil-en": "Filipino",
    "pt-en": "Portuguese",
    "es-en": "Spanish",
    "fr-en": "French",
    "ml-en": "Malayalam",
}


def build_user_prompt(
    text: str,
    tone: str,
    language: str,
    mode: str = "rewrite",
    instruction: Optional[str] = None,
) -> str:
    """Build the user prompt dynamically based on inputs."""
    parts = []

    ins = (instruction or "").strip()
    # 'short' is an internal sentinel sent by the "Make it shorter" button —
    # route it through the dedicated short-mode prompt rather than the generic
    # custom-instruction block, which would only see the literal word "short".
    if ins.lower() == "short":
        ins = ""
        mode = "short"
    if ins:
        src = (text or "").strip()
        parts.append(
            "You are ReplyPals. The user provides SOURCE TEXT (below) and a CUSTOM INSTRUCTION."
        )
        parts.append(
            "Produce ONE output that follows the instruction, using the source text as material when relevant."
        )
        parts.append(
            "The output may be any format they ask for: blog post, social post, outline, reusable AI prompt, "
            "email, DM, message, product copy, etc. Do NOT assume email unless the instruction asks for email."
        )
        parts.append(f"Preferred tone when it applies: {tone}.")
        parts.append("Rules:")
        parts.append("- Follow the instruction literally.")
        parts.append("- Do NOT add placeholders like [Your Name] or [Company].")
        parts.append('- No preamble like "Here is your text:" — output only the requested content.')
        parts.append(f"\nCUSTOM INSTRUCTION:\n{ins}")
        parts.append(f'\nSOURCE TEXT:\n"{src}"')
        if language not in ("en-rewrite", "auto"):
            lang_name = LANGUAGE_NAMES.get(language)
            if lang_name:
                parts.append(
                    f"If the source text is in {lang_name}, write the output in natural English unless the "
                    "instruction specifies another language."
                )
        parts.append(
            '\nRespond ONLY with valid JSON: {"rewritten":"your output here","score":null,"tip":null}'
        )
        return "\n".join(parts)

    if mode == "summary":
        parts.append("Summarize the following text in 1-2 clear, concise sentences.")
        parts.append("Preserve the key meaning. Do NOT add any opinion.")
        parts.append(f'\nText:\n"{text}"')
        if language not in ("en-rewrite", "auto"):
            lang_name = LANGUAGE_NAMES.get(language)
            if lang_name:
                parts.append(
                    f"If the source text is in {lang_name}, write the summary in natural English "
                    "unless the user's language setting specifies otherwise."
                )
        parts.append('\nRespond ONLY with valid JSON: {"rewritten":"your summary","score":null,"tip":null}')
        return "\n".join(parts)

    elif mode == "meaning":
        parts.append("Explain the meaning of the following text in simple, clear terms.")
        parts.append("Note any idioms, non-native phrasing, or unusual expressions and clarify them.")
        parts.append(f'\nText:\n"{text}"')
        parts.append('\nRespond ONLY with valid JSON: {"rewritten":"your explanation","score":null,"tip":null}')
        return "\n".join(parts)

    elif mode == "fix":
        parts.append("Fix all grammar, spelling, and punctuation errors in the following text.")
        parts.append("Do NOT change the meaning, vocabulary choice, or overall structure.")
        parts.append(f'\nText:\n"{text}"')
        parts.append('\nRespond ONLY with valid JSON: {"rewritten":"fixed text","score":85,"tip":"brief note on the main fix"}')
        return "\n".join(parts)

    elif mode == "translate":
        parts.append("Detect the language of the following text.")
        parts.append("If it is not English, translate it to clear, natural English.")
        parts.append("If it is already English, translate it to Spanish as a useful alternative.")
        parts.append("Preserve meaning, tone, and context exactly.")
        parts.append(f'\nText:\n"{text}"')
        parts.append('\nRespond ONLY with valid JSON: {"rewritten":"translated text","score":null,"tip":null}')
        return "\n".join(parts)

    elif mode == "write":
        parts.append(f"You are a professional content writer. The user has selected some text as a topic, idea, or brief.")
        parts.append(f"Generate engaging, well-structured ORIGINAL content based on this topic. Write in a {tone} tone.")
        parts.append("Requirements:")
        parts.append("- Write NEW content FROM SCRATCH inspired by the topic — do NOT rewrite the topic itself.")
        parts.append("- Keep it concise and punchy (2-4 sentences or short paragraph unless topic implies longer).")
        parts.append("- Every sentence MUST end with proper punctuation (period, exclamation mark, or question mark).")
        parts.append("- Do NOT add placeholder text like [Your Name] or [Company].")
        parts.append("- Output only the content itself — no preamble like 'Here is your content:'.")
        parts.append(f'\nTopic/Idea:\n"{text}"')
        parts.append('\nRespond ONLY with valid JSON: {"rewritten":"generated content here","score":null,"tip":null}')
        return "\n".join(parts)

    elif mode == "reply":
        parts.append(f"The following is a message or post that someone SENT TO ME or that I am READING.")
        parts.append(f"Write a natural, thoughtful reply FROM ME responding directly to this message. Tone: {tone}.")
        parts.append("Requirements:")
        parts.append("- This is a REPLY to the message below — do NOT rewrite it or summarize it.")
        parts.append("- Address what was said, acknowledge the key point, and respond appropriately.")
        parts.append("- Keep it concise and conversational (1-3 sentences).")
        parts.append("- Every sentence MUST end with proper punctuation (period, exclamation mark, or question mark).")
        parts.append("- Do NOT start with 'Hi' or 'Dear' unless the original message is an email.")
        parts.append(f'\nMessage to reply to:\n"{text}"')
        parts.append('\nRespond ONLY with valid JSON: {"rewritten":"your reply here","score":null,"tip":null}')
        return "\n".join(parts)

    else:
        # Default: rewrite mode
        parts.append(f"Rewrite the following text in a {tone} tone.")

    if tone.lower() == "short" or mode.lower() == "short":
        parts.append("Additionally, make this approximately 50% shorter while keeping the full meaning. Remove filler words and be direct.")

    if language not in ("en-rewrite", "auto"):
        lang_name = LANGUAGE_NAMES.get(language)
        if lang_name:
            parts.append(f"The input is in {lang_name}. First translate it to English, then proceed.")

    parts.append(f'\nOriginal text:\n"{text}"')
    parts.append("\nRespond ONLY with valid JSON.")

    return "\n".join(parts)


# ═══════════════════════════════════════════
# AI PROVIDER LOGIC
# ═══════════════════════════════════════════
async def call_ai(
    text:          str,
    tone:          str,
    language:      str,
    mode:          str          = "rewrite",
    brand_voice:   Optional[str] = None,
    test_override: Optional[dict] = None,
    rate_ctx:      Optional[dict] = None,
    source:        str           = "extension",
    event_id:      Optional[str] = None,
    instruction: Optional[str] = None,
) -> dict:
    """Call the configured AI provider, log via call_ai_model, and parse JSON response."""
    user_prompt = build_user_prompt(text, tone, language, mode, instruction=instruction)

    system = SYSTEM_PROMPT
    if brand_voice:
        system += f"\n\nAdditionally, match this brand voice and writing style: {brand_voice}"

    combined_prompt = f"{system}\n\n---\n\n{user_prompt}"

    if test_override:
        provider = test_override.get("provider")
        model_id = test_override.get("model_id")
    else:
        provider, model_id = get_active_model()

    _ins = (instruction or "").strip()
    _log_action = "custom_instruction" if _ins else (mode or "rewrite")
    try:
        raw_response = await asyncio.wait_for(
            call_ai_model(
                prompt      = combined_prompt,
                provider    = provider,
                model_id    = model_id,
                rate_ctx    = rate_ctx,
                action      = _log_action,
                text_length = len(text or "") + len(_ins),
                tone        = tone or "",
                language    = language or "",
                source      = source,
                event_id    = event_id,
            ),
            timeout=18.0,
        )
    except Exception:
        # If fallback text is returned to user, count it as consumed usage.
        if event_id and supabase:
            try:
                supabase.table("llm_call_logs").update({
                    "status": "success",
                    "error_message": "fallback_output_applied",
                }).eq("event_id", event_id).execute()
            except Exception:
                pass
        # Service-availability fallback: keep endpoint responsive during upstream AI outages.
        fallback_text = (text or "").strip()
        if mode == "summary":
            fallback_out = f"Summary: {fallback_text[:220]}".strip()
        elif mode == "translate":
            fallback_out = fallback_text
        elif mode == "meaning":
            fallback_out = f"Meaning: {fallback_text}"
        elif mode == "reply":
            fallback_out = "Thank you for your message. I will review this and get back to you shortly."
        elif mode == "write":
            fallback_out = "Hello,\n\nThank you for reaching out. I will get back to you with an update shortly.\n\nBest regards"
        elif _ins:
            fallback_out = f"{_ins}\n\n{fallback_text}".strip()
        else:
            fallback_out = f"I am writing to ask for your help with this request. {fallback_text}".strip()
        return {"rewritten": fallback_out, "score": 60, "tip": "AI service temporarily unavailable; fallback output applied."}
    result = _parse_ai_response(raw_response)

    # Update user_profiles stats (display cache — not rate limiting)
    if rate_ctx:
        await _update_user_profile_stats(
            rate_ctx = rate_ctx,
            action   = _log_action,
            tone     = tone or "",
            score    = result.get("score", 0) or 0,
            source   = source,
        )

    return result



def _parse_ai_response(raw: str) -> dict:
    """Extract JSON from AI response, handling possible markdown fences."""
    cleaned = raw.strip()

    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}") + 1
        if start != -1 and end > start:
            try:
                data = json.loads(cleaned[start:end])
            except json.JSONDecodeError:
                raise HTTPException(status_code=500, detail="Failed to parse AI response")
        else:
            raise HTTPException(status_code=500, detail="Failed to parse AI response")

    rewritten = data.get("rewritten") or data.get("rewritten_text", "")
    raw_score = data.get("score") or data.get("native_score")
    # Only coerce a numeric score when the AI returned one; preserve None for
    # modes that intentionally return score:null (summary, reply, translate, etc.)
    score = int(raw_score) if raw_score is not None else None
    tip = data.get("tip") or data.get("explanation")

    if score is not None and score >= 95:
        tip = None

    return {
        "rewritten": rewritten,
        "score": score,
        "tip": tip,
    }


# ═══════════════════════════════════════════
# HELPER: Get plan & brand voice for a license
# ═══════════════════════════════════════════
def _get_license_info(license_key: str) -> dict:
    """Look up license in both licenses and team_members tables."""
    if not supabase or not license_key:
        return {"valid": False}

    # Check licenses table first
    try:
        result = (
            supabase.table("licenses")
            .select("*")
            .eq("license_key", license_key)
            .eq("active", True)
            .execute()
        )
        if result.data and len(result.data) > 0:
            row = result.data[0]
            return {
                "valid": True,
                "plan": row.get("plan", "pro"),
                "email": row.get("email"),
                "is_admin": False,
                "brand_voice": None,
            }
    except Exception:
        pass

    # Check teams table (admin key)
    try:
        result = (
            supabase.table("teams")
            .select("*")
            .eq("license_key", license_key)
            .eq("active", True)
            .execute()
        )
        if result.data and len(result.data) > 0:
            team = result.data[0]
            return {
                "valid": True,
                "plan": "team",
                "email": team.get("admin_email"),
                "is_admin": True,
                "team_id": team.get("id"),
                "team_name": team.get("name"),
                "brand_voice": team.get("brand_voice"),
                "seat_count": team.get("seat_count", 5),
            }
    except Exception:
        pass

    # Check team_members table (member key)
    try:
        result = (
            supabase.table("team_members")
            .select("*, teams(*)")
            .eq("member_key", license_key)
            .execute()
        )
        if result.data and len(result.data) > 0:
            member = result.data[0]
            team = member.get("teams", {})
            return {
                "valid": True,
                "plan": "team",
                "email": member.get("email"),
                "is_admin": False,
                "team_id": member.get("team_id"),
                "team_name": team.get("name") if team else None,
                "brand_voice": team.get("brand_voice") if team else None,
            }
    except Exception:
        pass

    return {"valid": False}


# ═══════════════════════════════════════════
# RATE LIMIT DEPENDENCY (FastAPI Depends)
# ═══════════════════════════════════════════
async def check_rate_limit(
    request:       Request,
    authorization: str = Header(None),
) -> dict:
    """
    FastAPI Depends() — plan-aware limits via usage_logs + user_profiles (see billing_usage.py).
    When Supabase is in backoff, falls back to in-process free-tier counting.
    """
    if not supabase:
        return {"user_id": None, "email": "", "license_key": "",
                "plan": "free", "limit": -1, "has_license": False,
                "allowed": True, "usage_meta": UsageMetadata().model_dump(),
                "resolved_user_id": None}

    user       = get_user_from_token(authorization)
    user_id    = user.get("sub")   if user else None
    user_email = user.get("email") if user else None

    req_anon_parsed = ""
    try:
        import json as _json
        body_bytes = await request.body()
        # Starlette allows reading the body once; check_rate_limit_impl needs the same bytes.
        request.state._replypals_body_bytes = body_bytes
        body_raw = _json.loads(body_bytes) if body_bytes else {}
        req_email, req_anon_parsed, _req_key = extract_request_identity(body_raw, request, user_email)
    except Exception:
        req_email = (user_email or "").strip().lower()
        try:
            hdrs = request.headers
            a = (hdrs.get("x-anon-id") or hdrs.get("x-replypals-anon-id") or "").strip()
            req_anon_parsed = a
            if not req_email and a:
                req_email = (_synthetic_email_from_anon_id(a) or "").strip().lower()
        except Exception:
            pass

    def _degraded_backoff_ctx() -> dict:
        if not user_id and req_anon_parsed:
            used_d, limit_d = _degraded_anon_snapshot(req_anon_parsed)
            if used_d >= limit_d:
                raise HTTPException(
                    status_code=429,
                    detail={
                        "error": "limit_reached",
                        "plan": "anon",
                        "used": used_d,
                        "limit": limit_d,
                        "upgrade_url": "https://replypals.in/login",
                        "message": (
                            "You've used all 3 free tries. Sign in for 10 free rewrites per month!"
                        ),
                        "degraded": True,
                    },
                )
            ctx = _rate_ctx_degraded_anon(req_anon_parsed, used_d)
            ctx["used"] = used_d
            ctx["limit"] = limit_d
            return ctx
        used_d, limit_d = _degraded_free_usage_snapshot(user_id, req_email)
        if used_d >= limit_d:
            raise HTTPException(429, detail={
                "error": "limit_reached",
                "plan": "free",
                "used": used_d,
                "limit": limit_d,
                "upgrade_url": "https://replypals.in/#pricing",
                "resets_in": "30 days rolling",
                "degraded": True,
            })
        ctx = _rate_ctx_degraded(user_id, req_email)
        ctx["used"] = used_d
        ctx["limit"] = limit_d
        ctx.setdefault("usage_meta", UsageMetadata().model_dump())
        ctx.setdefault("resolved_user_id", None)
        return ctx

    if _supabase_in_backoff():
        return _degraded_backoff_ctx()

    try:
        await _sb_execute(supabase.table("licenses").select("id").limit(1), timeout_sec=2.0)
    except Exception as e:
        _mark_supabase_down(e)
        return _degraded_backoff_ctx()

    return await check_rate_limit_impl(
        supabase=supabase,
        sb_execute=_sb_execute,
        get_user_from_token=get_user_from_token,
        request=request,
        authorization=authorization,
    )


# (log_api_call removed — logging now happens inside call_ai_model() directly)
# Every LLM call writes its own row to llm_call_logs automatically.


# ═══════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════

@app.get("/health")
async def health():
    db = "ok"
    if not supabase:
        db = "not_configured"
    else:
        try:
            await asyncio.to_thread(
                lambda: supabase.table("user_profiles").select("id").limit(1).execute()
            )
        except Exception as e:
            db = str(e)
    return {
        "status": "ok" if db == "ok" else "degraded",
        "database": db,
        "service": "ReplyPals API",
        "version": "1.2.0",
    }


# ═══════════════════════════════════════════
# ADMIN STATS (powered by llm_call_logs)
# ═══════════════════════════════════════════
@app.get("/admin/stats/overview")
async def admin_stats_overview(credentials=Depends(require_admin)):
    """Returns monthly call stats, cost, errors, and breakdowns by provider/plan/action."""
    if not supabase:
        return {
            "month_total_calls": 0,
            "today_calls": 0,
            "error_calls": 0,
            "error_rate_pct": 0,
            "avg_latency_ms": 0,
            "total_cost_usd": 0.0,
            "by_provider": {},
            "by_action": {},
            "by_plan": {},
        }

    now    = datetime.now(timezone.utc)
    today  = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    month  = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    try:
        month_r = supabase.table("llm_call_logs") \
            .select("ai_provider,action,plan,cost_usd,latency_ms,status") \
            .gte("created_at", month).execute()
        rows = month_r.data or []
    except Exception:
        return {
            "month_total_calls": 0,
            "today_calls": 0,
            "error_calls": 0,
            "error_rate_pct": 0,
            "avg_latency_ms": 0,
            "total_cost_usd": 0.0,
            "by_provider": {},
            "by_action": {},
            "by_plan": {},
        }

    by_provider: dict = {}
    by_action:   dict = {}
    by_plan:     dict = {}
    total_cost        = 0.0
    total_lat         = 0
    success_count     = 0
    error_count       = 0

    for r in rows:
        p  = r.get("ai_provider") or "unknown"
        a  = r.get("action")      or "unknown"
        pl = r.get("plan")        or "free"
        by_provider[p]  = by_provider.get(p, 0) + 1
        by_action[a]    = by_action.get(a, 0)   + 1
        by_plan[pl]     = by_plan.get(pl, 0)    + 1
        total_cost     += float(r.get("cost_usd") or 0)
        if r.get("status") == "success":
            total_lat     += r.get("latency_ms") or 0
            success_count += 1
        else:
            error_count += 1

    try:
        today_r = supabase.table("llm_call_logs") \
            .select("id", count="exact") \
            .gte("created_at", today).execute()
        calls_today = today_r.count or 0
    except Exception:
        calls_today = 0

    return {
        "total_calls_today":  calls_today,
        "total_calls_month":  len(rows),
        "success_calls":      success_count,
        "error_calls":        error_count,
        "calls_by_provider":  by_provider,
        "calls_by_action":    by_action,
        "calls_by_plan":      by_plan,
        "total_cost_usd":     round(total_cost, 4),
        "avg_latency_ms":     round(total_lat / success_count, 0) if success_count else 0,
        "error_rate_pct":     round(error_count / len(rows) * 100, 1) if rows else 0,
    }


@app.get("/admin/users/{email}/calls")
async def admin_user_calls(email: str, credentials=Depends(require_admin)):
    """Returns the last 100 LLM calls for a specific user email."""
    if not supabase:
        raise HTTPException(503, "Supabase not configured")
    try:
        r = supabase.table("llm_call_logs") \
            .select("*") \
            .ilike("email", email.strip().lower()) \
            .order("created_at", desc=True) \
            .limit(100).execute()
        return {"calls": r.data or [], "total": len(r.data or [])}
    except Exception as e:
        raise HTTPException(500, f"User call query failed: {e}")


@app.post("/track")
async def track_event(request: Request, body: TrackRequest):
    """Simple event tracking for marketing site (no DB write)."""
    return {"status": "ok"}


@app.get("/public-config")
async def public_config():
    """Public frontend config (safe values only). Includes live free-tier monthly cap from DB."""
    return {
        "supabase_url": SUPABASE_URL or "",
        "supabase_anon_key": SUPABASE_ANON_KEY or "",
        "app_base_url": os.getenv("APP_BASE_URL", "").strip(),
        "free_monthly_rewrites": _free_monthly_cap_from_db(),
        **_public_plan_limits_payload(),
    }


@app.post("/contact-us")
async def contact_us(body: ContactSupportRequest):
    """Accept contact requests from website and route to support inbox."""
    email = (body.email or "").strip().lower()
    name = (body.name or "").strip()
    subject = (body.subject or "").strip()
    message = (body.message or "").strip()
    inquiry_type = (body.inquiry_type or "general").strip().lower()
    company = (body.company or "").strip()

    if "@" not in email:
        raise HTTPException(400, "Valid email is required")

    support_email = os.getenv("SUPPORT_EMAIL", GMAIL_ADDRESS or "support@replypals.in")
    safe_type = inquiry_type.replace("\n", " ").replace("\r", " ")[:64]
    safe_company = company.replace("\n", " ").replace("\r", " ")[:120]
    safe_subject = subject.replace("\n", " ").replace("\r", " ")[:160]

    final_subject = f"[Website:{safe_type}] {safe_subject}"
    body_plain = (
        f"New website inquiry\n\n"
        f"Type: {safe_type}\n"
        f"Name: {name}\n"
        f"Email: {email}\n"
        f"Company: {safe_company or '-'}\n\n"
        f"Message:\n{message}\n"
    )
    body_html = _make_html_email(
        "New Website Inquiry",
        f"{name} sent a {safe_type} request",
        f"""
        <h2 style="color:#0F2544;font-size:22px;font-weight:700;margin:0 0 8px;">New inquiry from {name}</h2>
        <p style="color:#6B7280;font-size:15px;margin:0 0 20px;">ReplyPals website contact form submission.</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
          <tr><td style="padding:8px 0;color:#6B7280;">Type</td><td style="padding:8px 0;color:#0F2544;font-weight:600;">{safe_type}</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280;">Name</td><td style="padding:8px 0;color:#0F2544;font-weight:600;">{name}</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280;">Email</td><td style="padding:8px 0;color:#0F2544;font-weight:600;">{email}</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280;">Company</td><td style="padding:8px 0;color:#0F2544;font-weight:600;">{safe_company or "-"}</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280;">Subject</td><td style="padding:8px 0;color:#0F2544;font-weight:600;">{safe_subject}</td></tr>
        </table>
        <div style="background:#F8F9FE;border:1px solid #EAECF4;border-radius:12px;padding:16px;white-space:pre-wrap;color:#111827;line-height:1.6;">{message}</div>
        """,
    )

    try:
        await asyncio.to_thread(
            _send_email,
            support_email,
            final_subject,
            body_plain,
            "support_contact",
            body_html,
        )
    except Exception as e:
        print(f"[contact-us] email dispatch error: {e}")

    return {"ok": True, "message": "Thanks. Our team will get back within 1 business day."}


@app.post("/rewrite", response_model=RewriteResponse)
@limiter.limit("100/minute")
async def rewrite(
    request: Request,
    body:    RewriteRequest,
    rate:    dict = Depends(check_rate_limit),
):
    """Rewrite / summarize / reply / fix / explain / translate — all modes go here."""
    test_override = (
        body.test_model_override
        if getattr(body, "test_model_override", None) and is_admin_request(request)
        else None
    )

    if not supabase:
        result = await call_ai(
            body.text,
            body.tone,
            body.language,
            body.mode,
            None,
            test_override,
            event_id=body.event_id,
            instruction=body.instruction,
        )
        return RewriteResponse(**result)

    # Ensure log/count identity is stable for anonymous users.
    # If free usage is tracked by anon_id, stamp synthetic email into ctx.
    if not rate.get("email") and body.anon_id:
        syn = _synthetic_email_from_anon_id(body.anon_id)
        if syn:
            rate["email"] = syn

    if not rate.get("user_id") and rate.get("resolved_user_id"):
        rate["user_id"] = rate["resolved_user_id"]

    brand_voice = rate.get("brand_voice")
    result = await call_ai(
        text          = body.text,
        tone          = body.tone,
        language      = body.language,
        mode          = body.mode or "rewrite",
        brand_voice   = brand_voice,
        test_override = test_override,
        rate_ctx      = rate,
        source        = body.source or "extension",
        event_id      = body.event_id,
        instruction   = body.instruction,
    )
    await _after_llm_usage(rate)
    if rate.get("degraded") and (rate.get("plan") == "free"):
        _degraded_free_record_hit(rate.get("user_id"), rate.get("email") or "")
    elif rate.get("degraded") and rate.get("plan") == "anon" and rate.get("anon_id"):
        _degraded_anon_record_hit(str(rate["anon_id"]))
    used_before = int(rate.get("used") or 0)
    limit = rate.get("limit")
    try:
        limit_i = int(limit) if limit is not None else None
    except Exception:
        limit_i = None
    result["plan"] = rate.get("plan")
    if limit_i and limit_i > 0:
        used_after = min(used_before + 1, limit_i)
        result["rewrites_used"] = used_after
        result["rewrites_limit"] = limit_i
        result["rewrites_left"] = max(0, limit_i - used_after)
        if rate.get("plan") == "free":
            base_cap = _free_monthly_cap_from_db()
            result["monthly_base_limit"] = base_cap
            result["bonus_rewrites"] = max(0, limit_i - base_cap)
        elif rate.get("plan") == "anon":
            result["monthly_base_limit"] = ANON_LIFETIME_LIMIT
            result["bonus_rewrites"] = 0
    result["usage"] = rate.get("usage_meta")
    return RewriteResponse(**result)





# ═══════════════════════════════════════════
# GENERATE ENDPOINT
# ═══════════════════════════════════════════
GENERATE_SYSTEM_PROMPT = """You are ReplyPals, an expert English writer for professionals and learners.
The user wants NEW original text from scratch based on their instruction. It may be an email, DM, social post, blog section, outline, product blurb, or any other format — follow what they ask for; do not default to email.

Rules:
1. Write naturally — no stiff templates unless they asked for a formal letter
2. Match the requested tone exactly
3. Keep it concise unless they asked for long-form content
4. Include a subject line only when the output is clearly an email and a subject helps, or when they asked for one; otherwise subject is null
5. Do NOT add [Your Name] or [Recipient Name] placeholders
6. If dates, names or details are in brackets in the prompt, use them exactly as given

Return ONLY valid JSON:
{
  "generated": "The full written content here",
  "subject": "Suggested subject line only when the piece is an email (or they asked for one), else null",
  "score": 90
}"""

async def call_generate_ai(prompt: str, tone: str,
                           rate_ctx: Optional[dict] = None,
                           event_id: Optional[str] = None) -> dict:
    user_prompt     = f"User instruction — produce new text in a {tone} tone:\n{prompt}"
    combined_prompt = f"{GENERATE_SYSTEM_PROMPT}\n\n---\n\n{user_prompt}"

    provider, model_id = get_active_model()

    try:
        content = await asyncio.wait_for(
            call_ai_model(
                prompt=combined_prompt, provider=provider, model_id=model_id,
                rate_ctx=rate_ctx, action="write",
                text_length=len(prompt),
                tone=tone, source=(rate_ctx or {}).get("source", "popup"),
                event_id=event_id,
            ),
            timeout=18.0,
        )
    except Exception:
        # If fallback content is returned, treat this call as consumed usage.
        if event_id and supabase:
            try:
                supabase.table("llm_call_logs").update({
                    "status": "success",
                    "error_message": "fallback_output_applied",
                }).eq("event_id", event_id).execute()
            except Exception:
                pass
        return {
            "generated": (
                "Here is a concise draft based on your request. Thank you for your message — "
                "I will follow up with more detail shortly."
            ),
            "subject": None,
            "score": 60,
        }
    if not content:
        raise Exception("AI returned empty content. Likely a safety filter.")

    try:
        import re
        cleaned = content.strip()
        if cleaned.startswith("```"):
            lines   = cleaned.split("\n")
            lines   = [l for l in lines if not l.strip().startswith("```")]
            cleaned = "\n".join(lines)
        parsed = json.loads(cleaned)
        return parsed
    except Exception:
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise

@app.post("/generate", response_model=GenerateResponse)
@limiter.limit("100/minute")
async def generate(
    request: Request,
    body:    GenerateRequest,
    rate:    dict = Depends(check_rate_limit),
):
    """Generate text from scratch — rate-limited by the same subscription cap as /rewrite."""
    # Pass source through so the log row shows 'popup'
    rate["source"] = body.source or "popup"
    # Keep anonymous identity consistent with /free-usage and llm_call_logs email key.
    if not rate.get("email") and body.anon_id:
        syn = _synthetic_email_from_anon_id(body.anon_id)
        if syn:
            rate["email"] = syn
    if not rate.get("user_id") and rate.get("resolved_user_id"):
        rate["user_id"] = rate["resolved_user_id"]
    result = await call_generate_ai(body.prompt, body.tone, rate_ctx=rate, event_id=body.event_id)
    if supabase:
        await _after_llm_usage(rate)
    if rate.get("degraded") and (rate.get("plan") == "free"):
        _degraded_free_record_hit(rate.get("user_id"), rate.get("email") or "")
    elif rate.get("degraded") and rate.get("plan") == "anon" and rate.get("anon_id"):
        _degraded_anon_record_hit(str(rate["anon_id"]))

    used_before = int(rate.get("used") or 0)
    limit = rate.get("limit")
    try:
        limit_i = int(limit) if limit is not None else None
    except Exception:
        limit_i = None
    result["plan"] = rate.get("plan")
    if limit_i and limit_i > 0:
        used_after = min(used_before + 1, limit_i)
        result["rewrites_used"] = used_after
        result["rewrites_limit"] = limit_i
        result["rewrites_left"] = max(0, limit_i - used_after)
        if rate.get("plan") == "free":
            base_cap = _free_monthly_cap_from_db()
            result["monthly_base_limit"] = base_cap
            result["bonus_rewrites"] = max(0, limit_i - base_cap)
        elif rate.get("plan") == "anon":
            result["monthly_base_limit"] = ANON_LIFETIME_LIMIT
            result["bonus_rewrites"] = 0

    # Update user_profiles stats for generate calls too
    if rate.get("user_id"):
        await _update_user_profile_stats(
            rate_ctx = rate,
            action   = "write",
            tone     = body.tone,
            score    = result.get("score", 0) or 0,
            source   = body.source or "popup",
        )
    result["usage"] = rate.get("usage_meta")
    return GenerateResponse(**result)


# ═══════════════════════════════════════════
# PRICING (region-auto-detected)
# ═══════════════════════════════════════════
@app.get("/pricing")
async def get_pricing(request: Request):
    """Localized subscription + credit bundle display from ``plan_config`` × PPP (DB)."""
    ip = _client_ip(request)
    geo_data = await _geo_country_for_ip(ip)
    country = (geo_data.get("countryCode") or "US").upper()
    vpn_detected = bool(geo_data.get("proxy") or geo_data.get("hosting"))
    if vpn_detected:
        country = "US"

    snap = await get_commerce_snapshot(supabase, _sb_execute)
    crow, mult = resolve_country_row(snap, country)

    plans_out: dict = {}
    for pk, prow in sorted(snap.plans.items(), key=lambda x: x[1].sort_order):
        if not prow.is_active or pk in ("free", "enterprise"):
            continue
        if prow.base_price_usd is None:
            continue
        eff_usd = localize_usd_price(float(prow.base_price_usd), mult)
        disp, ccy, amt_local, _ = format_pricing_display(crow, eff_usd)
        plans_out[pk] = {
            "display_name": prow.display_name,
            "display": disp,
            "per": "/mo",
            "currency": ccy,
            "amount_local": amt_local,
            "base_price_usd": float(prow.base_price_usd),
            "localized_usd": eff_usd,
            "stripe_price_id": resolve_stripe_price_id_for_plan(pk, prow) or "",
        }

    bundles_out: dict = {}
    for bk, brow in sorted(snap.bundles.items(), key=lambda x: x[1].sort_order):
        if not brow.is_active:
            continue
        eff_usd = localize_usd_price(float(brow.base_price_usd), mult)
        disp, ccy, amt_local, _ = format_pricing_display(crow, eff_usd)
        bundles_out[bk] = {
            "display_name": brow.display_name,
            "credits": brow.credits,
            "display": disp,
            "currency": ccy,
            "amount_local": amt_local,
            "localized_usd": eff_usd,
            "stripe_price_id": resolve_stripe_price_id_for_bundle(bk, brow) or "",
        }

    pl = serialize_plan_limits_from_snapshot(snap)
    if crow.exchange_rate_per_usd:
        note = (
            "Prices shown in your local currency (approximate). "
            "Checkout may still settle in USD with your regional discount applied."
        )
    else:
        note = None if mult >= 0.999 else "Pricing adjusted for your region (PPP)"

    return {
        "country": country,
        "currency_code": crow.currency_code.lower(),
        "currency_symbol": crow.currency_symbol,
        "exchange_rate_per_usd": crow.exchange_rate_per_usd,
        "price_multiplier": mult,
        "plans": plans_out,
        "credit_bundles": bundles_out,
        "note": note,
        "vpn_detected": vpn_detected,
        "plan_limits": pl["raw"],
        "plan_limit_labels": pl["labels"],
    }


# ═══════════════════════════════════════════
# CHECKOUT & STRIPE
# ═══════════════════════════════════════════
@app.post("/checkout/subscription")
async def checkout_subscription(body: SubscriptionCheckoutRequest):
    """Stripe Checkout subscription — ``price_data`` from ``plan_config`` × country PPP + FX (same as /pricing).

    India (etc.) sees **₹/£/…** on Stripe when ``country_pricing`` has ``exchange_rate_per_usd`` + local
    ``currency_code``; US and unknown regions see **USD** at PPP-adjusted cents. No catalog ``price_``
    id or coupon required for this path.
    """
    if not stripe or not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    snap = load_commerce_snapshot_sync(supabase)
    pk = body.plan_key.strip().lower()
    prow = snap.plans.get(pk)
    if not prow or not prow.is_active:
        raise HTTPException(status_code=400, detail="Unknown or inactive plan_key")
    if prow.base_price_usd is None:
        raise HTTPException(status_code=400, detail="This plan is not available for subscription checkout")

    cc = body.country_code.strip().upper()
    crow, mult = resolve_country_row(snap, cc)

    try:
        currency, unit_amount, eff_usd = subscription_checkout_stripe_line(prow, crow, mult)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        checkout_params: dict = {
            "customer_email": body.email,
            "payment_method_types": ["card"],
            "line_items": [
                {
                    "price_data": {
                        "currency": currency,
                        "unit_amount": unit_amount,
                        "product_data": {
                            "name": f"ReplyPals {prow.display_name}",
                            "metadata": {"plan_key": pk},
                        },
                        "recurring": {"interval": "month"},
                    },
                    "quantity": 1,
                }
            ],
            "mode": "subscription",
            "success_url": f"{FRONTEND_SUCCESS_URL}?session_id={{CHECKOUT_SESSION_ID}}",
            "cancel_url": FRONTEND_CANCEL_URL,
            "metadata": {
                "plan": pk,
                "plan_key": pk,
                "purchase_type": "subscription",
                "country_code": cc,
                "effective_usd": str(round(eff_usd, 2)),
            },
            "subscription_data": {
                "metadata": {
                    "plan_key": pk,
                    "plan": pk,
                },
            },
        }
        if body.user_id:
            checkout_params["client_reference_id"] = body.user_id
        session = stripe.checkout.Session.create(**checkout_params)
        return {"url": session.url, "checkout_url": session.url}
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/checkout/credits")
async def checkout_credits(body: CreditsCheckoutRequest):
    """One-time credits: ``price_data`` (localized) unless ``stripe_price_id`` / env STRIPE_PRICE_BUNDLE_* (USD + PPP coupon)."""
    if not stripe or not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    snap = load_commerce_snapshot_sync(supabase)
    bk = body.bundle_key.strip().lower()
    brow = snap.bundles.get(bk)
    if not brow or not brow.is_active:
        raise HTTPException(status_code=400, detail="Unknown or inactive bundle_key")

    cc = body.country_code.strip().upper()
    crow, mult = resolve_country_row(snap, cc)
    eff_usd = localize_usd_price(float(brow.base_price_usd), mult)
    unit_cents = max(50, int(round(eff_usd * 100)))
    price_id = resolve_stripe_price_id_for_bundle(bk, brow).strip()
    coupon = crow.stripe_coupon_id if crow.is_active and crow.price_multiplier < 0.999 else None

    try:
        checkout_params: dict = {
            "customer_email": body.email or None,
            "payment_method_types": ["card"],
            "mode": "payment",
            "success_url": f"{FRONTEND_SUCCESS_URL}?session_id={{CHECKOUT_SESSION_ID}}",
            "cancel_url": FRONTEND_CANCEL_URL,
            "metadata": {
                "purchase_type": "credits",
                "bundle_key": bk,
                "credits": str(brow.credits),
                "user_id": body.user_id or "",
                "country_code": cc,
                "amount_usd": str(round(eff_usd, 2)),
            },
            "client_reference_id": body.user_id,
        }
        if price_id:
            checkout_params["line_items"] = [{"price": price_id, "quantity": 1}]
            if coupon:
                checkout_params["discounts"] = [{"coupon": coupon}]
        else:
            checkout_params["line_items"] = [
                {
                    "price_data": {
                        "currency": "usd",
                        "product_data": {
                            "name": f"ReplyPals credits — {brow.display_name}",
                            "metadata": {"bundle_key": bk},
                        },
                        "unit_amount": unit_cents,
                    },
                    "quantity": 1,
                }
            ]
        session = stripe.checkout.Session.create(**checkout_params)
        return {"url": session.url, "checkout_url": session.url}
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/create-checkout")
async def create_checkout(body: CheckoutRequest):
    """Legacy: map tier/plan to ``/checkout/subscription`` using DB ``plan_config`` only (tier ignored)."""
    cc = (body.country_code or "US").strip().upper()
    return await checkout_subscription(
        SubscriptionCheckoutRequest(
            email=body.email,
            plan_key=body.plan,
            country_code=cc,
            user_id=body.user_id,
        )
    )


def _plan_from_stripe_price_id(price_id: Optional[str]) -> str:
    if not price_id or not supabase:
        return "starter"
    snap = load_commerce_snapshot_sync(supabase)
    mapped = plan_key_from_stripe_price_id(price_id, snap)
    return mapped if mapped else "starter"


def _normalize_plan_str(p: str) -> str:
    x = (p or "free").strip().lower()
    allowed = {"free", "starter", "pro", "growth", "team", "enterprise"}
    if x not in allowed:
        return "starter"
    return x


@app.post("/geo/detect")
async def geo_detect(request: Request, authorization: Optional[str] = Header(None)):
    """Resolve client IP → country + PPP multiplier + localized plan/bundle prices. Optionally stores on profile."""
    ip = _client_ip(request)
    geo_data = await _geo_country_for_ip(ip)
    country = (geo_data.get("countryCode") or "US").upper()
    vpn = bool(geo_data.get("proxy") or geo_data.get("hosting"))
    if vpn:
        country = "US"

    snap = await get_commerce_snapshot(supabase, _sb_execute)
    crow, mult = resolve_country_row(snap, country)

    localized_prices: dict = {}
    for pk, prow in snap.plans.items():
        if not prow.is_active or prow.base_price_usd is None:
            continue
        eff_usd = localize_usd_price(float(prow.base_price_usd), mult)
        disp, _, _, _ = format_pricing_display(crow, eff_usd)
        localized_prices[pk] = disp

    user = get_user_from_token(authorization) if authorization else None
    uid = user.get("sub") if user else None
    if supabase and uid:
        try:
            supabase.table("user_profiles").upsert(
                {
                    "id": uid,
                    "detected_country": country,
                    "price_multiplier": mult,
                },
                on_conflict="id",
            ).execute()
        except Exception as e:
            print(f"[geo/detect] profile update: {e}")

    return {
        "country": country,
        "currency_code": crow.currency_code.lower(),
        "currency_symbol": crow.currency_symbol,
        "exchange_rate_per_usd": crow.exchange_rate_per_usd,
        "multiplier": mult,
        "localized_prices": localized_prices,
        "vpn_detected": vpn,
    }


def _find_user_id_for_stripe_customer(customer_id: str) -> tuple[Optional[str], Optional[str]]:
    """Returns (user_id, email) from user_profiles or licenses."""
    if not supabase or not customer_id:
        return None, None
    try:
        r = supabase.table("user_profiles").select("id,email").eq("stripe_customer_id", customer_id).limit(1).execute()
        if r.data:
            row = r.data[0]
            return str(row.get("id")), (row.get("email") or "").strip() or None
    except Exception:
        pass
    try:
        r2 = supabase.table("licenses").select("user_id,email").eq("stripe_customer_id", customer_id).execute()
        if r2.data:
            for row in r2.data:
                uid = row.get("user_id")
                if uid:
                    return str(uid), (row.get("email") or "").strip() or None
        if r2.data:
            row = r2.data[0]
            return None, (row.get("email") or "").strip() or None
    except Exception:
        pass
    return None, None


@app.post("/stripe-webhook")
@app.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """Stripe webhooks — checkout, subscription lifecycle, failed payments."""

    if not stripe:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=500, detail="Webhook secret not configured")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    et = event["type"]

    if et == "checkout.session.completed":
        session = event["data"]["object"]
        email = (session.get("customer_email") or session.get("customer_details", {}).get("email") or "").strip()
        meta = session.get("metadata") or {}
        purchase_type = (meta.get("purchase_type") or "").strip().lower()
        plan = meta.get("plan_key") or meta.get("plan", "pro")
        user_id = session.get("client_reference_id")
        customer_id = session.get("customer") or ""
        now_iso = datetime.now(timezone.utc).isoformat()

        if supabase and purchase_type == "credits":
            bundle_key = (meta.get("bundle_key") or "").strip().lower()
            credits = int(meta.get("credits") or 0)
            amt_raw = meta.get("amount_usd")
            try:
                amt_usd = float(amt_raw) if amt_raw is not None else 0.0
            except (TypeError, ValueError):
                amt_usd = 0.0
            if user_id and bundle_key and credits > 0:
                try:
                    pr = (
                        supabase.table("user_profiles")
                        .select("credit_balance,credit_spent_usd")
                        .eq("id", user_id)
                        .maybe_single()
                        .execute()
                    )
                    rowp = pr.data or {}
                    bal = int(rowp.get("credit_balance") or 0)
                    spent = float(rowp.get("credit_spent_usd") or 0)
                    supabase.table("user_profiles").update(
                        {
                            "credit_balance": bal + credits,
                            "credit_spent_usd": round(spent + amt_usd, 2),
                            "stripe_customer_id": customer_id or rowp.get("stripe_customer_id"),
                        }
                    ).eq("id", user_id).execute()
                    supabase.table("credit_transactions").insert(
                        {
                            "user_id": user_id,
                            "stripe_checkout_session_id": session.get("id"),
                            "bundle_key": bundle_key,
                            "credits_added": credits,
                            "amount_paid_usd": round(amt_usd, 2),
                        }
                    ).execute()
                    if email:
                        _send_email(
                            email,
                            "ReplyPals — credits added",
                            f"{credits} credits were added to your account. They never expire.",
                            "credits_purchased",
                        )
                except Exception as e:
                    print(f"[stripe webhook] credits checkout: {e}")
            return {"status": "ok"}

        license_key = f"RP-{uuid.uuid4().hex[:8].upper()}-{uuid.uuid4().hex[:8].upper()}"

        if supabase:
            try:
                row = {
                    "email": email,
                    "license_key": license_key,
                    "plan": plan,
                    "region": plan,
                    "active": True,
                }
                if user_id:
                    row["user_id"] = user_id
                if customer_id:
                    row["stripe_customer_id"] = customer_id
                supabase.table("licenses").insert(row).execute()
            except Exception as e:
                print(f"[stripe webhook] licenses insert: {e}")

            if user_id and customer_id:
                try:
                    supabase.table("user_profiles").upsert(
                        {
                            "id": user_id,
                            "email": email or None,
                            "plan": _normalize_plan_str(plan),
                            "stripe_customer_id": customer_id,
                            "billing_cycle_start": now_iso,
                        },
                        on_conflict="id",
                    ).execute()
                except Exception as e:
                    print(f"[stripe webhook] user_profiles upsert: {e}")

        if email:
            _send_license_email(email, license_key, plan)

    elif et == "customer.subscription.deleted":
        sub = event["data"]["object"]
        customer_id = sub.get("customer") or ""
        uid, em = _find_user_id_for_stripe_customer(customer_id)
        if supabase and uid:
            try:
                supabase.table("user_profiles").update({"plan": "free"}).eq("id", uid).execute()
            except Exception as e:
                print(f"[stripe webhook] downgrade user_profiles: {e}")
        if supabase and customer_id:
            try:
                supabase.table("licenses").update({"active": False}).eq("stripe_customer_id", customer_id).execute()
            except Exception as e:
                print(f"[stripe webhook] deactivate licenses: {e}")

    elif et == "invoice.payment_failed":
        inv = event["data"]["object"]
        customer_id = inv.get("customer") or ""
        email = (inv.get("customer_email") or "").strip()
        uid, em = _find_user_id_for_stripe_customer(customer_id)
        if supabase and uid:
            try:
                supabase.table("user_profiles").update({"plan": "free"}).eq("id", uid).execute()
            except Exception as e:
                print(f"[stripe webhook] payment_failed profile: {e}")
        if supabase and customer_id:
            try:
                supabase.table("licenses").update({"active": False}).eq("stripe_customer_id", customer_id).execute()
            except Exception as e:
                print(f"[stripe webhook] payment_failed licenses: {e}")
        to = em or email
        if to:
            try:
                _send_email(
                    to,
                    "ReplyPals — payment issue on your subscription",
                    "We could not process your latest payment. Your plan has been set to Free until billing is updated. "
                    "Update your card in the billing portal or contact support.",
                    "invoice_failed",
                )
            except Exception as e:
                print(f"[stripe webhook] payment_failed email: {e}")

    elif et == "customer.subscription.updated":
        sub = event["data"]["object"]
        customer_id = sub.get("customer") or ""
        smeta = sub.get("metadata") or {}
        plan = (smeta.get("plan_key") or smeta.get("plan") or "").strip().lower()
        if not plan:
            items = (sub.get("items") or {}).get("data") or []
            price_id = items[0].get("price", {}).get("id") if items else None
            plan = _plan_from_stripe_price_id(price_id)
        plan_norm = _normalize_plan_str(plan)
        uid, _ = _find_user_id_for_stripe_customer(customer_id)
        if supabase and uid:
            try:
                supabase.table("user_profiles").update({"plan": plan_norm}).eq("id", uid).execute()
            except Exception as e:
                print(f"[stripe webhook] subscription.updated: {e}")
        if supabase and customer_id:
            try:
                supabase.table("licenses").update({"plan": plan_norm}).eq("stripe_customer_id", customer_id).execute()
            except Exception as e:
                print(f"[stripe webhook] licenses plan sync: {e}")

    return {"status": "ok"}


async def _require_enterprise_user(authorization: str = Header(None)):
    user = get_user_from_token(authorization)
    if not user:
        raise HTTPException(401, detail="Unauthorized")
    if not supabase:
        raise HTTPException(503, detail="Database not configured")
    uid = user.get("sub")
    pr = await _sb_execute(
        supabase.table("user_profiles").select("plan").eq("id", uid).maybe_single(),
        timeout_sec=3.0,
    )
    plan = ((pr.data or {}).get("plan") or "").strip().lower()
    if plan != "enterprise":
        raise HTTPException(403, detail="Enterprise plan required")
    return user


@app.get("/enterprise/usage", response_model=EnterpriseUsageResponse)
async def enterprise_usage(user=Depends(_require_enterprise_user)):
    uid = user.get("sub")
    tr = await _sb_execute(
        supabase.table("teams").select("id").eq("owner_id", uid).maybe_single(),
        timeout_sec=5.0,
    )
    if not tr or not tr.data:
        raise HTTPException(404, detail="No enterprise team for this account")
    team_id = tr.data["id"]
    mr = await _sb_execute(
        supabase.table("team_members").select("user_id").eq("team_id", team_id),
        timeout_sec=5.0,
    )
    mrows = mr.data or []
    uids = [str(x["user_id"]) for x in mrows if x.get("user_id")]
    now = datetime.now(timezone.utc)
    month = f"{now.year:04d}-{now.month:02d}"
    per_seat: list = []
    total_r = 0
    total_c = 0.0
    team_credits = 0
    for ouid in uids:
        ur = await _sb_execute(
            supabase.table("usage_logs")
            .select("subscription_rewrites,credit_rewrites,rewrite_count,estimated_cost_usd")
            .eq("user_id", ouid)
            .eq("month", month),
            timeout_sec=5.0,
        )
        rows = ur.data or []
        sub_w = sum(int(x.get("subscription_rewrites") or 0) for x in rows)
        cr_w = sum(int(x.get("credit_rewrites") or 0) for x in rows)
        rw = sum(int(x.get("rewrite_count") or 0) for x in rows)
        if rw == 0:
            rw = sub_w + cr_w
        elif sub_w == 0 and cr_w == 0:
            sub_w = rw
        co = sum(float(x.get("estimated_cost_usd") or 0) for x in rows)
        total_r += rw
        total_c += co
        prb = await _sb_execute(
            supabase.table("user_profiles").select("credit_balance").eq("id", ouid).maybe_single(),
            timeout_sec=3.0,
        )
        cb = int((prb.data or {}).get("credit_balance") or 0)
        team_credits += cb
        per_seat.append(
            {
                "user_id": ouid,
                "rewrites": rw,
                "subscription_rewrites": sub_w,
                "credit_rewrites": cr_w,
                "cost": round(co, 6),
                "cost_usd": round(co, 6),
                "credit_balance": cb,
            }
        )
    tc = round(total_c, 6)
    return EnterpriseUsageResponse(
        total_rewrites=total_r,
        per_seat=per_seat,
        cost_estimate_usd=tc,
        total_cost_estimate_usd=tc,
        credit_balance=team_credits,
    )


@app.post("/enterprise/seats")
async def enterprise_seats(body: EnterpriseSeatsRequest, user=Depends(_require_enterprise_user)):
    uid = user.get("sub")
    tr = await _sb_execute(
        supabase.table("teams").select("id,seat_limit").eq("owner_id", uid).maybe_single(),
        timeout_sec=5.0,
    )
    if not tr or not tr.data:
        raise HTTPException(404, detail="No enterprise team for this account")
    team_id = tr.data["id"]
    seat_limit = int(tr.data.get("seat_limit") or 10)
    if body.action == "add":
        for ouid in body.user_ids:
            mk = f"EM-{uuid.uuid4().hex[:20].upper()}"
            try:
                await _sb_execute(
                    supabase.table("team_members").insert(
                        {
                            "team_id": team_id,
                            "user_id": ouid,
                            "member_key": mk,
                            "joined_at": datetime.now(timezone.utc).isoformat(),
                        }
                    ),
                    timeout_sec=5.0,
                )
            except Exception as e:
                print(f"[enterprise/seats] add {ouid}: {e}")
    else:
        for ouid in body.user_ids:
            await _sb_execute(
                supabase.table("team_members").delete().eq("team_id", team_id).eq("user_id", ouid),
                timeout_sec=5.0,
            )
    return {"ok": True, "team_id": team_id, "seat_limit": seat_limit}


# ═══════════════════════════════════════════
# VERIFY LICENSE (updated for teams)
# ═══════════════════════════════════════════
@app.post("/verify-license")
async def verify_license(body: VerifyLicenseRequest):
    """Verify a license key is valid and active. Checks both licenses and teams tables."""

    if not supabase:
        return {"valid": bool(body.license_key)}

    info = _get_license_info(body.license_key)

    if info.get("valid"):
        result = {
            "valid": True,
            "plan": info.get("plan", "pro"),
            "is_admin": info.get("is_admin", False),
        }
        if info.get("team_name"):
            result["team_name"] = info["team_name"]
        if info.get("seat_count"):
            result["seat_count"] = info["seat_count"]
        # Get members count if team admin
        if info.get("is_admin") and info.get("team_id"):
            try:
                members = supabase.table("team_members").select("id", count="exact").eq("team_id", info["team_id"]).execute()
                result["members_count"] = members.count if hasattr(members, 'count') and members.count else len(members.data)
            except Exception:
                result["members_count"] = 0
        return result

    return {"valid": False}


# ═══════════════════════════════════════════
# CHECK USAGE
# ═══════════════════════════════════════════
@app.post("/check-usage")
async def check_usage(body: CheckUsageRequest):
    """Check monthly usage for a license key using the same source as rate limits."""

    if not supabase:
        return {"plan": "pro", "rewrites_this_month": 0, "limit": None, "reset_date": ""}

    info = _get_license_info(body.license_key)
    if not info.get("valid"):
        raise HTTPException(status_code=404, detail="License not found")

    plan = info.get("plan", "pro")
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # Next month first day
    if now.month == 12:
        reset_date = now.replace(year=now.year + 1, month=1, day=1)
    else:
        reset_date = now.replace(month=now.month + 1, day=1)

    result = {
        "plan": plan,
        "rewrites_this_month": 0,
        "limit": None,
        "reset_date": reset_date.isoformat(),
        "is_admin": info.get("is_admin", False),
    }

    try:
        snap = await get_commerce_snapshot(supabase, _sb_execute)
        result["limit"] = plan_monthly_cap(snap, plan, 0)
    except Exception:
        result["limit"] = _plan_policy_limits().get(plan, {}).get("default_limit", 50)

    try:
        # Team usage should aggregate across admin key + all member keys.
        if plan == "team" and info.get("team_id"):
            key_set = {body.license_key}
            try:
                tr = await _sb_execute(
                    supabase.table("teams")
                    .select("license_key")
                    .eq("id", info["team_id"])
                    .maybe_single(),
                    timeout_sec=3.0,
                )
                if tr and tr.data and tr.data.get("license_key"):
                    key_set.add(tr.data["license_key"])
            except Exception:
                pass
            try:
                mr = await _sb_execute(
                    supabase.table("team_members")
                    .select("member_key")
                    .eq("team_id", info["team_id"]),
                    timeout_sec=3.0,
                )
                for row in (mr.data or []):
                    mk = (row.get("member_key") or "").strip()
                    if mk:
                        key_set.add(mk)
            except Exception:
                pass

            cnt_total = 0
            for lk in key_set:
                c = await _sb_execute(
                    supabase.table("llm_call_logs")
                    .select("id", count="exact")
                    .eq("license_key", lk)
                    .eq("status", "success")
                    .gte("created_at", month_start.isoformat()),
                    timeout_sec=4.0,
                )
                cnt_total += int(c.count or 0)
            result["rewrites_this_month"] = cnt_total
        else:
            # Prefer key-based count; fallback to email for older rows.
            cnt = await _sb_execute(
                supabase.table("llm_call_logs")
                .select("id", count="exact")
                .eq("license_key", body.license_key)
                .eq("status", "success")
                .gte("created_at", month_start.isoformat()),
                timeout_sec=4.0,
            )
            used = int(cnt.count or 0)
            if used == 0 and info.get("email"):
                c2 = await _sb_execute(
                    supabase.table("llm_call_logs")
                    .select("id", count="exact")
                    .eq("email", str(info["email"]).strip().lower())
                    .eq("status", "success")
                    .gte("created_at", month_start.isoformat()),
                    timeout_sec=4.0,
                )
                used = int(c2.count or 0)
            result["rewrites_this_month"] = used
    except Exception:
        pass

    return result


# ═══════════════════════════════════════════
# SAVE EMAIL (Free users)
# ═══════════════════════════════════════════
@app.post("/save-email")
async def save_email(body: SaveEmailRequest):
    """Save a free user's email for weekly reports."""

    if not supabase:
        return {"saved": True, "persisted": False, "mode": "memory_only"}

    try:
        if _supabase_in_backoff():
            # DB fallback path for network DNS issues with Supabase REST.
            ref_code = uuid.uuid4().hex[:8]
            if _pg_fallback_save_email(body.email, body.goal, body.sites, ref_code):
                return {"saved": True, "message": "Saved via DB fallback", "persisted": True, "mode": "db_fallback"}
            return {"saved": True, "message": "Saved in degraded mode", "persisted": False, "mode": "degraded"}

        # Check if already exists
        existing = await _sb_execute(
            supabase.table("free_users").select("id").eq("email", body.email),
            timeout_sec=3.0
        )
        if existing.data and len(existing.data) > 0:
            return {"saved": True, "message": "Email already registered", "persisted": True, "mode": "supabase"}

        # Generate ref code
        ref_code = uuid.uuid4().hex[:8]

        await _sb_execute(supabase.table("free_users").insert({
            "email": body.email,
            "goal": body.goal,
            "sites": body.sites,
            "ref_code": ref_code,
        }), timeout_sec=3.0)

        # Send welcome email in background so endpoint stays fast.
        asyncio.create_task(asyncio.to_thread(_send_welcome_email, body.email))

        return {"saved": True, "persisted": True, "mode": "supabase"}
    except Exception as e:
        _mark_supabase_down(e)
        ref_code = uuid.uuid4().hex[:8]
        if _pg_fallback_save_email(body.email, body.goal, body.sites, ref_code):
            return {"saved": True, "message": "Saved via DB fallback", "persisted": True, "mode": "db_fallback"}
        return {"saved": True, "message": "Saved in degraded mode", "persisted": False, "mode": "degraded"}


# ═══════════════════════════════════════════
# REFERRAL
# ═══════════════════════════════════════════
@app.post("/register-referral")
async def register_referral(body: RegisterReferralRequest):
    """Register a referral — give both users 5 bonus rewrites."""

    if not supabase:
        return {"success": True, "bonus": 5}

    try:
        if _supabase_in_backoff():
            # Keep behavior deterministic for invalid codes while DB is degraded.
            raise HTTPException(status_code=404, detail="Referral code not found")
        # Find referrer
        referrer = await _sb_execute(
            supabase.table("free_users").select("*").eq("ref_code", body.ref_code),
            timeout_sec=3.0
        )
        if not referrer.data or len(referrer.data) == 0:
            raise HTTPException(status_code=404, detail="Referral code not found")

        referrer_row = referrer.data[0]

        # Give referrer 5 bonus
        new_bonus = (referrer_row.get("bonus_rewrites") or 0) + 5
        await _sb_execute(supabase.table("free_users").update({
            "bonus_rewrites": new_bonus
        }).eq("id", referrer_row["id"]), timeout_sec=3.0)

        # Check if new user exists, give them bonus too
        new_user = await _sb_execute(
            supabase.table("free_users").select("*").eq("email", body.new_user_email),
            timeout_sec=3.0
        )
        if new_user.data and len(new_user.data) > 0:
            nu_bonus = (new_user.data[0].get("bonus_rewrites") or 0) + 5
            await _sb_execute(supabase.table("free_users").update({
                "bonus_rewrites": nu_bonus
            }).eq("id", new_user.data[0]["id"]), timeout_sec=3.0)

        return {"success": True, "bonus": 5}
    except HTTPException:
        raise
    except Exception as e:
        _mark_supabase_down(e)
        # Prefer stable client behavior over transient infra errors.
        raise HTTPException(status_code=404, detail="Referral code not found")


# ═══════════════════════════════════════════
# TEAM ENDPOINTS
# ═══════════════════════════════════════════
@app.post("/create-team")
async def create_team(body: CreateTeamRequest):
    """Create a new team and generate admin license key."""

    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")

    license_key = f"RP-TEAM-{uuid.uuid4().hex[:8].upper()}"

    try:
        supabase.table("teams").insert({
            "name": body.team_name,
            "admin_email": body.admin_email,
            "license_key": license_key,
            "seat_count": body.seat_count,
        }).execute()

        # Send email with admin key
        _send_team_welcome_email(body.admin_email, license_key, body.team_name)

        return {"success": True, "license_key": license_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/add-team-member")
async def add_team_member(body: AddTeamMemberRequest):
    """Add a member to a team."""

    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")

    # Verify admin
    team_result = supabase.table("teams").select("*").eq("license_key", body.admin_key).eq("active", True).execute()
    if not team_result.data or len(team_result.data) == 0:
        raise HTTPException(status_code=403, detail="Invalid admin key")

    team = team_result.data[0]

    # Check seat count
    members = supabase.table("team_members").select("id", count="exact").eq("team_id", team["id"]).execute()
    current_count = members.count if hasattr(members, 'count') and members.count else len(members.data)
    if current_count >= team.get("seat_count", 5):
        raise HTTPException(status_code=400, detail="Team seat limit reached")

    member_key = f"RP-M-{uuid.uuid4().hex[:8].upper()}"

    try:
        supabase.table("team_members").insert({
            "team_id": team["id"],
            "email": body.member_email,
            "member_key": member_key,
        }).execute()

        # Send member key via email
        _send_member_key_email(body.member_email, member_key, team["name"])

        return {"success": True, "member_key": member_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/team-stats")
async def team_stats(request: Request, x_license_key: str = Header(None, alias="X-License-Key")):
    """Get team stats for admin."""

    if not supabase or not x_license_key:
        raise HTTPException(status_code=400, detail="License key required")

    # Find team
    team_result = supabase.table("teams").select("*").eq("license_key", x_license_key).eq("active", True).execute()
    if not team_result.data or len(team_result.data) == 0:
        raise HTTPException(status_code=404, detail="Team not found")

    team = team_result.data[0]

    # Get members
    members = supabase.table("team_members").select("*").eq("team_id", team["id"]).execute()
    members_list = members.data or []

    total_rewrites = sum(m.get("rewrites", 0) for m in members_list)
    avg_scores = [m.get("avg_score", 0) for m in members_list if m.get("avg_score")]
    team_avg = sum(avg_scores) / len(avg_scores) if avg_scores else 0

    return {
        "total_rewrites": total_rewrites,
        "avg_score": round(team_avg, 1),
        "team_name": team["name"],
        "seat_count": team.get("seat_count", 5),
        "members": [
            {
                "email": m.get("email"),
                "rewrites": m.get("rewrites", 0),
                "avg_score": m.get("avg_score", 0),
            }
            for m in members_list
        ]
    }


# ═══════════════════════════════════════════
# WEEKLY REPORTS (cron endpoint)
# ═══════════════════════════════════════════
@app.post("/send-weekly-reports")
async def send_weekly_reports(request: Request, x_cron_secret: str = Header(None, alias="X-Cron-Secret")):
    """Send weekly progress reports to free users. Protected by cron secret."""

    if not CRON_SECRET or x_cron_secret != CRON_SECRET:
        raise HTTPException(status_code=403, detail="Invalid cron secret")

    if not supabase:
        return {"sent": 0}

    # Get users active in the last 7 days
    from datetime import timedelta
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    try:
        users = supabase.table("free_users").select("*").gte("last_active", week_ago).execute()
        sent_count = 0

        for user in (users.data or []):
            if not user.get("email"):
                continue

            avg_score = user.get("avg_score", 0)
            total = user.get("total_rewrites", 0)
            tips_log = user.get("tips_log") or []

            # Find most common tip pattern
            tip_freq = {}
            for t in tips_log[-20:]:
                tip_text = t.get("tip", "") if isinstance(t, dict) else str(t)
                import re
                quoted = re.findall(r"'([^']+)'", tip_text)
                for q in quoted:
                    q_lower = q.lower().strip()
                    if len(q_lower) > 2:
                        tip_freq[q_lower] = tip_freq.get(q_lower, 0) + 1

            most_common = ""
            if tip_freq:
                most_common = max(tip_freq, key=tip_freq.get)

            _send_weekly_report_email(
                user["email"],
                round(avg_score, 1),
                total,
                most_common
            )
            sent_count += 1

        return {"sent": sent_count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════
def _send_license_email(to_email: str, license_key: str, plan: str):
    """Send the license key to the user via Gmail SMTP."""
    plan_cap = plan.capitalize()
    benefit  = "Unlimited rewrites, voice in 8 languages & Tone Memory!" if plan in ("pro", "team") else "50 rewrites per month!"
    subject  = f"🎉 Your ReplyPals {plan_cap} License Key"
    plain    = f"Your ReplyPals {plan_cap} license key: {license_key}\nActivate in the Chrome extension settings."
    html = _make_html_email(subject, f"Your {plan_cap} license key is inside →", f"""
      <h2 style="color:#0F2544;font-size:22px;font-weight:700;margin:0 0 8px;">You're all set! 🎉</h2>
      <p style="color:#6B7280;font-size:15px;margin:0 0 24px;">Your <strong style="color:#FF6B35;">{plan_cap} Plan</strong> is now active. Here's your license key:</p>
      <div style="background:#F8F9FE;border:2px dashed #FF6B35;border-radius:12px;padding:20px;text-align:center;margin:0 0 24px;">
        <p style="color:#9CA3AF;font-size:12px;font-weight:600;letter-spacing:0.1em;margin:0 0 8px;text-transform:uppercase;">License Key</p>
        <p style="font-family:'Courier New',monospace;font-size:20px;font-weight:700;color:#0F2544;letter-spacing:0.08em;margin:0;">{license_key}</p>
      </div>
      <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 12px;">✨ {benefit}</p>
      <p style="color:#6B7280;font-size:14px;margin:0 0 12px;"><strong style="color:#0F2544;">How to activate:</strong></p>
      <ol style="color:#6B7280;font-size:14px;line-height:2;margin:0 0 24px;padding-left:20px;">
        <li>Open Gmail, WhatsApp Web, or LinkedIn</li>
        <li>Click the <strong>ReplyPals</strong> extension icon</li>
        <li>Click <strong>"Already have a key?"</strong></li>
        <li>Paste your key above and click <strong>Activate</strong></li>
      </ol>
      <a href="{os.getenv('APP_BASE_URL', 'https://replypals.in')}/dashboard.html" style="display:inline-block;background:linear-gradient(135deg,#FF6B35,#FF8C42);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;">Open Dashboard →</a>
    """)
    _send_email(to_email, subject, plain, email_type="license", body_html=html)


def _send_welcome_email(to_email: str, name: str = ""):
    """Send welcome email to new user."""
    greeting = f"Hi {name}," if name else "Hi there,"
    subject  = "Welcome to ReplyPals 🎉 — your writing journey starts now"
    plain    = f"{greeting}\n\nThanks for joining ReplyPals! You now have 5 free rewrites to start.\n\nEvery week you'll get a writing progress report.\n\n— The ReplyPals Team"
    html = _make_html_email(subject, "Your ReplyPals journey starts now →", f"""
      <h2 style="color:#0F2544;font-size:22px;font-weight:700;margin:0 0 8px;">Welcome to ReplyPals! 🎉</h2>
      <p style="color:#6B7280;font-size:15px;margin:0 0 20px;">{greeting}<br>Your writing is about to sound a whole lot more natural.</p>
      <div style="display:grid;gap:12px;margin:0 0 24px;">
        <div style="background:#F8F9FE;border-left:4px solid #FF6B35;border-radius:0 10px 10px 0;padding:14px 18px;">
          <strong style="color:#0F2544;font-size:14px;">🎤 Voice Input</strong>
          <p style="color:#6B7280;font-size:13px;margin:4px 0 0;">Speak in Malayalam, Hindi, Arabic, Tagalog & more</p>
        </div>
        <div style="background:#F8F9FE;border-left:4px solid #FF6B35;border-radius:0 10px 10px 0;padding:14px 18px;">
          <strong style="color:#0F2544;font-size:14px;">📊 Native Sound Score</strong>
          <p style="color:#6B7280;font-size:13px;margin:4px 0 0;">Every rewrite is scored so you can track your progress</p>
        </div>
        <div style="background:#F8F9FE;border-left:4px solid #FF6B35;border-radius:0 10px 10px 0;padding:14px 18px;">
          <strong style="color:#0F2544;font-size:14px;">🧠 Tone Memory</strong>
          <p style="color:#6B7280;font-size:13px;margin:4px 0 0;">(Pro) ReplyPals learns your preferred writing style</p>
        </div>
      </div>
      <a href="{os.getenv('APP_BASE_URL', 'https://replypals.in')}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#FF6B35,#FF8C42);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;">Go to Dashboard →</a>
      <p style="color:#9CA3AF;font-size:12px;margin:20px 0 0;">You'll receive a weekly writing progress report every Sunday.</p>
    """)
    _send_email(to_email, subject, plain, email_type="welcome", body_html=html)


def _send_weekly_report_email(to_email: str, avg_score: float, total_rewrites: int, most_common: str):
    """Send weekly progress report."""
    score_color  = "#10B981" if avg_score >= 80 else "#F59E0B" if avg_score >= 60 else "#EF4444"
    score_label  = "Excellent 🏆" if avg_score >= 80 else "Good 👍" if avg_score >= 60 else "Keep going 💪"
    common_html  = f'<p style="color:#6B7280;font-size:14px;">Most common pattern: <strong style="color:#0F2544;">{most_common}</strong> — keep an eye on this!</p>' if most_common else '<p style="color:#6B7280;font-size:14px;">No specific patterns flagged this week. Great work!</p>'
    subject  = f"📈 Your ReplyPals Weekly Report — Score: {avg_score}/100"
    plain    = f"Your weekly score: {avg_score}/100\nTotal rewrites: {total_rewrites}\n{('Most common pattern: ' + most_common) if most_common else ''}"
    html = _make_html_email(subject, f"Your weekly writing score is {avg_score}/100 →", f"""
      <h2 style="color:#0F2544;font-size:22px;font-weight:700;margin:0 0 8px;">Your Weekly Report 📈</h2>
      <p style="color:#6B7280;font-size:15px;margin:0 0 24px;">Here's how your English writing improved this week:</p>
      <div style="background:linear-gradient(135deg,#0F2544,#1a3a6e);border-radius:14px;padding:24px;text-align:center;margin:0 0 20px;">
        <p style="color:rgba(255,255,255,0.7);font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 6px;">Avg Native Sound Score</p>
        <p style="color:{score_color};font-size:48px;font-weight:800;margin:0;line-height:1;">{avg_score}<span style="font-size:20px;color:rgba(255,255,255,0.5);">/100</span></p>
        <p style="color:rgba(255,255,255,0.8);font-size:14px;margin:8px 0 0;">{score_label}</p>
      </div>
      <div style="background:#F8F9FE;border-radius:12px;padding:18px;margin:0 0 20px;">
        <p style="color:#6B7280;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 8px;">This Week</p>
        <p style="color:#0F2544;font-size:16px;font-weight:700;margin:0;">✍️ {total_rewrites} rewrites completed</p>
      </div>
      {common_html}
      <a href="{os.getenv('APP_BASE_URL', 'https://replypals.in')}/dashboard.html" style="display:inline-block;background:linear-gradient(135deg,#FF6B35,#FF8C42);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;margin-top:8px;">View Full Dashboard →</a>
    """)
    _send_email(to_email, subject, plain, email_type="weekly_report", body_html=html)


def _send_team_welcome_email(to_email: str, license_key: str, team_name: str):
    """Send team creation welcome email."""
    subject = f"Your ReplyPals Team '{team_name}' is ready!"
    plain   = f"Team: {team_name}\nAdmin License Key: {license_key}\nActivate in the extension."
    html = _make_html_email(subject, f"Your team '{team_name}' is live →", f"""
      <h2 style="color:#0F2544;font-size:22px;font-weight:700;margin:0 0 8px;">Your Team is Ready! 👥</h2>
      <p style="color:#6B7280;font-size:15px;margin:0 0 20px;">Team <strong style="color:#FF6B35;">{team_name}</strong> is now active with unlimited rewrites for all members.</p>
      <div style="background:#F8F9FE;border:2px dashed #FF6B35;border-radius:12px;padding:20px;text-align:center;margin:0 0 24px;">
        <p style="color:#9CA3AF;font-size:12px;font-weight:600;letter-spacing:0.1em;margin:0 0 8px;text-transform:uppercase;">Admin License Key</p>
        <p style="font-family:'Courier New',monospace;font-size:20px;font-weight:700;color:#0F2544;letter-spacing:0.08em;margin:0;">{license_key}</p>
      </div>
      <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 12px;">Getting started:</p>
      <ol style="color:#6B7280;font-size:14px;line-height:2;margin:0;padding-left:20px;">
        <li>Activate your admin key in the ReplyPals extension</li>
        <li>Go to the <strong>Team</strong> tab in the side panel</li>
        <li>Invite members — they'll receive their own key by email</li>
      </ol>
    """)
    _send_email(to_email, subject, plain, email_type="team_welcome", body_html=html)


def _send_member_key_email(to_email: str, member_key: str, team_name: str):
    """Send member key to new team member."""
    subject = f"You've been added to team '{team_name}' on ReplyPals"
    plain   = f"Team: {team_name}\nYour license key: {member_key}\nActivate in the Chrome extension."
    html = _make_html_email(subject, f"You're now on team '{team_name}' →", f"""
      <h2 style="color:#0F2544;font-size:22px;font-weight:700;margin:0 0 8px;">You're on the team! 🎉</h2>
      <p style="color:#6B7280;font-size:15px;margin:0 0 20px;">You've been added to <strong style="color:#FF6B35;">{team_name}</strong> on ReplyPals. Here's your personal license key:</p>
      <div style="background:#F8F9FE;border:2px dashed #FF6B35;border-radius:12px;padding:20px;text-align:center;margin:0 0 24px;">
        <p style="color:#9CA3AF;font-size:12px;font-weight:600;letter-spacing:0.1em;margin:0 0 8px;text-transform:uppercase;">Your License Key</p>
        <p style="font-family:'Courier New',monospace;font-size:20px;font-weight:700;color:#0F2544;letter-spacing:0.08em;margin:0;">{member_key}</p>
      </div>
      <ol style="color:#6B7280;font-size:14px;line-height:2;margin:0 0 24px;padding-left:20px;">
        <li>Install <a href="https://chrome.google.com/webstore" style="color:#FF6B35;">ReplyPals from Chrome Web Store</a></li>
        <li>Click the extension icon and choose <strong>"Already have a key?"</strong></li>
        <li>Paste your key and click Activate — done!</li>
      </ol>
      <a href="https://chrome.google.com/webstore" style="display:inline-block;background:linear-gradient(135deg,#FF6B35,#FF8C42);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;">Install Extension →</a>
    """)
    _send_email(to_email, subject, plain, email_type="member_key", body_html=html)


def _make_html_email(title: str, preheader: str, body_html: str) -> str:
    """Wrap content in a beautiful branded HTML email template."""
    return f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
</head>
<body style="margin:0;padding:0;background:#F8F9FE;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;color:#F8F9FE;">{preheader}</div>
  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FE;padding:32px 0;">
    <tr><td align="center">
      <!-- Card -->
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0F2544 0%,#1a3a6e 60%,#FF6B35 100%);border-radius:16px 16px 0 0;padding:28px 36px;text-align:center;">
            <span style="display:inline-block;width:44px;height:44px;background:#FF6B35;border-radius:50%;line-height:44px;font-size:20px;font-weight:900;color:#fff;font-family:Arial;">R</span>
            <h1 style="color:#fff;font-size:22px;font-weight:700;margin:12px 0 0;letter-spacing:-0.3px;">ReplyPals</h1>
            <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:4px 0 0;">Write better English. Sound more confident.</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="background:#fff;padding:36px;border-radius:0 0 16px 16px;">
            {body_html}
            <!-- Divider -->
            <hr style="border:none;border-top:1px solid #EAECF4;margin:28px 0;">
            <!-- Footer -->
            <p style="color:#9CA3AF;font-size:12px;text-align:center;margin:0;line-height:1.8;">
              © 2025 ReplyPals · Built for non-native English speakers worldwide 🌍<br>
              <a href="https://replypals.in" style="color:#FF6B35;text-decoration:none;">replypals.in</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _send_email(to_email: str, subject: str, body_plain: str, email_type: str = "manual", body_html: str = ""):
    """Send branded HTML email via Gmail SMTP and log to Supabase."""
    from email.mime.multipart import MIMEMultipart
    status = "sent"
    error_msg = None

    if not GMAIL_ADDRESS or not GMAIL_APP_PASSWORD:
        status = "failed"
        error_msg = "Gmail credentials not configured"
        print(f"[email] NOT SENT — Gmail not configured. Subject: {subject}")
    else:
        try:
            if body_html:
                msg = MIMEMultipart("alternative")
                msg["Subject"] = str(Header(subject, "utf-8"))
                msg["From"] = f"ReplyPals <{GMAIL_ADDRESS}>"
                msg["To"] = to_email
                msg.attach(MIMEText(body_plain, "plain", "utf-8"))
                msg.attach(MIMEText(body_html, "html", "utf-8"))
            else:
                msg = MIMEText(body_plain, "plain", "utf-8")
                msg["Subject"] = str(Header(subject, "utf-8"))
                msg["From"] = f"ReplyPals <{GMAIL_ADDRESS}>"
                msg["To"] = to_email

            with smtplib.SMTP("smtp.gmail.com", 587, timeout=8) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
                server.send_message(msg)
            print(f"[email] Sent '{subject}' to {to_email}")
        except Exception as e:
            status = "failed"
            error_msg = str(e)[:500]
            print(f"[email] FAILED '{subject}' to {to_email}: {e}")

    if supabase:
        try:
            supabase.table("email_log").insert({
                "to_email": to_email,
                "subject":  subject,
                "type":     email_type,
                "status":   status,
                "error":    error_msg,
            }).execute()
        except Exception:
            pass


def _send_cost_guardrail_alert(
    user_email: str, user_id: str, total_usd: float, threshold_usd: float
) -> None:
    to_addr = os.getenv("SUPPORT_EMAIL", GMAIL_ADDRESS or "support@replypals.in")
    sub = f"[ReplyPals] Cost guardrail — user {user_id[:8]}…"
    body = (
        f"Estimated daily LLM cost for user {user_id} ({user_email or 'no email'}) "
        f"exceeded ${threshold_usd:.2f} (now ${total_usd:.4f}). Account paused 24h."
    )
    _send_email(to_addr, sub, body, "cost_guardrail")


async def _after_llm_usage(rate: dict) -> None:
    """usage_logs + cost guardrail from ``system_config`` (estimated daily cost → pause + alert)."""
    if not supabase or rate.get("degraded"):
        return
    if rate.get("anon_only") and rate.get("anon_id"):
        await increment_anon_usage(supabase, _sb_execute, str(rate["anon_id"]))
        return
    ruid = rate.get("resolved_user_id")
    if not ruid:
        return
    if not rate.get("user_id"):
        rate["user_id"] = ruid
    cost = float(rate.get("_last_cost_usd") or 0)
    usage_src = rate.get("usage_source") or "subscription"
    if usage_src not in ("subscription", "credits"):
        usage_src = "subscription"
    await ensure_user_profile_row(
        supabase, _sb_execute, resolved_uid=ruid, email=rate.get("email")
    )
    await record_rewrite_usage(
        supabase,
        _sb_execute,
        user_id=ruid,
        team_id=rate.get("team_id"),
        cost_usd=cost,
        usage_source=usage_src,
    )
    total = await today_total_cost_usd(supabase, _sb_execute, ruid)
    snap = await get_commerce_snapshot(supabase, _sb_execute)
    guard = snap.cost_guardrail_usd()
    if total > guard:
        await apply_cost_pause(supabase, _sb_execute, ruid)
        try:
            await asyncio.to_thread(
                _send_cost_guardrail_alert,
                rate.get("email") or "",
                ruid,
                total,
                guard,
            )
        except Exception as e:
            print(f"[cost_guardrail alert] {e}")
        raise HTTPException(status_code=429, detail=CostGuardrailBody().model_dump())


# ═══════════════════════════════════════════
# USER ACCOUNT SYSTEM (Supabase Auth)
# ═══════════════════════════════════════════

def verify_user_token(authorization: str = Header(None)) -> str:
    """Verify a Supabase JWT and return the user_id (sub claim)."""
    if not authorization or not pyjwt:
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization.replace("Bearer ", "")
    try:
        payload = pyjwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload.get("sub", "")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_user_from_token(authorization: str) -> Optional[dict]:
    """Extract and verify Supabase JWT. Returns user dict or None."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ")[1]
    try:
        # Verify with decoded project JWT secret first; fallback to raw env for compatibility.
        for secret in (SUPABASE_JWT_SECRET, os.getenv("SUPABASE_JWT_SECRET", "")):
            if not secret:
                continue
            try:
                payload = pyjwt.decode(
                    token,
                    secret,
                    algorithms=["HS256"],
                    audience="authenticated",
                )
                return payload
            except Exception:
                continue

        # Fallback: verify token by calling Supabase Auth user endpoint.
        # This avoids hard-failing dashboard endpoints when JWT secret env is mismatched.
        if SUPABASE_URL and (SUPABASE_ANON_KEY or SUPABASE_KEY):
            try:
                auth_url = SUPABASE_URL.rstrip("/") + "/auth/v1/user"
                for apikey in (SUPABASE_ANON_KEY, SUPABASE_KEY):
                    if not apikey:
                        continue
                    r = httpx.get(
                        auth_url,
                        headers={
                            "Authorization": f"Bearer {token}",
                            "apikey": apikey,
                        },
                        timeout=5.0,
                    )
                    if r.status_code == 200:
                        u = r.json() or {}
                        uid = u.get("id") or u.get("sub")
                        email = u.get("email", "")
                        if uid:
                            return {"sub": uid, "email": email, "aud": "authenticated"}
            except Exception:
                pass
        return None
    except Exception:
        return None


class AccountRegisterRequest(BaseModel):
    email: str
    name: Optional[str] = None
    user_id: str
    anon_id: Optional[str] = None

def _synthetic_email_from_anon_id(anon_id: Optional[str]) -> Optional[str]:
    if not anon_id:
        return None
    v = str(anon_id).strip()
    if not v:
        return None
    return f"anon_{v[:16]}@replypal.internal"


@app.post("/account/register")
async def account_register(
    request: Request,
    authorization: str = Header(None)
):
    """
    Called when user signs in or signs up via the website.
    Creates/updates user_profiles row.
    Links user_id to any existing license or free_user record.
    """
    body = await request.json()
    user_id   = body.get("user_id")
    email     = body.get("email", "").lower().strip()
    full_name = body.get("full_name", "")
    anon_id   = body.get("anon_id")

    if not user_id or not email:
        return {"ok": False, "error": "Missing user_id or email"}
    resolved_user_id = _resolve_user_id_for_db(user_id, email)
    if not resolved_user_id:
        return {"ok": False, "error": "Invalid user_id"}

    try:
        # Send welcome only on first account creation, not on repeated sign-ins.
        existing_profile = None
        try:
            existing_profile = supabase.table("user_profiles").select("id").eq("id", resolved_user_id).maybe_single().execute()
        except Exception:
            existing_profile = None
        is_first_registration = not bool(existing_profile and existing_profile.data)

        # Upsert user profile (create or update if exists)
        supabase.table("user_profiles").upsert({
            "id":        resolved_user_id,
            "email":     email,
            "full_name": full_name,
            "last_seen": "now()",
        }, on_conflict="id").execute()

        # ── Backfill user_id into licenses (case-insensitive email match) ──
        try:
            supabase.table("licenses").update({"user_id": resolved_user_id}) \
                .is_("user_id", "null").ilike("email", email).execute()
        except Exception as _e:
            print(f"[register backfill/licenses] non-fatal: {_e}")

        # ── Backfill user_id into free_users (case-insensitive email match) ──
        try:
            res = supabase.table("free_users").update(
                {"user_id": resolved_user_id, "last_active": "now()"}
            ).ilike("email", email).execute()

            if not res.data:
                # No existing row — create one
                supabase.table("free_users").insert({
                    "email":   email,
                    "user_id": resolved_user_id,
                }).execute()
        except Exception as _e:
            print(f"[register backfill/free_users] non-fatal: {_e}")

        # Link previous anonymous usage row (if provided by client).
        anon_email = _synthetic_email_from_anon_id(anon_id)
        if anon_email:
            try:
                anon_row = supabase.table("free_users").select("*").eq("email", anon_email).maybe_single().execute()
                if anon_row.data:
                    merged_bonus = max(
                        int(anon_row.data.get("bonus_rewrites") or 0),
                        0,
                    )
                    supabase.table("free_users").update({
                        "email": email,
                        "user_id": resolved_user_id,
                        "bonus_rewrites": merged_bonus,
                        "last_active": "now()",
                    }).eq("id", anon_row.data["id"]).execute()
            except Exception as _e:
                print(f"[register anon-link] non-fatal: {_e}")

        if is_first_registration:
            first_name = (full_name or "").strip().split(" ")[0] if full_name else ""
            asyncio.create_task(asyncio.to_thread(_send_welcome_email, email, first_name))

        return {"ok": True}
    except Exception as e:
        print(f"[account/register] error: {e}")
        if _pg_fallback_account_register(resolved_user_id, email, full_name):
            return {"ok": True, "message": "Registered via DB fallback"}
        return {"ok": False, "error": str(e)}


@app.get("/account/status")
async def account_status(authorization: str = Header(None)):
    user = get_user_from_token(authorization)
    if not user:
        _dash_dbg("account_status unauthorized", has_auth=bool(authorization))
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    user_id = user.get("sub")
    email   = user.get("email", "")
    _dash_dbg("account_status start", user_id=user_id, email=email)
    if not supabase:
        _dash_dbg("account_status no_supabase")
        return {
            "plan": "free",
            "active": False,
            "rewrites_used": 0,
            "rewrites_limit": int(_free_monthly_cap_from_db()),
            "mode": "memory_only",
        }
    email_lower = (email or "").strip().lower()

    try:
        # Check if user has a license
        license_result = await _sb_execute(
            supabase.table("licenses")
            .select("*")
            .or_(f"user_id.eq.{user_id},email.eq.{email_lower}")
            .eq("active", True)
            .order("created_at", desc=True)
            .limit(1),
            timeout_sec=3.0,
        )

        if license_result.data:
            lic = license_result.data[0]
            _dash_dbg("account_status paid", plan=lic.get("plan", "pro"), active=bool(lic.get("active", True)))
            return {
                "plan":        lic.get("plan", "pro"),
                "active":      True,
                "license_key": lic.get("license_key", "")[:8] + "••••••••",
                "renews_at":   lic.get("renews_at"),
                "rewrites_used": lic.get("rewrites_used", 0),
                "rewrites_limit": lic.get("rewrites_limit", -1),
                "reset_date": lic.get("reset_date")
            }

        # Free tier: usage from llm_call_logs (same source as admin + /free-usage), not free_users.rewrites_used
        free_result = await _sb_execute(
            supabase.table("free_users")
            .select("bonus_rewrites")
            .or_(f"user_id.eq.{user_id},email.eq.{email_lower}")
            .limit(1),
            timeout_sec=3.0,
        )

        bonus = 0
        if free_result.data:
            bonus = int(free_result.data[0].get("bonus_rewrites") or 0)

        rewrites_used = await _free_monthly_used_llm_logs(user_id, email_lower)
        base_cap = _free_monthly_cap_from_db()
        _dash_dbg("account_status free", rewrites_used=rewrites_used, bonus=bonus)

        return {
            "plan":               "free",
            "active":             False,
            "rewrites_used":      rewrites_used,
            "rewrites_limit":     base_cap + bonus,
            "monthly_base_limit": base_cap,
            "bonus_rewrites":     bonus,
        }
    except Exception as e:
        _mark_supabase_down(e)
        _dash_dbg("account_status fallback_error", error=str(e))
        return {
            "plan": "free",
            "active": False,
            "rewrites_used": 0,
            "rewrites_limit": int(_free_monthly_cap_from_db()),
            "degraded": True,
        }


@app.get("/account/license-key")
async def account_license_key(authorization: str = Header(None)):
    """Return the full (unmasked) license key for the authenticated user."""
    user_id = verify_user_token(authorization)
    if not supabase:
        raise HTTPException(500, "Database not connected")

    try:
        lic = supabase.table("licenses").select("license_key,plan").eq("user_id", user_id).execute()
        if lic.data and len(lic.data) > 0:
            return {"license_key": lic.data[0]["license_key"], "plan": lic.data[0]["plan"]}
    except Exception:
        pass
    raise HTTPException(404, "No license found for this account")


@app.get("/account/stats")
async def account_stats(authorization: str = Header(None)):
    user = get_user_from_token(authorization)
    if not user:
        _dash_dbg("account_stats unauthorized", has_auth=bool(authorization))
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    user_id = user.get("sub")
    _dash_dbg("account_stats start", user_id=user_id)
    if not supabase:
        _dash_dbg("account_stats no_supabase")
        return {
            "total_rewrites": 0,
            "avg_score":      0,
            "top_tone":       None,
            "scores_by_day":  [],
            "recent_tips":    [],
            "mode": "memory_only",
        }
    try:
        profile = await _sb_execute(
            supabase.table("user_profiles")
            .select("*")
            .eq("id", user_id)
            .single(),
            timeout_sec=3.0,
        )
        
        if not profile.data:
            _dash_dbg("account_stats no_profile", user_id=user_id)
            return {
                "total_rewrites": 0,
                "avg_score":      0,
                "top_tone":       None,
                "scores_by_day":  [],
                "recent_tips":    [],
            }
        
        data       = profile.data
        scores_log = data.get("scores_log", []) or []
        
        # Group scores by day for chart
        from collections import defaultdict
        by_day = defaultdict(list)
        for entry in scores_log:
            day = entry.get("ts", "")[:10]  # "2026-03-11"
            if day:
                by_day[day].append(entry.get("score", 0))
        
        scores_by_day = [
            {
                "date":  day,
                "count": len(scores),
                "avg":   round(sum(scores) / len(scores), 1),
            }
            for day, scores in sorted(by_day.items())
        ][-30:]  # last 30 days
        
        # Recent tips (last 5 non-null)
        recent_tips = [
            e["tip"] for e in reversed(scores_log)
            if e.get("tip")
        ][:5]
        
        return {
            "total_rewrites": data.get("total_rewrites", 0),
            "avg_score":      data.get("avg_score", 0),
            "top_tone":       data.get("top_tone"),
            "scores_by_day":  scores_by_day,
            "recent_tips":    recent_tips,
        }
    except Exception as e:
        _mark_supabase_down(e)
        _dash_dbg("account_stats fallback_error", error=str(e))
        return {
            "total_rewrites": 0,
            "avg_score":      0,
            "top_tone":       None,
            "scores_by_day":  [],
            "recent_tips":    [],
            "degraded": True,
        }


# ═══════════════════════════════════════════
# REFERRAL SYSTEM
# ═══════════════════════════════════════════
@app.get("/account/referral")
async def account_referral(authorization: str = Header(None)):
    """Get or create referral code for the authenticated user."""
    user = get_user_from_token(authorization)
    if not user:
        _dash_dbg("account_referral unauthorized", has_auth=bool(authorization))
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    email   = user.get("email", "")
    user_id = user.get("sub", "")
    _dash_dbg("account_referral start", user_id=user_id, email=email)
    if not email:
        raise HTTPException(status_code=400, detail="No email in token")

    try:
        if _supabase_in_backoff():
            import hashlib
            ref_code = hashlib.md5(email.lower().encode()).hexdigest()[:8].upper()
            referral_url = f"{os.getenv('APP_BASE_URL', 'https://replypals.in')}/signup?ref={ref_code}"
            _dash_dbg("account_referral degraded_backoff", ref_code=ref_code)
            return {"ref_code": ref_code, "referral_url": referral_url, "bonus_rewrites": 0, "degraded": True}

        # Find existing row
        res = await _sb_execute(
            supabase.table("free_users").select("ref_code,bonus_rewrites").or_(
                f"user_id.eq.{user_id},email.eq.{email}"
            ).limit(1),
            timeout_sec=3.0,
        )

        if res.data and res.data[0].get("ref_code"):
            ref_code = res.data[0]["ref_code"]
            bonus    = res.data[0].get("bonus_rewrites", 0)
        else:
            # Generate a unique short code from email
            import hashlib
            ref_code = hashlib.md5(email.lower().encode()).hexdigest()[:8].upper()
            # Upsert it
            await _sb_execute(
                supabase.table("free_users").update({"ref_code": ref_code}).or_(
                    f"user_id.eq.{user_id},email.eq.{email}"
                ),
                timeout_sec=3.0,
            )
            bonus = 0

        referral_url = f"{os.getenv('APP_BASE_URL', 'https://replypals.in')}/signup?ref={ref_code}"
        _dash_dbg("account_referral ok", ref_code=ref_code, bonus=bonus)
        return {
            "ref_code":     ref_code,
            "referral_url": referral_url,
            "bonus_rewrites": bonus,
        }
    except Exception as e:
        _mark_supabase_down(e)
        import hashlib
        ref_code = hashlib.md5(email.lower().encode()).hexdigest()[:8].upper()
        referral_url = f"{os.getenv('APP_BASE_URL', 'https://replypals.in')}/signup?ref={ref_code}"
        _dash_dbg("account_referral fallback_error", error=str(e), ref_code=ref_code)
        return {"ref_code": ref_code, "referral_url": referral_url, "bonus_rewrites": 0, "degraded": True}


@app.post("/referral/use")
async def referral_use(request: Request):
    """Called when a new user signs up via a referral link."""
    body     = await request.json()
    ref_code = (body.get("ref_code") or "").strip().upper()
    new_email = (body.get("email") or "").strip().lower()

    if not ref_code or not new_email:
        return {"ok": False, "error": "Missing ref_code or email"}

    try:
        # Find referrer
        referrer = supabase.table("free_users").select("id,email,bonus_rewrites").eq("ref_code", ref_code).limit(1).execute()
        if not referrer.data:
            return {"ok": False, "error": "Invalid referral code"}

        referrer_row   = referrer.data[0]
        referrer_email = referrer_row["email"]

        # Credit referrer +5
        new_bonus = (referrer_row.get("bonus_rewrites") or 0) + 5
        supabase.table("free_users").update({"bonus_rewrites": new_bonus}).eq("id", referrer_row["id"]).execute()

        # Credit new user +5 bonus if their row exists
        supabase.table("free_users").update({"bonus_rewrites": 5, "referred_by": ref_code}).eq("email", new_email).execute()

        return {"ok": True, "referrer": referrer_email}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════
# ANONYMOUS REWRITE TRACKING  
# Track rewrites for users who haven't logged in
# Uses a browser fingerprint / anonymous session ID
# ═══════════════════════════════════════════
@app.post("/track-rewrite")
async def track_rewrite_anonymous(request: Request):
    """
    Track rewrites for anonymous (not logged in) users.
    
    How it works:
    - The extension generates a stable anonymous ID stored in chrome.storage.local
    - On each rewrite, it sends this ID + email (if provided) to this endpoint
    - Returns how many rewrites this anonymous user has used & their limit
    - When they eventually log in, their email links the data to their account
    """
    body       = await request.json()
    anon_id    = (body.get("anon_id") or "").strip()    # UUID stored in extension
    email      = (body.get("email") or "").strip().lower()
    score      = int(body.get("score") or 0)
    
    if not anon_id:
        return {"ok": False, "error": "anon_id required"}

    # We track anonymous users in free_users using a synthetic email
    synthetic_email = email or f"anon_{anon_id[:16]}@replypal.internal"

    try:
        res = supabase.table("free_users").select(
            "id,total_rewrites,bonus_rewrites,avg_score,tips_log"
        ).eq("email", synthetic_email).limit(1).execute()

        FREE_LIMIT = _free_monthly_cap_from_db()

        if res.data:
            row       = res.data[0]
            old_count = row.get("total_rewrites", 0)
            old_avg   = row.get("avg_score", 0) or 0
            bonus     = row.get("bonus_rewrites", 0)
            new_count = old_count + 1
            new_avg   = round(((old_avg * old_count) + score) / new_count, 1) if score else old_avg
            supabase.table("free_users").update({
                "total_rewrites": new_count,
                "avg_score":      new_avg,
                "last_active":    datetime.utcnow().isoformat(),
            }).eq("id", row["id"]).execute()
            used  = new_count
            limit = FREE_LIMIT + bonus
        else:
            # Create new anon row
            supabase.table("free_users").insert({
                "email":          synthetic_email,
                "total_rewrites": 1,
                "avg_score":      score,
                "last_active":    datetime.utcnow().isoformat(),
            }).execute()
            used  = 1
            limit = FREE_LIMIT

        return {
            "ok":              True,
            "rewrites_used":   used,
            "rewrites_limit":  limit,
            "rewrites_left":   max(0, limit - used),
            "can_rewrite":     used <= limit,
        }
    except Exception as e:
        print(f"[track-rewrite] error: {e}")
        return {"ok": False, "error": str(e)}


@app.post("/free-usage")
async def free_usage_status(body: FreeUsageRequest):
    """
    Return usage without incrementing counters.
    - Real email (signed-in / saved email): free tier, calendar month, cap from plan_config (10/mo default).
    - anon_id only (or synthetic @replypal.internal): lifetime anon cap (3), plan ``anon``.
    """
    raw_email = (body.email or "").strip().lower()
    anon_id = (body.anon_id or "").strip()

    if raw_email and not raw_email.endswith("@replypal.internal"):
        identity_email = raw_email
        is_anon_tier = False
    elif anon_id:
        identity_email = (_synthetic_email_from_anon_id(anon_id) or "").strip().lower()
        is_anon_tier = True
    else:
        identity_email = ""
        is_anon_tier = False

    if not identity_email and not anon_id:
        cap = _free_monthly_cap_from_db()
        _usage_dbg("free_usage_fetch", path="no_identity", used=0, limit=cap)
        return {
            "ok": True,
            "plan": "free",
            "rewrites_used": 0,
            "rewrites_limit": cap,
            "rewrites_left": cap,
            "source": "none",
            "bonus_rewrites": 0,
            "monthly_base_limit": cap,
        }

    if not supabase:
        if is_anon_tier and anon_id:
            _usage_dbg("free_usage_fetch", path="memory_only_anon", anon_id=anon_id, used=0, limit=ANON_LIFETIME_LIMIT)
            return {
                "ok": True,
                "plan": "anon",
                "rewrites_used": 0,
                "rewrites_limit": ANON_LIFETIME_LIMIT,
                "rewrites_left": ANON_LIFETIME_LIMIT,
                "source": "anon_id",
                "bonus_rewrites": 0,
                "monthly_base_limit": ANON_LIFETIME_LIMIT,
            }
        base = int(_free_monthly_cap_from_db())
        _usage_dbg("free_usage_fetch", path="memory_only", identity_email=identity_email, used=0, limit=base)
        return {
            "ok": True,
            "plan": "free",
            "rewrites_used": 0,
            "rewrites_limit": base,
            "rewrites_left": base,
            "source": "memory_only",
            "bonus_rewrites": 0,
            "monthly_base_limit": base,
        }

    if is_anon_tier and anon_id:
        used = await get_anon_total_used(supabase, _sb_execute, anon_id)
        lim = ANON_LIFETIME_LIMIT
        _usage_dbg(
            "free_usage_fetch",
            path="anon_db",
            anon_id=anon_id,
            used=used,
            limit=lim,
        )
        return {
            "ok": True,
            "plan": "anon",
            "rewrites_used": used,
            "rewrites_limit": lim,
            "rewrites_left": max(0, lim - used),
            "source": "anon_id",
            "bonus_rewrites": 0,
            "monthly_base_limit": lim,
        }

    bonus = 0
    try:
        fu = await _sb_execute(
            supabase.table("free_users")
            .select("bonus_rewrites")
            .eq("email", identity_email)
            .maybe_single(),
            timeout_sec=3.0
        )
        if fu and fu.data:
            bonus = int(fu.data.get("bonus_rewrites") or 0)
    except Exception:
        bonus = 0

    month_start = datetime.now(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    ).isoformat()
    used = 0
    try:
        cnt = await _sb_execute(
            supabase.table("llm_call_logs")
            .select("id", count="exact")
            .eq("email", identity_email)
            .eq("status", "success")
            .gte("created_at", month_start),
            timeout_sec=4.0
        )
        used = int(cnt.count or 0)
    except Exception:
        used = 0

    base_cap = _free_monthly_cap_from_db()
    limit = base_cap + bonus
    _usage_dbg(
        "free_usage_fetch",
        path="db",
        identity_email=identity_email,
        used=used,
        limit=limit,
        bonus=bonus,
        source="email",
    )
    return {
        "ok": True,
        "plan": "free",
        "rewrites_used": used,
        "rewrites_limit": limit,
        "rewrites_left": max(0, limit - used),
        "source": "email",
        "bonus_rewrites": bonus,
        "monthly_base_limit": base_cap,
    }


@app.post("/account/billing-portal")
async def account_billing_portal(authorization: str = Header(None)):
    """Create a Stripe billing portal session for the user."""
    user_id = verify_user_token(authorization)
    if not supabase or not stripe:
        raise HTTPException(500, "Stripe or database not configured")

    # Get stripe customer ID from licenses
    try:
        lic = supabase.table("licenses").select("stripe_customer_id,email").eq("user_id", user_id).execute()
        if not lic.data or not lic.data[0].get("stripe_customer_id"):
            raise HTTPException(400, "No billing account found. Contact support@replypals.in")

        portal = stripe.billing_portal.Session.create(
            customer=lic.data[0]["stripe_customer_id"],
            return_url=FRONTEND_CANCEL_URL,
        )
        return {"url": portal.url}
    except stripe.error.StripeError as e:
        raise HTTPException(400, str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, "Billing portal error")


@app.post("/account/resend-license")
async def account_resend_license(authorization: str = Header(None)):
    """Resend the license key email to the authenticated user."""
    user_id = verify_user_token(authorization)
    if not supabase:
        raise HTTPException(500, "Database not connected")

    try:
        lic = supabase.table("licenses").select("license_key,email,plan").eq("user_id", user_id).execute()
        if not lic.data:
            raise HTTPException(404, "No license found")
        row = lic.data[0]
        _send_license_email(row["email"], row["license_key"], row.get("plan", "pro"))
        return {"ok": True, "email": row["email"]}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(500, "Failed to resend email")


class PaymentSuccessRequest(BaseModel):
    session_id: str


@app.post("/account/payment-success")
async def account_payment_success(body: PaymentSuccessRequest):
    """Get payment details from a Stripe checkout session ID."""
    if not stripe:
        raise HTTPException(500, "Stripe not configured")
    try:
        session = stripe.checkout.Session.retrieve(body.session_id)
        email = session.get("customer_email", "")
        plan = session.get("metadata", {}).get("plan", "pro")
        # Find the license
        key_hint = ""
        if supabase:
            try:
                lic = supabase.table("licenses").select("license_key").eq("email", email).order("created_at", desc=True).limit(1).execute()
                if lic.data:
                    k = lic.data[0]["license_key"]
                    key_hint = k[:4] + "-..." if len(k) > 4 else k
            except Exception:
                pass
        return {"email": email, "plan": plan, "license_key_hint": key_hint}
    except Exception:
        raise HTTPException(400, "Invalid session")


class ResendBySessionRequest(BaseModel):
    session_id: str


@app.post("/account/resend-license-by-session")
async def account_resend_license_by_session(body: ResendBySessionRequest):
    """Resend license email using Stripe session ID (no auth needed, used on success page)."""
    if not stripe:
        raise HTTPException(500, "Stripe not configured")
    try:
        session = stripe.checkout.Session.retrieve(body.session_id)
        email = session.get("customer_email", "")
        if not email:
            raise HTTPException(400, "No email found")
        if supabase:
            lic = supabase.table("licenses").select("license_key,plan").eq("email", email).order("created_at", desc=True).limit(1).execute()
            if lic.data:
                _send_license_email(email, lic.data[0]["license_key"], lic.data[0].get("plan", "pro"))
                return {"ok": True}
        raise HTTPException(404, "License not found")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(500, "Failed to resend")


# ═══════════════════════════════════════════
# SERVE WEBSITE (static HTML from ../website/)
# ═══════════════════════════════════════════
from fastapi.responses import FileResponse

_website_dir = pathlib.Path(__file__).parent.parent / "website"

# Serve individual HTML pages at clean paths
@app.get("/", include_in_schema=False)
async def serve_home():
    f = _website_dir / "index.html"
    if f.exists():
        return FileResponse(str(f), media_type="text/html")
    return {"message": "ReplyPals API is running"}


@app.get("/robots.txt", include_in_schema=False)
async def serve_robots():
    f = _website_dir / "robots.txt"
    if f.exists():
        return FileResponse(str(f), media_type="text/plain")
    # Safe default if file is absent.
    return PlainTextResponse(content="User-agent: *\nAllow: /\n")

# Map all website pages
_WEBSITE_PAGES = [
    "login.html", "signup.html", "dashboard.html",
    "forgot-password.html", "reset-password.html",
    "auth-callback.html", "success.html", "contact.html",
    "privacy.html", "terms.html", "refund.html",
]

for _page in _WEBSITE_PAGES:
    _page_path = f"/{_page}"
    _page_file = _website_dir / _page

    def _make_handler(filepath):
        async def handler():
            if filepath.exists():
                return FileResponse(str(filepath), media_type="text/html")
            raise HTTPException(404, "Page not found")
        return handler

    app.get(_page_path, include_in_schema=False)(_make_handler(_page_file))

# Also expose clean URLs without `.html` for production domains.
_WEBSITE_PAGE_ALIASES = {
    "/login": "login.html",
    "/signup": "signup.html",
    "/dashboard": "dashboard.html",
    "/forgot-password": "forgot-password.html",
    "/reset-password": "reset-password.html",
    "/auth-callback": "auth-callback.html",
    "/success": "success.html",
    "/contact": "contact.html",
    "/privacy": "privacy.html",
    "/terms": "terms.html",
    "/refund": "refund.html",
}

for _alias_path, _alias_file in _WEBSITE_PAGE_ALIASES.items():
    _file = _website_dir / _alias_file

    def _make_alias_handler(filepath):
        async def handler():
            if filepath.exists():
                return FileResponse(str(filepath), media_type="text/html")
            raise HTTPException(404, "Page not found")
        return handler

    app.get(_alias_path, include_in_schema=False)(_make_alias_handler(_file))


# ═══════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════
if __name__ == "__main__":
    app_env = os.getenv("APP_ENV", "development").lower()
    is_production = app_env == "production"
    # Windows file-watch reload has been unstable in this project.
    # Keep reload off by default; enable only when explicitly requested.
    reload_mode = os.getenv("UVICORN_RELOAD", "0") == "1"
    if is_production:
        reload_mode = False
    default_workers = "2" if is_production else "1"
    workers = int(os.getenv("UVICORN_WORKERS", default_workers))

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8150,
        reload=reload_mode,
        workers=1 if reload_mode else max(1, workers),
    )
