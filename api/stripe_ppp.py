"""
Stripe PPP coupons: percent_off derived from country price_multiplier (subscription checkout).
"""

from __future__ import annotations

from typing import Any, Optional

try:
    import stripe
except ImportError:
    stripe = None


def multiplier_to_percent_off(multiplier: float) -> int:
    """Full price = mult 1.0 → 0% off. India 0.35 → 65% off."""
    m = max(0.0, min(1.0, float(multiplier)))
    off = int(round((1.0 - m) * 100))
    return max(0, min(100, off))


def coupon_id_for_country(country_code: str, percent_off: int) -> str:
    """Stripe coupon id max 40 chars."""
    base = f"rp_ppp_{country_code.upper()}_{percent_off}"
    return base[:40]


def ensure_ppp_coupon(
    country_code: str,
    price_multiplier: float,
    existing_coupon_id: Optional[str] = None,
) -> Optional[str]:
    """
    Create or replace Stripe coupon for this PPP level.
    Returns coupon id to store in country_pricing.stripe_coupon_id.
    """
    if not stripe:
        return None
    pct = multiplier_to_percent_off(price_multiplier)
    if pct <= 0:
        return None
    cid = coupon_id_for_country(country_code, pct)
    try:
        if existing_coupon_id:
            try:
                stripe.Coupon.delete(existing_coupon_id)
            except Exception:
                pass
        stripe.Coupon.create(
            id=cid,
            percent_off=pct,
            duration="forever",
            name=f"ReplyPals PPP {country_code.upper()} {pct}%",
        )
        return cid
    except Exception as e:
        print(f"[stripe_ppp] ensure_ppp_coupon {country_code}: {e}")
        return existing_coupon_id
