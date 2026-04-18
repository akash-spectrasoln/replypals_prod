// ─── ReplyPals Background Service Worker ───
// Paths are /api/... — FastAPI strips the /api prefix when running without nginx (Railway).
// Use www — apex replypals.in does not proxy /api/* to FastAPI (POSTs get 405, /api/health 404).
const API_BASE = 'https://www.replypals.in/api';
/** Origin without trailing /api (for health fallbacks when /api/* is not routed). */
const API_ORIGIN = (() => {
  const b = String(API_BASE || '').replace(/\/$/, '');
  if (b.endsWith('/api')) return b.slice(0, -4);
  try {
    return new URL(b).origin;
  } catch {
    return 'https://www.replypals.in';
  }
})();
if (!API_BASE || !API_BASE.startsWith('https://')) {
  console.error('[ReplyPals] API_BASE is misconfigured:', API_BASE);
}

const BUILD_TIME_MIXPANEL_TOKEN = '__MIXPANEL_TOKEN__';

const ALLOWED_EXTERNAL_ORIGINS = new Set([
  'https://replypals.in',
  'https://www.replypals.in',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
]);

function isAllowedExternalSender(sender) {
  try {
    const u = sender?.url ? new URL(sender.url) : null;
    if (!u) return false;
    return ALLOWED_EXTERNAL_ORIGINS.has(u.origin);
  } catch (_) {
    return false;
  }
}

/** FastAPI may return ``detail`` as a string, list of validation errors, or object */
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

// ─── Onboarding + Install ───
chrome.runtime.onInstalled.addListener(async (details) => {
  // Context menu
  chrome.contextMenus.create({
    id: 'replypal-rewrite',
    title: '✍ Rewrite with ReplyPals',
    contexts: ['selection']
  });

  // Generate referral code on first install
  const { replypalRefCode } = await chrome.storage.local.get('replypalRefCode');
  if (!replypalRefCode) {
    const refCode = crypto.randomUUID().replace(/-/g, '').substring(0, 8);
    await chrome.storage.local.set({ replypalRefCode: refCode });
  }

  // Onboarding — only on fresh install
  if (details.reason === 'install') {
    track('extension_installed'); // no personal data
    const { replypalOnboarded } = await chrome.storage.local.get('replypalOnboarded');
    if (!replypalOnboarded) {
      chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
    }
  }
});

// ─── Context Menu Click ───
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'replypal-rewrite' && info.selectionText) {
    await chrome.storage.session.set({ replypalSelection: info.selectionText.trim() });
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (err) {
      console.error('ReplyPals: Failed to open side panel', err);
    }
  }
});

// ─── Extension Icon Click → Open Side Panel ───
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
    try {
      const url = new URL(tab.url);
      track('popup_opened', { site: url.hostname }); // no personal data
    } catch { }
  } catch (err) {
    console.error('ReplyPals: Failed to open side panel', err);
  }
});

// ─── Online Check ───
async function checkOnline() {
  const timeoutMs = 12000;
  const urls = [
    `${API_BASE}/health`,
    `${API_ORIGIN}/health`,
    'https://www.replypals.in/api/health',
    'https://www.replypals.in/health',
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.ok) return true;
    } catch (_) {
      /* try next URL */
    }
  }
  return false;
}

let _cachedAnonId = null;

async function getOrCreateAnonId() {
  if (_cachedAnonId) return _cachedAnonId;
  const { replypalAnonId } = await chrome.storage.local.get('replypalAnonId');
  if (replypalAnonId) {
    _cachedAnonId = replypalAnonId;
    return replypalAnonId;
  }
  const anonId = crypto.randomUUID();
  await chrome.storage.local.set({ replypalAnonId: anonId });
  _cachedAnonId = anonId;
  return anonId;
}

/** Use client-supplied event_id for dedup on retries; never replace a non-empty payload id. */
function pickEventId(payload) {
  const e = payload && payload.event_id;
  if (e != null && String(e).trim().length >= 8) return String(e).trim();
  return crypto.randomUUID();
}

