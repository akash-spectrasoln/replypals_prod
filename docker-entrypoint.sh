#!/bin/sh
set -e

PORT="${PORT:-8000}"
export PORT
UVICORN_WORKERS="${UVICORN_WORKERS:-1}"

# FULL_STACK=1: nginx (public) + uvicorn on 8000 — for VPS / self-hosted Docker.
# Default: uvicorn only — Render, Railway, Fly (FastAPI serves /dashboard, /admin, /api/*).
if [ "${FULL_STACK:-0}" = "1" ]; then
  NGINX_PORT="${PORT}"
  sed "s/__PORT__/${NGINX_PORT}/g" /etc/nginx/sites-available/default > /etc/nginx/sites-enabled/default
  exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
fi

cd /app/api
exec uvicorn main:app --host 0.0.0.0 --port "${PORT}" --workers "${UVICORN_WORKERS}"
