#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ReplyPals — Production Extension Build Script
#
# Usage:
#   MIXPANEL_TOKEN=abc123 REPLYPAL_API_URL=https://www.replypals.in ./scripts/build.sh
#
# Outputs: dist/extension/  (ready to zip and upload to Chrome Web Store)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
SRC="$ROOT/extension"
DIST="$ROOT/dist/extension"

# ── Validate required vars ────────────────────────────────────────────────────
: "${REPLYPAL_API_URL:=https://www.replypals.in}"
: "${MIXPANEL_TOKEN:=}"

if [[ -z "$MIXPANEL_TOKEN" ]]; then
  echo "⚠️  MIXPANEL_TOKEN is not set — analytics will be disabled in this build"
fi

# ── Clean & copy ──────────────────────────────────────────────────────────────
echo "🧹 Cleaning dist..."
rm -rf "$DIST"
mkdir -p "$DIST"

echo "📋 Copying extension files..."
cp -r "$SRC"/. "$DIST/"

# Remove dev-only files
rm -f "$DIST/new_logic.js" "$DIST/temp.txt" "$DIST/build2.js" "$DIST/voice-test.html"

# ── Inject build-time constants ───────────────────────────────────────────────
echo "🔧 Injecting build constants..."

# Inject concrete build-time placeholders in background.js
sed -i.bak \
  "s|__REPLYPAL_API_URL__|${REPLYPAL_API_URL}|g; \
   s|__MIXPANEL_TOKEN__|${MIXPANEL_TOKEN}|g" \
  "$DIST/background.js"

# Clean sed backups
find "$DIST" -name "*.bak" -delete

# ── Verify output ─────────────────────────────────────────────────────────────
echo "✅ Build complete → $DIST"
echo ""
echo "📦 To create Chrome Web Store zip:"
echo "   cd dist && zip -r replypal-extension.zip extension/"
echo ""
echo "🔎 Injected:"
echo "   API_BASE = ${REPLYPAL_API_URL}"
echo "   MIXPANEL = ${MIXPANEL_TOKEN:0:8}... (truncated)"
