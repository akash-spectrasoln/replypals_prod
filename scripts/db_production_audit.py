import json
import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "api" / ".env")

DSN = os.getenv("DIRECT_URL") or os.getenv("DATABASE_URL")
if not DSN:
    raise RuntimeError("Missing DIRECT_URL/DATABASE_URL in api/.env")

EXPECTED_TABLES = [
    "free_users",
    "licenses",
    "teams",
    "team_members",
    "user_profiles",
    "llm_call_logs",
    "rewrite_logs",
    "email_log",
    "app_settings",
    "admin_audit_log",
    "api_logs",
    "usage_logs",
    "anon_usage",
]


def q(cur, sql, params=None):
    cur.execute(sql, params or ())
    return cur.fetchall()


def main():
    conn = psycopg2.connect(DSN)
    cur = conn.cursor()

    tables = {r[0] for r in q(cur, "select tablename from pg_tables where schemaname='public'")}
    missing_tables = [t for t in EXPECTED_TABLES if t not in tables]

    fk_rows = q(
        cur,
        """
        select
          tc.table_name,
          kcu.column_name,
          ccu.table_name as foreign_table_name,
          ccu.column_name as foreign_column_name,
          tc.constraint_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
         and tc.table_schema = kcu.table_schema
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_name = tc.constraint_name
         and ccu.table_schema = tc.table_schema
        where tc.constraint_type = 'FOREIGN KEY'
          and tc.table_schema = 'public'
        order by tc.table_name, tc.constraint_name
        """,
    )

    required_fk_edges = [
        ("team_members", "team_id", "teams", "id"),
        ("team_members", "user_id", "user_profiles", "id"),
        ("usage_logs", "user_id", "user_profiles", "id"),
        ("usage_logs", "team_id", "teams", "id"),
    ]
    fk_edges = {(r[0], r[1], r[2], r[3]) for r in fk_rows}
    missing_fk_edges = [e for e in required_fk_edges if e not in fk_edges]

    idx_rows = q(
        cur,
        """
        select tablename, indexname, indexdef
        from pg_indexes
        where schemaname='public'
        order by tablename, indexname
        """,
    )
    index_names = {r[1] for r in idx_rows}
    required_indexes = [
        "idx_llm_logs_success_license_month",
        "idx_llm_logs_success_email_month",
        "idx_team_members_team_member_key",
        "idx_anon_usage_updated_at",
        "idx_llm_logs_event_id_unique",
        "usage_logs_user_date_unique",
    ]
    missing_indexes = [i for i in required_indexes if i not in index_names]

    rls_rows = q(
        cur,
        """
        select relname, relrowsecurity
        from pg_class
        where relkind='r'
          and relnamespace = 'public'::regnamespace
        order by relname
        """,
    )
    rls_disabled = [name for name, enabled in rls_rows if name in EXPECTED_TABLES and not enabled]

    policy_rows = q(
        cur,
        """
        select tablename, count(*)
        from pg_policies
        where schemaname='public'
        group by tablename
        """,
    )
    policy_count = {name: cnt for name, cnt in policy_rows}
    rls_no_policies = [t for t in EXPECTED_TABLES if t in tables and t not in policy_count]

    row_estimates = q(
        cur,
        """
        select relname, n_live_tup
        from pg_stat_user_tables
        where schemaname='public'
        order by n_live_tup desc, relname
        """,
    )

    summary = {
        "missing_tables": missing_tables,
        "missing_fk_edges": missing_fk_edges,
        "missing_indexes": missing_indexes,
        "rls_disabled_tables": rls_disabled,
        "rls_enabled_but_no_policies": rls_no_policies,
        "fk_count": len(fk_rows),
        "index_count": len(idx_rows),
        "table_count_public": len(tables),
        "largest_tables_estimate": row_estimates[:10],
    }
    print(json.dumps(summary, indent=2, default=str))

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
