"""
End-to-end quota, billing, and UI consistency tests (API + static pages).

Run (live API):
    REPLYPALS_API_URL=https://www.replypals.in/api pytest tests/e2e/test_quota_billing_e2e.py -v

Run (local):
    REPLYPALS_API_URL=http://127.0.0.1:8150 pytest tests/e2e/test_quota_billing_e2e.py -v

Costly (AI) tests:
    RUN_COSTLY_TESTS=1 REPLYPALS_API_URL=... pytest tests/e2e/test_quota_billing_e2e.py -v -m costly

Optional real license check:
    REPLYPALS_TEST_LICENSE_KEY=RP-... pytest tests/e2e/test_quota_billing_e2e.py -v -k license
"""

from __future__ import annotations

import os
import re
import time
import uuid
from pathlib import Path

import pytest
import requests

REPO_ROOT = Path(__file__).resolve().parents[2]
STATIC_DASHBOARD = REPO_ROOT / "website_static_backup" / "dashboard.html"

BASE = os.getenv("REPLYPALS_API_URL", "http://127.0.0.1:8150").rstrip("/")
TIMEOUT = float(os.getenv("TEST_TIMEOUT", "45"))
ADMIN_USER = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASS = os.getenv("ADMIN_PASSWORD", "changeme123!")
TEST_LICENSE = os.getenv("REPLYPALS_TEST_LICENSE_KEY", "").strip()


def get(path: str, **kw):
    return requests.get(f"{BASE}{path}", timeout=TIMEOUT, **kw)


def post(path: str, **kw):
    return requests.post(f"{BASE}{path}", timeout=TIMEOUT, **kw)


def unique_email() -> str:
    return f"e2e+{uuid.uuid4().hex[:10]}@test.replypals.in"


def unique_anon() -> str:
    return f"e2e-anon-{uuid.uuid4().hex}"


def api_ok() -> bool:
    try:
        return requests.get(f"{BASE}/health", timeout=10).ok
    except Exception:
        return False


