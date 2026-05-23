#!/usr/bin/env python3
"""
Apply single global USD pricing to Supabase (all countries = US price, Pro-only paid plan).

Requires in api/.env:
  DATABASE_URL=postgresql://...  (Supabase → Settings → Database → connection string)

Usage:
  python scripts/apply_single_global_pricing.py
  python scripts/apply_single_global_pricing.py --dry-run
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / "api" / ".env"
SQL_PATH = ROOT / "supabase" / "migrations" / "20260523_single_global_usd_pricing.sql"


def read_database_url() -> str:
    if not ENV_PATH.is_file():
        raise RuntimeError(f"Missing {ENV_PATH}")
    text = ENV_PATH.read_text(encoding="utf-8")
    m = re.search(r'^DATABASE_URL\s*=\s*"?([^\n"#]+)', text, re.M)
    if not m:
        raise RuntimeError(
            "DATABASE_URL not found in api/.env\n"
            "Add it from Supabase → Project Settings → Database → URI (use Session pooler or direct)."
        )
    url = m.group(1).strip().strip('"')
    url = url.replace("?pgbouncer=true", "").replace("&pgbouncer=true", "")
    if "sslmode=" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return url


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply single global USD pricing in Supabase")
    parser.add_argument("--dry-run", action="store_true", help="Print SQL only, do not execute")
    args = parser.parse_args()

    sql = SQL_PATH.read_text(encoding="utf-8")
    if args.dry_run:
        print(sql)
        return 0

    try:
        import psycopg2
    except ImportError:
        print("Install psycopg2: pip install psycopg2-binary", file=sys.stderr)
        return 1

    url = read_database_url()
    print("Connecting to Supabase Postgres…", flush=True)
    conn = psycopg2.connect(url)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        print("Done. Applied:", SQL_PATH.name)
        print()
        print("Next:")
        print("  1. Set PRICING_MODE=global in api/.env (optional backup)")
        print("  2. Restart API (or POST /admin/config/refresh if you use admin)")
        print("  3. Hard-refresh extension / clear session pricing cache")
        print()
        print("Everyone should see Pro at $9/mo USD on GET /pricing")
        return 0
    except Exception as e:
        print(f"Failed: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
