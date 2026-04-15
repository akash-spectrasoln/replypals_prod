# ── Stage 1: Admin dashboard (Vite/React) ─────────────────────
FROM node:20-alpine AS admin-builder
WORKDIR /app/admin-dashboard
COPY admin-dashboard/package*.json ./
RUN npm ci
COPY admin-dashboard/ ./
ENV VITE_API_BASE=/api
RUN npm run build

# ── Stage 2: Marketing site (Astro) ───────────────────────────
FROM node:20-alpine AS website-builder
WORKDIR /app/website
COPY website/package*.json ./
RUN npm ci
COPY website/ ./
ENV PUBLIC_API_BASE=/api
RUN npm run build

# ── Stage 3: API + nginx + supervisor ───────────────────────
FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    nginx \
    supervisor \
    curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/api
COPY api/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY api/ ./

COPY --from=admin-builder /app/admin-dashboard/dist /var/www/admin
COPY --from=website-builder /app/website/dist /var/www/website
COPY website_static_backup/ /var/www/website_static_backup

COPY nginx.conf /etc/nginx/sites-available/default
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY docker-healthcheck.sh /usr/local/bin/docker-healthcheck.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /usr/local/bin/docker-healthcheck.sh

RUN rm -f /etc/nginx/sites-enabled/default && \
    ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD /usr/local/bin/docker-healthcheck.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
