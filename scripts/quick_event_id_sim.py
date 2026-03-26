import os
import re
import uuid
import requests
import psycopg2

API_BASE = "http://127.0.0.1:8150"
email = f"sim+{uuid.uuid4().hex[:8]}@test.replypals.in"
event_id = "sim-" + uuid.uuid4().hex

payload = {
    "text": "Please rewrite this line politely.",
    "tone": "Polite",
    "email": email,
    "event_id": event_id,
}

r1 = requests.post(f"{API_BASE}/rewrite", json=payload, timeout=30)
r2 = requests.post(f"{API_BASE}/rewrite", json=payload, timeout=30)

env_text = open("api/.env", "r", encoding="utf-8").read()
m = re.search(r'^DATABASE_URL\s*=\s*"?([^\n"#]+)', env_text, re.M)
if not m:
    raise RuntimeError("DATABASE_URL not found in api/.env")
db_url = m.group(1).strip().replace("?pgbouncer=true", "")
if "sslmode=" not in db_url:
    db_url += ("&" if "?" in db_url else "?") + "sslmode=require"

conn = psycopg2.connect(db_url)
cur = conn.cursor()
cur.execute("select count(*) from llm_call_logs where event_id = %s", (event_id,))
row_count = cur.fetchone()[0]
cur.execute(
    "select id, status, created_at from llm_call_logs where event_id = %s order by id asc",
    (event_id,),
)
rows = cur.fetchall()
conn.close()

print("first_status", r1.status_code)
print("second_status", r2.status_code)
print("event_id", event_id)
print("db_rows_for_event_id", row_count)
for row in rows:
    print("log_row", row)
