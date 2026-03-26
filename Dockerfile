# ─────────────────────────────────────────────────────────
# ReplyPal API — Production Dockerfile
# Build:  docker build -t replypal-api .
# Run:    docker run --env-file api/.env -p 8150:8150 replypal-api
# ─────────────────────────────────────────────────────────

FROM python:3.11-slim

# Security: run as non-root
RUN groupadd -r replypal && useradd -r -g replypal replypal

WORKDIR /app

# Install deps first (layer cache)
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app source
COPY api/ .

# Non-root ownership
RUN chown -R replypal:replypal /app
USER replypal

EXPOSE 8150

# Production: no --reload, single worker per container (scale horizontally)
# Use Railway-provided PORT when available.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8150} --workers 1"]
