import os
import re
import uuid
from datetime import datetime

import psycopg2
import requests


ROOT = os.path.dirname(os.path.dirname(__file__))
ENV_PATH = os.path.join(ROOT, "api", ".env")
API_BASE = "http://127.0.0.1:8150"


def read_database_url() -> str:
    with open(ENV_PATH, "r", encoding="utf-8") as f:
        env = f.read()
    m = re.search(r'^DATABASE_URL\s*=\s*"?([^\n"#]+)', env, re.M)
    if not m:
        raise RuntimeError("DATABASE_URL not found in api/.env")
    url = m.group(1).strip().replace("?pgbouncer=true", "")
    if "sslmode=" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return url


def reset_tables(conn):
    # Keep settings/admin audit; remove user/domain activity data.
    tables = [
        "team_members",
        "teams",
        "licenses",
        "user_profiles",
        "free_users",
        "llm_call_logs",
        "rewrite_logs",
        "api_logs",
        "email_log",
    ]
    cur = conn.cursor()
    for t in tables:
        cur.execute(f"DELETE FROM {t};")
    conn.commit()
    print("reset_done_tables", ",".join(tables))


def count_rows(conn):
    cur = conn.cursor()
    for t in ["free_users", "user_profiles", "licenses", "llm_call_logs", "api_logs", "email_log"]:
        cur.execute(f"SELECT COUNT(*) FROM {t}")
        print(f"count_{t}", cur.fetchone()[0])


def api_post(path: str, payload: dict):
    r = requests.post(f"{API_BASE}{path}", json=payload, timeout=40)
    return r.status_code, r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text


def api_get(path: str, headers=None):
    r = requests.get(f"{API_BASE}{path}", headers=headers or {}, timeout=30)
    return r.status_code, r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text


def run_single_user_flow():
    email = f"singleuser+{uuid.uuid4().hex[:8]}@test.replypals.in"
    anon_id = uuid.uuid4().hex

    s1, b1 = api_post("/save-email", {"email": email, "goal": "professional writing"})
    print("save_email", s1, b1 if isinstance(b1, dict) else str(b1)[:120])

    for i in range(3):
        s, b = api_post("/rewrite", {
            "text": f"please rewrite message number {i+1}",
            "tone": "Formal",
            "email": email,
            "anon_id": anon_id,
            "event_id": f"flow-{uuid.uuid4().hex}",
            "source": "popup",
        })
        print(f"rewrite_{i+1}", s, b.get("rewrites_used") if isinstance(b, dict) else "n/a")

    s2, b2 = api_post("/generate", {
        "prompt": "Write a short status update email to manager",
        "tone": "Confident",
        "email": email,
        "anon_id": anon_id,
        "event_id": f"flow-{uuid.uuid4().hex}",
        "source": "popup",
    })
    print("generate_1", s2, "ok" if s2 == 200 else b2)

    s3, b3 = api_post("/free-usage", {"email": email, "anon_id": anon_id})
    print("free_usage", s3, b3 if isinstance(b3, dict) else str(b3)[:120])

    # Register/link account to verify user visibility path
    local_user_id = "local-" + uuid.uuid4().hex[:8]
    s4, b4 = api_post("/account/register", {
        "user_id": local_user_id,
        "email": email,
        "full_name": "Single User",
        "anon_id": anon_id,
    })
    print("account_register", s4, b4 if isinstance(b4, dict) else str(b4)[:120])
    return email


def verify_admin(email: str):
    s, b = api_post("/admin/login", {"username": "admin", "password": "changeme123!"})
    if s != 200 or not isinstance(b, dict) or "token" not in b:
        raise RuntimeError(f"Admin login failed: {s} {b}")
    token = b["token"]
    headers = {"Authorization": f"Bearer {token}"}

    su, bu = api_get("/admin/users?page=1&limit=200", headers=headers)
    users = bu.get("users", []) if isinstance(bu, dict) else []
    found = [u for u in users if (u.get("email") or "").lower() == email.lower()]
    print("admin_users_status", su, "found_user", len(found) > 0)

    so, bo = api_get("/admin/stats/overview", headers=headers)
    print("admin_overview_status", so, "month_total_calls", bo.get("month_total_calls") if isinstance(bo, dict) else "n/a")

    # Find user id from DB-backed merged payload and fetch user-specific logs
    if found and found[0].get("user_id"):
        uid = found[0]["user_id"]
        sd, bd = api_get(f"/admin/user-details/{uid}", headers=headers)
        api_logs = bd.get("api_logs", []) if isinstance(bd, dict) else []
        print("admin_user_details_status", sd, "api_logs_count", len(api_logs))
        if api_logs:
            sample = api_logs[0]
            print("sample_log_fields", {
                "action": sample.get("action"),
                "provider": sample.get("ai_provider"),
                "model": sample.get("ai_model"),
                "status": sample.get("status"),
                "created_at": sample.get("created_at"),
            })
    else:
        print("admin_user_details_status", "skipped_no_user_id")


def main():
    url = read_database_url()
    conn = psycopg2.connect(url)
    try:
        reset_tables(conn)
        count_rows(conn)
    finally:
        conn.close()

    email = run_single_user_flow()

    conn2 = psycopg2.connect(url)
    try:
        count_rows(conn2)
    finally:
        conn2.close()

    verify_admin(email)
    print("completed_at", datetime.utcnow().isoformat() + "Z")


if __name__ == "__main__":
    main()
