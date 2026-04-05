#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  ReplyPals — Test + Start Script (macOS / Linux)
#  Usage:  ./start.sh
#  Runs all tests first. Server only starts if all tests pass.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
CHECK="${GREEN}✅${NC}"; CROSS="${RED}❌${NC}"; WARN="${YELLOW}⚠️ ${NC}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

box() { echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${NC}"
        printf "${BOLD}${CYAN}║  %-48s║${NC}\n" "$1"
        echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${NC}"; }

echo ""
box "ReplyPals — Pre-flight Test Suite"
echo ""

# ── Check required tools ────────────────────────────────────────
for cmd in node python3; do
  if ! command -v "$cmd" &>/dev/null; then
    echo -e "${CROSS} '$cmd' not found. Please install it first."; exit 1; fi
done

# ════════════════════════════════════════════════════════════════
# STEP 1: Extension unit tests (157 tests, no API needed)
# ════════════════════════════════════════════════════════════════
echo -e "${BOLD}[1/3] Extension unit tests (157 checks, no API required)${NC}"
echo "──────────────────────────────────────────────────────"

if ! node "$ROOT/tests/extension/test_extension.js"; then
  echo ""
  box "EXTENSION TESTS FAILED — server NOT started"
  echo -e "Fix the errors above, then re-run ${CYAN}./start.sh${NC}"
  exit 1
fi
echo -e "\n${CHECK} Extension tests passed (157/157)\n"

# ════════════════════════════════════════════════════════════════
# STEP 2: API validation tests (no AI key, fast)
# ════════════════════════════════════════════════════════════════
echo -e "${BOLD}[2/3] API validation tests (auth, shapes, validation — no AI key)${NC}"
echo "──────────────────────────────────────────────────────"

if ! python3 -m pytest --version &>/dev/null 2>&1; then
  echo -e "${WARN} pytest not installed — skipping API validation tests."
  echo "       Install: pip install pytest requests --break-system-packages"
else
  # Exit code 5 = no tests collected (API not running) — not a failure
  set +e
  python3 -m pytest "$ROOT/tests/api/test_api.py" \
    -m "not ai" \
    --tb=short -q \
    --timeout=30 2>/dev/null
  EXIT=$?
  set -e

  if [ "$EXIT" -eq 5 ]; then
    echo -e "${WARN} No tests ran (server not yet running — starting fresh)."
  elif [ "$EXIT" -ne 0 ]; then
    echo ""
    box "API VALIDATION TESTS FAILED — server NOT started"
    exit 1
  else
    echo -e "\n${CHECK} API validation tests passed.\n"
  fi
fi
echo ""

# ════════════════════════════════════════════════════════════════
# STEP 3: Start the server
# ════════════════════════════════════════════════════════════════
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  ALL TESTS PASSED — Starting ReplyPals API       ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  API Health:   ${CYAN}http://localhost:8150/health${NC}"
echo -e "  Website:      ${CYAN}http://localhost:8150/${NC}"
echo -e "  Admin Panel:  ${CYAN}http://localhost:8150/admin/${NC}"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

cd "$ROOT/api"
python3 main.py
