"""
ReplyPals pytest configuration
"""
import pytest

def pytest_configure(config):
    config.addinivalue_line("markers", "slow: marks tests as slow (AI calls)")
    config.addinivalue_line("markers", "integration: marks tests as integration tests")
