#!/bin/sh
set -e
PORT="${PORT:-80}"
export PORT
sed -i "s/__PORT__/${PORT}/g" /etc/nginx/sites-available/default

# Start API first (background), then keep nginx in foreground for container lifecycle.
UVICORN_WORKERS="${UVICORN_WORKERS:-1}"
cd /app/api
uvicorn main:app --host 127.0.0.1 --port 8000 --workers "${UVICORN_WORKERS}" &

# nginx stays PID 1
exec nginx -g "daemon off;"