/** Persist quota fields from a successful /rewrite or /generate JSON body (single source of truth). */
async function persistQuotaFromRewriteResponse(data) {
  if (!data || typeof data !== 'object') return;
  const patch = {};
  if (typeof data.plan === 'string' && data.plan.length) {
    patch.replypalPlan = data.plan;
  }
  if (typeof data.rewrites_used === 'number') {
    patch.replypalCount = data.rewrites_used;
    patch.replypalUsageUsed = data.rewrites_used;
  }
  if (typeof data.rewrites_limit === 'number') {
    const limit = data.rewrites_limit;
    patch.replypalUsageLimit = limit;
    patch.replypalRewritesLimit = limit;
    let bonus = 0;
    if (data.plan === 'anon') {
      bonus = 0;
    } else if (typeof data.bonus_rewrites === 'number') {
      bonus = Math.max(0, data.bonus_rewrites);
    } else if (typeof data.monthly_base_limit === 'number') {
      bonus = Math.max(0, limit - data.monthly_base_limit);
    } else {
      bonus = Math.max(0, limit - 10);
    }
    patch.replypalBonusRewrites = bonus;
  }
  if (typeof data.monthly_base_limit === 'number') {
    patch.replypalMonthlyBaseLimit = data.monthly_base_limit;
  }
  if (typeof data.rewrites_left === 'number') {
    patch.replypalUsageLeft = data.rewrites_left;
  } else if (typeof data.rewrites_used === 'number' && typeof data.rewrites_limit === 'number') {
    patch.replypalUsageLeft = Math.max(0, data.rewrites_limit - data.rewrites_used);
  }
  if (Object.keys(patch).length) {
    await chrome.storage.local.set(patch);
  }
}

async function syncFreeUsageSnapshot(emailHint = null, anonHint = null) {
  try {
    const { replypalEmail, replypalUsageUsed, replypalUsageLimit } = await chrome.storage.local.get([
      'replypalEmail', 'replypalUsageUsed', 'replypalUsageLimit'
    ]);
    const anonId = anonHint || await getOrCreateAnonId();
    const payload = {
      email: emailHint || replypalEmail || null,
      anon_id: anonId,
    };
    const snap = await handleCheckFreeUsage(payload);
    if (snap && snap.success !== false) {
      const currentUsed = Number(replypalUsageUsed || 0);
      const serverUsed = Number(snap.rewrites_used || 0);
      const mergedUsed = Math.max(currentUsed, serverUsed);
      const limit = Number(snap.rewrites_limit || replypalUsageLimit || 10);
      const mergedLeft = Math.max(0, limit - mergedUsed);
      let bonus = 0;
      if (snap.plan === 'anon') {
        bonus = 0;
      } else if (typeof snap.bonus_rewrites === 'number') {
        bonus = Math.max(0, snap.bonus_rewrites);
      } else {
        const base = typeof snap.monthly_base_limit === 'number' ? snap.monthly_base_limit : 10;
        bonus = Math.max(0, limit - base);
      }
      const patch = {
        replypalUsageUsed: mergedUsed,
        replypalCount: mergedUsed,
        replypalUsageLimit: limit,
        replypalUsageLeft: mergedLeft,
        replypalRewritesLimit: limit,
        replypalBonusRewrites: bonus,
        replypalMonthlyBaseLimit: typeof snap.monthly_base_limit === 'number' ? snap.monthly_base_limit : undefined,
      };
      if (typeof snap.plan === 'string') patch.replypalPlan = snap.plan;
      await chrome.storage.local.set(patch);
    }
  } catch (_) { }
}

// ─── Analytics (Mixpanel via HTTP) ───
// Injected at build time via build script (see scripts/build.sh)
const injectedMixpanelToken = (BUILD_TIME_MIXPANEL_TOKEN && !BUILD_TIME_MIXPANEL_TOKEN.startsWith('__'))
  ? BUILD_TIME_MIXPANEL_TOKEN
  : '';

