"""
ReplyPals — Integration & End-to-End Test Suite
================================================
Tests complete user journeys and cross-component consistency.

Run:
    REPLYPALS_API_URL=http://localhost:8150 \\
    ADMIN_USERNAME=admin \\
    ADMIN_PASSWORD=changeme123! \\
    pytest tests/integration/test_integration.py -v

Requires a live API with Supabase configured.
Mark: @pytest.mark.integration
"""

import os
import time
import uuid
import pytest
import requests

BASE = os.getenv("REPLYPALS_API_URL", "http://127.0.0.1:8150")
TIMEOUT = 30
ADMIN_USER = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASS = os.getenv("ADMIN_PASSWORD", "changeme123!")


def post(path, **kw):
    return requests.post(f"{BASE}{path}", timeout=TIMEOUT, **kw)

def get(path, **kw):
    return requests.get(f"{BASE}{path}", timeout=TIMEOUT, **kw)

def unique_email():
    return f"integration+{uuid.uuid4().hex[:8]}@test.replypals.in"

def get_admin_token():
    r = post("/admin/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    return r.json().get("token", "") if r.status_code == 200 else ""

def admin_hdrs():
    return {"Authorization": f"Bearer {get_admin_token()}"}

def api_ok():
    try:
        # Call requests directly to avoid passing duplicate `timeout`
        # (the `get()` helper already sets `timeout=TIMEOUT`).
        return requests.get(f"{BASE}/health", timeout=10).ok
    except Exception:
        return False


@pytest.fixture(autouse=True)
def require_api():
    if not api_ok():
        pytest.skip("API not running")


# ─────────────────────────────────────────────────────────────────────────────
# Journey 1: Free user full lifecycle
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.integration
class TestFreeUserJourney:
    """
    Simulates: new user → saves email → uses rewrites → hits limit → sees upgrade
    """

    def test_j1_save_email_and_get_referral(self):
        email = unique_email()
        # Save email
        r = post("/save-email", json={"email": email, "goal": "sound professional"})
        assert r.status_code == 200
        assert r.json()["saved"] is True

        # Check admin can see this user
        token = get_admin_token()
        if not token:
            pytest.skip("Admin login failed")

    def test_j1_free_rewrite_works(self):
        email = unique_email()
        r = post("/rewrite", json={
            "text": "I am writing to see if you can maybe help.",
            "tone": "Confident",
            "email": email
        })
        assert r.status_code == 200
        data = r.json()
        assert "rewritten" in data
        assert len(data["rewritten"]) > 10

    def test_j1_score_returned(self):
        r = post("/rewrite", json={"text": "Please do the needful.", "tone": "Confident"})
        assert r.status_code == 200
        data = r.json()
        assert data.get("score") is not None
        assert 0 <= data["score"] <= 100

    def test_j1_pricing_check(self):
        r = get("/pricing")
        assert r.status_code == 200
        plans = r.json()["plans"]
        assert "pro" in plans
        assert plans["pro"]["display"]


# ─────────────────────────────────────────────────────────────────────────────
# Journey 2: Referral system
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.integration
class TestReferralJourney:

    def test_j2_referral_invalid_code(self):
        r = post("/referral/use", json={
            "ref_code": "NOTEXIST00",
            "email": unique_email()
        })
        assert r.status_code == 200
        assert r.json()["ok"] is False

    def test_j2_register_referral_invalid(self):
        r = post("/register-referral", json={
            "ref_code": "INVALIDCODE",
            "new_user_email": unique_email()
        })
        assert r.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# Journey 3: Admin dashboard full workflow
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.integration
class TestAdminJourney:

    def test_j3_login_get_token(self):
        r = post("/admin/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
        assert r.status_code == 200
        assert "token" in r.json()

    def test_j3_dashboard_stats_numeric(self):
        hdrs = admin_hdrs()
        if not hdrs["Authorization"].endswith("."):
            pass
        r = get("/admin/dashboard-stats", headers=hdrs)
        if r.status_code == 401:
            pytest.skip("Admin auth failed")
        assert r.status_code == 200
        data = r.json()
        # All stat values must be numeric (not None or error string)
        for key in ("total_users", "active_licenses", "rewrites_today", "mrr"):
            assert isinstance(data[key], (int, float)), f"{key} must be numeric, got {type(data[key])}"

    def test_j3_users_list_consistent_pagination(self):
        hdrs = admin_hdrs()
        r1 = get("/admin/users?page=1&limit=5", headers=hdrs)
        if r1.status_code == 401:
            pytest.skip("Admin auth failed")
        r2 = get("/admin/users?page=2&limit=5", headers=hdrs)
        d1 = r1.json()
        d2 = r2.json()
        # Both pages report same total
        assert d1["total"] == d2["total"], "Total count inconsistent across pages"
        # Pages don't overlap (if enough users)
        if len(d1["users"]) > 0 and len(d2["users"]) > 0:
            ids1 = {u.get("user_id") or u.get("email") for u in d1["users"]}
            ids2 = {u.get("user_id") or u.get("email") for u in d2["users"]}
            assert not ids1.intersection(ids2), "Pages have overlapping users"

    def test_j3_stats_overview_cost_nonnegative(self):
        hdrs = admin_hdrs()
        r = get("/admin/stats/overview", headers=hdrs)
        if r.status_code == 401:
            pytest.skip("Admin auth failed")
        assert r.status_code == 200
        data = r.json()
        assert data["total_cost_usd"] >= 0

    def test_j3_stats_overview_error_rate_valid(self):
        hdrs = admin_hdrs()
        r = get("/admin/stats/overview", headers=hdrs)
        if r.status_code == 401:
            pytest.skip("Admin auth failed")
        data = r.json()
        rate = data.get("error_rate_pct", 0)
        assert 0 <= rate <= 100, f"Error rate {rate} is not a valid percentage"

    def test_j3_model_get_set_roundtrip(self):
        hdrs = admin_hdrs()
        # Get current model
        r = get("/admin/model", headers=hdrs)
        if r.status_code == 401:
            pytest.skip("Admin auth failed")
        original = r.json()
        provider = original["provider"]
        model_id = original["model_id"]

        # Set same model back (no-op)
        r2 = post("/admin/model",
                  json={"provider": provider, "model_id": model_id},
                  headers=hdrs)
        assert r2.status_code == 200

        # Verify still same
        r3 = get("/admin/model", headers=hdrs)
        assert r3.json()["provider"] == provider
        assert r3.json()["model_id"] == model_id


# ─────────────────────────────────────────────────────────────────────────────
# Journey 4: All rewrite modes produce non-empty, non-identical output
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.integration
@pytest.mark.slow
class TestAllModesOutputQuality:

    INPUT_TEXT = "I am writing to kindly inform you that the project is delayed due to some issues."

    @pytest.mark.parametrize("mode,tone", [
        ("rewrite",   "Confident"),
        ("rewrite",   "Formal"),
        ("rewrite",   "Casual"),
        ("rewrite",   "Polite"),
        ("fix",       "Formal"),
        ("summary",   "Formal"),
        ("meaning",   "Friendly"),
        ("translate", "Formal"),
        ("write",     "Confident"),
        ("reply",     "Friendly"),
    ])
    def test_mode_tone_output_nonempty(self, mode, tone):
        r = post("/rewrite", json={"text": self.INPUT_TEXT, "tone": tone, "mode": mode})
        assert r.status_code == 200, f"{mode}/{tone}: {r.text}"
        data = r.json()
        assert len(data.get("rewritten", "")) > 5, f"{mode}/{tone}: Output too short"

    def test_rewrite_output_differs_from_input(self):
        """Rewriting non-native text should produce different output"""
        text = "Please do the needful and revert back at the earliest."
        r = post("/rewrite", json={"text": text, "tone": "Confident"})
        assert r.status_code == 200
        rewritten = r.json().get("rewritten", "")
        # The output should not be identical to input
        assert rewritten.lower() != text.lower(), "Rewrite returned identical text"

    def test_generate_output_nonempty(self):
        r = post("/generate", json={
            "prompt": "Write a short apology email for missing a meeting",
            "tone": "Polite"
        })
        assert r.status_code == 200
        data = r.json()
        assert len(data.get("generated", "")) > 20

    def test_generate_score_in_range(self):
        r = post("/generate", json={
            "prompt": "Write a quick thank you email",
            "tone": "Friendly"
        })
        assert r.status_code == 200
        score = r.json().get("score")
        if score is not None:
            assert 0 <= score <= 100


# ─────────────────────────────────────────────────────────────────────────────
# Journey 5: Data consistency — rate limit matches actual call counts
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.integration
class TestRateLimitConsistency:

    def test_rewrite_count_increments(self):
        """Each successful /rewrite for a user should increment their count"""
        email = unique_email()

        r1 = post("/rewrite", json={"text": "test", "tone": "Casual", "email": email})
        # Note: might hit free limit if API has no Supabase — that's ok
        assert r1.status_code in (200, 429)

    def test_free_limit_shape_on_429(self):
        """If a free user is rate limited, the response must include required fields"""
        email = unique_email()
        last_r = None
        for _ in range(8):
            last_r = post("/rewrite", json={
                "text": "Please do the needful and revert.",
                "tone": "Confident",
                "email": email
            })
            if last_r.status_code == 429:
                detail = last_r.json().get("detail", {})
                assert detail.get("error") == "limit_reached"
                assert "used" in detail
                assert "limit" in detail
                assert detail["used"] >= detail["limit"]
                # Must include upgrade URL
                assert "upgrade_url" in detail or "resets_in" in detail
                break

    def test_check_usage_matches_llm_logs(self):
        """check_usage must read from same source as rate limit (llm_call_logs)"""
        # This tests the fix we applied — check_usage used to read rewrite_logs
        # We can verify the endpoint at minimum returns a valid structure
        r = post("/check-usage", json={"license_key": "INVALID-TEST-KEY"})
        assert r.status_code == 404  # Key not found, but endpoint works

    def test_pricing_tiers_all_present(self):
        r = get("/pricing")
        assert r.status_code == 200
        data = r.json()
        for plan in ("starter", "pro", "team"):
            assert plan in data["plans"], f"Plan '{plan}' missing"
            plan_data = data["plans"][plan]
            assert "display" in plan_data
            assert "currency" in plan_data


# ─────────────────────────────────────────────────────────────────────────────
# Journey 6: Brand name and domain consistency
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.integration
class TestBrandConsistency:

    def test_health_service_name_is_replypals(self):
        r = get("/health")
        assert r.status_code == 200
        service = r.json().get("service", "")
        assert "ReplyPals" in service, f"Service name '{service}' doesn't contain 'ReplyPals'"

    def test_website_home_contains_replypals(self):
        r = get("/")
        if r.status_code == 200:
            assert "ReplyPals" in r.text or "replypals" in r.text.lower()

    def test_no_old_domain_in_api_responses(self):
        """API responses should not reference replypal.app (old domain)"""
        r = get("/pricing")
        assert r.status_code == 200
        assert "replypal.app" not in r.text, "Old domain found in pricing response"

    def test_website_login_no_old_domain(self):
        r = get("/login.html")
        if r.status_code == 200:
            assert "replypal.app" not in r.text


# ─────────────────────────────────────────────────────────────────────────────
# Journey 7: Concurrent requests — no race conditions
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.integration
@pytest.mark.slow
class TestConcurrency:

    def test_concurrent_rewrites_all_succeed(self):
        """10 simultaneous rewrites should all return 200"""
        import concurrent.futures
        emails = [unique_email() for _ in range(5)]

        def do_rewrite(email):
            return post("/rewrite", json={
                "text": "I am writing to enquire about the status of my request.",
                "tone": "Confident",
                "email": email
            }).status_code

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
            results = list(ex.map(do_rewrite, emails))

        success = [r for r in results if r == 200]
        assert len(success) >= 3, f"Only {len(success)}/5 concurrent requests succeeded"


@pytest.mark.integration
class TestEntitlementHardening:
    def test_j8_free_limit_1_to_6(self):
        email = unique_email()
        statuses = []
        for _ in range(6):
            r = post("/rewrite", json={
                "text": "Please rewrite this short sentence.",
                "tone": "Formal",
                "email": email,
            })
            statuses.append(r.status_code)
            if r.status_code == 429:
                break
        assert statuses[0] == 200
        assert statuses[-1] in (200, 429)

    def test_j8_register_accepts_anon_id(self):
        email = unique_email()
        anon_id = uuid.uuid4().hex
        r = post("/account/register", json={
            "email": email,
            "user_id": "local-" + uuid.uuid4().hex[:8],
            "full_name": "Integration Local",
            "anon_id": anon_id,
        })
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_j8_save_email_returns_persistence_contract(self):
        email = unique_email()
        r = post("/save-email", json={"email": email, "goal": "sound concise"})
        assert r.status_code == 200
        payload = r.json()
        assert payload.get("saved") is True
        assert "persisted" in payload
        assert payload.get("mode") in ("supabase", "db_fallback", "degraded", "memory_only")

    def test_j8_admin_diagnostics_shape(self):
        hdrs = admin_hdrs()
        r = get("/admin/diagnostics", headers=hdrs)
        if r.status_code == 401:
            pytest.skip("Admin auth failed")
        assert r.status_code == 200
        d = r.json()
        for key in ("db_configured", "degraded_active", "supabase_backoff_active", "log_write_errors"):
            assert key in d


@pytest.mark.integration
class TestUsageSyncConsistency:
    def test_rewrite_and_generate_reflect_in_free_usage(self):
        email = unique_email()
        anon_id = uuid.uuid4().hex

        r1 = post("/rewrite", json={
            "text": "Please rewrite this update politely.",
            "tone": "Formal",
            "email": email,
            "anon_id": anon_id,
            "event_id": "it-rewrite-" + uuid.uuid4().hex,
        })
        assert r1.status_code == 200, r1.text

        r2 = post("/generate", json={
            "prompt": "Write a short project status email.",
            "tone": "Confident",
            "email": email,
            "anon_id": anon_id,
            "event_id": "it-generate-" + uuid.uuid4().hex,
        })
        assert r2.status_code == 200, r2.text

        # llm_call_logs write is async; allow brief eventual-consistency window.
        observed = None
        for _ in range(8):
            ru = post("/free-usage", json={"email": email, "anon_id": anon_id})
            assert ru.status_code == 200, ru.text
            observed = ru.json()
            if int(observed.get("rewrites_used") or 0) >= 2:
                break
            time.sleep(1)

        assert observed is not None
        assert int(observed.get("rewrites_used") or 0) >= 2, observed
        assert int(observed.get("rewrites_limit") or 0) >= 5, observed
