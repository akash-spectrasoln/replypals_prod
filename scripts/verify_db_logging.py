import re, uuid, time, requests, psycopg2

B = "http://127.0.0.1:8150"

def db_conn():
    env = open("api/.env", encoding="utf-8").read()
    m = re.search(r'^DATABASE_URL\s*=\s*"?([^\n"#]+)', env, re.M)
    url = m.group(1).strip().replace("?pgbouncer=true", "")
    if "sslmode=" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return psycopg2.connect(url)

def db_rows(cur, email):
    cur.execute("""
        SELECT id, action, ai_provider, ai_model, status, email, user_id,
               latency_ms, cost_usd, created_at
        FROM llm_call_logs
        WHERE email = %s
        ORDER BY created_at ASC
    """, (email,))
    return cur.fetchall()

# ── one fresh user ──────────────────────────────────────────────
email = f"dblog+{uuid.uuid4().hex[:8]}@test.replypals.in"
anon  = uuid.uuid4().hex
calls = [
    ("rewrite",  "/rewrite",  {"text": "Please fix this sentence.", "tone": "Formal",
                                "email": email, "anon_id": anon,
                                "event_id": "ev-" + uuid.uuid4().hex}),
    ("generate", "/generate", {"prompt": "Write a meeting cancellation email", "tone": "Polite",
                                "email": email, "anon_id": anon,
                                "event_id": "ev-" + uuid.uuid4().hex}),
    ("summary",  "/rewrite",  {"text": "This is a long update about the project status.",
                                "tone": "Formal", "mode": "summary",
                                "email": email, "anon_id": anon,
                                "event_id": "ev-" + uuid.uuid4().hex}),
]

print(f"user_email  {email}")
print(f"anon_id     {anon}\n")

for label, path, payload in calls:
    r = requests.post(B + path, json=payload, timeout=45)
    q = r.json()
    print(f"call_{label:<10} status={r.status_code}  "
          f"rewrites_used={q.get('rewrites_used')}  "
          f"rewrites_left={q.get('rewrites_left')}")

# wait for async log writes
print("\nwaiting 2s for async DB writes...")
time.sleep(2)

conn = db_conn()
cur  = conn.cursor()
rows = db_rows(cur, email)
conn.close()

print(f"\nllm_call_logs rows for user: {len(rows)}")
print(f"{'id':>5}  {'action':<10}  {'provider':<8}  {'status':<8}  {'latency':>7}  created_at")
print("-" * 80)
for r in rows:
    rid, action, prov, model, status, em, uid, lat, cost, ts = r
    print(f"{rid:>5}  {(action or ''):.<10}  {(prov or ''):.<8}  "
          f"{(status or ''):.<8}  {(lat or 0):>6}ms  {str(ts)[:19]}")

print(f"\nexpected: {len(calls)} rows")
print(f"got:      {len(rows)} rows")
ok = len(rows) >= len(calls)
print(f"result:   {'PASS' if ok else 'FAIL — rows missing in DB'}")
