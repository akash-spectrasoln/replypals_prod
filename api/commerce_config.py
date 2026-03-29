"""
Commerce configuration loaded exclusively from Supabase (plan_config, bundles, PPP, system).
In-memory TTL cache; bust via invalidate_commerce_cache() or POST /admin/config/refresh.
"""

from __future__ import annotations

import asyncio
import os
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
    # Local units per 1 USD; when set, UI shows (PPP USD) × rate in currency_code.
    exchange_rate_per_usd: Optional[float] = None


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


def _env_stripe_price_for_plan(plan_key: str) -> str:
    """When ``plan_config.stripe_price_id`` is empty: USD Tier-1 keys (PPP uses coupons, not extra Prices)."""
    pk = (plan_key or "").strip().lower()
    keys = (
        ("starter", ("STRIPE_PRICE_STARTER", "STRIPE_PRICE_T1_STARTER")),
        ("pro", ("STRIPE_PRICE_PRO", "STRIPE_PRICE_T1_PRO")),
        ("growth", ("STRIPE_PRICE_GROWTH", "STRIPE_PRICE_T1_GROWTH")),
        ("team", ("STRIPE_PRICE_TEAM", "STRIPE_PRICE_T1_TEAM")),
    )
    for name, envnames in keys:
        if name == pk:
            for ek in envnames:
                v = (os.getenv(ek) or "").strip()
                if v.startswith("price_"):
                    return v
            break
    return ""


def resolve_stripe_price_id_for_plan(plan_key: str, prow: Optional[PlanConfigRow]) -> str:
    if prow and prow.stripe_price_id:
        s = str(prow.stripe_price_id).strip()
        if s:
            return s
    return _env_stripe_price_for_plan(plan_key)


def plan_key_from_stripe_price_id(price_id: Optional[str], snap: CommerceSnapshot) -> Optional[str]:
    if not price_id:
        return None
    pid = str(price_id).strip()
    for pname, prow in snap.plans.items():
        if resolve_stripe_price_id_for_plan(pname, prow) == pid:
            return pname
    return None


def _env_stripe_price_for_bundle(bundle_key: str) -> str:
    """When ``credit_bundle_config.stripe_price_id`` is empty: one-time USD list Price."""
    pk = (bundle_key or "").strip().lower()
    keys = (
        ("nano", ("STRIPE_PRICE_BUNDLE_NANO",)),
        ("starter_c", ("STRIPE_PRICE_BUNDLE_STARTER_C", "STRIPE_BUNDLE_STARTER_C")),
        ("pro_c", ("STRIPE_PRICE_BUNDLE_PRO_C",)),
        ("power_c", ("STRIPE_PRICE_BUNDLE_POWER_C",)),
    )
    for name, envnames in keys:
        if name == pk:
            for ek in envnames:
                v = (os.getenv(ek) or "").strip()
                if v.startswith("price_"):
                    return v
            break
    return ""


def resolve_stripe_price_id_for_bundle(bundle_key: str, brow: Optional[CreditBundleRow]) -> str:
    if brow and brow.stripe_price_id:
        s = str(brow.stripe_price_id).strip()
        if s:
            return s
    return _env_stripe_price_for_bundle(bundle_key)


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
    fx = _num(r.get("exchange_rate_per_usd"))
    return CountryPricingRow(
        country_code=str(r["country_code"]).strip().upper(),
        country_name=str(r.get("country_name") or r["country_code"]),
        currency_code=str(r.get("currency_code") or "USD").upper(),
        currency_symbol=str(r.get("currency_symbol") or "$"),
        price_multiplier=float(_num(r.get("price_multiplier")) or 1.0),
        is_active=bool(r.get("is_active", True)),
        stripe_coupon_id=(str(r["stripe_coupon_id"]).strip() or None) if r.get("stripe_coupon_id") else None,
        exchange_rate_per_usd=float(fx) if fx is not None and fx > 0 else None,
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


# ISO 4217 currencies commonly shown with no fractional units in marketing UIs
_ZERO_DECIMAL = frozenset(
    {
        "BIF",
        "CLP",
        "DJF",
        "GNF",
        "JPY",
        "KMF",
        "KRW",
        "MGA",
        "PYG",
        "RWF",
        "UGX",
        "VND",
        "VUV",
        "XAF",
        "XOF",
        "XPF",
    }
)


def round_for_currency(currency_code: str, amount: float) -> float:
    """Round a localized amount for display (not tax precision)."""
    cc = (currency_code or "USD").upper()
    if cc in _ZERO_DECIMAL:
        return float(round(amount))
    if cc in ("INR", "IDR", "PHP", "NGN", "COP", "HUF", "ISK"):
        return float(round(amount))
    if amount >= 100:
        return float(round(amount))
    if amount == int(amount):
        return float(int(amount))
    return round(amount, 2)


def subscription_checkout_stripe_line(
    prow: PlanConfigRow,
    crow: CountryPricingRow,
    mult: float,
) -> tuple[str, int, float]:
    """
    Build Stripe Checkout ``price_data`` for a subscription: (currency, unit_amount_minor, effective_usd).

    When the country row has ``exchange_rate_per_usd`` and currency is not USD, the charge is in **local
    currency** (e.g. INR for India) so Checkout shows ₹… instead of the US list price ($9).

    PPP is applied via ``localize_usd_price`` × multiplier, then converted with FX — **no separate
    Stripe coupon** (avoids “still $9” when coupons are missing or confusing).
    """
    if prow.base_price_usd is None:
        raise ValueError("plan has no base_price_usd")
    base = float(prow.base_price_usd)
    eff_usd = localize_usd_price(base, mult)
    fx = crow.exchange_rate_per_usd
    cc = (crow.currency_code or "USD").upper()
    if fx is not None and float(fx) > 0 and cc != "USD":
        local_amt = eff_usd * float(fx)
        local_amt = round_for_currency(cc, local_amt)
        if cc in _ZERO_DECIMAL:
            unit = int(round(local_amt))
        else:
            unit = int(round(local_amt * 100))
        unit = max(unit, _stripe_min_minor(cc))
        return cc.lower(), unit, eff_usd
    cents = max(50, int(round(eff_usd * 100)))
    return "usd", cents, eff_usd


def _stripe_min_minor(currency: str) -> int:
    """Rough Stripe minimum charge amounts (minor units)."""
    return {
        "USD": 50,
        "INR": 5000,
        "GBP": 30,
        "EUR": 50,
        "BRL": 50,
        "MXN": 1000,
        "NGN": 5000,
    }.get(currency.upper(), 1)


def format_pricing_display(
    row: CountryPricingRow,
    effective_usd: float,
) -> tuple[str, str, float, float]:
    """
    Build user-facing price string and currency metadata.
    effective_usd = PPP-adjusted list amount in USD (Stripe alignment).

    Returns (display, currency_iso_lower, amount_shown, effective_usd).
    When exchange_rate_per_usd is set: amount_shown is in local currency.
    """
    eff = float(effective_usd)
    fx = row.exchange_rate_per_usd
    if fx is not None and float(fx) > 0:
        local_amt = eff * float(fx)
        local_amt = round_for_currency(row.currency_code, local_amt)
        disp = format_money(row.currency_symbol, local_amt)
        return disp, row.currency_code.lower(), local_amt, eff
    disp = format_money(row.currency_symbol, eff)
    return disp, "usd", eff, eff


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
        exchange_rate_per_usd=None,
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
    eff_usd = localize_usd_price(float(tgt.base_price_usd), mult)
    disp, _, _, _ = format_pricing_display(row, eff_usd)
    return f"{disp}/mo"