const MIXPANEL_TOKEN = injectedMixpanelToken || '';

async function track(event, properties = {}) {
  try {
    const { replypalUserId } = await chrome.storage.local.get('replypalUserId');
    let userId = replypalUserId;
    if (!userId) {
      userId = crypto.randomUUID();
      await chrome.storage.local.set({ replypalUserId: userId });
    }
    const payload = {
      event,
      properties: {
        token: MIXPANEL_TOKEN,
        distinct_id: userId,
        time: Math.floor(Date.now() / 1000),
        $insert_id: crypto.randomUUID(),
        ...properties
      }
    };
    const encoded = btoa(JSON.stringify(payload));
    fetch(`https://api.mixpanel.com/track?data=${encoded}`, { method: 'GET' });
  } catch {
    // Analytics failure must never affect app behavior
  }
}

// ─── Message Listener ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let responded = false;
  const safeRespond = (data) => {
    if (!responded) {
      responded = true;
      try { sendResponse(data); } catch (e) { /* channel already closed */ }
    }
  };
  const timeout = setTimeout(() => safeRespond({ success: false, error: 'timeout', message: 'Request timed out — please try again' }), 25000);
  const wrapped = (data) => { clearTimeout(timeout); safeRespond(data); };

  if (message.type === 'openPanel' || message.action === 'openPopup') {
    chrome.sidePanel.open({ tabId: sender.tab?.id }).catch(console.error);
    clearTimeout(timeout);
    safeRespond({ success: true });
    return false;
  }

  if (message.type === 'rewrite' || message.type === 'generateReply') {
    if (message.type === 'generateReply') {
      message.payload.mode = 'reply';
    }
    handleRewrite(message.payload)
      .then(wrapped)
      .catch(err => wrapped({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'generate') {
    handleGenerate(message.payload)
      .then(wrapped)
      .catch(err => wrapped({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'createCheckout') {
    handleCreateCheckout(message.payload)
      .then(wrapped)
      .catch(err => wrapped({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'createCreditsCheckout') {
    handleCreateCreditsCheckout(message.payload)
      .then(wrapped)
      .catch(err => wrapped({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'verifyLicense') {
    handleVerifyLicense(message.payload)
      .then(wrapped)
      .catch(err => wrapped({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'checkUsage') {
    handleCheckUsage(message.payload)
      .then(wrapped)
      .catch(err => wrapped({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'getAnonId') {
    getOrCreateAnonId()
      .then((anonId) => wrapped({ success: true, anon_id: anonId }))
      .catch((err) => wrapped({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'checkFreeUsage') {
    handleCheckFreeUsage(message.payload)
      .then(wrapped)
      .catch(err => wrapped({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'saveEmail') {
    handleSaveEmail(message.payload)
      .then(wrapped)
      .catch(err => wrapped({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'registerReferral') {
    handleRegisterReferral(message.payload)
      .then(wrapped)
      .catch(err => wrapped({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'addTeamMember') {
    handleAddTeamMember(message.payload)
      .then(wrapped)
      .catch(err => wrapped({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'getTeamStats') {
    handleGetTeamStats(message.payload)
      .then(wrapped)
      .catch(err => wrapped({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'fetchPricing') {
    handleFetchPricing()
      .then(wrapped)
      .catch(err => wrapped({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'getReferralLink') {
    handleGetReferralLink()
      .then(wrapped)
      .catch(err => wrapped({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'track') {
    track(message.event, message.properties || {}); // no personal data
    clearTimeout(timeout);
    safeRespond({ success: true });
    return false;
  }

  if (message.type === 'selectionAction') {
    handleSelectionAction(message.payload)
      .then(wrapped)
      .catch(err => wrapped({ success: false, error: err.message }));
    return true;
  }

  // Unknown message type — respond immediately so channel closes cleanly
  clearTimeout(timeout);
  safeRespond({ success: false, error: 'unknown_type' });
  return false;
});

// ─── External Messaging (from Dashboard) ───
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!isAllowedExternalSender(sender)) {
    sendResponse({ success: false, error: 'forbidden_origin' });
    return false;
  }
  if (message.type === 'setSupabaseSession') {
    chrome.storage.local.set({ replypalSupabaseToken: message.token })
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async
  }
});

// ─── API Handlers ───
async function handleRewrite(payload) {
  // Check online first
  const online = await checkOnline();
  if (!online) {
    return {
      success: false,
      error: 'offline',
      message: 'ReplyPals is offline. Check your connection.'
    };
  }

  try {
    const { replypalSupabaseToken, replypalEmail } = await chrome.storage.local.get(['replypalSupabaseToken', 'replypalEmail']);
    const anonId = await getOrCreateAnonId();
    const headers = { 'Content-Type': 'application/json' };
    if (replypalSupabaseToken) {
      headers['Authorization'] = 'Bearer ' + replypalSupabaseToken;
    }

    const res = await fetch(`${API_BASE}/rewrite`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        ...payload,
        email: payload.email || replypalEmail || null,
        anon_id: payload.anon_id != null && payload.anon_id !== '' ? payload.anon_id : anonId,
        event_id: pickEventId(payload),
        source: payload.source || 'popup',   // popup | content_input | voice
      })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const msg = formatFastApiDetail(errorData) || `Server error: ${res.status}`;
      throw new Error(msg);
    }
    const data = await res.json();

    // Track analytics — no personal data
    track('rewrite_completed', { tone: payload.tone, score: data.score, mode: payload.mode || 'rewrite' });

    // Track score
    if (data.score) {
      const storeObj = await chrome.storage.local.get('replypalScores');
      const scores = storeObj.replypalScores || [];
      const today = new Date().toISOString().split('T')[0];
      scores.push({
        score: data.score,
        date: today,
        tone: payload.tone,
        tip: data.tip || null
      });
      if (scores.length > 50) scores.splice(0, scores.length - 50);
      await chrome.storage.local.set({ replypalScores: scores });

      // Cache last 5 rewrites
      const cacheObj = await chrome.storage.local.get('replypalCache');
      const cache = cacheObj.replypalCache || [];
      cache.push({
        input: (payload.text || '').substring(0, 200),
        output: (data.rewritten || '').substring(0, 200),
        tone: payload.tone,
        score: data.score,
        timestamp: Date.now()
      });
      if (cache.length > 5) cache.splice(0, cache.length - 5);
      await chrome.storage.local.set({ replypalCache: cache });

      // Badge logic
      const todayScores = scores.filter(s => s.date === today);
      if (todayScores.length > 0) {
        const avg = todayScores.reduce((sum, s) => sum + s.score, 0) / todayScores.length;
        if (avg < 70) {
          chrome.action.setBadgeText({ text: '!' });
          chrome.action.setBadgeBackgroundColor({ color: '#E85D26' });
        } else if (avg >= 80) {
          chrome.action.setBadgeText({ text: '' });
        }
      }
    }

    if (typeof data.rewrites_used === 'number' || typeof data.rewrites_limit === 'number' || typeof data.rewrites_left === 'number') {
      await persistQuotaFromRewriteResponse(data);
    } else {
      await syncFreeUsageSnapshot(payload.email || null, payload.anon_id || null);
    }

    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleGenerate(payload) {
  const online = await checkOnline();
  if (!online) {
    return {
      success: false,
      error: 'offline',
      message: 'ReplyPals is offline. Check your connection.'
    };
  }

  try {
    const { replypalEmail, replypalSupabaseToken } = await chrome.storage.local.get(['replypalEmail', 'replypalSupabaseToken']);
    const anonId = await getOrCreateAnonId();
    const headers = { 'Content-Type': 'application/json' };
    if (replypalSupabaseToken) {
      headers['Authorization'] = 'Bearer ' + replypalSupabaseToken;
    }
    const res = await fetch(`${API_BASE}/generate`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        ...payload,
        email: payload.email || replypalEmail || null,
        anon_id: payload.anon_id != null && payload.anon_id !== '' ? payload.anon_id : anonId,
        event_id: pickEventId(payload),
      })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      let msg = errorData.detail || `Server error: ${res.status}`;
      if (typeof msg === 'object') msg = JSON.stringify(msg);
      throw new Error(msg);
    }
    const data = await res.json();

    // Track score
    if (data.score) {
      const storeObj = await chrome.storage.local.get('replypalScores');
      const scores = storeObj.replypalScores || [];
      const today = new Date().toISOString().split('T')[0];
      scores.push({ score: data.score, date: today, tone: payload.tone, tip: null });
      if (scores.length > 50) scores.splice(0, scores.length - 50);
      await chrome.storage.local.set({ replypalScores: scores });
    }
    if (typeof data.rewrites_used === 'number' || typeof data.rewrites_limit === 'number' || typeof data.rewrites_left === 'number') {
      await persistQuotaFromRewriteResponse(data);
    } else {
      await syncFreeUsageSnapshot(payload.email || null, payload.anon_id || null);
    }
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function parseJwtSub(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = JSON.parse(atob(b64));
    const sub = json.sub;
    return typeof sub === 'string' && sub.length >= 10 ? sub : null;
  } catch {
    return null;
  }
}

async function handleCreateCreditsCheckout(payload) {
  const online = await checkOnline();
  if (!online) {
    return { success: false, error: 'offline', message: 'ReplyPals is offline. Check your connection.' };
  }
  const { replypalSupabaseToken, replypalEmail } = await chrome.storage.local.get([
    'replypalSupabaseToken',
    'replypalEmail',
  ]);
  const userId = parseJwtSub(replypalSupabaseToken);
  if (!userId) {
    return {
      success: false,
      error: 'signin_required',
      message: 'Sign in with ReplyPals (dashboard → connect extension) to buy credits.',
    };
  }
  const email = (payload && payload.email) || replypalEmail || '';
  if (!email || !email.includes('@')) {
    return {
      success: false,
      error: 'email_required',
      message: 'Enter your email above or save it in the extension.',
    };
  }
  const bk = (payload && payload.bundle_key) || '';
  if (!bk) {
    return { success: false, error: 'bad_request', message: 'Missing bundle.' };
  }
  const cc = (payload && (payload.country_code || payload.country))
    ? String(payload.country_code || payload.country).trim().slice(0, 2).toUpperCase()
    : 'US';
  try {
    const res = await fetch(`${API_BASE}/checkout/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bundle_key: bk,
        country_code: cc || 'US',
        email: email.trim(),
        user_id: userId,
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const detail = errorData.detail;
      const msg = typeof detail === 'string' ? detail : (detail && JSON.stringify(detail)) || `Server error: ${res.status}`;
      throw new Error(msg);
    }
    const data = await res.json();
    track('credits_checkout_started', { bundle: bk });
    return { success: true, url: data.url || data.checkout_url };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleCreateCheckout(payload) {
  const online = await checkOnline();
  if (!online) {
    return { success: false, error: 'offline', message: 'ReplyPals is offline. Check your connection.' };
  }
  try {
    const { replypalSupabaseToken } = await chrome.storage.local.get(['replypalSupabaseToken']);
    const sessionUserId = parseJwtSub(replypalSupabaseToken);
    const body = {
      email: payload.email,
      plan: payload.plan,
      tier: payload.tier || 'tier1',
      country_code: (payload.country_code || payload.country || 'US').toString().trim().slice(0, 2).toUpperCase() || 'US',
    };
    if (payload.currency_code) {
      body.currency_code = String(payload.currency_code).trim().toLowerCase();
    }
    if (payload.user_id) {
      body.user_id = payload.user_id;
    } else if (sessionUserId) {
      body.user_id = sessionUserId;
    }
    const res = await fetch(`${API_BASE}/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `Server error: ${res.status}`);
    }
    const data = await res.json();
    track('upgrade_clicked', { plan: payload.plan }); // no personal data
    return { success: true, url: data.url };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleVerifyLicense(payload) {
  const online = await checkOnline();
  if (!online) {
    return { success: false, error: 'offline', message: 'ReplyPals is offline. Check your connection.' };
  }
  try {
    const res = await fetch(`${API_BASE}/verify-license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `Server error: ${res.status}`);
    }
    const data = await res.json();
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleCheckUsage(payload) {
  const online = await checkOnline();
  if (!online) {
    return { success: false, error: 'offline', message: 'ReplyPals is offline. Check your connection.' };
  }
  try {
    const res = await fetch(`${API_BASE}/check-usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `Server error: ${res.status}`);
    }
    const data = await res.json();
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleCheckFreeUsage(payload) {
  const online = await checkOnline();
  if (!online) {
    return { success: false, error: 'offline', message: 'ReplyPals is offline. Check your connection.' };
  }
  try {
    const res = await fetch(`${API_BASE}/free-usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `Server error: ${res.status}`);
    }
    const data = await res.json();
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleSaveEmail(payload) {
  const online = await checkOnline();
  if (!online) {
    return { success: false, error: 'offline', message: 'ReplyPals is offline. Check your connection.' };
  }
  try {
    const res = await fetch(`${API_BASE}/save-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `Server error: ${res.status}`);
    }
    const data = await res.json();
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleRegisterReferral(payload) {
  const online = await checkOnline();
  if (!online) {
    return { success: false, error: 'offline', message: 'ReplyPals is offline. Check your connection.' };
  }
  try {
    const res = await fetch(`${API_BASE}/register-referral`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const msg = formatFastApiDetail(errorData) || errorData.detail || `Server error: ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    const data = await res.json();
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleAddTeamMember(payload) {
  try {
    const res = await fetch(`${API_BASE}/add-team-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `Server error: ${res.status}`);
    }
    const data = await res.json();
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleGetTeamStats(payload) {
  try {
    const res = await fetch(`${API_BASE}/team-stats`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-License-Key': payload.license_key
      }
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `Server error: ${res.status}`);
    }
    const data = await res.json();
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleFetchPricing() {
  // Default tier1 pricing as fallback
  const FALLBACK = {
    country: 'US', tier: 'tier1', currency: 'usd', note: null, vpn_detected: false,
    plans: {
      starter: { display: '$2', per: '/mo', currency: 'usd' },
      pro: { display: '$9', per: '/mo', currency: 'usd' },
      growth: { display: '$15', per: '/mo', currency: 'usd' },
      team: { display: '$25', per: '/mo', currency: 'usd' },
    },
    plan_limit_labels: {
      starter: '25 rewrites/mo',
      pro: '300 rewrites/mo',
      growth: '750 rewrites/mo',
      team: '150/mo · 15/day',
    },
    credit_bundles: {},
  };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${API_BASE}/pricing`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    if (!res.ok) return { success: true, ...FALLBACK };
    const data = await res.json();
    return { success: true, ...data };
  } catch (err) {
    return { success: true, ...FALLBACK };
  }
}

async function handleGetReferralLink() {
  const { replypalSupabaseToken, replypalRefCode } = await chrome.storage.local.get([
    'replypalSupabaseToken',
    'replypalRefCode',
  ]);

  // Prefer canonical backend-issued referral code when authenticated.
  if (replypalSupabaseToken) {
    try {
      const res = await fetch(`${API_BASE}/account/referral`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${replypalSupabaseToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && data.referral_url) {
        if (data.ref_code) {
          await chrome.storage.local.set({ replypalRefCode: data.ref_code });
        }
        return {
          success: true,
          referral_url: data.referral_url,
          ref_code: data.ref_code || null,
          source: 'backend',
        };
      }
    } catch (_) {
      // Fall through to local fallback.
    }
  }

  // Fallback: keep flow usable, but indicate local link may not carry rewards.
  const code = (replypalRefCode || 'XXXXXXXX').toString().trim();
  return {
    success: true,
    referral_url: `${API_ORIGIN}/signup?ref=${encodeURIComponent(code)}`,
    ref_code: code,
    source: 'local',
    warning: 'Sign in on dashboard to sync referral rewards.',
  };
}

// ─── Selection Action Handler ───
async function handleSelectionAction(payload) {
  const online = await checkOnline();
  if (!online) {
    return { success: false, error: 'offline', message: 'ReplyPals is offline. Check your connection.' };
  }

  const { text, mode, tone, language, targetLang, targetLangName, targetLangCode } = payload;
  const normalizedMode = (mode === 'explain') ? 'meaning' : mode;
  if (!text || !text.trim()) {
    return { success: false, error: 'No text provided' };
  }

  // Default tone per mode; if tone param is explicitly passed (Change Tone), use it
  const toneMap = {
    rewrite:   'Confident',
    reply:     'Friendly',
    summary:   'Formal',
    meaning:   'Friendly',
    fix:       'Formal',
    translate: 'Formal',
  };
  const activeTone = tone || toneMap[normalizedMode] || 'Friendly';

  // For translate mode, embed target language in the text field so the API prompt includes it
  const targetLanguage = targetLangName || targetLang || targetLangCode || 'English';
  const effectiveText = (normalizedMode === 'translate')
    ? `[Translate to ${targetLanguage}]\n${text}`
    : text;

  try {
    const { replypalSupabaseToken, replypalLicense, replypalEmail } = await chrome.storage.local.get([
      'replypalSupabaseToken', 'replypalLicense', 'replypalEmail'
    ]);
    const anonId = await getOrCreateAnonId();

    const headers = { 'Content-Type': 'application/json' };
    if (replypalSupabaseToken) {
      headers['Authorization'] = 'Bearer ' + replypalSupabaseToken;
    }

    const bodyJson = JSON.stringify({
      text:        effectiveText,
      tone:        activeTone,
      language:    language || 'auto',
      email:       replypalEmail || null,
      anon_id:     payload.anon_id != null && payload.anon_id !== '' ? payload.anon_id : anonId,
      event_id:    pickEventId(payload),
      license_key: replypalLicense || null,
      mode:        normalizedMode,
      source:      'content_selection',
    });
    const controller = new AbortController();
    const tid = setTimeout(function () { controller.abort(); }, 120000);
    let res;
    try {
      res = await fetch(`${API_BASE}/rewrite`, {
        method: 'POST',
        headers: headers,
        signal: controller.signal,
        body: bodyJson,
      });
    } finally {
      clearTimeout(tid);
    }

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const msg = formatFastApiDetail(errorData) || `Server error: ${res.status}`;
      throw new Error(msg);
    }

    const data = await res.json();
    track('selection_action', { mode: normalizedMode, score: data.score }); // no personal data
    if (typeof data.rewrites_used === 'number' || typeof data.rewrites_limit === 'number' || typeof data.rewrites_left === 'number') {
      await persistQuotaFromRewriteResponse(data);
    } else {
      await syncFreeUsageSnapshot(replypalEmail || null, anonId);
    }
    return { success: true, data };
  } catch (err) {
    const name = err && err.name;
    const msg = err && err.message;
    if (name === 'AbortError' || (msg && /aborted/i.test(msg))) {
      return { success: false, error: 'Request timed out. Check your connection and try again.' };
    }
    return { success: false, error: msg || 'Request failed' };
  }
}

