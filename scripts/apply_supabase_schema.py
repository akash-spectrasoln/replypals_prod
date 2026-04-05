"""
Apply supabase_core_tables.sql using psql + DATABASE_URL from api/.env.
Bypasses Prisma db execute (which resolves Supabase pooler to db.* and can fail on some networks).
"""
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from dotenv import dotenv_values


def _clean_supabase_url(raw: str) -> str:
    """psql rejects ?pgbouncer=true; strip it and ensure sslmode=require."""
    u = urlparse(raw)
    q = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if k != "pgbouncer"]
    if not any(k == "sslmode" for k, _ in q):
        q.append(("sslmode", "require"))
    new_query = urlencode(q)
    return urlunparse((u.scheme, u.netloc, u.path, u.params, new_query, u.fragment))


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    env_path = root / "api" / ".env"
    sql_path = root / "supabase_core_tables.sql"

    cfg = dotenv_values(env_path)
    url = (cfg.get("DATABASE_URL") or "").strip().strip('"')
    if not url:
        print("DATABASE_URL missing in api/.env", file=sys.stderr)
        return 1

    url = _clean_supabase_url(url)

    psql = os.environ.get("PSQL_PATH", r"C:\Program Files\PostgreSQL\15\bin\psql.exe")
    if not Path(psql).exists():
        psql = "psql"

    # Options must precede the connection URI.
    cmd = [psql, "-v", "ON_ERROR_STOP=1", "-f", str(sql_path), url]
    print("Running psql -f", sql_path.name, "(pooler URL, sslmode=require)", flush=True)
    r = subprocess.run(cmd, cwd=str(root))
    return r.returncode


if __name__ == "__main__":
    raise SystemExit(main())
