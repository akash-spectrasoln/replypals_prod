#!/bin/sh
curl -fsS "http://127.0.0.1:${PORT:-8000}/health" || exit 1
