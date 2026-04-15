import base64
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt


def test_get_user_from_token_accepts_base64_env_secret(monkeypatch):
    repo_root = Path(__file__).resolve().parents[2]
    api_dir = repo_root / "api"
    if str(api_dir) not in sys.path:
        sys.path.insert(0, str(api_dir))

    import main

    raw_secret = "replypals-test-secret-123"
    # Simulate environments where raw env value is base64-encoded, but decoded
    # secret is available in module-level config.
    monkeypatch.setenv("SUPABASE_JWT_SECRET", base64.b64encode(raw_secret.encode()).decode())
    monkeypatch.setattr(main, "SUPABASE_JWT_SECRET", raw_secret, raising=False)

    token = jwt.encode(
        {
            "sub": "11111111-1111-1111-1111-111111111111",
            "email": "token-test@replypals.in",
            "aud": "authenticated",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
        },
        raw_secret,
        algorithm="HS256",
    )

    user = main.get_user_from_token(f"Bearer {token}")
    assert user is not None
    assert user.get("email") == "token-test@replypals.in"
