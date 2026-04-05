import requests
import json
import time

import os
API_URL = os.getenv("REPLYPAL_API_URL", "http://localhost:8150")

print("========================================")
print("  REPLYPAL API TEST SUITE")
print("========================================")

def test_endpoint(name, endpoint, payload):
    print(f"\\n[TEST] {name}")
    print(f"  POST {endpoint}")
    print(f"  Payload: {json.dumps(payload)}")
    try:
        start_time = time.time()
        resp = requests.post(f"{API_URL}{endpoint}", json=payload, timeout=30)
        elapsed = time.time() - start_time
        
        print(f"  Status: {resp.status_code} ({elapsed:.2f}s)")
        
        if resp.status_code == 200:
            data = resp.json()
            print("  [OK] SUCCESS")
            print(f"  Response: {json.dumps(data, indent=2)}")
            return True
        else:
            print("  [FAIL] HTTP ERROR")
            print(f"  Response: {resp.text}")
            return False
            
    except Exception as e:
        print(f"  [FAIL] REQUEST FAILED: {str(e)}")
        return False

# 1. Test standard rewrite
test_endpoint(
    "Rewrite (Confident Tone)", 
    "/rewrite", 
    {
        "text": "I am writing to see if we can maybe meet tomorrow if you are not busy.",
        "tone": "Confident",
        "language": "en"
    }
)

# 2. Test rewrite with custom instruction
test_endpoint(
    "Rewrite (With Instruction)", 
    "/rewrite", 
    {
        "text": "The project is delayed.",
        "tone": "Polite",
        "language": "en",
        "instruction": "explain that the delay is due to server outage"
    }
)

# 3. Test Generate from scratch
test_endpoint(
    "Generate (Leave Request)", 
    "/generate", 
    {
        "prompt": "Write a leave request email for 26th and 7th of this month to my manager",
        "tone": "Formal"
    }
)

# 4. Test Reply generation mapping (assuming it goes to /rewrite with mode=reply, or /generate)
# In popup.js, handleRewrite sends type: 'generate' for mode: 'reply', so it maps to /generate on extension side? 
# Wait, let's check background.js how it maps it.
# Wait, I'll just test /generate directly with a reply instruction.
test_endpoint(
    "Generate Reply", 
    "/generate", 
    {
        "prompt": "Write a reply to this email: 'Can we schedule a call for Friday at 2PM?' Saying yes.",
        "tone": "Friendly"
    }
)

print("\\n[OK] All API tests completed.")
