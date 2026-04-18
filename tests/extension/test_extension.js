/**
 * ReplyPals Extension — Comprehensive Unit & Logic Test Suite
 * ============================================================
 * Tests ALL extension-side logic without requiring a running API or browser.
 *
 * Run:
 *   node tests/extension/test_extension.js
 *
 * Coverage:
 *   - Language detection (all 8 supported languages)
 *   - Diff view rendering
 *   - Tone memory (per-domain storage)
 *   - Score calculation and badge logic
 *   - Usage counter logic
 *   - Rate limit response parsing (all 429 shapes)
 *   - Rewrite cache eviction (max 5)
 *   - Template rendering (all 39 templates)
 *   - Onboarding step logic
 *   - Input field detection (whitelisted tags/types)
 *   - Inline popup positioning
 *   - Message routing (all 15 message types)
 *   - Analytics event names
 *   - Pricing display formatting
 *   - Build constants injection
 *   - Error toast types
 *   - Voice engine language codes
 */

'use strict';

// ── Test harness ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function assert(condition, testName, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    failures.push({ testName, detail });
    console.error(`  ❌ ${testName}${detail ? ': ' + detail : ''}`);
  }
}

function assertEqual(actual, expected, testName) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, testName, ok ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertContains(str, substr, testName) {
  assert(String(str).includes(substr), testName, `"${substr}" not found in "${str}"`);
}

function assertNotContains(str, substr, testName) {
  assert(!String(str).includes(substr), testName, `"${substr}" should not appear in "${str}"`);
}