def admin_token() -> str:
    r = post("/admin/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    return r.json().get("token", "") if r.status_code == 200 else ""


@pytest.fixture(autouse=True)
def require_api():
    if not api_ok():
        pytest.skip("API not reachable (set REPLYPALS_API_URL)")


@pytest.mark.e2e
class TestQuotaCrossEndpointConsistency:
    """Public config, /free-usage, and pricing must agree on the free tier cap."""

    def test_public_config_has_free_cap_and_plans(self):
        r = get("/public-config")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "free_monthly_rewrites" in data
        cap = int(data["free_monthly_rewrites"])
        assert 1 <= cap <= 10_000, f"unexpected free_monthly_rewrites: {cap}"
        assert "plan_limit_labels" in data and isinstance(data["plan_limit_labels"], dict)
        assert "plan_limits" in data and isinstance(data["plan_limits"], dict)

    def test_public_config_chrome_extension_id_shape_when_set(self):
        """When REPLYPAL_CHROME_EXTENSION_ID is configured, homepage JS can build Web Store URLs."""
        r = get("/public-config")
        assert r.status_code == 200, r.text
        data = r.json()
        ext = (data.get("chrome_extension_id") or "").strip().lower()
        if ext:
            assert len(ext) == 32 and re.match(r"^[a-p]{32}$", ext), ext

    def test_free_usage_no_identity_matches_public_config_cap(self):
        r = post("/free-usage", json={})
        assert r.status_code == 200, r.text
        fu = r.json()
        assert fu.get("plan") == "free"
        cfg = get("/public-config").json()
        cap = int(cfg["free_monthly_rewrites"])
        assert int(fu["rewrites_limit"]) == cap
        assert int(fu["rewrites_left"]) == cap
        assert int(fu["rewrites_used"]) == 0

    def test_free_usage_anon_identity_shape(self):
        anon_id = unique_anon()
        r = post("/free-usage", json={"anon_id": anon_id})
        assert r.status_code == 200, r.text
        fu = r.json()
        assert fu.get("plan") == "anon"
        lim = int(fu["rewrites_limit"])
        used = int(fu["rewrites_used"])
        left = int(fu["rewrites_left"])
        assert lim >= 1
        assert used >= 0
        assert left == max(0, lim - used)


@pytest.mark.e2e
class TestRewriteThenFreeUsageEventuallyConsistent:
    """After a successful rewrite, /free-usage should reflect the same counter (Supabase)."""

    @pytest.mark.costly
    @pytest.mark.skipif(
        not os.getenv("RUN_COSTLY_TESTS"),
        reason="Set RUN_COSTLY_TESTS=1 to run AI rewrite tests",
    )
    def test_rewrite_increments_free_usage_for_anon(self):
        anon_id = unique_anon()
        r1 = post(
            "/rewrite",
            json={
                "text": "Please rewrite this short sentence politely.",
                "tone": "Formal",
                "anon_id": anon_id,
                "event_id": "e2e-" + uuid.uuid4().hex,
            },
        )
        assert r1.status_code == 200, r1.text

        observed = None
        for _ in range(12):
            ru = post("/free-usage", json={"anon_id": anon_id})
            assert ru.status_code == 200, ru.text
            observed = ru.json()
            if int(observed.get("rewrites_used") or 0) >= 1:
                break
            time.sleep(0.5)

        assert observed is not None
        assert int(observed.get("rewrites_used") or 0) >= 1, observed


@pytest.mark.e2e
class TestBillingAndLicenseEndpoints:
    def test_verify_license_invalid(self):
        r = post("/verify-license", json={"license_key": "INVALID-E2E-KEY-0000"})
        assert r.status_code == 200
        assert r.json().get("valid") is False

    def test_check_usage_invalid_key_404(self):
        r = post("/check-usage", json={"license_key": "INVALID-E2E-KEY-0000"})
        assert r.status_code == 404

    @pytest.mark.skipif(not TEST_LICENSE, reason="Set REPLYPALS_TEST_LICENSE_KEY for valid license check")
    def test_check_usage_valid_key_shape(self):
        r = post("/check-usage", json={"license_key": TEST_LICENSE})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "plan" in d
        assert "rewrites_this_month" in d
        assert "limit" in d or d.get("limit") is None


@pytest.mark.e2e
class TestAdminDashboardNumbers:
    """Admin stats must be numeric and non-negative (no random strings)."""

    def test_dashboard_stats_numeric(self):
        tok = admin_token()
        if not tok:
            pytest.skip("Admin login failed — set ADMIN_USERNAME / ADMIN_PASSWORD")
        r = get("/admin/dashboard-stats", headers={"Authorization": f"Bearer {tok}"})
        if r.status_code == 401:
            pytest.skip("Admin auth rejected")
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("total_users", "active_licenses", "rewrites_today", "mrr"):
            assert isinstance(data[key], (int, float)), f"{key} must be numeric, got {data[key]!r}"


@pytest.mark.e2e
class TestWebsitePagesNoContradictoryQuotaCopy:
    """Static HTML must not show a fixed fake number where the API drives limits."""

    @pytest.mark.parametrize(
        "page",
        ["/", "/login.html", "/signup.html", "/dashboard.html", "/about", "/about.html"],
    )
    def test_page_serves_200(self, page):
        r = get(page)
        assert r.status_code == 200, f"{page} -> {r.status_code}"

    def test_dashboard_repo_skeleton_no_fake_five_left(self):
        """Source HTML must not hardcode a fake remaining count (deploy from website_static_backup)."""
        assert STATIC_DASHBOARD.is_file(), f"missing {STATIC_DASHBOARD}"
        text = STATIC_DASHBOARD.read_text(encoding="utf-8")
        assert "· 5 rewrites left</span>" not in text

    def test_dashboard_uses_dynamic_usage_in_script(self):
        r = get("/dashboard.html")
        assert r.status_code == 200
        # Real usage from API
        assert "rewrites_limit" in r.text and "rewrites_used" in r.text


@pytest.mark.e2e
class TestCheckoutAndAccountGuards:
    def test_create_checkout_requires_email(self):
        assert post("/create-checkout", json={"plan": "pro", "tier": "tier1"}).status_code == 422

    def test_account_status_requires_auth(self):
        assert get("/account/status").status_code == 401

    def test_billing_portal_requires_auth(self):
        r = post("/account/billing-portal", json={})
        assert r.status_code in (401, 422)
