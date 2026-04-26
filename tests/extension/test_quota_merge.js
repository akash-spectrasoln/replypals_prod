/**
 * Mirrors extension background sync rules for free-tier merge (anon vs signed-in).
 * Run: node tests/extension/test_quota_merge.js
 */
'use strict';

let passed = 0;
let failed = 0;

function assert(cond, name, detail) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ': ' + detail : ''}`);
  }
}

/** Same semantics as syncFreeUsageSnapshot mergedUsed */
function mergeFreeUsed({ plan, currentUsed, serverUsed }) {
  const s = Number(serverUsed || 0);
  const c = Number(currentUsed || 0);
  if (plan === 'anon') return Math.max(c, s);
  return s;
}

function mergedLeft({ plan, snapLeft, limit, mergedUsed }) {
  if (typeof snapLeft === 'number') return Math.max(0, snapLeft);
  return Math.max(0, Number(limit || 0) - mergedUsed);
}

function paidUsageLabel({ plan, used, limit }) {
  const p = String(plan || 'pro');
  const label = p.charAt(0).toUpperCase() + p.slice(1);
  if (typeof limit === 'number' && limit > 0) return `${label}: ${used} / ${limit} this month`;
  if (typeof limit === 'number' && limit < 0) return `${label} · Unlimited`;
  return label;
}

console.log('\n── Quota merge (extension parity) ───────────────────────────────');

assert(
  mergeFreeUsed({ plan: 'anon', currentUsed: 2, serverUsed: 1 }) === 2,
  'anon: max(local, server) when server lags'
);
assert(
  mergeFreeUsed({ plan: 'anon', currentUsed: 1, serverUsed: 2 }) === 2,
  'anon: server can catch up'
);
assert(
  mergeFreeUsed({ plan: 'free', currentUsed: 9, serverUsed: 3 }) === 3,
  'free: trust server count (signed-in monthly)'
);
assert(
  mergedLeft({ plan: 'free', snapLeft: 7, limit: 10, mergedUsed: 3 }) === 7,
  'prefer server rewrites_left when present'
);
assert(
  mergedLeft({ plan: 'free', snapLeft: undefined, limit: 10, mergedUsed: 3 }) === 7,
  'derive left from limit - used'
);
assert(
  paidUsageLabel({ plan: 'pro', used: 12, limit: 300 }) === 'Pro: 12 / 300 this month',
  'paid capped plans show DB-backed monthly usage'
);
assert(
  paidUsageLabel({ plan: 'enterprise', used: 12, limit: -1 }) === 'Enterprise · Unlimited',
  'unlimited plans still render as unlimited'
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
