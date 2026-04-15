/**
 * Mirrors extension/background.js — formatFastApiDetail
 * Run: node tests/extension/test_background_format.js
 */
'use strict';

function formatFastApiDetail(errorData) {
  const d = errorData && errorData.detail;
  if (d == null || d === '') return '';
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    return d
      .map((e) => {
        if (e && typeof e === 'object' && e.msg) {
          const loc = Array.isArray(e.loc) ? e.loc.filter(Boolean).join('.') : '';
          return (loc ? loc + ': ' : '') + e.msg;
        }
        return JSON.stringify(e);
      })
      .join('; ');
  }
  if (typeof d === 'object') return JSON.stringify(d);
  return String(d);
}

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, name) {
  if (actual === expected) {
    passed++;
    console.log('OK', name);
  } else {
    failed++;
    console.error('FAIL', name, '\n  expected:', JSON.stringify(expected), '\n  actual:  ', JSON.stringify(actual));
  }
}

assertEqual(formatFastApiDetail({}), '', 'empty object');
assertEqual(formatFastApiDetail({ detail: null }), '', 'null detail');
assertEqual(formatFastApiDetail({ detail: 'Missing identity' }), 'Missing identity', 'string detail');
assertEqual(
  formatFastApiDetail({
    detail: [
      { loc: ['body', 'text'], msg: 'field required', type: 'value_error.missing' },
    ],
  }),
  'body.text: field required',
  'validation array detail'
);
assertEqual(
  formatFastApiDetail({ detail: { error: 'x' } }),
  '{"error":"x"}',
  'object detail json'
);

console.log('\nformatFastApiDetail:', passed, 'passed,', failed, 'failed');
process.exit(failed > 0 ? 1 : 0);
