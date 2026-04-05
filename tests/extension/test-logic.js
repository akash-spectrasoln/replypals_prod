const fs = require('fs');
const path = require('path');

console.log('Testing ReplyPals Extension Logic...');

// Utility mock functions to verify logic
let passed = 0;
let failed = 0;

function assertEqual(actual, expected, testName) {
  if (actual === expected) {
    passed++;
    console.log(`✅ ${testName} Passed`);
  } else {
    failed++;
    console.error(`❌ ${testName} Failed: expected ${expected}, got ${actual}`);
  }
}

// 1. Language Detection Test (mock from content.js)
const LANG_PATTERNS = {
  hi: /[\u0900-\u097F]|\b(hai|hain|karo|aur|nahi|mujhe|bahut|accha|kya)\b/i,
  ar: /[\u0600-\u06FF]/,
  tl: /\b(po|opo|ako|ikaw|siya|kasi|pero|parang|lang)\b/i,
  ml: /[\u0D00-\u0D7F]/,
};
function detectLanguage(text) {
  for (var lang in LANG_PATTERNS) { if (LANG_PATTERNS[lang].test(text)) return lang; }
  return 'en';
}

assertEqual(detectLanguage('hello there'), 'en', 'English Detection');
assertEqual(detectLanguage('kya haal hai'), 'hi', 'Hindi Pinyin Detection');
assertEqual(detectLanguage('kamusta po'), 'tl', 'Tagalog Detection');
assertEqual(detectLanguage('مرحبا كيف حالك'), 'ar', 'Arabic Detection');
assertEqual(detectLanguage('എന്ത് ഒക്കെയുണ്ട് വിശേഷം'), 'ml', 'Malayalam Detection');

// 2. Diff Words (mock from content.js)
function diffWords(a, b) {
  var aW = a.split(' '), bW = b.split(' '), oA = '', oB = '', i = 0, j = 0;
  while (i < aW.length || j < bW.length) {
    if (aW[i] === bW[j]) { oA += aW[i] + ' '; oB += bW[j] + ' '; i++; j++; }
    else { if (aW[i]) oA += '<s>' + aW[i] + '</s> '; if (bW[j]) oB += '<b>' + bW[j] + '</b> '; i++; j++; }
  }
  return { a: oA.trim(), b: oB.trim() };
}
const diff = diffWords("I is a boy", "I am a boy");
assertEqual(diff.a, "I <s>is</s> a boy", "Diff Original String");
assertEqual(diff.b, "I <b>am</b> a boy", "Diff Result String");

console.log(`\nExtension Logic Test Results: \n✅ ${passed} Passed | ❌ ${failed} Failed`);
if (failed > 0) process.exit(1);

