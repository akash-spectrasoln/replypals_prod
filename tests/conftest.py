"""
ReplyPals pytest configuration
"""
import sys
from pathlib import Path

# Allow `import billing_usage` etc. from repo `api/` when running `pytest tests/`
_ROOT = Path(__file__).resolve().parent.parent
_API = _ROOT / "api"
if _API.is_dir() and str(_API) not in sys.path:
    sys.path.insert(0, str(_API))

import pytest

def pytest_configure(config):
    config.addinivalue_line("markers", "slow: marks tests as slow (AI calls)")
    config.addinivalue_line("markers", "ai: marks tests that call the live LLM (use -m \"not ai\" to skip)")
    config.addinivalue_line("markers", "integration: marks tests as integration tests")
