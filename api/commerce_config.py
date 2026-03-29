"""
Commerce configuration loaded exclusively from Supabase (plan_config, bundles, PPP, system).
In-memory TTL cache; bust via invalidate_commerce_cache() or POST /admin/config/refresh.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Callable, Optional

# ─── Cache ───────────────────────────────────────────────────────────────────
_cache: dict[str, Any] = {"snapshot": None, "ts": 0.0, "ttl": 300.0}


def invalidate_commerce_cache() -> None:
    _cache["snapshot"] = None
    _cache["ts"] = 0.0


def _num(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v)
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _int(v: Any) -> Optional[int]:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


@dataclass
class PlanConfigRow:
    plan_key: str
    display_name: str
    monthly_rewrites: Optional[int]
    base_price_usd: Optional[float]
    seat_count: int
    is_active: bool
    sort_order: int
    stripe_price_id: Optional[str]


@dataclass
class CreditBundleRow:
    bundle_key: str
    display_name: str
    credits: int
    base_price_usd: float
    is_active: bool
    sort_order: int
    stripe_price_id: Optional[str]


@dataclass
class NudgeRow:
    from_plan: str
    nudge_at_spend_usd: float
    nudge_to_plan: str
    message_template: str


@dataclass
class CountryPricingRow:
    country_code: str
    country_name: str
    currency_code: str
    currency_symbol: str
    price_multiplier: float
    is_active: bool
    stripe_coupon_id: Optional[str]


@dataclass
class CommerceSnapshot:
    plans: dict[str, PlanConfigRow] = field(default_factory=dict)
    bundles: dict[str, CreditBundleRow] = field(default_factory=dict)
    nudges: dict[str, NudgeRow] = field(default_factory=dict)
    countries: dict[str, CountryPricingRow] = field(default_factory=dict)
    system: dict[str, str] = field(default_factory=dict)
    loaded_at: float = 0.0

    def cost_guardrail_usd(self) -> float:
        return float(self.system.get("cost_guardrail_usd_per_day") or 0.5)

    def usage_warning_percent(self) -> float:
        return float(self.system.get("usage_warning_percent") or 80)

    def cache_ttl_seconds(self) -> float:
        return float(self.system.get("credits_cache_ttl_seconds") or 300)

    def maintenance_mode(self) -> bool:
        return str(self.system.get("maintenance_mode") or "").lower() in ("1", "true", "yes")


def _row_plan(r: dict[str, Any]) -> PlanConfigRow:
    return PlanConfigRow(
        plan_key=str(r["plan_key"]).strip().lower(),
        display_name=str(r.get("display_name") or r["plan_key"]),
        monthly_rewrites=_int(r.get("monthly_rewrites")),
        base_price_usd=_num(r.get("base_price_usd")),
        seat_count=int(r.get("seat_count") or 1),
        is_active=bool(r.get("is_active", True)),
        sort_order=int(r.get("sort_order") or 0),
        stripe_price_id=(str(r["stripe_price_id"]).strip() or None) if r.get("stripe_price_id") else None,
    )


def _row_bundle(r: dict[str, Any]) -> CreditBundleRow:
    return CreditBundleRow(
        bundle_key=str(r["bundle_key"]).strip().lower(),
        display_name=str(r.get("display_name") or r["bundle_key"]),
        credits=int(r.get("credits") or 0),
        base_price_usd=float(_num(r.get("base_price_usd")) or 0),
        is_active=bool(r.get("is_active", True)),
        sort_order=int(r.get("sort_order") or 0),
        stripe_price_id=(str(r["stripe_price_id"]).strip() or None) if r.get("stripe_price_id") else None,
    )


def _row_nudge(r: dict[str, Any]) -> NudgeRow:
    return NudgeRow(
        from_plan=str(r["from_plan"]).strip().lower(),
        nudge_at_spend_usd=float(_num(r.get("nudge_at_spend_usd")) or 0),
        nudge_to_plan=str(r.get("nudge_to_plan") or "").strip().lower(),
        message_template=str(r.get("message_template") or ""),
    )


def _row_country(r: dict[str, Any]) -> CountryPricingRow:
    return CountryPricingRow(
        country_code=str(r["country_code"]).strip().upper(),
        country_name=str(r.get("country_name") or r["country_code"]),
        currency_code=str(r.get("currency_code") or "USD").upper(),
        currency_symbol=str(r.get("currency_symbol") or "$"),
        price_multiplier=float(_num(r.get("price_multiplier")) or 1.0),
        is_active=bool(r.get("is_active", True)),
        stripe_coupon_id=(str(r["stripe_coupon_id"]).strip() or None) if r.get("stripe_coupon_id") else None,
    )


def load_commerce_snapshot_sync(supabase: Any) -> CommerceSnapshot:
    """Blocking load from Supabase (run via asyncio.to_thread)."""
    snap = CommerceSnapshot(loaded_at=time.time())
    if not supabase:
        return snap
    try:
        pr = supabase.table("plan_config").select("*").execute()
        for r in pr.data or []:
            row = _row_plan(r)
            snap.plans[row.plan_key] = row
    except Exception as e:
        print(f"[commerce_config] plan_config: {e}")
    try:
        br = supabase.table("credit_bundle_config").select("*").execute()
        for r in br.data or []:
            row = _row_bundle(r)
            snap.bundles[row.bundle_key] = row
    except Exception as e:
        print(f"[commerce_config] credit_bundle_config: {e}")
    try:
        nr = supabase.table("upgrade_nudge_config").select("*").execute()
        for r in nr.data or []:
            row = _row_nudge(r)
            snap.nudges[row.from_plan] = row
    except Exception as e:
        print(f"[commerce_config] upgrade_nudge_config: {e}")
    try:
        sr = supabase.table("system_config").select("key,value").execute()
        for r in sr.data or []:
            k = r.get("key")
            if k:
                snap.system[str(k)] = str(r.get("value") or "")
    except Exception as e:
        print(f"[commerce_config] system_config: {e}")
    try:
        cr = supabase.table("country_pricing").select("*").execute()
        for r in cr.data or []:
            row = _row_country(r)
            snap.countries[row.country_code] = row
    except Exception as e:
        print(f"[commerce_config] country_pricing: {e}")
    return snap


async def get_commerce_snapshot(
    supabase: Any,
    sb_execute: Optional[Callable] = None,
) -> CommerceSnapshot:
    """
    Return cached CommerceSnapshot when fresh; otherwise reload from DB.
    TTL is read from previous snapshot's system_config (defaults 300s).
    """
    now = time.time()
    ttl = float(_cache.get("ttl") or 300)
    cached = _cache.get("snapshot")
    ts = float(_cache.get("ts") or 0)
    if cached is not None and (now - ts) < ttl:
        return cached  # type: ignore[return-value]

    def _load() -> CommerceSnapshot:
        return load_commerce_snapshot_sync(supabase)

    snap = await asyncio.to_thread(_load)
    _cache["ttl"] = snap.cache_ttl_seconds()
    _cache["snapshot"] = snap
    _cache["ts"] = now
    return snap


def localize_usd_price(base_usd: float, multiplier: float) -> float:
    """PPP-adjusted display/checkout amount in USD (Stripe still bills USD)."""
    raw = float(base_usd) * float(multiplier)
    if raw < 1:
        return round(raw, 2)
    if raw <= 10:
        return round(raw * 2) / 2.0
    return float(round(raw))


def format_money(symbol: str, amount: float) -> str:
    if amount < 10 and amount != int(amount):
        return f"{symbol}{amount:.2f}"
    if amount == int(amount):
        return f"{symbol}{int(amount)}"
    return f"{symbol}{amount:.2f}"


def resolve_country_row(snap: CommerceSnapshot, country_code: str) -> tuple[CountryPricingRow, float]:
    """
    Active country row or synthetic default (full USD price).
    Returns (row, multiplier).
    """
    cc = (country_code or "US").strip().upper()
    row = snap.countries.get(cc)
    if row and row.is_active:
        return row, float(row.price_multiplier)
    default = CountryPricingRow(
        country_code=cc,
        country_name=cc,
        currency_code="USD",
        currency_symbol="$",
        price_multiplier=1.0,
        is_active=True,
        stripe_coupon_id=None,
    )
    return default, 1.0


def cheapest_active_bundle(snap: CommerceSnapshot) -> Optional[CreditBundleRow]:
    cand = [b for b in snap.bundles.values() if b.is_active and b.credits > 0]
    if not cand:
        return None
    return min(cand, key=lambda b: float(b.base_price_usd))


def plan_monthly_cap(snap: CommerceSnapshot, plan_key: str, bonus_free: int = 0) -> Optional[int]:
    p = snap.plans.get(plan_key) or snap.plans.get("free")
    if not p:
        return 10 if plan_key == "free" else None
    m = p.monthly_rewrites
    if m is None:
        return None
    cap = int(m)
    if plan_key == "free" and bonus_free:
        cap += int(bonus_free)
    return cap


def format_upgrade_price_for_plan(
    snap: CommerceSnapshot,
    upgrade_to_plan: str,
    country_code: str,
) -> str:
    row, mult = resolve_country_row(snap, country_code)
    tgt = snap.plans.get(upgrade_to_plan)
    if not tgt or tgt.base_price_usd is None:
        return "contact sales"
    loc = localize_usd_price(float(tgt.base_price_usd), mult)
    return f"{format_money(row.currency_symbol, loc)}/mo"
