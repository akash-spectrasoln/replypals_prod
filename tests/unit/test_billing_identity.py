"""
Unit tests for anonymous identity parsing (no API server, no Supabase).

Run: pytest tests/unit/test_billing_identity.py -v
"""

from __future__ import annotations

import uuid

import pytest

from billing_usage import (
    _resolved_uid_from_auth_sub,
    _synthetic_email_from_anon_id,
    extract_request_identity,
)


class MockHeaders:
    def __init__(self, mapping: dict[str, str] | None = None):
        self._m = {k.lower(): v for k, v in (mapping or {}).items()}

    def get(self, key: str, default: str = "") -> str:
        return self._m.get(key.lower(), default)


class MockRequest:
    def __init__(self, headers: dict[str, str] | None = None):
        self.headers = MockHeaders(headers)


class TestSyntheticEmailFromAnon:
    def test_none(self):
        assert _synthetic_email_from_anon_id(None) is None

    def test_empty_string(self):
        assert _synthetic_email_from_anon_id("") is None
        assert _synthetic_email_from_anon_id("   ") is None

    def test_stable_prefix(self):
        s = _synthetic_email_from_anon_id("abcd-efgh-ijkl-mnop")
        assert s == "anon_abcd-efgh-ijkl-m@replypal.internal"

    def test_truncates_long_id(self):
        long_id = "x" * 64
        s = _synthetic_email_from_anon_id(long_id)
        assert s.startswith("anon_")
        assert "@replypal.internal" in s


class TestResolvedUidFromAuthSub:
    def test_none(self):
        assert _resolved_uid_from_auth_sub(None) is None

    def test_valid_uuid_string(self):
        u = "550e8400-e29b-41d4-a716-446655440000"
        assert _resolved_uid_from_auth_sub(u) == u

    def test_non_uuid_sub_gets_deterministic_uuid(self):
        a = _resolved_uid_from_auth_sub("auth0|12345")
        b = _resolved_uid_from_auth_sub("auth0|12345")
        assert a == b
        uuid.UUID(a)  # valid format


class TestExtractRequestIdentity:
    def test_jwt_email_only(self):
        req = MockRequest()
        em, anon, key = extract_request_identity({"email": "a@b.com"}, req, "user@jwt.com")
        assert em == "user@jwt.com"
        assert anon == ""
        assert key == ""

    def test_body_email_when_no_jwt(self):
        req = MockRequest()
        em, anon, key = extract_request_identity({"email": "Body@X.com"}, req, None)
        assert em == "body@x.com"

    def test_anon_id_snake(self):
        req = MockRequest()
        em, anon, key = extract_request_identity({"anon_id": "device-abc"}, req, None)
        assert anon == "device-abc"
        assert "anon_" in em and "replypal.internal" in em

    def test_anonId_camelCase(self):
        req = MockRequest()
        em, anon, key = extract_request_identity({"anonId": "camel-case-id"}, req, None)
        assert anon == "camel-case-id"
        assert em

    def test_licenseKey_camelCase(self):
        req = MockRequest()
        _, _, key = extract_request_identity({"licenseKey": "RP-KEY-1"}, req, None)
        assert key == "RP-KEY-1"

    def test_header_x_anon_id_when_body_empty(self):
        req = MockRequest({"X-Anon-Id": "hdr-only"})
        em, anon, key = extract_request_identity({}, req, None)
        assert anon == "hdr-only"
        assert em

    def test_header_replypals_alias(self):
        req = MockRequest({"X-ReplyPals-Anon-Id": "alt-hdr"})
        em, anon, _ = extract_request_identity({}, req, None)
        assert anon == "alt-hdr"
        assert em

    def test_non_dict_body_safe(self):
        req = MockRequest()
        em, anon, key = extract_request_identity(None, req, None)
        assert em == "" and anon == "" and key == ""

    def test_jwt_wins_over_body_email(self):
        req = MockRequest()
        em, _, _ = extract_request_identity({"email": "other@x.com"}, req, "primary@y.com")
        assert em == "primary@y.com"
