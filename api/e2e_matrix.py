import json
import os
import uuid

import requests


BASE_URL = os.getenv("REPLYPAL_API_URL", "http://localhost:8150")


def post(path, payload, headers=None, auth=None, timeout=90):
    response = requests.post(
        f"{BASE_URL}{path}",
        json=payload,
        headers=headers or {},
        auth=auth,
        timeout=timeout,
    )
    try:
        body = response.json()
    except Exception:
        body = response.text
    return response.status_code, body


def get(path, headers=None, auth=None, timeout=60):
    response = requests.get(
        f"{BASE_URL}{path}",
        headers=headers or {},
        auth=auth,
        timeout=timeout,
    )
    try:
        body = response.json()
    except Exception:
        body = response.text
    return response.status_code, body


def run():
    results = {}

    def rec(name, ok, detail):
        results[name] = {"ok": bool(ok), "detail": detail}

    def admin_login_token():
        admin_user = os.getenv("ADMIN_USERNAME", "admin")
        admin_pass = os.getenv("ADMIN_PASSWORD", "changeme123!")
        login_status, login_body = post("/admin/login", {"username": admin_user, "password": admin_pass})
        token = login_body.get("token") if isinstance(login_body, dict) else None
        return login_status, login_body, token

    # 1) Health / DB
    status, body = get("/health")
    rec(
        "health_db_ok",
        status == 200 and isinstance(body, dict) and body.get("database") == "ok",
        {"status": status, "body": body},
    )

    # 2) Anonymous usage exhaustion
    anon_id = f"e2e-{uuid.uuid4().hex[:10]}"
    status, body = post("/free-usage", {"anon_id": anon_id})
    rec(
        "anon_usage_initial",
        status == 200 and body.get("rewrites_used") == 0 and body.get("rewrites_limit") == 3,
        {"status": status, "body": body},
    )

    all_three_ok = True
    for idx in range(1, 4):
        status, body = post(
            "/rewrite",
            {
                "text": f"E2E anon test {idx}",
                "tone": "Polite",
                "language": "en",
                "anon_id": anon_id,
            },
        )
        all_three_ok = all_three_ok and (status == 200)
    rec("anon_rewrite_first_three", all_three_ok, {"anon_id": anon_id})

    status, body = post(
        "/rewrite",
        {
            "text": "E2E anon over limit",
            "tone": "Polite",
            "language": "en",
            "anon_id": anon_id,
        },
    )
    rec("anon_rewrite_fourth_blocked", status == 429, {"status": status, "body": body})

    status, body = post("/free-usage", {"anon_id": anon_id})
    rec(
        "anon_usage_after_limit",
        status == 200 and body.get("rewrites_used") == 3 and body.get("rewrites_left") == 0,
        {"status": status, "body": body},
    )

    # 3) Identity edge case
    status, body = post(
        "/rewrite",
        {"text": "Missing identity test", "tone": "Formal", "language": "en"},
    )
    rec("rewrite_missing_identity_rejected", status == 400, {"status": status, "body": body})

    # 4) Invalid license edge cases
    invalid_key = f"RP-INVALID-{uuid.uuid4().hex[:6].upper()}"
    status, body = post("/verify-license", {"license_key": invalid_key})
    rec("verify_license_invalid", status == 200 and body.get("valid") is False, {"status": status, "body": body})

    status, body = post("/check-usage", {"license_key": invalid_key})
    rec("check_usage_invalid_404", status == 404, {"status": status, "body": body})

    # 5) Save email and referral invalid edge
    free_email = f"e2e_ref_{uuid.uuid4().hex[:8]}@example.com"
    status, body = post(
        "/save-email",
        {"email": free_email, "goal": "improve emails", "sites": ["gmail.com"]},
    )
    rec(
        "save_email_new_user",
        status == 200 and body.get("saved") is True and body.get("persisted") is True,
        {"status": status, "body": body, "email": free_email},
    )

    status, body = post(
        "/register-referral",
        {
            "ref_code": "BADCODE00",
            "new_user_email": f"e2e_new_{uuid.uuid4().hex[:8]}@example.com",
        },
    )
    rec("register_referral_invalid_code", status == 404, {"status": status, "body": body})

    # 6) Team flow + seat edge + usage increment
    admin_email = f"e2e_team_admin_{uuid.uuid4().hex[:8]}@example.com"
    status, body = post(
        "/create-team",
        {"admin_email": admin_email, "team_name": "E2E Team", "seat_count": 1},
    )
    team_key = body.get("license_key") if isinstance(body, dict) else None
    rec("create_team", status == 200 and bool(team_key), {"status": status, "body": body})

    if team_key:
        status, body = post("/verify-license", {"license_key": team_key})
        rec(
            "verify_team_license",
            status == 200 and body.get("valid") is True and body.get("plan") == "team",
            {"status": status, "body": body},
        )

        status, body = post(
            "/add-team-member",
            {"admin_key": team_key, "member_email": f"e2e_member1_{uuid.uuid4().hex[:8]}@example.com"},
        )
        rec(
            "team_add_member_within_seat_limit",
            status == 200 and body.get("success") is True,
            {"status": status, "body": body},
        )

        status, body = post(
            "/add-team-member",
            {"admin_key": team_key, "member_email": f"e2e_member2_{uuid.uuid4().hex[:8]}@example.com"},
        )
        rec("team_add_member_over_limit_blocked", status == 400, {"status": status, "body": body})

        status, body = get("/team-stats", headers={"X-License-Key": team_key})
        members = body.get("members") if isinstance(body, dict) else []
        rec(
            "team_stats_access",
            status == 200 and isinstance(members, list) and len(members) == 1,
            {"status": status, "body": body},
        )

        status_before, body_before = post("/check-usage", {"license_key": team_key})
        pre_count = body_before.get("rewrites_this_month") if isinstance(body_before, dict) else None

        status_generate, body_generate = post(
            "/generate",
            {
                "prompt": "Write a short professional hello.",
                "tone": "Formal",
                "license_key": team_key,
            },
        )

        status_after, body_after = post("/check-usage", {"license_key": team_key})
        post_count = body_after.get("rewrites_this_month") if isinstance(body_after, dict) else None

        rec(
            "team_usage_increment_after_generate",
            status_generate == 200
            and isinstance(pre_count, int)
            and isinstance(post_count, int)
            and post_count >= pre_count + 1,
            {
                "generate_status": status_generate,
                "pre": pre_count,
                "post": post_count,
                "generate_body": body_generate,
                "check_before_status": status_before,
                "check_before_body": body_before,
                "check_after_status": status_after,
                "check_after_body": body_after,
            },
        )

    # 6a) Team aggregate consistency on separate 2-seat team
    admin_email_agg = f"e2e_team_agg_admin_{uuid.uuid4().hex[:8]}@example.com"
    status, body = post(
        "/create-team",
        {"admin_email": admin_email_agg, "team_name": "E2E Team Aggregate", "seat_count": 2},
    )
    team_key_agg = body.get("license_key") if isinstance(body, dict) else None
    member_key = None
    if team_key_agg:
        status_member, body_member = post(
            "/add-team-member",
            {"admin_key": team_key_agg, "member_email": f"e2e_memberx_{uuid.uuid4().hex[:8]}@example.com"},
        )
        if status_member == 200 and isinstance(body_member, dict):
            member_key = body_member.get("member_key")
    if team_key_agg and member_key:
        status_before2, body_before2 = post("/check-usage", {"license_key": team_key_agg})
        pre2 = body_before2.get("rewrites_this_month") if isinstance(body_before2, dict) else None
        post(
            "/generate",
            {"prompt": "Write one short update.", "tone": "Formal", "license_key": member_key},
        )
        status_after2, body_after2 = post("/check-usage", {"license_key": team_key_agg})
        post2 = body_after2.get("rewrites_this_month") if isinstance(body_after2, dict) else None
        rec(
            "team_admin_usage_includes_member_keys",
            isinstance(pre2, int) and isinstance(post2, int) and post2 >= pre2 + 1,
            {
                "member_key": member_key,
                "check_before_status": status_before2,
                "check_before_body": body_before2,
                "check_after_status": status_after2,
                "check_after_body": body_after2,
            },
        )
    else:
        rec("team_admin_usage_includes_member_keys", False, {"error": "team_or_member_key_not_created"})

    # 6b) Free/email identity usage consistency with /free-usage
    free_track_email = f"e2e_free_track_{uuid.uuid4().hex[:8]}@example.com"
    post("/save-email", {"email": free_track_email, "goal": "improve", "sites": ["gmail.com"]})
    s_fu_before, b_fu_before = post("/free-usage", {"email": free_track_email})
    pre_free = b_fu_before.get("rewrites_used") if isinstance(b_fu_before, dict) else None
    s_rw, b_rw = post(
        "/rewrite",
        {"text": "Need concise follow-up.", "tone": "Formal", "language": "en", "email": free_track_email},
    )
    s_fu_after, b_fu_after = post("/free-usage", {"email": free_track_email})
    post_free = b_fu_after.get("rewrites_used") if isinstance(b_fu_after, dict) else None
    rec(
        "free_usage_tracks_email_rewrites",
        s_rw == 200 and isinstance(pre_free, int) and isinstance(post_free, int) and post_free >= pre_free + 1,
        {
            "rewrite_status": s_rw,
            "rewrite_body": b_rw,
            "free_before_status": s_fu_before,
            "free_before_body": b_fu_before,
            "free_after_status": s_fu_after,
            "free_after_body": b_fu_after,
        },
    )

    # 7) Admin auth behavior + paid plan consistency
    status, body = get("/admin/stats/overview")
    rec("admin_overview_requires_auth", status in (401, 403), {"status": status, "body": body})

    login_status, login_body, token = admin_login_token()
    status, body = get(
        "/admin/stats/overview",
        headers={"Authorization": f"Bearer {token}"} if token else {},
    )
    rec(
        "admin_overview_with_auth",
        login_status == 200 and bool(token) and status == 200 and isinstance(body, dict),
        {
            "login_status": login_status,
            "login_body": login_body,
            "status": status,
            "body": body,
        },
    )

    # 8) Paid starter license: check-usage limit/count consistent with rewrite path
    if token:
        paid_email = f"e2e_starter_{uuid.uuid4().hex[:8]}@example.com"
        cs, cb = post(
            "/admin/licenses",
            {"email": paid_email, "plan": "starter", "note": "e2e", "send_email": False},
            headers={"Authorization": f"Bearer {token}"},
        )
        starter_key = cb.get("license_key") if isinstance(cb, dict) else None
        rec("admin_create_starter_license", cs == 200 and bool(starter_key), {"status": cs, "body": cb})
        if starter_key:
            su0, bu0 = post("/check-usage", {"license_key": starter_key})
            pre_paid = bu0.get("rewrites_this_month") if isinstance(bu0, dict) else None
            limit_paid = bu0.get("limit") if isinstance(bu0, dict) else None
            sr, br = post(
                "/rewrite",
                {"text": "Starter test rewrite.", "tone": "Polite", "language": "en", "license_key": starter_key},
            )
            su1, bu1 = post("/check-usage", {"license_key": starter_key})
            post_paid = bu1.get("rewrites_this_month") if isinstance(bu1, dict) else None
            rec(
                "starter_limit_and_usage_consistent",
                sr == 200
                and isinstance(pre_paid, int)
                and isinstance(post_paid, int)
                and post_paid >= pre_paid + 1
                and (isinstance(limit_paid, int) or limit_paid is None),
                {
                    "rewrite_status": sr,
                    "rewrite_body": br,
                    "check_before_status": su0,
                    "check_before_body": bu0,
                    "check_after_status": su1,
                    "check_after_body": bu1,
                },
            )
        else:
            rec("starter_limit_and_usage_consistent", False, {"error": "starter_key_not_created"})
    else:
        rec("admin_create_starter_license", False, {"error": "admin_token_missing"})
        rec("starter_limit_and_usage_consistent", False, {"error": "admin_token_missing"})

    passed = sum(1 for item in results.values() if item["ok"])
    total = len(results)
    print(json.dumps({"passed": passed, "total": total, "results": results}, indent=2))


if __name__ == "__main__":
    run()
