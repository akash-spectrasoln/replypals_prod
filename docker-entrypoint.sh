#!/bin/sh
set -e
PORT="${PORT:-8000}"
export PORT

UVICORN_WORKERS="${UVICORN_WORKERS:-1}"
cd /app/api
exec uvicorn main:app --host 0.0.0.0 --port "${PORT}" --workers "${UVICORN_WORKERS}"
