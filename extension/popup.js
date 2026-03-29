// ═══════════════════════════════════════════
// ReplyPals — Side Panel Logic
// ═══════════════════════════════════════════
(function () {
  'use strict';

  // ─── Safe chrome.runtime.sendMessage wrapper ───
  // Prevents "message channel closed" console errors that happen when
  // the side panel closes or the page navigates before a response arrives.
  function safeSendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          // Suppress chrome.runtime.lastError to avoid uncaught promise errors
          void chrome.runtime.lastError;
          resolve(response || { success: false, error: 'no_response' });
        });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  }
  /** Fallback only until /free-usage returns; keep aligned with API default free monthly cap */
  const FREE_LIMIT_BASE = 10;

  // ─── DOM Elements ───
  const inputText = document.getElementById('inputText');
  const charCount = document.getElementById('charCount');
  const toneGrid = document.getElementById('toneGrid');
  const languageSelect = document.getElementById('languageSelect');
  const rewriteBtn = document.getElementById('rewriteBtn');
  const rewriteBtnText = document.getElementById('rewriteBtnText');
  const outputCard = document.getElementById('outputCard');
  const outputText = document.getElementById('outputText');
  const scoreBadge = document.getElementById('scoreBadge');
  const tipBox = document.getElementById('tipBox');
  const tipText = document.getElementById('tipText');
  const subjectBar = document.getElementById('subjectBar');
  const quickPrompts = document.getElementById('quickPrompts');
  const inputLabel = document.getElementById('inputLabel');
  const copyBtn = document.getElementById('copyBtn');
  const copyBtnText = document.getElementById('copyBtnText');
  const tryAgainBtn = document.getElementById('tryAgainBtn');
  const usageBadge = document.getElementById('usageBadge');
  const usageText = document.getElementById('usageText');
  const privacyBar = document.getElementById('privacy-bar');
  const toastContainer = document.getElementById('toastContainer');
  const templatesContent = document.getElementById('templatesContent');
  const templateSearch = document.getElementById('templateSearch');
  const templatesList = document.getElementById('templatesList');
  const templateFormOverlay = document.getElementById('templateFormOverlay');

  // Upgrade overlay
  const upgradeOverlay = document.getElementById('upgradeOverlay');
  const plansGrid = document.getElementById('plansGrid');
  const checkoutEmail = document.getElementById('checkoutEmail');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const licenseInput = document.getElementById('licenseInput');
  const activateBtn = document.getElementById('activateBtn');
  const licenseError = document.getElementById('licenseError');
  const closeOverlay = document.getElementById('closeOverlay');

  // Email capture
  const emailCaptureCard = document.getElementById('emailCaptureCard');
  const emailCaptureInput = document.getElementById('emailCaptureInput');
  const emailCaptureBtn = document.getElementById('emailCaptureBtn');
  const emailCaptureDismiss = document.getElementById('emailCaptureDismiss');

  // Referral
  const referralCard = document.getElementById('referralCard');
  const referralCopyBtn = document.getElementById('referralCopyBtn');
  const referralWhatsappBtn = document.getElementById('referralWhatsappBtn');

  // Recent
  const recentSection = document.getElementById('recentSection');
  const recentToggle = document.getElementById('recentToggle');
  const recentList = document.getElementById('recentList');
  const recentChevron = document.getElementById('recentChevron');

  // ─── State ───
  let currentMode = 'rewrite';
  let currentTone = 'confident';
  let currentLanguage = 'auto';
  let useCount = 0;
  let bonusRewrites = 0;
  let licenseKey = null;
  let selectedPlan = 'pro'; // default featured
  let isLoading = false;
  let currentPlan = null; // 'starter' | 'pro' | 'team'
  let isTeamAdmin = false;
  let referralShownThisSession = false;
  let anonId = null;
  let serverRewriteCount = null;
  let usagePollTimer = null;
  /** Same semantics as content script: finite limit + zero left ⇒ block all actions. */
  let replypalUsageLeft = null;
  let replypalRewritesLimit = null;

  /** Derive bonus from API fields so it stays correct when monthly base cap is not 10. */
  function applyFreeTierBonusFromApiPayload(payload) {
    if (!payload || licenseKey) return;
    const lim = Number(payload.rewrites_limit != null ? payload.rewrites_limit : FREE_LIMIT_BASE);
    if (typeof payload.bonus_rewrites === 'number') {
      bonusRewrites = Math.max(0, payload.bonus_rewrites);
    } else {
      const base = typeof payload.monthly_base_limit === 'number' && payload.monthly_base_limit >= 0
        ? payload.monthly_base_limit
        : FREE_LIMIT_BASE;
      bonusRewrites = Math.max(0, lim - base);
    }
  }

  function isPopupQuotaBlockedSync() {
    if (typeof replypalRewritesLimit === 'number' && replypalRewritesLimit > 0) {
      if (typeof replypalUsageLeft === 'number' && replypalUsageLeft <= 0) return true;
    }
    if (!licenseKey) {
      const eff = (typeof replypalRewritesLimit === 'number' && replypalRewritesLimit > 0)
        ? replypalRewritesLimit
        : (FREE_LIMIT_BASE + bonusRewrites);
      return useCount >= eff;
    }
    return false;
  }

  async function refreshFreeUsageFromServer() {
    if (licenseKey) return;
    try {
      const { replypalEmail, replypalAnonId } = await chrome.storage.local.get(['replypalEmail', 'replypalAnonId']);
      anonId = replypalAnonId || anonId;
      if (!anonId) {
        const idResp = await safeSendMessage({ type: 'getAnonId' });
        if (idResp && idResp.success && idResp.anon_id) anonId = idResp.anon_id;
      }
      const freeResp = await safeSendMessage({
        type: 'checkFreeUsage',
        payload: { email: replypalEmail || null, anon_id: anonId }
      });
      if (freeResp && freeResp.success !== false) {
        const serverUsed = Number(freeResp.rewrites_used || 0);
        // Prevent stale async snapshots from rolling UI backward (e.g. 4 -> 5 left).
        useCount = Math.max(useCount, serverUsed);
        const serverLimit = Number(freeResp.rewrites_limit || FREE_LIMIT_BASE);
        applyFreeTierBonusFromApiPayload(freeResp);
        replypalRewritesLimit = serverLimit;
        serverRewriteCount = useCount;
        await chrome.storage.local.set({
          replypalCount: useCount,
          replypalBonusRewrites: bonusRewrites,
          replypalUsageLimit: serverLimit,
          replypalRewritesLimit: serverLimit,
          replypalMonthlyBaseLimit: typeof freeResp.monthly_base_limit === 'number' ? freeResp.monthly_base_limit : undefined
        });
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function startUsagePolling() {
    // Disabled: aggressive polling can read stale pre-log snapshots and cause badge rollbacks.
    if (usagePollTimer) clearInterval(usagePollTimer);
  }

  // ─── Init ───
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    if (typeof RP_TONES !== 'undefined') {
      toneGrid.innerHTML = RP_TONES.map(t => 
        `<button class="tone-btn" data-tone="${t.id.toLowerCase()}">${t.icon} ${t.id}</button>`
      ).join('');
    }
    if (typeof RP_LANGUAGES !== 'undefined') {
      languageSelect.innerHTML = RP_LANGUAGES.map(l =>
        `<option value="${l.code}">${l.label}</option>`
      ).join('');
    }

    const stored = await chrome.storage.local.get([
      'replypalCount',
      'replypalLicense',
      'replypalTone',
      'replypalLanguage',
      'replypalScores',
      'replypalCache',
      'replypalEmailSaved',
      'replypalEmailSkipped',
      'replypalBonusRewrites',
      'replypalRefCode',
      'replypalUsageUsed',
      'replypalUsageLimit',
      'replypalUsageLeft',
      'replypalRewritesLimit',
      'replypalMonthlyBaseLimit'
    ]);

    useCount = stored.replypalCount || 0;
    licenseKey = stored.replypalLicense || null;
    currentTone = stored.replypalTone || 'confident';
    currentLanguage = stored.replypalLanguage || 'auto';
    bonusRewrites = stored.replypalBonusRewrites || 0;
    if (typeof stored.replypalUsageUsed === 'number' && typeof stored.replypalUsageLimit === 'number') {
      useCount = Number(stored.replypalUsageUsed);
      applyFreeTierBonusFromApiPayload({
        rewrites_limit: Number(stored.replypalUsageLimit),
        bonus_rewrites: typeof stored.replypalBonusRewrites === 'number' ? stored.replypalBonusRewrites : undefined,
        monthly_base_limit: typeof stored.replypalMonthlyBaseLimit === 'number' ? stored.replypalMonthlyBaseLimit : undefined
      });
      serverRewriteCount = useCount;
    }
    if (typeof stored.replypalUsageLeft === 'number') replypalUsageLeft = stored.replypalUsageLeft;
    if (typeof stored.replypalRewritesLimit === 'number') replypalRewritesLimit = stored.replypalRewritesLimit;
    anonId = stored.replypalAnonId || null;
    if (!anonId) {
      const idResp = await safeSendMessage({ type: 'getAnonId' });
      if (idResp && idResp.success && idResp.anon_id) anonId = idResp.anon_id;
    }

    const scores = stored.replypalScores || [];

    // Auto tone logic
    const DEFAULT_TONE_MAP = {
      'mail.google.com': 'formal',
      'outlook.live.com': 'formal',
      'outlook.office.com': 'formal',
      'web.whatsapp.com': 'casual',
      'twitter.com': 'casual',
      'x.com': 'casual',
      'linkedin.com': 'confident',
      'slack.com': 'friendly',
      'notion.so': 'polite',
    };
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0] && tabs[0].url) {
        try {
          const url = new URL(tabs[0].url);
          const hostname = url.hostname;
          let suggestedTone = null;
          let note = '';
          const memory = stored.toneMemory || {};

          if (memory[hostname]) {
            suggestedTone = memory[hostname];
            note = '(remembered)';
          } else if (DEFAULT_TONE_MAP[hostname]) {
            suggestedTone = DEFAULT_TONE_MAP[hostname];
            note = '(auto)';
          }
          if (suggestedTone) {
            currentTone = suggestedTone;
            setActiveTone(currentTone);
            const activeBtn = toneGrid.querySelector('.tone-btn.active');
            if (activeBtn && note) {
              activeBtn.innerHTML = activeBtn.innerHTML + ` <span style="font-size:10px;opacity:0.8">${note}</span>`;
            }
          }
        } catch (e) { }
      }
    });

    // Restore UI state
    setActiveTone(currentTone);
    languageSelect.value = currentLanguage;

    // Check license and usage from server
    if (licenseKey) {
      try {
        const usageResp = await safeSendMessage({
          type: 'checkUsage',
          payload: { license_key: licenseKey }
        });
        if (usageResp && usageResp.success !== false && usageResp.plan) {
          currentPlan = usageResp.plan;
          isTeamAdmin = usageResp.is_admin || false;
          const lim = usageResp.limit;
          const usedMo = Number(usageResp.rewrites_this_month || 0);
          if (typeof lim === 'number' && lim > 0) {
            replypalRewritesLimit = lim;
            replypalUsageLeft = Math.max(0, lim - usedMo);
            await chrome.storage.local.set({
              replypalRewritesLimit: lim,
              replypalUsageLeft: replypalUsageLeft
            });
          } else if (typeof lim === 'number' && lim < 0) {
            replypalRewritesLimit = lim;
            replypalUsageLeft = null;
            await chrome.storage.local.set({
              replypalRewritesLimit: lim,
              replypalUsageLeft: null
            });
          }
        }
      } catch (e) { }
    } else {
      await refreshFreeUsageFromServer();
    }
    startUsagePolling();

    updateUsageDisplay();

    // Auto-fill from highlighted text (session storage)
    const session = await chrome.storage.session.get('replypalSelection');
    if (session.replypalSelection) {
      inputText.value = session.replypalSelection;
      updateCharCount();
      chrome.storage.session.remove('replypalSelection');
    }

    if (isPopupQuotaBlockedSync()) {
      showUpgradeOverlay(true);
    }

    // Mark default plan as selected
    selectPlan('pro');

    // Show email capture card if conditions met
    if (useCount >= 3 && !stored.replypalEmailSaved && !stored.replypalEmailSkipped && !licenseKey) {
      emailCaptureCard.style.display = 'block';
    }

    // Render recent rewrites
    const cache = stored.replypalCache || [];
    if (cache.length > 0) {
      renderRecentRewrites(cache);
    }

    // Render progress card
    if (scores.length >= 3) {
      renderProgressCard(scores);
    }

    // Render templates
    renderTemplates();

    // Show team tab if team admin
    if (currentPlan === 'team' && isTeamAdmin) {
      loadTeamStats();
    }

    // Track popup opened — no personal data
    sendTrack('popup_opened', {});
    initPanelVoice();
  }

  // ─── Analytics helper ───
  function sendTrack(event, props) {
    try {
      chrome.runtime.sendMessage({ type: 'track', event, properties: props });
    } catch (e) { }
  }

  // ─── Toast ───
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 3000);
  }

  // ─── Usage Display ───
  function updateUsageDisplay() {
    if (licenseKey && currentPlan) {
      if (currentPlan === 'pro') {
        usageText.textContent = 'Unlimited ✨';
        usageBadge.classList.add('pro');
      } else if (currentPlan === 'team') {
        usageText.textContent = 'Team · Unlimited';
        usageBadge.classList.add('pro');
      } else if (currentPlan === 'starter') {
        usageText.textContent = 'Starter';
        usageBadge.classList.add('pro');
      } else {
        usageText.textContent = 'PRO';
        usageBadge.classList.add('pro');
      }
    } else if (licenseKey) {
      usageText.textContent = 'PRO';
      usageBadge.classList.add('pro');
    } else {
      const effectiveLimit = (typeof replypalRewritesLimit === 'number' && replypalRewritesLimit > 0)
        ? replypalRewritesLimit
        : (FREE_LIMIT_BASE + bonusRewrites);
      const remaining = Math.max(0, effectiveLimit - useCount);
      usageText.textContent = `${remaining} free left`;
      usageBadge.classList.remove('pro');
    }
  }

  // ─── Character Counter ───
  inputText.addEventListener('input', updateCharCount);

  function updateCharCount() {
    const len = inputText.value.length;
    charCount.textContent = `${len.toLocaleString()} / 5,000`;
  }

  // ─── Tone Buttons ───
  toneGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.tone-btn');
    if (!btn) return;
    const tone = btn.dataset.tone;
    setActiveTone(tone);
    currentTone = tone;
    sendTrack('tone_selected', { tone }); // no personal data
    try { chrome.storage.local.set({ replypalTone: tone }); } catch (e) { }
  });

  function setActiveTone(tone) {
    toneGrid.querySelectorAll('.tone-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tone === tone);
    });
  }

  // ─── Language Select ───
  languageSelect.addEventListener('change', () => {
    currentLanguage = languageSelect.value;
    try { chrome.storage.local.set({ replypalLanguage: currentLanguage }); } catch (e) { }
  });

  // ─── Privacy Bar ───
  privacyBar.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://replypals.in/privacy' });
  });

  // ─── Mode Switching & Quick Prompts ───
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      currentMode = e.target.dataset.mode;

      outputCard.classList.remove('visible');

      // Show/hide sections based on mode
      const rewriteSections = [
        document.getElementById('inputCard'),
        document.getElementById('toneCard'),
        document.getElementById('langCard'),
        rewriteBtn,
        emailCaptureCard
      ];
      const templatesSection = templatesContent;

      if (currentMode === 'templates') {
        rewriteSections.forEach(el => { if (el) el.style.display = 'none'; });
        templatesSection.style.display = 'block';
        templateFormOverlay.style.display = 'none';
      } else {
        rewriteSections.forEach(el => { if (el) el.style.display = ''; });
        templatesSection.style.display = 'none';

        inputText.value = '';
        updateCharCount();

        if (currentMode === 'generate') {
          inputLabel.textContent = 'What do you need to write?';
          inputText.placeholder = 'e.g. Leave request for 26th and 7th of this month';
          quickPrompts.style.display = 'flex';
          rewriteBtn.innerHTML = '<span id="rewriteBtnText">⚡ Generate</span>';
        } else {
          inputLabel.textContent = 'Your Text';
          inputText.placeholder = 'Highlight text on any page, or paste here…';
          quickPrompts.style.display = 'none';
          rewriteBtn.innerHTML = '<svg class="bolt-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg><span id="rewriteBtnText">Rewrite Now</span>';
        }
      }
    });
  });

  quickPrompts.addEventListener('click', (e) => {
    if (e.target.classList.contains('quick-chip')) {
      const tmpl = e.target.dataset.template;
      inputText.value = tmpl;
      updateCharCount();
      inputText.focus();
      inputText.setSelectionRange(tmpl.length, tmpl.length);
    }
  });

  // ─── Rewrite / Generate Button ───
  rewriteBtn.addEventListener('click', () => handleRewrite(true));

  async function handleRewrite(shouldCount = true) {
    if (isLoading) return;

    if (shouldCount && isPopupQuotaBlockedSync()) {
      showUpgradeOverlay(true);
      sendTrack('upgrade_shown', { trigger: 'limit_reached' }); // no personal data
      return;
    }

    const text = inputText.value.trim();
    if (!text) {
      inputText.focus();
      inputText.style.borderColor = 'var(--red)';
      setTimeout(() => { inputText.style.borderColor = ''; }, 1500);
      return;
    }

    window.lastOriginalText = text;
    setLoading(true);

    try {
      const actionType = currentMode === 'generate' ? 'generate' : 'rewrite';
      const payload = {
        tone: currentTone,
        license_key: licenseKey,
        event_id: crypto.randomUUID(),
        anon_id: anonId || null,
      };

      if (currentMode === 'generate') {
        payload.prompt = text;
      } else {
        payload.text = text;
        payload.language = currentLanguage;
      }

      // Add email if saved
      const { replypalEmail } = await chrome.storage.local.get('replypalEmail');
      if (replypalEmail) {
        payload.email = replypalEmail;
      }

      sendTrack('rewrite_triggered', { tone: currentTone, mode: actionType }); // no personal data

      let response;
      try {
        response = await safeSendMessage({ type: actionType, payload });
      } catch (msgErr) {
        throw new Error('Extension communication error. Try reloading the page.');
      }

      // Handle errors from background.js
      if (response?.error === 'offline') {
        showToast('🔴 ReplyPals offline — check your connection', 'error');
        setLoading(false);
        return;
      }
      if (response?.error === 'timeout') {
        showToast('⏱ Request timed out — please try again', 'error');
        setLoading(false);
        return;
      }

      if (response?.success && response.data) {
        showResult(response.data);

        if (shouldCount) {
          if (!licenseKey) {
            // Use quota numbers returned directly in API response.
            // These come from rate_ctx (pre-log-write) so they are always correct.
            // Never call free-usage immediately — it reads llm_call_logs which has
            // an async write lag and will return stale (old) count, resetting the display.
            const apiUsed  = response.data?.rewrites_used;
            const apiLimit = response.data?.rewrites_limit;
            if (typeof apiUsed === 'number' && typeof apiLimit === 'number') {
              useCount = apiUsed;
              applyFreeTierBonusFromApiPayload({
                rewrites_limit: apiLimit,
                monthly_base_limit: response.data?.monthly_base_limit,
                bonus_rewrites: response.data?.bonus_rewrites
              });
              replypalRewritesLimit = apiLimit;
              serverRewriteCount = useCount;
              await chrome.storage.local.set({
                replypalCount: useCount,
                replypalBonusRewrites: bonusRewrites,
                replypalUsageLimit: apiLimit,
                replypalRewritesLimit: apiLimit,
                replypalMonthlyBaseLimit: response.data?.monthly_base_limit
              });
            } else {
              useCount++;
              serverRewriteCount = useCount;
              await chrome.storage.local.set({ replypalCount: useCount });
            }
            updateUsageDisplay();

            // Only sync from server AFTER log write has had time to settle (~2s).
            setTimeout(async () => {
              await refreshFreeUsageFromServer();
              updateUsageDisplay();
            }, 2000);
            setTimeout(async () => {
              await refreshFreeUsageFromServer();
              updateUsageDisplay();
            }, 5000);
          } else if (licenseKey) {
            const apiLeft = response.data?.rewrites_left;
            const apiLim = response.data?.rewrites_limit;
            if (typeof apiLeft === 'number' && typeof apiLim === 'number') {
              replypalUsageLeft = apiLeft;
              replypalRewritesLimit = apiLim;
              await chrome.storage.local.set({
                replypalUsageLeft: apiLeft,
                replypalRewritesLimit: apiLim
              });
              updateUsageDisplay();
              if (isPopupQuotaBlockedSync()) {
                showUpgradeOverlay(true);
              }
            }
          }
          try {
            const s = await chrome.storage.local.get(['replypalScores', 'replypalCache']);
            renderRecentRewrites(s.replypalCache || []);
            renderProgressCard(s.replypalScores || []);
          } catch (_) { }
        }
      } else {
        if (response?.error) {
          showToast('⚠️ ' + response.error, 'error');
        }
        showError(response?.error || 'Something went wrong. Please try again.');
      }
    } catch (err) {
      showToast('⚠️ Something went wrong — try again', 'error');
      showError(err.message || 'Connection failed. Is the API running?');
    } finally {
      setLoading(false);
    }
  }

  function setLoading(loading) {
    isLoading = loading;
    rewriteBtn.disabled = loading;
    const boltIcon = rewriteBtn.querySelector('.bolt-icon');
    if (loading) {
      if (currentMode === 'generate') {
        rewriteBtn.innerHTML = '<span id="rewriteBtnText">Generating…</span>';
      } else {
        if (boltIcon) boltIcon.style.display = 'none';
        const existingSpinner = document.getElementById('loadingSpinner');
        if (!existingSpinner) {
          const spinner = document.createElement('div');
          spinner.className = 'spinner';
          spinner.id = 'loadingSpinner';
          const btnText = document.getElementById('rewriteBtnText');
          if (btnText) rewriteBtn.insertBefore(spinner, btnText);
        }
        const btnText2 = document.getElementById('rewriteBtnText');
        if (btnText2) btnText2.textContent = 'Rewriting…';
      }
    } else {
      const spinner = document.getElementById('loadingSpinner');
      if (spinner) spinner.remove();
      if (currentMode === 'generate') {
        rewriteBtn.innerHTML = '<span id="rewriteBtnText">⚡ Generate</span>';
      } else {
        const bi2 = rewriteBtn.querySelector('.bolt-icon');
        if (bi2) bi2.style.display = '';
        const btnText3 = document.getElementById('rewriteBtnText');
        if (btnText3) btnText3.textContent = 'Rewrite Now';
      }
    }
  }

  // ─── Show Result ───
  function showResult(data) {
    // Make card visible FIRST so scrollIntoView works reliably
    outputCard.classList.add('visible');
    outputText.value = data.rewritten || data.generated || '';
    outputText.removeAttribute('readonly');

    const score = data.score ?? 0;
    scoreBadge.textContent = `${score}/100 🎯`;
    scoreBadge.className = 'score-badge';
    if (score >= 80) scoreBadge.classList.add('green');
    else if (score >= 60) scoreBadge.classList.add('amber');
    else scoreBadge.classList.add('red');

    // Subject Bar
    if (data.subject) {
      subjectBar.style.display = 'block';
      subjectBar.textContent = `📧 Subject: ${data.subject}`;
    } else {
      subjectBar.style.display = 'none';
    }

    // Tip
    if (data.tip && currentMode !== 'generate') {
      tipBox.style.display = 'flex';
      tipText.textContent = data.tip;
    } else {
      tipBox.style.display = 'none';
    }

    // Explain section
    let explainDiv = document.getElementById('explainSection');
    if (!explainDiv) {
      explainDiv = document.createElement('div');
      explainDiv.id = 'explainSection';
      outputCard.appendChild(explainDiv);
    }

    if (currentMode === 'generate') {
      explainDiv.style.display = 'none';
    } else {
      explainDiv.style.display = 'block';
      const orig = window.lastOriginalText || '';
      explainDiv.innerHTML = `
        <div class="explain-toggle" id="explainToggle" style="margin-top:12px">
          <span>▶</span> <span>Why did this change?</span>
        </div>
        <div class="explain-content" id="explainContent">
          <div class="diff-original">${orig}</div>
          <div class="diff-result">${outputText.value}</div>
        </div>
      `;
      const tgl = explainDiv.querySelector('#explainToggle');
      const cnt = explainDiv.querySelector('#explainContent');
      tgl.addEventListener('click', () => {
        cnt.classList.toggle('open');
        tgl.querySelector('span').textContent = cnt.classList.contains('open') ? '▼' : '▶';
      });
    }

    // Referral card — show once per session if score >= 85
    if (score >= 85 && !referralShownThisSession) {
      referralShownThisSession = true;
      referralCard.style.display = 'block';
    } else {
      referralCard.style.display = 'none';
    }

    outputCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ─── Progress Card ───
  function renderProgressCard(scores) {
    if (scores.length < 3) return;

    const container = document.getElementById('progressCardContainer');
    container.innerHTML = '';

    // Calculate stats
    let totalSum = 0;
    scores.forEach(s => totalSum += s.score);
    const avg = Math.round(totalSum / scores.length);

    // This week scores
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const thisWeekScores = scores.filter(s => new Date(s.date) >= weekStart);

    // Last week scores
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekScores = scores.filter(s => {
      const d = new Date(s.date);
      return d >= lastWeekStart && d < weekStart;
    });

    const thisWeekAvg = thisWeekScores.length > 0
      ? Math.round(thisWeekScores.reduce((s, x) => s + x.score, 0) / thisWeekScores.length)
      : avg;
    const lastWeekAvg = lastWeekScores.length > 0
      ? Math.round(lastWeekScores.reduce((s, x) => s + x.score, 0) / lastWeekScores.length)
      : thisWeekAvg;

    // Improvement indicator
    let improvementHTML = '';
    const diff = thisWeekAvg - lastWeekAvg;
    if (diff > 0) {
      improvementHTML = `<span class="progress-improvement up">↑ +${diff} from last week 🎉</span>`;
    } else if (diff === 0) {
      improvementHTML = `<span class="progress-improvement same">→ Consistent this week</span>`;
    } else {
      improvementHTML = `<span class="progress-improvement down">↓ Keep practicing!</span>`;
    }

    // Most common issue from tips
    const last20 = scores.slice(-20);
    const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'was', 'were', 'be', 'been', 'being', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'and', 'or', 'but', 'not', 'no', 'it', 'this', 'that', 'from', 'by', 'as', 'are', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'can']);
    const wordFreq = {};
    last20.forEach(s => {
      if (s.tip) {
        // Find quoted phrases first
        const quoted = s.tip.match(/'([^']+)'/g) || s.tip.match(/"([^"]+)"/g);
        if (quoted) {
          quoted.forEach(q => {
            const phrase = q.replace(/['"]/g, '').toLowerCase().trim();
            if (phrase.length > 2) {
              wordFreq[phrase] = (wordFreq[phrase] || 0) + 1;
            }
          });
        }
      }
    });

    let mostCommon = '';
    let maxCount = 0;
    for (const [phrase, count] of Object.entries(wordFreq)) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = phrase;
      }
    }
    const issueHTML = mostCommon
      ? `<div class="progress-issue">Most flagged: '${mostCommon}' (${maxCount}×)</div>`
      : '';

    // Find most used tone
    const toneFreq = {};
    scores.forEach(s => {
      if (s.tone) toneFreq[s.tone] = (toneFreq[s.tone] || 0) + 1;
    });
    let mostUsedTone = 'Confident';
    let maxToneCount = 0;
    for (const [tone, count] of Object.entries(toneFreq)) {
      if (count > maxToneCount) {
        maxToneCount = count;
        mostUsedTone = tone;
      }
    }

    const card = document.createElement('div');
    card.className = 'progress-card';
    card.innerHTML = `
      <div class="progress-card-header">
        <span class="progress-card-title">📈 Your Writing Progress</span>
        <span class="progress-card-period">This week</span>
      </div>
      <div class="progress-score-row">
        <span class="progress-score-big">${thisWeekAvg}</span>
        <span class="progress-score-total">/100</span>
      </div>
      <div class="progress-score-label">avg score</div>
      ${improvementHTML}
      ${issueHTML}
      <div class="progress-stats-row">
        <span>${serverRewriteCount ?? scores.length} rewrites</span>
        <span>·</span>
        <span>${mostUsedTone} most used</span>
      </div>
      <div class="progress-bar-section">
        <div class="progress-bar-header">
          <span>Fluency Progress</span>
          <span>${thisWeekAvg}%</span>
        </div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" id="progressBarFill"></div>
        </div>
      </div>
    `;
    container.appendChild(card);

    // Animate fill
    setTimeout(() => {
      const fill = document.getElementById('progressBarFill');
      if (fill) fill.style.width = thisWeekAvg + '%';
    }, 100);
  }

  function showError(message) {
    outputText.value = `⚠️ Error: ${message}`;
    scoreBadge.textContent = '—/100';
    scoreBadge.className = 'score-badge';
    tipBox.style.display = 'flex';
    tipText.textContent = 'Try again or check your connection.';
    outputCard.classList.add('visible');
  }

  // ─── Copy Button ───
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(outputText.value);
      copyBtn.classList.add('copied');
      copyBtnText.textContent = '✅ Copied!';
      sendTrack('copy_clicked'); // no personal data
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtnText.textContent = 'Copy';
      }, 1500);
    } catch {
      outputText.select();
      document.execCommand('copy');
      copyBtnText.textContent = '✅ Copied!';
      setTimeout(() => { copyBtnText.textContent = 'Copy'; }, 1500);
    }
  });

  // ─── Try Again ───
  tryAgainBtn.addEventListener('click', () => {
    handleRewrite(false);
  });

  // ─── Email Capture ───
  emailCaptureBtn.addEventListener('click', async () => {
    const email = emailCaptureInput.value.trim();
    if (!email || !email.includes('@')) {
      emailCaptureInput.style.borderColor = 'var(--red)';
      setTimeout(() => { emailCaptureInput.style.borderColor = ''; }, 1500);
      return;
    }

    emailCaptureBtn.textContent = 'Saving…';
    emailCaptureBtn.disabled = true;

    try {
      const stored = await chrome.storage.local.get(['replypalGoal', 'replypalSites']);
      const response = await safeSendMessage({
        type: 'saveEmail',
        payload: {
          email,
          goal: stored.replypalGoal || '',
          sites: stored.replypalSites || []
        }
      });

      if (response?.success) {
        await chrome.storage.local.set({
          replypalEmail: email,
          replypalEmailSaved: true
        });
        emailCaptureCard.innerHTML = '<div style="padding:12px;font-size:13px;color:#065F46;">✅ Saved! You\'ll get your first report Sunday.</div>';
        setTimeout(() => { emailCaptureCard.style.display = 'none'; }, 3000);
      } else {
        showToast('Failed to save email. Try again.', 'error');
        emailCaptureBtn.textContent = 'Save →';
        emailCaptureBtn.disabled = false;
      }
    } catch (err) {
      showToast('Connection error.', 'error');
      emailCaptureBtn.textContent = 'Save →';
      emailCaptureBtn.disabled = false;
    }
  });

  emailCaptureDismiss.addEventListener('click', async () => {
    emailCaptureCard.style.display = 'none';
    await chrome.storage.local.set({ replypalEmailSkipped: true });
  });

  // ─── Referral ───
  referralCopyBtn.addEventListener('click', async () => {
    const { replypalRefCode } = await chrome.storage.local.get('replypalRefCode');
    const code = replypalRefCode || 'XXXXXXXX';
    const link = `https://replypals.in?ref=${code}`;
    await navigator.clipboard.writeText(link);
    referralCopyBtn.textContent = '✅ Copied!';
    sendTrack('referral_shared', { channel: 'copy' }); // no personal data
    setTimeout(() => { referralCopyBtn.textContent = '📋 Copy your referral link'; }, 2000);
  });

  referralWhatsappBtn.addEventListener('click', async () => {
    const { replypalRefCode } = await chrome.storage.local.get('replypalRefCode');
    const code = replypalRefCode || 'XXXXXXXX';
    const waURL = `https://wa.me/?text=I%20use%20ReplyPals%20to%20write%20better%20English%20emails%20in%20seconds.%20Try%20it%20free%3A%20https%3A%2F%2Freplypals.in%3Fref%3D${code}`;
    chrome.tabs.create({ url: waURL });
    sendTrack('referral_shared', { channel: 'whatsapp' }); // no personal data
  });

  // ─── Recent Rewrites ───
  function renderRecentRewrites(cache) {
    if (cache.length === 0) return;
    recentSection.style.display = 'block';

    const items = cache.slice(-3).reverse();
    recentList.innerHTML = items.map(item => {
      const time = new Date(item.timestamp).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      return `
        <div class="recent-item" data-input="${encodeURIComponent(item.input)}" data-output="${encodeURIComponent(item.output)}">
          <div class="recent-item-text">${item.input}</div>
          <div class="recent-item-meta">${item.tone} · ${item.score}/100 · ${time}</div>
        </div>
      `;
    }).join('');

    recentList.querySelectorAll('.recent-item').forEach(el => {
      el.addEventListener('click', () => {
        inputText.value = decodeURIComponent(el.dataset.input);
        outputText.value = decodeURIComponent(el.dataset.output);
        updateCharCount();
        outputCard.classList.add('visible');
      });
    });
  }

  let recentCollapsed = false;
  recentToggle.addEventListener('click', () => {
    recentCollapsed = !recentCollapsed;
    recentList.classList.toggle('collapsed', recentCollapsed);
    recentChevron.classList.toggle('collapsed', recentCollapsed);
  });

  // ─── Templates ───
  function renderTemplates(filter = '') {
    if (typeof TEMPLATES === 'undefined' || typeof TEMPLATE_CATEGORIES === 'undefined') {
      templatesList.innerHTML = '<div class="templates-empty">Templates loading…</div>';
      return;
    }

    const filterLower = filter.toLowerCase();
    let html = '';
    let anyMatch = false;

    TEMPLATE_CATEGORIES.forEach(cat => {
      const catTemplates = TEMPLATES.filter(t =>
        t.category === cat.name &&
        (filterLower === '' ||
          t.name.toLowerCase().includes(filterLower) ||
          t.category.toLowerCase().includes(filterLower))
      );

      if (catTemplates.length === 0) return;
      anyMatch = true;

      const isExpanded = filter || cat.expanded;
      html += `
        <div class="template-category">
          <div class="template-category-header" data-cat="${cat.name}">
            <span>${cat.icon} ${cat.name}</span>
            <span class="template-category-chevron ${isExpanded ? '' : 'collapsed'}">▾</span>
          </div>
          <div class="template-category-items ${isExpanded ? '' : 'collapsed'}" style="max-height:${isExpanded ? '2000px' : '0'}">
            ${catTemplates.map(t => `
              <div class="template-item" data-id="${t.id}">
                <span class="template-item-icon">${t.icon}</span>
                <div class="template-item-info">
                  <div class="template-item-name">${t.name}</div>
                  <span class="template-item-category">${t.category}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });

    if (!anyMatch) {
      html = '<div class="templates-empty">No templates found</div>';
    }

    templatesList.innerHTML = html;

    // Category collapse/expand
    templatesList.querySelectorAll('.template-category-header').forEach(header => {
      header.addEventListener('click', () => {
        const items = header.nextElementSibling;
        const chevron = header.querySelector('.template-category-chevron');
        items.classList.toggle('collapsed');
        chevron.classList.toggle('collapsed');
        if (items.classList.contains('collapsed')) {
          items.style.maxHeight = '0';
        } else {
          items.style.maxHeight = '2000px';
        }
      });
    });

    // Template item click
    templatesList.querySelectorAll('.template-item').forEach(item => {
      item.addEventListener('click', () => {
        const template = TEMPLATES.find(t => t.id === item.dataset.id);
        if (template) openTemplateForm(template);
      });
    });
  }

  templateSearch.addEventListener('input', () => {
    renderTemplates(templateSearch.value.trim());
  });

  function openTemplateForm(template) {
    templateFormOverlay.style.display = 'block';
    templatesList.style.display = 'none';
    document.querySelector('.templates-search-wrap').style.display = 'none';

    let templateFormTone = currentTone;
    const TONE_LIST = [
      { key: 'confident', emoji: '💪', label: 'Confident' },
      { key: 'formal',    emoji: '🎯', label: 'Formal' },
      { key: 'polite',    emoji: '🙏', label: 'Polite' },
      { key: 'casual',    emoji: '😊', label: 'Casual' },
      { key: 'friendly',  emoji: '👋', label: 'Friendly' },
      { key: 'assertive', emoji: '⚡', label: 'Assertive' },
    ];

    const requiredFields  = template.fields.filter(f => !f.optional);
    const optionalFields  = template.fields.filter(f => f.optional);

    const renderField = (f) => `
      <div class="tf-field" data-optional="${f.optional ? '1' : '0'}">
        <div class="tf-field-header">
          <label class="tf-label">${f.label}</label>
          ${f.optional ? '<span class="tf-optional-tag">Optional</span>' : '<span class="tf-required-dot"></span>'}
        </div>
        <input type="text" class="tf-input template-form-input" data-field="${f.id}" placeholder="${f.placeholder}" autocomplete="off" />
      </div>
    `;

    const fieldsHTML = [
      requiredFields.map(renderField).join(''),
      optionalFields.length ? `
        <div class="tf-optional-section">
          <div class="tf-optional-toggle" id="tfOptToggle">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            Add optional details (${optionalFields.length})
          </div>
          <div class="tf-optional-fields" id="tfOptFields" style="display:none">
            ${optionalFields.map(renderField).join('')}
          </div>
        </div>
      ` : ''
    ].join('');

    const tonesHTML = TONE_LIST.map(t => `
      <button class="tf-tone-btn ${t.key === templateFormTone ? 'active' : ''}" data-tone="${t.key}">
        <span class="tf-tone-emoji">${t.emoji}</span>
        <span class="tf-tone-name">${t.label}</span>
      </button>
    `).join('');

    templateFormOverlay.innerHTML = `
      <div class="tf-header">
        <button class="tf-back" id="templateFormBack">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          Templates
        </button>
        <div class="tf-badge">${template.category}</div>
      </div>
      <div class="tf-title-row">
        <span class="tf-icon">${template.icon}</span>
        <div>
          <div class="tf-title">${template.name}</div>
          <div class="tf-subtitle">${requiredFields.length} field${requiredFields.length !== 1 ? 's' : ''} to fill</div>
        </div>
      </div>
      <div class="tf-fields-wrap">${fieldsHTML}</div>
      <div class="tf-section-label">Tone</div>
      <div class="tf-tones" id="templateFormTones">${tonesHTML}</div>
      <div class="tf-progress" id="tfProgress">
        <div class="tf-progress-bar" id="tfProgressBar" style="width:0%"></div>
      </div>
      <button class="tf-generate-btn" id="templateFormGenerate">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg>
        Generate Email
      </button>
    `;

    // ── Back button ────────────────────────────────────────────────
    templateFormOverlay.querySelector('#templateFormBack').addEventListener('click', () => {
      templateFormOverlay.style.display = 'none';
      templatesList.style.display = 'block';
      document.querySelector('.templates-search-wrap').style.display = 'block';
    });

    // ── Optional fields toggle ─────────────────────────────────────
    const optToggle = templateFormOverlay.querySelector('#tfOptToggle');
    const optFields = templateFormOverlay.querySelector('#tfOptFields');
    if (optToggle) {
      optToggle.addEventListener('click', () => {
        const open = optFields.style.display !== 'none';
        optFields.style.display = open ? 'none' : 'block';
        optToggle.classList.toggle('open', !open);
      });
    }

    // ── Progress bar update ────────────────────────────────────────
    function updateProgress() {
      const all = templateFormOverlay.querySelectorAll('.tf-input[data-optional="0"],[data-optional="0"] .tf-input');
      const req = templateFormOverlay.querySelectorAll('.tf-field[data-optional="0"] .tf-input');
      if (!req.length) return;
      const filled = [...req].filter(i => i.value.trim().length > 0).length;
      const pct = Math.round((filled / req.length) * 100);
      const bar = document.getElementById('tfProgressBar');
      if (bar) bar.style.width = pct + '%';
      const btn = document.getElementById('templateFormGenerate');
      if (btn) {
        btn.disabled = false; // allow generate even with empty (uses placeholders)
        btn.style.opacity = filled === req.length ? '1' : '0.75';
      }
    }
    templateFormOverlay.querySelectorAll('.tf-input').forEach(inp => {
      inp.addEventListener('input', updateProgress);
    });

    // ── Tone selection ──────────────────────────────────────────────
    templateFormOverlay.querySelector('#templateFormTones').addEventListener('click', (e) => {
      const btn = e.target.closest('.tf-tone-btn');
      if (!btn) return;
      templateFormOverlay.querySelectorAll('.tf-tone-btn').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      templateFormTone = btn.dataset.tone;
    });

    // ── Generate ────────────────────────────────────────────────────
    templateFormOverlay.querySelector('#templateFormGenerate').addEventListener('click', async () => {
      if (isPopupQuotaBlockedSync()) {
        showUpgradeOverlay(true);
        return;
      }
      const fieldValues = {};
      templateFormOverlay.querySelectorAll('.template-form-input').forEach(inp => {
        fieldValues[inp.dataset.field] = inp.value.trim() || inp.placeholder;
      });

      const prompt = template.prompt(fieldValues);
      const genBtn = templateFormOverlay.querySelector('#templateFormGenerate');
      genBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.3);border-top-color:#fff;"></div> Generating…';
      genBtn.disabled = true;

      sendTrack('template_used', { template_id: template.id }); // no personal data

      try {
        const response = await safeSendMessage({
          type: 'generate',
          payload: { prompt, tone: templateFormTone, license_key: licenseKey }
        });

        if (response?.error === 'offline') {
          showToast('🔴 ReplyPals offline — check your connection', 'error');
          genBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg> Generate Email';
          genBtn.disabled = false;
          return;
        }

        if (response?.success && response.data) {
          // Switch to rewrite tab to show output
          document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
          document.querySelector('.mode-tab[data-mode="rewrite"]').classList.add('active');
          currentMode = 'rewrite';

          [document.getElementById('inputCard'), document.getElementById('toneCard'), document.getElementById('langCard'), rewriteBtn, emailCaptureCard].forEach(el => { if (el) el.style.display = ''; });
          templatesContent.style.display = 'none';
          inputLabel.textContent = 'Your Text';
          inputText.placeholder = 'Highlight text on any page, or paste here…';
          quickPrompts.style.display = 'none';
          rewriteBtn.innerHTML = '<svg class="bolt-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg><span id="rewriteBtnText">Rewrite Now</span>';

          inputText.value = prompt;
          updateCharCount();
          showResult(response.data);

          useCount++;
          await chrome.storage.local.set({ replypalCount: useCount });
          updateUsageDisplay();
        } else {
          showToast('⚠️ ' + (response?.error || 'Failed to generate'), 'error');
          genBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg> Generate Email';
          genBtn.disabled = false;
        }
      } catch (err) {
        showToast('⚠️ Connection error', 'error');
        genBtn.textContent = '⚡ Generate Email';
        genBtn.disabled = false;
      }
    });
  }

  // ─── Team Stats ───
  async function loadTeamStats() {
    const teamContent = document.getElementById('teamContent');
    const teamStats = document.getElementById('teamStats');

    try {
      const response = await safeSendMessage({
        type: 'getTeamStats',
        payload: { license_key: licenseKey }
      });

      if (response?.success) {
        teamContent.style.display = 'block';
        let membersHTML = '';
        if (response.members && response.members.length > 0) {
          membersHTML = response.members.map(m => `
            <div class="team-member-item">
              <span>${m.email || 'Member'}</span>
              <span>${m.rewrites || 0} rewrites · ${Math.round(m.avg_score || 0)}/100</span>
            </div>
          `).join('');
        }

        teamStats.innerHTML = `
          <div class="team-stat-row">
            <span class="team-stat-label">Total Rewrites</span>
            <span class="team-stat-value">${response.total_rewrites || 0}</span>
          </div>
          <div class="team-stat-row">
            <span class="team-stat-label">Team Avg Score</span>
            <span class="team-stat-value">${Math.round(response.avg_score || 0)}/100</span>
          </div>
          <div style="margin-top:12px;">
            <label class="card-label">Members</label>
            ${membersHTML || '<div style="font-size:12px;color:var(--text-muted);">No members yet</div>'}
          </div>
        `;
      }
    } catch (e) { }

    // Invite member
    const teamInviteBtn = document.getElementById('teamInviteBtn');
    const teamInviteEmail = document.getElementById('teamInviteEmail');
    teamInviteBtn.addEventListener('click', async () => {
      const email = teamInviteEmail.value.trim();
      if (!email || !email.includes('@')) {
        teamInviteEmail.style.borderColor = 'var(--red)';
        setTimeout(() => { teamInviteEmail.style.borderColor = ''; }, 1500);
        return;
      }

      teamInviteBtn.textContent = 'Inviting…';
      teamInviteBtn.disabled = true;

      try {
        const resp = await safeSendMessage({
          type: 'addTeamMember',
          payload: { admin_key: licenseKey, member_email: email }
        });
        if (resp?.success) {
          showToast('✅ Member invited!', 'success');
          teamInviteEmail.value = '';
          loadTeamStats(); // Refresh
        } else {
          showToast('⚠️ ' + (resp?.error || 'Failed to invite'), 'error');
        }
      } catch (e) {
        showToast('Connection error', 'error');
      } finally {
        teamInviteBtn.textContent = 'Invite Member';
        teamInviteBtn.disabled = false;
      }
    });
  }

  // ═══════════════════════════════════════════
  // UPGRADE OVERLAY — Dynamic Pricing
  // ═══════════════════════════════════════════
  let cachedPricing = null;

  async function fetchPricingData() {
    // Return cached if available
    if (cachedPricing) return cachedPricing;

    // Check session storage
    const session = await chrome.storage.session.get('replypalPricing');
    if (session.replypalPricing) {
      cachedPricing = session.replypalPricing;
      return cachedPricing;
    }

    // Fetch from API via background
    try {
      const resp = await safeSendMessage({ type: 'fetchPricing' });
      if (resp && resp.success !== false && resp.plans) {
        cachedPricing = resp;
        await chrome.storage.session.set({ replypalPricing: resp });
        return resp;
      }
    } catch (e) { }

    return {
      country: 'US',
      tier: 'tier1', currency: 'usd', note: null,
      plans: {
        starter: { display: '$2', per: '/mo' },
        pro: { display: '$9', per: '/mo' },
        growth: { display: '$15', per: '/mo' },
        team: { display: '$25', per: '/mo' },
      },
      plan_limit_labels: {
        starter: '25 rewrites/mo',
        pro: '300 rewrites/mo',
        growth: '750 rewrites/mo',
        team: '150/mo · 15/day',
      },
      credit_bundles: {},
    };
  }

  function renderCreditBundlesRow(pricing) {
    const row = document.getElementById('creditBundlesRow');
    const list = document.getElementById('creditBundlesList');
    if (!row || !list) return;
    const bundles = pricing.credit_bundles;
    if (!bundles || typeof bundles !== 'object' || !Object.keys(bundles).length) {
      row.style.display = 'none';
      list.innerHTML = '';
      return;
    }
    const keys = Object.keys(bundles).sort(
      (a, b) => (bundles[a].credits || 0) - (bundles[b].credits || 0)
    );
    list.innerHTML = keys.map((k) => {
      const b = bundles[k];
      const name = b.display_name || k;
      const price = b.display || '';
      return `<div class="credit-bundle-line"><span class="credit-bundle-meta">${name} · ${b.credits} cr</span><span class="credit-bundle-price">${price}</span><button type="button" class="credit-bundle-buy" data-bundle-key="${k.replace(/"/g, '')}">Buy</button></div>`;
    }).join('');
    row.style.display = 'block';
  }

  (function bindCreditBundleBuyOnce() {
    const list = document.getElementById('creditBundlesList');
    if (!list || list.dataset.creditBuyBound) return;
    list.dataset.creditBuyBound = '1';
    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('.credit-bundle-buy');
      if (!btn) return;
      e.preventDefault();
      const bk = btn.getAttribute('data-bundle-key');
      if (!bk) return;
      const pricing = cachedPricing || await fetchPricingData();
      const countryCode = (pricing && pricing.country) ? String(pricing.country).slice(0, 2).toUpperCase() : 'US';
      let email = (checkoutEmail && checkoutEmail.value) ? checkoutEmail.value.trim() : '';
      if (!email) {
        const st = await chrome.storage.local.get('replypalEmail');
        email = (st.replypalEmail || '').trim();
      }
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = '…';
      try {
        const resp = await safeSendMessage({
          type: 'createCreditsCheckout',
          payload: { bundle_key: bk, country_code: countryCode, email },
        });
        if (resp && resp.success && resp.url) {
          chrome.tabs.create({ url: resp.url });
          showToast('Opening secure checkout…', 'success');
        } else if (resp && resp.error === 'signin_required') {
          showToast('Sign in: open dashboard → connect extension, then try again.', 'error');
        } else if (resp && resp.error === 'email_required') {
          showToast('Enter your email above first.', 'error');
          if (checkoutEmail) checkoutEmail.focus();
        } else {
          showToast((resp && resp.message) || (resp && resp.error) || 'Checkout failed', 'error');
        }
      } catch (err) {
        showToast(err.message || 'Checkout failed', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });
  })();

  function renderPlanCards(pricing) {
    const plans = pricing.plans || {};
    const L = pricing.plan_limit_labels || {};
    const order = ['starter', 'pro', 'growth', 'team'].filter((k) => plans[k]);
    const html = order.map((k) => {
      const p = plans[k];
      const per = p.per || '/mo';
      const sub = k === 'team'
        ? (L.team ? ('5 seats · ' + L.team) : '5 seats · 150/mo · 15/day')
        : (L[k] || '');
      const isFeat = k === 'pro';
      const badge = isFeat ? '<div class="plan-badge">BEST VALUE</div>' : '';
      const title = k === 'pro' ? 'Pro ⭐' : (k.charAt(0).toUpperCase() + k.slice(1));
      return `<div class="plan-card${isFeat ? ' featured' : ''}" data-plan="${k}">${badge}<div class="plan-name">${title}</div><div class="plan-price">${p.display}<span>${per}</span></div><div class="plan-detail">${sub}</div></div>`;
    }).join('');
    plansGrid.innerHTML = html;

    plansGrid.querySelectorAll('.plan-card').forEach((card) => {
      card.addEventListener('click', () => selectPlan(card.dataset.plan));
    });

    const noteEl = document.getElementById('pricingNote');
    if (pricing.note) {
      noteEl.textContent = pricing.note + ' 🌍';
      noteEl.style.display = 'block';
    } else {
      noteEl.style.display = 'none';
    }

    renderCreditBundlesRow(pricing);

    const defaultPlan = order.includes('pro') ? 'pro' : (order[0] || 'pro');
    selectPlan(defaultPlan);
  }

  async function showUpgradeOverlay(blocking) {
    upgradeOverlay.classList.add('visible');
    sendTrack('upgrade_shown', { trigger: blocking ? 'limit_blocked' : 'limit' });

    if (blocking) {
      upgradeOverlay.dataset.blocking = '1';
      closeOverlay.style.display = 'none';
      const sub = upgradeOverlay.querySelector('.upgrade-header p');
      if (sub) {
        sub.textContent = 'You\'ve reached your plan limit — subscribe or upgrade to continue.';
      }
    } else {
      delete upgradeOverlay.dataset.blocking;
      closeOverlay.style.display = '';
      const sub = upgradeOverlay.querySelector('.upgrade-header p');
      if (sub) {
        sub.textContent = 'You\'ve used all your free rewrites';
      }
    }

    const loader = document.getElementById('pricingLoader');

    // If we already have cached pricing, render immediately
    if (cachedPricing) {
      renderPlanCards(cachedPricing);
      return;
    }

    // Show loader, fetch pricing
    loader.style.display = 'block';
    plansGrid.style.display = 'none';
    const pricing = await fetchPricingData();
    loader.style.display = 'none';
    plansGrid.style.display = '';
    renderPlanCards(pricing);
  }

  function hideUpgradeOverlay(force) {
    if (force !== true && upgradeOverlay.dataset.blocking === '1') return;
    upgradeOverlay.classList.remove('visible');
    delete upgradeOverlay.dataset.blocking;
    closeOverlay.style.display = '';
  }

  closeOverlay.addEventListener('click', () => hideUpgradeOverlay());

  // ─── Plan Selection ───
  function selectPlan(plan) {
    selectedPlan = plan;
    plansGrid.querySelectorAll('.plan-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.plan === plan);
    });
    // Update button text
    const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
    checkoutBtn.textContent = `⚡ Get ${planLabel} Access`;
  }

  // ─── Checkout ───
  checkoutBtn.addEventListener('click', async () => {
    const email = checkoutEmail.value.trim();
    if (!email || !email.includes('@')) {
      checkoutEmail.style.borderColor = 'var(--red)';
      setTimeout(() => { checkoutEmail.style.borderColor = ''; }, 1500);
      return;
    }

    checkoutBtn.textContent = 'Opening…';
    checkoutBtn.disabled = true;

    const pricing = cachedPricing || await fetchPricingData();
    const tier = pricing.tier || 'tier1';
    const countryCode = (pricing && pricing.country) ? String(pricing.country).slice(0, 2).toUpperCase() : 'US';

    try {
      const response = await safeSendMessage({
        type: 'createCheckout',
        payload: { email, plan: selectedPlan, tier, country_code: countryCode }
      });

      if (response?.error === 'offline') {
        showToast('🔴 ReplyPals offline — check your connection', 'error');
      } else if (response?.success && response.url) {
        chrome.tabs.create({ url: response.url });
      } else {
        licenseError.textContent = response?.error || 'Checkout failed. Try again.';
      }
    } catch (err) {
      licenseError.textContent = err.message || 'Connection error.';
    } finally {
      const planLabel = selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1);
      checkoutBtn.textContent = `⚡ Get ${planLabel} Access`;
      checkoutBtn.disabled = false;
    }
  });

  // ─── License Activation ───
  activateBtn.addEventListener('click', async () => {
    const key = licenseInput.value.trim();
    if (!key) {
      licenseInput.style.borderColor = 'var(--red)';
      setTimeout(() => { licenseInput.style.borderColor = ''; }, 1500);
      return;
    }

    activateBtn.textContent = 'Checking…';
    activateBtn.disabled = true;
    licenseError.textContent = '';

    try {
      const response = await safeSendMessage({
        type: 'verifyLicense',
        payload: { license_key: key }
      });

      if (response?.error === 'offline') {
        showToast('🔴 ReplyPals offline — check your connection', 'error');
      } else if (response?.success !== false && response?.valid) {
        licenseKey = key;
        currentPlan = response.plan || 'pro';
        isTeamAdmin = response.is_admin || false;
        await chrome.storage.local.set({ replypalLicense: key });
        try {
          const usageResp = await safeSendMessage({
            type: 'checkUsage',
            payload: { license_key: key }
          });
          if (usageResp && usageResp.success !== false && typeof usageResp.limit === 'number') {
            const lim = usageResp.limit;
            const usedMo = Number(usageResp.rewrites_this_month || 0);
            if (lim > 0) {
              replypalRewritesLimit = lim;
              replypalUsageLeft = Math.max(0, lim - usedMo);
              await chrome.storage.local.set({
                replypalRewritesLimit: lim,
                replypalUsageLeft: replypalUsageLeft
              });
            } else {
              replypalRewritesLimit = lim;
              replypalUsageLeft = null;
              await chrome.storage.local.set({
                replypalRewritesLimit: lim,
                replypalUsageLeft: null
              });
            }
          }
        } catch (_) { }
        updateUsageDisplay();
        hideUpgradeOverlay(true);
        showToast('✅ License activated!', 'success');

        if (currentPlan === 'team' && isTeamAdmin) {
          loadTeamStats();
        }
      } else {
        licenseError.textContent = 'Invalid or expired key. Please try again.';
      }
    } catch (err) {
      licenseError.textContent = err.message || 'Verification failed.';
    } finally {
      activateBtn.textContent = 'Activate';
      activateBtn.disabled = false;
    }
  });

  // ─── Listen for storage changes ───
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.replypalSelection?.newValue) {
      inputText.value = changes.replypalSelection.newValue;
      updateCharCount();
    }
    if (area === 'local' && (changes.replypalUsageUsed || changes.replypalUsageLimit || changes.replypalUsageLeft || changes.replypalRewritesLimit || changes.replypalLicense || changes.replypalBonusRewrites || changes.replypalMonthlyBaseLimit)) {
      const used = changes.replypalUsageUsed?.newValue;
      const limit = changes.replypalUsageLimit?.newValue;
      if (typeof used === 'number') {
        useCount = used;
        serverRewriteCount = used;
      }
      if (typeof limit === 'number') {
        applyFreeTierBonusFromApiPayload({
          rewrites_limit: limit,
          bonus_rewrites: changes.replypalBonusRewrites?.newValue,
          monthly_base_limit: changes.replypalMonthlyBaseLimit?.newValue
        });
      }
      if (changes.replypalUsageLeft && typeof changes.replypalUsageLeft.newValue === 'number') {
        replypalUsageLeft = changes.replypalUsageLeft.newValue;
      }
      if (changes.replypalRewritesLimit && typeof changes.replypalRewritesLimit.newValue === 'number') {
        replypalRewritesLimit = changes.replypalRewritesLimit.newValue;
      }
      if (changes.replypalLicense?.newValue) {
        licenseKey = changes.replypalLicense.newValue;
        hideUpgradeOverlay(true);
      }
      updateUsageDisplay();
    }
    if (area === 'local' && (changes.replypalScores || changes.replypalCache || changes.replypalCount)) {
      try {
        chrome.storage.local.get(['replypalScores', 'replypalCache']).then((s) => {
          renderRecentRewrites(s.replypalCache || []);
          renderProgressCard(s.replypalScores || []);
        });
      } catch (_) { }
    }
  });

  // ═══════════════════════════════════════════
  // VOICE INPUT (Web Speech API)
  // ═══════════════════════════════════════════
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let isRecording = false;
  const voiceBtn = document.getElementById('voiceBtn');
  const voiceIcon = document.getElementById('voiceIcon');
  const voiceStatus = document.getElementById('voiceStatus');

  const VOICE_LANG_MAP = {
    'auto': 'en-IN',
    'en-rewrite': 'en-IN',
    'hi-en': 'hi-IN',
    'ml-en': 'ml-IN',
    'ar-en': 'ar-SA',
    'fil-en': 'fil-PH',
    'pt-en': 'pt-BR',
    'es-en': 'es-ES',
    'fr-en': 'fr-FR',
  };

  function getRecognitionLang() {
    const selected = languageSelect ? languageSelect.value : 'auto';
    return VOICE_LANG_MAP[selected] || 'en-IN';
  }

  function initVoice() {
    if (!SpeechRecognition || !voiceBtn) {
      if (voiceBtn) voiceBtn.style.display = 'none';
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = getRecognitionLang();

    recognition.onstart = () => {
      isRecording = true;
      voiceBtn.style.background = '#FF6B35';
      voiceBtn.style.borderColor = '#FF6B35';
      voiceBtn.style.animation = 'pulse 1.5s infinite';
      voiceIcon.setAttribute('stroke', '#fff');
      voiceBtn.title = 'Click to stop';
      if (voiceStatus) voiceStatus.textContent = '\uD83C\uDFA4 Listening... speak now';
    };

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript)
        .join('');
      inputText.value = transcript;
      inputText.style.color = event.results[0].isFinal ? '#1A1D2E' : '#9CA3AF';
      updateCharCount();
    };

    recognition.onend = () => {
      isRecording = false;
      voiceBtn.style.background = '#fff';
      voiceBtn.style.borderColor = '#EAECF4';
      voiceBtn.style.animation = '';
      voiceIcon.setAttribute('stroke', '#6B7280');
      voiceBtn.title = 'Speak your message';
      inputText.style.color = '#1A1D2E';
      if (voiceStatus) {
        voiceStatus.textContent = inputText.value.trim().length > 0
          ? '\u2705 Got it! Review and rewrite.'
          : '';
      }
    };

    recognition.onerror = (event) => {
      isRecording = false;
      voiceBtn.style.background = '#fff';
      voiceBtn.style.borderColor = '#EAECF4';
      voiceBtn.style.animation = '';
      voiceIcon.setAttribute('stroke', '#6B7280');
      voiceBtn.title = 'Speak your message';
      if (voiceStatus) {
        if (event.error === 'not-allowed') {
          voiceStatus.textContent = '\u274C Microphone access denied. Click \uD83D\uDD12 in address bar to enable.';
        } else if (event.error === 'no-speech') {
          voiceStatus.textContent = 'No speech detected. Try again.';
        } else {
          voiceStatus.textContent = 'Voice error. Try again.';
        }
      }
    };
  }

  if (voiceBtn) {
    voiceBtn.addEventListener('click', () => {
      if (!recognition) initVoice();
      if (!recognition) return;

      if (isRecording) {
        recognition.stop();
      } else {
        recognition.lang = getRecognitionLang();
        try {
          recognition.start();
        } catch (e) {
          if (voiceStatus) voiceStatus.textContent = 'Voice error. Try again.';
        }
      }
    });
  }

  if (languageSelect) {
    languageSelect.addEventListener('change', () => {
      if (recognition) recognition.lang = getRecognitionLang();
    });
  }

  initVoice();
// ── VOICE: SIDE PANEL ──────────────────────────────

function initPanelVoice() {
  const btn = document.getElementById('voice-btn');
  const textarea = document.getElementById('inputText');
  if (!btn) return;

  btn.addEventListener('click', () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('voice-bridge.html'),
      type: 'popup',
      width: 420,
      height: 540
    });
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'VOICE_BRIDGE_RESULT') {
      const payload = request.payload;
      if (!payload || !payload.text) return;
      textarea.value = payload.text;
      updateCharCount();
      
      if (payload.action === 'rewrite') {
        document.getElementById('rewriteBtn')?.click();
      } else if (payload.action === 'generate') {
        document.querySelector('.mode-tab[data-mode="generate"]')?.click();
        textarea.value = 'Write a reply to this:\n\n' + payload.text;
        document.getElementById('rewriteBtn')?.click(); // generating
      } else if (payload.action === 'use') {
        textarea.focus();
      }
      sendResponse({ received: true });
    }
  });
}

})();
