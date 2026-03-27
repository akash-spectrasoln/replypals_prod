// ─── ReplyPals Background Service Worker ───
// API base — set REPLYPAL_API_URL at build time for production packages.
// Defaults keep local dev simple while making unpacked builds work in production.
const DEV_API_BASE = 'http://' + 'localhost' + ':8150';
const PROD_API_BASE = 'https://www.replypals.in';
const IS_DEV_BUILD = chrome.runtime.getManifest?.().update_url === undefined;

const API_BASE = (typeof REPLYPAL_API_URL !== 'undefined' && REPLYPAL_API_URL)
  ? REPLYPAL_API_URL
  : (IS_DEV_BUILD ? DEV_API_BASE : PROD_API_BASE);

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
  try {
    const r = await fetch(API_BASE + '/health', {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function getOrCreateAnonId() {
  const { replypalAnonId } = await chrome.storage.local.get('replypalAnonId');
  if (replypalAnonId) return replypalAnonId;
  const anonId = crypto.randomUUID();
  await chrome.storage.local.set({ replypalAnonId: anonId });
  return anonId;
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
      const limit = Number(snap.rewrites_limit || replypalUsageLimit || 5);
      await chrome.storage.local.set({
        replypalUsageUsed: mergedUsed,
        replypalUsageLimit: limit,
        replypalUsageLeft: Math.max(0, limit - mergedUsed),
      });
    }
  } catch (_) { }
}

// ─── Analytics (Mixpanel via HTTP) ───
// Injected at build time via build script (see scripts/build.sh)
const MIXPANEL_TOKEN = (typeof __MIXPANEL_TOKEN__ !== 'undefined') ? __MIXPANEL_TOKEN__ : '';

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
        anon_id: payload.anon_id || anonId,
        event_id: payload.event_id || crypto.randomUUID(),
        source: payload.source || 'popup',   // popup | content_input | voice
      })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      let msg = errorData.detail || `Server error: ${res.status}`;
      if (typeof msg === 'object') msg = JSON.stringify(msg);
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

    // Keep popup counters synced with any surface (popup, R-sign, bulb, selection).
    await syncFreeUsageSnapshot(payload.email || null, payload.anon_id || null);

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
        anon_id: payload.anon_id || anonId,
        event_id: payload.event_id || crypto.randomUUID(),
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
    await syncFreeUsageSnapshot(payload.email || null, payload.anon_id || null);
    return { success: true, data };
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
    const res = await fetch(`${API_BASE}/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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
  try {
    const res = await fetch(`${API_BASE}/register-referral`, {
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
      team: { display: '$25', per: '/mo', currency: 'usd' },
    }
  };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${API_BASE}/pricing`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return { success: true, ...FALLBACK };
    const data = await res.json();
    return { success: true, ...data };
  } catch (err) {
    return { success: true, ...FALLBACK };
  }
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

    const res = await fetch(`${API_BASE}/rewrite`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        text:        effectiveText,
        tone:        activeTone,
        language:    language || 'auto',
        email:       replypalEmail || null,
        anon_id:     anonId,
        event_id:    crypto.randomUUID(),
        license_key: replypalLicense || null,
        mode:        normalizedMode,
        source:      'content_selection',
      })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      let msg = errorData.detail || `Server error: ${res.status}`;
      if (typeof msg === 'object') msg = JSON.stringify(msg);
      throw new Error(msg);
    }

    const data = await res.json();
    track('selection_action', { mode: normalizedMode, score: data.score }); // no personal data
    await syncFreeUsageSnapshot(replypalEmail || null, anonId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

