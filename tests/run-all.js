/**
 * ReplyPals — Master Test Runner
 * ================================
 * Runs: extension unit tests (Node.js) + reminder to run pytest suites
 *
 * Usage:
 *   node tests/run-all.js
 *
 *   For full test suite (requires live API):
 *   REPLYPALS_API_URL=http://localhost:8150 pytest tests/api/test_api.py -v
 *   REPLYPALS_API_URL=http://localhost:8150 pytest tests/integration/test_integration.py -v -m integration
 */
'use strict';
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

console.log('═══════════════════════════════════════════════════════');
console.log('  ReplyPals — Test Suite');
console.log('═══════════════════════════════════════════════════════\n');

let allPassed = true;

// 1. Extension unit tests (no API needed)
console.log('── Extension Unit Tests (no API required) ──────────────');
try {
  execSync(`node ${path.join(__dirname, 'extension/test_extension.js')}`, {
    stdio: 'inherit',
    cwd: ROOT
  });
  console.log('\n✅ Extension tests PASSED\n');
} catch (e) {
  console.log('\n❌ Extension tests FAILED\n');
  allPassed = false;
}

// 2. Reminder for pytest suites
console.log('── API & Integration Tests (requires running API) ───────');
console.log('  Run these manually with a live API:');
console.log('');
console.log('  # Unit-level API tests (no AI calls):');
console.log('  REPLYPALS_API_URL=http://localhost:8150 \\');
console.log('    pytest tests/api/test_api.py -v -m "not slow"');
console.log('');
console.log('  # All API tests including AI calls:');
console.log('  REPLYPALS_API_URL=http://localhost:8150 \\');
console.log('    pytest tests/api/test_api.py -v');
console.log('');
console.log('  # Integration / journey tests:');
console.log('  REPLYPALS_API_URL=http://localhost:8150 \\');
console.log('    pytest tests/integration/test_integration.py -v -m integration');
console.log('');
console.log('  Install pytest deps:  pip install pytest requests --break-system-packages');
console.log('');

console.log('═══════════════════════════════════════════════════════');
console.log(allPassed
  ? '  ALL RUNNABLE TESTS PASSED ✅'
  : '  SOME TESTS FAILED ❌ — see output above');
console.log('═══════════════════════════════════════════════════════');
process.exit(allPassed ? 0 : 1);
