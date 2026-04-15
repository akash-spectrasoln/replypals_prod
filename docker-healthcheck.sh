#!/bin/sh
curl -fsS "http://127.0.0.1:${PORT:-80}/api/health" || exit 1
