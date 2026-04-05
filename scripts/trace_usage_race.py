import requests, uuid, time

B = "http://127.0.0.1:8150"
email = f"trace+{uuid.uuid4().hex[:8]}@test.replypals.in"
anon  = uuid.uuid4().hex
ev    = "ev-" + uuid.uuid4().hex

r = requests.post(B + "/generate", json={
    "prompt": "Write a short thank you",
    "tone": "Friendly",
    "email": email,
    "anon_id": anon,
    "event_id": ev
}, timeout=45)

j = r.json()
print("api_status", r.status_code)
print("api_has_quota", "rewrites_used" in j)
print("api_rewrites_used", j.get("rewrites_used"))
print("api_rewrites_limit", j.get("rewrites_limit"))
print("api_rewrites_left", j.get("rewrites_left"))

for i in range(8):
    fu = requests.post(B + "/free-usage", json={"email": email, "anon_id": anon}, timeout=10).json()
    used  = fu.get("rewrites_used", 0)
    limit = fu.get("rewrites_limit", 5)
    left  = fu.get("rewrites_left", 5)
    print(f"free_usage_poll_{i} used={used} limit={limit} left={left}")
    if used >= 1:
        break
    time.sleep(0.5)