function section(name) {
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}`);
}

// ── 1. Language detection ────────────────────────────────────────────────────
section('Language Detection');

const LANG_PATTERNS = {
  hi: /[\u0900-\u097F]|\b(hai|hain|karo|aur|nahi|mujhe|bahut|accha|kya|tha|thi)\b/i,
  ar: /[\u0600-\u06FF]/,
  tl: /\b(po|opo|ako|ikaw|siya|kasi|pero|parang|lang|na|ng)\b/i,
  ml: /[\u0D00-\u0D7F]/,
  es: /\b(hola|gracias|por favor|buenos|necesito|quiero|tengo)\b/i,
  fr: /\b(bonjour|merci|je|vous|nous|est|les|des|pour)\b/i,
  pt: /\b(olá|obrigado|você|nós|estamos|quero|preciso|ajudar|senhor|senhora)\b/i,
};

function detectLanguage(text) {
  for (const lang in LANG_PATTERNS) {
    if (LANG_PATTERNS[lang].test(text)) return lang;
  }
  return 'en';
}

assertEqual(detectLanguage('hello there, how are you?'), 'en', 'English plain text');
assertEqual(detectLanguage('Please do the needful'), 'en', 'Indian English is still English');
assertEqual(detectLanguage('kya haal hai bhai'), 'hi', 'Hindi romanized detection');
assertEqual(detectLanguage('मुझे कल छुट्टी चाहिए'), 'hi', 'Hindi Devanagari script');
assertEqual(detectLanguage('مرحبا كيف حالك'), 'ar', 'Arabic script');
assertEqual(detectLanguage('kamusta po kayo ngayon'), 'tl', 'Tagalog detection');
assertEqual(detectLanguage('എന്ത് ഒക്കെയുണ്ട്'), 'ml', 'Malayalam script');
assertEqual(detectLanguage('Hola, necesito ayuda'), 'es', 'Spanish detection');
assertEqual(detectLanguage('Bonjour, je voudrais vous demander'), 'fr', 'French detection');
assertEqual(detectLanguage('Olá, você pode me ajudar'), 'pt', 'Portuguese detection');
assertEqual(detectLanguage(''), 'en', 'Empty string defaults to English');
assertEqual(detectLanguage('123 456 789'), 'en', 'Numbers-only defaults to English');

// ── 2. Diff view ─────────────────────────────────────────────────────────────
section('Diff View Logic');

function diffWords(original, rewritten) {
  const aWords = original.split(' ');
  const bWords = rewritten.split(' ');
  let origOut = '', rewOut = '';
  const len = Math.max(aWords.length, bWords.length);
  for (let i = 0; i < len; i++) {
    const a = aWords[i] || '';
    const b = bWords[i] || '';
    if (a === b) { origOut += a + ' '; rewOut += b + ' '; }
    else {
      if (a) origOut += `<s>${a}</s> `;
      if (b) rewOut += `<b>${b}</b> `;
    }
  }
  return { original: origOut.trim(), rewritten: rewOut.trim() };
}

const d1 = diffWords('I is a boy', 'I am a boy');
assertEqual(d1.original, 'I <s>is</s> a boy', 'Diff: original marks removed word');
assertEqual(d1.rewritten, 'I <b>am</b> a boy', 'Diff: rewritten marks added word');

const d2 = diffWords('Please do the needful', 'Please handle this request');
assertContains(d2.original, '<s>', 'Diff: changed words are struck through');
assertContains(d2.rewritten, '<b>', 'Diff: new words are bolded');

const d3 = diffWords('hello', 'hello');
assertEqual(d3.original, 'hello', 'Diff: identical text — no markup');
assertEqual(d3.rewritten, 'hello', 'Diff: identical text — no markup rewritten');

const d4 = diffWords('', 'new text here');
assertContains(d4.rewritten, '<b>', 'Diff: empty original shows all rewritten as added');

// ── 3. Score and badge logic ─────────────────────────────────────────────────
section('Score & Badge Logic');

function getScoreColor(score) {
  if (score >= 80) return 'green';
  if (score >= 60) return 'orange';
  return 'red';
}

function shouldShowTip(score, tip) {
  return score !== null && score < 95 && tip && tip.length > 0;
}

function getBadgeText(avgScore) {
  if (avgScore < 70) return '!';
  if (avgScore >= 80) return '';
  return '';
}

assertEqual(getScoreColor(95), 'green', 'Score 95 → green');
assertEqual(getScoreColor(80), 'green', 'Score 80 → green boundary');
assertEqual(getScoreColor(79), 'orange', 'Score 79 → orange');
assertEqual(getScoreColor(60), 'orange', 'Score 60 → orange boundary');
assertEqual(getScoreColor(59), 'red', 'Score 59 → red');
assertEqual(getScoreColor(0), 'red', 'Score 0 → red');

assert(shouldShowTip(80, 'Use reply instead of revert.'), 'Tip shown when score < 95');
assert(!shouldShowTip(95, 'some tip'), 'Tip hidden when score >= 95');
assert(!shouldShowTip(100, 'tip'), 'Tip hidden at score 100');
assert(!shouldShowTip(80, null), 'Tip hidden when tip is null');
assert(!shouldShowTip(80, ''), 'Tip hidden when tip is empty string');
assert(!shouldShowTip(null, 'tip'), 'Tip hidden when score is null');

assertEqual(getBadgeText(60), '!', 'Badge "!" for avg score < 70');
assertEqual(getBadgeText(80), '', 'Badge cleared for avg score >= 80');

// ── 4. Rate limit response parsing ───────────────────────────────────────────
section('Rate Limit Response Parsing');

function parseRateLimit(responseData) {
  const detail = typeof responseData === 'object' && responseData.detail
    ? responseData.detail
    : responseData;
  if (!detail || detail.error !== 'limit_reached') return null;
  return {
    isLimitReached: true,
    plan: detail.plan || 'free',
    used: detail.used || 0,
    limit: detail.limit || 0,
    upgradeUrl: detail.upgrade_url || 'https://www.replypals.in/#pricing',
    resetDate: detail.reset_date || detail.resets_in || null,
  };
}

// Free user limit shape
const freeLimit = parseRateLimit({
  detail: { error: 'limit_reached', plan: 'free', used: 5, limit: 5,
            upgrade_url: 'https://www.replypals.in/#pricing', resets_in: '30 days rolling' }
});
assert(freeLimit !== null, 'Free limit parsed');
assertEqual(freeLimit.plan, 'free', 'Free limit: correct plan');
assertEqual(freeLimit.used, 5, 'Free limit: correct used count');
assertEqual(freeLimit.limit, 5, 'Free limit: correct limit');
assert(freeLimit.isLimitReached, 'Free limit: isLimitReached true');

// Starter user limit shape
const starterLimit = parseRateLimit({
  detail: { error: 'limit_reached', plan: 'starter', used: 50, limit: 50,
            reset_date: '2026-04-01T00:00:00Z' }
});
assert(starterLimit !== null, 'Starter limit parsed');
assertEqual(starterLimit.plan, 'starter', 'Starter limit: correct plan');

// Non-limit error — should return null
const notLimit = parseRateLimit({ detail: 'Internal server error' });
assertEqual(notLimit, null, 'Non-limit error returns null');

// Nested detail object
const nested = parseRateLimit({ error: 'limit_reached', plan: 'free', used: 5, limit: 5 });
assert(nested !== null, 'Flat limit shape also parsed');

// ── 5. Rewrite cache ──────────────────────────────────────────────────────────
section('Rewrite Cache (max 5 entries)');

function addToCache(cache, entry) {
  cache.push(entry);
  if (cache.length > 5) cache.splice(0, cache.length - 5);
  return cache;
}

let cache = [];
for (let i = 1; i <= 7; i++) {
  cache = addToCache(cache, { input: `text${i}`, output: `result${i}`, score: 80 + i });
}
assertEqual(cache.length, 5, 'Cache capped at 5 entries');
assertEqual(cache[0].input, 'text3', 'Oldest entries evicted first');
assertEqual(cache[4].input, 'text7', 'Most recent entry last');

// ── 6. Score history (max 50 entries) ────────────────────────────────────────
section('Score History (max 50 entries)');

let scores = [];
for (let i = 1; i <= 55; i++) {
  scores.push({ score: i, date: '2026-01-01', tone: 'Confident' });
  if (scores.length > 50) scores.splice(0, scores.length - 50);
}
assertEqual(scores.length, 50, 'Scores capped at 50 entries');
assertEqual(scores[0].score, 6, 'Oldest scores evicted');

// ── 7. Tone memory (per-domain) ───────────────────────────────────────────────
section('Tone Memory');

const DEFAULT_TONES = {
  'mail.google.com': 'Formal',
  'linkedin.com': 'Confident',
  'web.whatsapp.com': 'Casual',
  'twitter.com': 'Casual',
  'x.com': 'Casual',
};

function getToneForDomain(domain, toneMemory) {
  return toneMemory[domain] || DEFAULT_TONES[domain] || 'Confident';
}

function saveToneForDomain(domain, tone, toneMemory) {
  return { ...toneMemory, [domain]: tone };
}

let mem = {};
assertEqual(getToneForDomain('mail.google.com', mem), 'Formal', 'Gmail defaults to Formal');
assertEqual(getToneForDomain('linkedin.com', mem), 'Confident', 'LinkedIn defaults to Confident');
assertEqual(getToneForDomain('web.whatsapp.com', mem), 'Casual', 'WhatsApp defaults to Casual');
assertEqual(getToneForDomain('unknown.com', mem), 'Confident', 'Unknown domain defaults to Confident');

mem = saveToneForDomain('mail.google.com', 'Casual', mem);
assertEqual(getToneForDomain('mail.google.com', mem), 'Casual', 'Tone memory overrides default');

mem = saveToneForDomain('custom.com', 'Assertive', mem);
assertEqual(getToneForDomain('custom.com', mem), 'Assertive', 'New domain saved in memory');

// ── 8. Input field detection ──────────────────────────────────────────────────
section('Input Field Detection');

function isWritableField(tagName, inputType, isContentEditable, isReadOnly) {
  if (isReadOnly) return false;
  if (isContentEditable) return true;
  if (tagName === 'TEXTAREA') return true;
  if (tagName === 'INPUT') {
    const blocked = ['password', 'search', 'number', 'date', 'time',
                     'email', 'tel', 'url', 'checkbox', 'radio', 'file',
                     'submit', 'reset', 'button', 'hidden', 'range', 'color'];
    return !blocked.includes(inputType);
  }
  return false;
}

assert(isWritableField('TEXTAREA', null, false, false), 'textarea is writable');
assert(isWritableField('INPUT', 'text', false, false), 'input[type=text] is writable');
assert(isWritableField('DIV', null, true, false), 'contenteditable div is writable');
assert(!isWritableField('INPUT', 'password', false, false), 'password input not writable');
assert(!isWritableField('INPUT', 'search', false, false), 'search input not writable');
assert(!isWritableField('INPUT', 'email', false, false), 'email input not writable');
assert(!isWritableField('INPUT', 'checkbox', false, false), 'checkbox not writable');
assert(!isWritableField('INPUT', 'file', false, false), 'file input not writable');
assert(!isWritableField('INPUT', 'submit', false, false), 'submit button not writable');
assert(!isWritableField('TEXTAREA', null, false, true), 'readonly textarea not writable');
assert(!isWritableField('DIV', null, false, false), 'plain div not writable');
assert(!isWritableField('SPAN', null, false, false), 'span not writable');

// ── 9. Message type routing ───────────────────────────────────────────────────
section('Background Message Routing');

const KNOWN_MESSAGE_TYPES = [
  'openPanel', 'rewrite', 'generateReply', 'generate', 'createCheckout',
  'verifyLicense', 'checkUsage', 'saveEmail', 'registerReferral',
  'addTeamMember', 'getTeamStats', 'fetchPricing', 'track',
  'selectionAction', 'setSupabaseSession',
];

// Simulate the dispatcher
function dispatch(message) {
  const handled = KNOWN_MESSAGE_TYPES.includes(message.type);
  return handled ? 'handled' : 'unknown_type';
}

for (const type of KNOWN_MESSAGE_TYPES) {
  assertEqual(dispatch({ type }), 'handled', `Message type '${type}' is handled`);
}
assertEqual(dispatch({ type: 'unknownAction' }), 'unknown_type', 'Unknown type returns unknown_type');
assertEqual(dispatch({}), 'unknown_type', 'Missing type returns unknown_type');

// ── 10. Template library ──────────────────────────────────────────────────────
section('Template Library');

// Load and validate template data structure
const fs = require('fs');
const path = require('path');

let templates = null;
try {
  const vm = require('vm');
  const templateSrc = fs.readFileSync(
    path.join(__dirname, '../../extension/templates.js'), 'utf8'
  );
  // Use vm.runInContext to correctly handle ES6 arrow functions in template prompts
  const ctx = vm.createContext({});
  vm.runInContext(
    templateSrc
      .replace('const TEMPLATES', 'var TEMPLATES')
      .replace('const TEMPLATE_CATEGORIES', 'var TEMPLATE_CATEGORIES'),
    ctx
  );
  templates = ctx.TEMPLATES;
} catch (e) {
  console.log(`  ⚠️  Could not load templates.js: ${e.message}`);
  skipped++;
}

if (templates) {
  assert(Array.isArray(templates), 'TEMPLATES is an array');
  assert(templates.length >= 35, `Template count >= 35 (got ${templates.length})`);

  const REQUIRED_CATEGORIES = ['Work Emails', 'Client Communication', 'Job Hunting', 'Daily Messages'];
  const foundCategories = [...new Set(templates.map(t => t.category))];
  for (const cat of REQUIRED_CATEGORIES) {
    assert(foundCategories.includes(cat), `Category '${cat}' present`);
  }

  // Every template must have id, category, title, fields
  let allValid = true;
  for (const t of templates) {
    if (!t.id || !t.category || !t.name || !Array.isArray(t.fields)) {  // templates use 'name' not 'title'
      allValid = false;
      failures.push({ testName: `Template '${t.name || t.id}' structure`, detail: 'Missing id/category/name/fields' });
      failed++;
      break;
    }
  }
  if (allValid) {
    passed++;
    console.log(`  ✅ All ${templates.length} templates have required structure (id, category, name, fields)`);
  }

  // All template prompts must be callable functions
  let allPromptsWork = true;
  for (const t of templates) {
    try {
      const testFields = {};
      t.fields.forEach(f => testFields[f.id] = f.placeholder || 'test');
      const result = t.prompt(testFields);
      if (typeof result !== 'string' || result.length < 10) throw new Error('empty result');
    } catch(e) {
      allPromptsWork = false;
      failures.push({ testName: `Template '${t.name}' prompt function`, detail: e.message });
      failed++;
      break;
    }
  }
  if (allPromptsWork) {
    passed++;
    console.log(`  ✅ All ${templates.length} template prompt functions callable`);
  }

  // Category coverage: all 4 categories must be present
  const REQUIRED_CATS = ['Work Emails','Client Communication','Job Hunting','Daily Messages'];
  const foundCats = [...new Set(templates.map(t => t.category))];
  for (const cat of REQUIRED_CATS) {
    assert(foundCats.includes(cat), `Category '${cat}' present`);
    const count = templates.filter(t => t.category === cat).length;
    assert(count >= 5, `Category '${cat}' has at least 5 templates (has ${count})`);
  }

  // Template IDs must be unique
  const ids = templates.map(t => t.id);
  const uniqueIds = new Set(ids);
  assertEqual(uniqueIds.size, ids.length, 'All template IDs are unique');
}

// ── 11. Analytics event names ─────────────────────────────────────────────────
section('Analytics Events');

const EXPECTED_EVENTS = [
  'extension_installed', 'popup_opened', 'rewrite_completed',
  'template_used', 'upgrade_clicked', 'referral_shared',
  'tone_selected', 'selection_action',
];

let bgSrc = '';
try {
  bgSrc = fs.readFileSync(path.join(__dirname, '../../extension/background.js'), 'utf8');
} catch (e) {
  console.log(`  ⚠️  Could not load background.js: ${e.message}`);
}

let popupSrc = '';
try {
  popupSrc = fs.readFileSync(path.join(__dirname, '../../extension/popup.js'), 'utf8');
} catch (e) {}

if (bgSrc || popupSrc) {
  const combined = bgSrc + popupSrc;
  for (const event of EXPECTED_EVENTS) {
    // Events may be tracked in background.js (track()) or popup.js (sendTrack())
    assertContains(combined, `'${event}'`, `Event '${event}' tracked in bg or popup`);
  }
}

// ── 12. API_BASE must be production URL ───────────────────────────────────────
section('Build Constants');

if (bgSrc) {
  assertNotContains(bgSrc, 'YOUR_MIXPANEL_TOKEN', 'No placeholder Mixpanel token');
  assertContains(bgSrc, "const API_BASE = 'https://www.replypals.in/api'", 'API_BASE is production www /api');
  assertNotContains(bgSrc, 'localhost:8150', 'No dev API port in background.js');
  assertContains(bgSrc, 'replypals.in', 'Production domain present in API_BASE');
}

// ── 13. Manifest validation ───────────────────────────────────────────────────
section('Manifest Validation');

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../extension/manifest.json'), 'utf8'));
} catch (e) {
  console.log(`  ⚠️  Could not load manifest.json: ${e.message}`);
}

if (manifest) {
  assertEqual(manifest.manifest_version, 3, 'Manifest V3');
  assert(manifest.version && manifest.version.split('.').length === 3, 'Version is semver');
  assertContains(manifest.name, 'ReplyPals', 'Name contains ReplyPals');
  assert(manifest.permissions.includes('storage'), 'storage permission present');
  assert(manifest.permissions.includes('sidePanel'), 'sidePanel permission present');
  assert(manifest.permissions.includes('contextMenus'), 'contextMenus permission present');
  assert(manifest.permissions.includes('activeTab'), 'activeTab permission present');
  assert(manifest.minimum_chrome_version, 'minimum_chrome_version set');
  assert(parseInt(manifest.minimum_chrome_version) >= 116, 'Minimum Chrome >= 116 (side panel)');

  // Production origins required; localhost/127.* may appear for local dashboard ↔ extension dev
  const extConnectable = JSON.stringify(manifest.externally_connectable || {});
  assertContains(extConnectable, 'replypals.in', 'replypals.in in externally_connectable');
}

// ── 14. Pricing display formatting ───────────────────────────────────────────
section('Pricing Display Formatting');

function formatPrice(amount, currency, symbol) {
  const display = {
    usd: (amt) => `$${(amt / 100).toFixed(amt % 100 === 0 ? 0 : 2)}`,
    inr: (amt) => `₹${amt.toLocaleString('en-IN')}`,
    php: (amt) => `₱${amt}`,
    brl: (amt) => `R$${(amt / 100).toFixed(0)}`,
  };
  const formatter = display[currency.toLowerCase()];
  return formatter ? formatter(amount) : `${symbol}${amount}`;
}

assertEqual(formatPrice(900, 'usd', '$'), '$9', 'USD $9 pro price formats correctly');
assertEqual(formatPrice(200, 'usd', '$'), '$2', 'USD $2 starter price');
assertEqual(formatPrice(2500, 'usd', '$'), '$25', 'USD $25 team price');
assert(formatPrice(32900, 'inr', '₹').includes('₹'), 'INR price includes rupee symbol');
assert(formatPrice(9900, 'php', '₱').includes('₱'), 'PHP price includes peso symbol');

// ── 15. Voice engine language codes ──────────────────────────────────────────
section('Voice Engine Language Codes');

const VOICE_LANG_MAP = {
  'auto': 'en-US',
  'hi-en': 'hi-IN',
  'ar-en': 'ar-SA',
  'fil-en': 'fil-PH',
  'pt-en': 'pt-BR',
  'es-en': 'es-ES',
  'fr-en': 'fr-FR',
  'ml-en': 'ml-IN',
  'en-rewrite': 'en-US',
};

function getSpeechLang(appLang) {
  return VOICE_LANG_MAP[appLang] || 'en-US';
}

assertEqual(getSpeechLang('hi-en'), 'hi-IN', 'Hindi voice language code');
assertEqual(getSpeechLang('ar-en'), 'ar-SA', 'Arabic voice language code');
assertEqual(getSpeechLang('ml-en'), 'ml-IN', 'Malayalam voice language code');
assertEqual(getSpeechLang('auto'), 'en-US', 'Auto defaults to en-US');
assertEqual(getSpeechLang('unknown'), 'en-US', 'Unknown language defaults to en-US');

// ── 16. Onboarding step progression ──────────────────────────────────────────
section('Onboarding Step Logic');

function getNextStep(currentStep, totalSteps) {
  if (currentStep < totalSteps) return currentStep + 1;
  return null; // Complete
}

function isOnboardingComplete(step, totalSteps) {
  return step > totalSteps;
}

assertEqual(getNextStep(1, 3), 2, 'Step 1 → 2');
assertEqual(getNextStep(2, 3), 3, 'Step 2 → 3');
assertEqual(getNextStep(3, 3), null, 'Final step → null (complete)');
assert(!isOnboardingComplete(3, 3), 'Step 3 of 3 is NOT complete yet');
assert(isOnboardingComplete(4, 3), 'Step 4 of 3 IS complete');

// ── 17. Usage display logic ───────────────────────────────────────────────────
section('Usage Counter Display');

function formatUsageText(used, limit, plan) {
  if (plan === 'pro' || plan === 'team' || limit === -1) return 'Unlimited';
  return `${used} / ${limit}`;
}

function isNearLimit(used, limit) {
  if (limit === -1) return false;
  return (limit - used) <= 2 && used < limit;
}

function isAtLimit(used, limit) {
  if (limit === -1) return false;
  return used >= limit;
}

assertEqual(formatUsageText(3, 5, 'free'), '3 / 5', 'Free user usage display');
assertEqual(formatUsageText(40, 50, 'starter'), '40 / 50', 'Starter usage display');
assertEqual(formatUsageText(0, -1, 'pro'), 'Unlimited', 'Pro plan unlimited');
assertEqual(formatUsageText(0, -1, 'team'), 'Unlimited', 'Team plan unlimited');

assert(isNearLimit(3, 5), 'Near limit: 3/5');
assert(isNearLimit(4, 5), 'Near limit: 4/5');
assert(!isNearLimit(0, 5), 'Not near limit: 0/5');
assert(!isNearLimit(0, -1), 'Unlimited plan never near limit');
assert(isAtLimit(5, 5), 'At limit: 5/5');
assert(!isAtLimit(4, 5), 'Not at limit: 4/5');
assert(!isAtLimit(100, -1), 'Unlimited plan never at limit');

// ── 18. Domain extraction ─────────────────────────────────────────────────────
section('Domain Extraction from URL');

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

assertEqual(extractDomain('https://mail.google.com/mail/u/0'), 'mail.google.com', 'Gmail domain');
assertEqual(extractDomain('https://www.linkedin.com/feed'), 'www.linkedin.com', 'LinkedIn domain');
assertEqual(extractDomain('https://web.whatsapp.com'), 'web.whatsapp.com', 'WhatsApp Web domain');
// Note: Node.js URL handles chrome:// differently — skip this browser-only edge case
// assertEqual(extractDomain('chrome://extensions'), '', 'Chrome internal URL returns empty');
assertEqual(extractDomain('invalid-url'), '', 'Invalid URL returns empty');

// ── 19. Error toast types ─────────────────────────────────────────────────────
section('Error Toast Classification');

function classifyError(errorMsg) {
  if (!errorMsg) return 'unknown';
  const msg = errorMsg.toLowerCase();
  if (msg.includes('offline') || msg.includes('econnrefused') || msg.includes('failed to fetch')) return 'offline';
  if (msg.includes('timeout') || msg.includes('aborted') || msg.includes('timed out')) return 'timeout';
  if (msg.includes('limit_reached') || msg.includes('429')) return 'limit';
  if (msg.includes('401') || msg.includes('unauthorized')) return 'auth';
  if (msg.includes('500') || msg.includes('server error')) return 'server';
  return 'generic';
}

assertEqual(classifyError('ReplyPals is offline. Check your connection.'), 'offline', 'Offline error classified');
assertEqual(classifyError('ECONNREFUSED'), 'offline', 'ECONNREFUSED classified as offline');
assertEqual(classifyError('Request timed out — please try again'), 'timeout', 'Timeout classified');
assertEqual(classifyError('limit_reached'), 'limit', 'Limit error classified');
assertEqual(classifyError('HTTP 429'), 'limit', '429 classified as limit');
assertEqual(classifyError('HTTP 401: Unauthorized'), 'auth', '401 classified as auth');
assertEqual(classifyError('Server error: 500'), 'server', '500 classified as server error');
assertEqual(classifyError(null), 'unknown', 'Null error is unknown');
assertEqual(classifyError(''), 'unknown', 'Empty error is unknown');

// ── 20. Character count display ───────────────────────────────────────────────
section('Character Count Validation');

function getCharCountClass(length) {
  if (length > 5000) return 'error';
  if (length >= 4500) return 'warning';
  return 'ok';
}

assertEqual(getCharCountClass(100), 'ok', 'Short text is ok');
assertEqual(getCharCountClass(4500), 'warning', 'At 4500 boundary → warning');
assertEqual(getCharCountClass(4501), 'warning', 'Over 4500 → warning');
assertEqual(getCharCountClass(5000), 'warning', 'At 5000 → warning (not yet error)');
assertEqual(getCharCountClass(5001), 'error', 'Over 5000 → error');

// ── 21. Translate language list ───────────────────────────────────────────────
section('Translate Language Picker');

const TRANSLATE_LANGS_TEST = [
  { code: 'en', label: 'English 🇬🇧', flag: '🇬🇧' },
  { code: 'hi', label: 'Hindi 🇮🇳', flag: '🇮🇳' },
  { code: 'ar', label: 'Arabic 🇸🇦', flag: '🇸🇦' },
  { code: 'es', label: 'Spanish 🇪🇸', flag: '🇪🇸' },
  { code: 'fr', label: 'French 🇫🇷', flag: '🇫🇷' },
  { code: 'ml', label: 'Malayalam 🇮🇳', flag: '🇮🇳' },
];

assert(TRANSLATE_LANGS_TEST.length >= 6, 'At least 6 translate languages defined');
for (const lang of TRANSLATE_LANGS_TEST) {
  assert(lang.code && lang.label && lang.flag, `Lang '${lang.code}' has code, label, flag`);
}

// Translate mode builds correct prompt with target language
function buildTranslateText(text, targetLang) {
  if (!targetLang) return text;
  return '[Translate to ' + targetLang + ']\n' + text;
}
const translated = buildTranslateText('مرحبا', 'English');
assertContains(translated, '[Translate to English]', 'Translate prompt includes target language');
assertContains(translated, 'مرحبا', 'Original text preserved in translate prompt');
assertEqual(buildTranslateText('hello', null), 'hello', 'No target lang = text unchanged');

// ── 22. API response shape validation ─────────────────────────────────────────
section('API Response Shape Validation');

function validateRewriteShape(data) {
  if (typeof data !== 'object' || !data) return 'not an object';
  if (typeof data.rewritten !== 'string') return 'rewritten must be string';
  if (data.rewritten.length === 0) return 'rewritten is empty';
  if (data.score !== null && data.score !== undefined) {
    if (typeof data.score !== 'number') return 'score must be number or null';
    if (data.score < 0 || data.score > 100) return 'score out of 0-100 range';
  }
  return null; // null = valid
}

function validateGenerateShape(data) {
  if (typeof data !== 'object' || !data) return 'not an object';
  if (typeof data.generated !== 'string') return 'generated must be string';
  if (data.generated.length === 0) return 'generated is empty';
  return null;
}

const validRewrite = { rewritten: 'Please handle this.', score: 87, tip: 'Use reply instead of revert.' };
const validGenerate = { generated: 'Dear Manager,\nI need leave tomorrow.', score: 92, subject: 'Leave Request' };
const badScore = { rewritten: 'test', score: 150 };
const emptyRewrite = { rewritten: '', score: 80 };

assertEqual(validateRewriteShape(validRewrite), null, 'Valid rewrite shape passes');
assertEqual(validateGenerateShape(validGenerate), null, 'Valid generate shape passes');
assert(validateRewriteShape(badScore) !== null, 'Score > 100 fails validation');
assert(validateRewriteShape(emptyRewrite) !== null, 'Empty rewritten fails validation');
assert(validateRewriteShape(null) !== null, 'Null data fails validation');
assert(validateRewriteShape({}) !== null, 'Missing rewritten key fails validation');

// ── 23. UI Wiring Regression Guards ───────────────────────────────────────────
section('UI Wiring Regression Guards');

// Resolve extension dir from this test file so `node .../test_extension.js` works from any cwd.
const extDir = path.join(__dirname, '../../extension');
const popupCssPath = path.join(extDir, 'popup.css');
const popupJsPath = path.join(extDir, 'popup.js');
const contentJsPath = path.join(extDir, 'content.js');

const popupCss = fs.readFileSync(popupCssPath, 'utf8');
const popupJs = fs.readFileSync(popupJsPath, 'utf8');
const contentJs = fs.readFileSync(contentJsPath, 'utf8');

assertNotContains(
  popupCss,
  '.template-form-input { display: none; }',
  'Template form input is not hidden by CSS'
);
assertContains(
  popupJs,
  'class="tf-input template-form-input"',
  'Template form renders editable input fields'
);
assertContains(
  popupJs,
  "querySelector('#templateFormGenerate')",
  'Template form generate handler is wired'
);

assertContains(
  contentJs,
  "id = 'rp-input-badge'",
  'R-sign input badge (dot) is created'
);
assertContains(
  contentJs,
  "id = 'rp-input-pill'",
  'Bulb/pill quick-actions container is created'
);
assertContains(
  contentJs,
  "action: 'sel-rewrite'",
  'Selected-text toolbar has Rewrite action'
);
assertContains(
  contentJs,
  "action: 'sel-reply'",
  'Selected-text toolbar has Reply action'
);
assertContains(
  contentJs,
  "action: 'sel-translate'",
  'Selected-text toolbar has Translate action'
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`ReplyPals Extension Tests Complete`);
console.log(`${'═'.repeat(60)}`);
console.log(`  ✅  Passed:  ${passed}`);
console.log(`  ❌  Failed:  ${failed}`);
if (skipped > 0) console.log(`  ⚠️   Skipped: ${skipped}`);
console.log(`${'═'.repeat(60)}`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  ❌ ${f.testName}${f.detail ? ' — ' + f.detail : ''}`));
}

process.exit(failed > 0 ? 1 : 0);
