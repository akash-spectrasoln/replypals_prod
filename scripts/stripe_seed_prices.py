#!/usr/bin/env python3
"""
Create Stripe Prices aligned with plan_config + country_pricing seeds.

**Default (recommended):** Subscription tiers T1–T6 are **all USD**. Each tier uses the same
``price_multiplier`` as the seeded country (US, GB, IN, …) but **only**
``localize_usd_price(base_price_usd, multiplier)`` → cents. **No** ``exchange_rate_per_usd``.
That matches how the API bills: **USD Prices + PPP Stripe coupons** — FX is for UI display only.

So T2 “UK” is not £1.19 in Stripe; it is **$1.50/mo** (150¢) for Starter — i.e. list $2 × 0.85
after ``localize_usd_price`` rounding — which is comparable to T1’s $2.00 instead of looking like a
different currency.

**Optional:** ``--local-currency`` builds Prices in GBP/INR/BRL/… using PPP × FX (same as the
marketing display path). That can look “odd” vs list USD (e.g. £1.19 for a $2 product).

Credit bundles: one-time **USD** list from credit_bundle_config (PPP at checkout via coupon).

Run from replypals-prod:
  python scripts/stripe_seed_prices.py --dry-run
  python scripts/stripe_seed_prices.py --all --force --write-env
  python scripts/stripe_seed_prices.py --all --force --write-env --local-currency   # legacy
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
API_DIR = REPO / "api"
API_ENV = API_DIR / ".env"

sys.path.insert(0, str(API_DIR))
from commerce_config import localize_usd_price, round_for_currency  # noqa: E402

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore

if load_dotenv and API_ENV.is_file():
    load_dotenv(API_ENV)

import stripe  # noqa: E402

# plan_config.base_price_usd (paid plans)
BASE_USD: dict[str, float] = {
    "starter": 2.0,
    "pro": 9.0,
    "growth": 15.0,
    "team": 25.0,
}

# credit_bundle_config.base_price_usd
BUNDLE_USD: dict[str, tuple[float, str]] = {
    "nano": (2.50, "Nano Pack"),
    "starter_c": (10.00, "Starter Credits"),
    "pro_c": (25.00, "Pro Credits"),
    "power_c": (60.00, "Power Pack"),
}

# tier_id, country_code, price_multiplier — same as country_pricing seeds (PPP only; no FX in default mode)
COUNTRY_TIERS_PPP: list[tuple[str, str, float]] = [
    ("T1", "US", 1.000),
    ("T2", "GB", 0.850),
    ("T3", "IN", 0.350),
    ("T4", "BR", 0.420),
    ("T5", "NG", 0.280),
    ("T6", "MX", 0.380),
]

# Optional --local-currency: tier_id, country, stripe currency, mult, exchange_rate_per_usd (20260331)
COUNTRY_TIERS_LOCAL: list[tuple[str, str, str, float, float]] = [
    ("T1", "US", "usd", 1.000, 1.0000),
    ("T2", "GB", "gbp", 0.850, 0.7900),
    ("T3", "IN", "inr", 0.350, 83.0000),
    ("T4", "BR", "brl", 0.420, 5.2000),
    ("T5", "NG", "ngn", 0.280, 1550.0000),
    ("T6", "MX", "mxn", 0.380, 17.5000),
]

_ZERO_DECIMAL = frozenset(
    {
        "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
        "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
    }
)


def _stripe_minor_units(currency_code: str, local_amount: float) -> int:
    cc = (currency_code or "usd").upper()
    if cc in _ZERO_DECIMAL:
        return int(round(local_amount))
    return int(round(local_amount * 100))


def _max_stripe_minor(currency: str, amount: int) -> int:
    cur = currency.lower()
    mins = {
        "usd": 50,
        "gbp": 30,
        "eur": 50,
        "inr": 5000,
        "brl": 50,
        "mxn": 1000,
        "ngn": 5000,
    }
    return max(amount, mins.get(cur, 1))


def tier_stripe_amount_usd_ppp(base_usd: float, price_multiplier: float) -> int:
    """USD cents = localize_usd_price(base, mult) — matches billing; Stripe min $0.50."""
    eff = localize_usd_price(float(base_usd), float(price_multiplier))
    cents = int(round(eff * 100))
    return max(50, cents)


def tier_stripe_amount_local_fx(base_usd: float, currency: str, price_multiplier: float, exchange_rate_per_usd: float) -> int:
    """PPP × FX into local currency minor units (UI display path; can yield e.g. £1.19 for $2 list)."""
    eff = localize_usd_price(float(base_usd), float(price_multiplier))
    fx = float(exchange_rate_per_usd)
    if fx > 0:
        local_amt = eff * fx
        local_amt = round_for_currency(currency, local_amt)
    else:
        local_amt = eff
    raw = _stripe_minor_units(currency, local_amt)
    return _max_stripe_minor(currency, raw)


def _env_key_plan(tier: str, plan_key: str) -> str:
    return f"STRIPE_PRICE_{tier}_{plan_key.upper()}"


def _env_key_bundle(bundle_key: str) -> str:
    return f"STRIPE_PRICE_BUNDLE_{bundle_key.upper()}"


def _plan_label(pk: str) -> str:
    return {"starter": "Starter", "pro": "Pro", "growth": "Growth", "team": "Team"}.get(pk, pk.title())


def _get_or_create_plan_product(plan_key: str) -> str:
    for p in stripe.Product.list(limit=100, active=True).auto_paging_iter():
        md = getattr(p, "metadata", None) or {}
        if md.get("plan_key") == plan_key and not md.get("bundle_key"):
            return p.id
    prod = stripe.Product.create(
        name=f"ReplyPals {_plan_label(plan_key)}",
        metadata={"plan_key": plan_key},
    )
    return prod.id


def _get_or_create_bundle_product(bundle_key: str, display: str) -> str:
    for p in stripe.Product.list(limit=100, active=True).auto_paging_iter():
        md = getattr(p, "metadata", None) or {}
        if md.get("bundle_key") == bundle_key:
            return p.id
    return stripe.Product.create(
        name=f"ReplyPals credits — {display}",
        metadata={"bundle_key": bundle_key, "product_kind": "credits"},
    ).id


def seed_subscriptions(force: bool, local_currency: bool) -> list[tuple[str, str]]:
    created: list[tuple[str, str]] = []
    if local_currency:
        for tier_id, country, currency, mult, fx in COUNTRY_TIERS_LOCAL:
            for plan_key, base in BASE_USD.items():
                envk = _env_key_plan(tier_id, plan_key)
                if not force and (os.getenv(envk) or "").strip().startswith("price_"):
                    print(f"{envk} already set — skip")
                    continue
                unit_amount = tier_stripe_amount_local_fx(base, currency, mult, fx)
                prod_id = _get_or_create_plan_product(plan_key)
                price = stripe.Price.create(
                    product=prod_id,
                    unit_amount=unit_amount,
                    currency=currency,
                    recurring={"interval": "month"},
                    metadata={
                        "plan_key": plan_key,
                        "tier": tier_id,
                        "country_code": country,
                        "pricing_mode": "local_currency_fx",
                    },
                )
                print(f"Created {envk}={price.id} ({country} {currency} {unit_amount})")
                created.append((envk, price.id))
    else:
        for tier_id, country, mult in COUNTRY_TIERS_PPP:
            for plan_key, base in BASE_USD.items():
                envk = _env_key_plan(tier_id, plan_key)
                if not force and (os.getenv(envk) or "").strip().startswith("price_"):
                    print(f"{envk} already set — skip")
                    continue
                unit_amount = tier_stripe_amount_usd_ppp(base, mult)
                prod_id = _get_or_create_plan_product(plan_key)
                price = stripe.Price.create(
                    product=prod_id,
                    unit_amount=unit_amount,
                    currency="usd",
                    recurring={"interval": "month"},
                    metadata={
                        "plan_key": plan_key,
                        "tier": tier_id,
                        "country_code": country,
                        "price_multiplier": str(mult),
                        "pricing_mode": "usd_ppp",
                    },
                )
                print(f"Created {envk}={price.id} ({country} usd {unit_amount})")
                created.append((envk, price.id))
    return created


def seed_bundles(force: bool) -> list[tuple[str, str]]:
    """USD list = credit_bundle_config; PPP at checkout via coupon."""
    created: list[tuple[str, str]] = []
    for bundle_key, (usd, label) in BUNDLE_USD.items():
        envk = _env_key_bundle(bundle_key)
        if not force and (os.getenv(envk) or "").strip().startswith("price_"):
            print(f"{envk} already set — skip")
            continue
        unit_amount = tier_stripe_amount_usd_ppp(usd, 1.0)
        prod_id = _get_or_create_bundle_product(bundle_key, label)
        price = stripe.Price.create(
            product=prod_id,
            unit_amount=unit_amount,
            currency="usd",
            metadata={"bundle_key": bundle_key, "kind": "credits_one_time"},
        )
        print(f"Created {envk}={price.id} (usd {unit_amount})")
        created.append((envk, price.id))
    return created


def _upsert_env_file(path: Path, updates: dict[str, str]) -> None:
    """Replace or append KEY=value lines; preserves unrelated lines and order when replacing."""
    text = path.read_text(encoding="utf-8")
    for key, val in sorted(updates.items()):
        line = f"{key}={val}"
        pat = re.compile(rf"^{re.escape(key)}=.*\r?$", re.MULTILINE)
        if pat.search(text):
            text = pat.sub(line, text, count=1)
        else:
            if not text.endswith("\n"):
                text += "\n"
            text += line + "\n"
    path.write_text(text, encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description="Seed Stripe Prices for ReplyPals (commerce + country_pricing)")
    ap.add_argument("--bundles", action="store_true", help="Only credit bundle USD prices")
    ap.add_argument("--all", action="store_true", help="Subscriptions + bundles")
    ap.add_argument(
        "--force",
        action="store_true",
        help="Create new Prices even when STRIPE_PRICE_* already set (writes new ids)",
    )
    ap.add_argument(
        "--write-env",
        action="store_true",
        help=f"Update {API_ENV.name} with created STRIPE_PRICE_* ids (use with --force to refresh all)",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print computed unit_amount per tier/plan (no API calls)",
    )
    ap.add_argument(
        "--local-currency",
        action="store_true",
        help="Use PPP×FX local currencies (GBP/INR/…); default is USD-only PPP tiers",
    )
    args = ap.parse_args()

    if args.dry_run:
        print(
            "Stripe `unit_amount` for USD is always in **cents** (¢): 200 = $2.00, 900 = $9.00, …\n"
            "T1 uses multiplier 1.0 → those cents match plan_config.base_price_usd (2, 9, 15, 25 dollars).\n"
            "Lower tiers apply country_pricing multipliers to the same list prices before rounding.\n"
        )
        print("Default mode: all subscription Prices in USD (PPP multiplier only, no FX).\n")
        for tier_id, country, mult in COUNTRY_TIERS_PPP:
            print(f"  {tier_id} {country} mult={mult}")
            for plan_key, base in BASE_USD.items():
                ua = tier_stripe_amount_usd_ppp(base, mult)
                print(f"    {plan_key:8} list ${base:.2f}  →  unit_amount={ua}  (= ${ua/100:.2f}/mo)")
        if args.local_currency:
            print("\n--- --local-currency: PPP × FX (display path; e.g. £1.19 for $2 starter UK) ---\n")
            for tier_id, country, currency, mult, fx in COUNTRY_TIERS_LOCAL:
                print(f"  {tier_id} {country} {currency.upper()} mult={mult} fx={fx}")
                for plan_key, base in BASE_USD.items():
                    ua = tier_stripe_amount_local_fx(base, currency, mult, fx)
                    print(f"    {plan_key:8} base_usd={base:4} -> {ua}")
        print("\nBundles (USD list, mult=1):")
        for bk, (usd, _) in BUNDLE_USD.items():
            ua = tier_stripe_amount_usd_ppp(usd, 1.0)
            print(f"    {bk:12} list ${usd:.2f}  →  unit_amount={ua}  (= ${ua/100:.2f} one-time)")
        return

    key = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
    if not key:
        print("Set STRIPE_SECRET_KEY (e.g. in api/.env).", file=sys.stderr)
        sys.exit(1)
    stripe.api_key = key

    sub_created: list[tuple[str, str]] = []
    bun_created: list[tuple[str, str]] = []

    if args.all:
        sub_created = seed_subscriptions(args.force, args.local_currency)
        bun_created = seed_bundles(args.force)
    elif args.bundles:
        bun_created = seed_bundles(args.force)
    else:
        sub_created = seed_subscriptions(args.force, args.local_currency)

    all_pairs = dict(sub_created + bun_created)
    if args.write_env and all_pairs:
        if not API_ENV.is_file():
            print(f"Missing {API_ENV}, cannot --write-env", file=sys.stderr)
            sys.exit(1)
        _upsert_env_file(API_ENV, all_pairs)
        print(f"\nUpdated {API_ENV} with {len(all_pairs)} STRIPE_PRICE_* keys.")

    if sub_created or bun_created:
        print("\nAdd or merge into api/.env:")
        if sub_created:
            by_tier: dict[str, list[tuple[str, str]]] = {}
            for k, v in sub_created:
                parts = k.split("_", 3)
                tier = parts[2] if len(parts) > 2 else "?"
                by_tier.setdefault(tier, []).append((k, v))
            for tier in sorted(by_tier.keys()):
                print(f"\n# --- subscriptions {tier} ---")
                for kk, vv in sorted(by_tier[tier], key=lambda x: x[0]):
                    print(f"{kk}={vv}")
        if bun_created:
            print("\n# --- credit bundles (one-time USD) ---")
            for k, v in sorted(bun_created, key=lambda x: x[0]):
                print(f"{k}={v}")


if __name__ == "__main__":
    main()
