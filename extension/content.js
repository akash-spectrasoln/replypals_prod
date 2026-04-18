try {
  (function () {
    'use strict';
    if (window.__replypalInjected) return;
    window.__replypalInjected = true;
    var SITE_ORIGIN = 'https://www.replypals.in';

    /** Align with popup.js — must match GET /pricing for Stripe country resolution. */
    function checkoutCountryFromPricing(pricing) {
      var c = pricing && pricing.country;
      if (typeof c === 'string' && /^[a-zA-Z]{2}/.test(c)) {
        return c.slice(0, 2).toUpperCase();
      }
      var cur = (pricing && pricing.currency_code) ? String(pricing.currency_code).toLowerCase() : '';
      if (cur === 'inr') return 'IN';
      if (cur === 'gbp') return 'GB';
      if (cur === 'usd') return 'US';
      if (cur === 'cad') return 'CA';
      if (cur === 'aud') return 'AU';
      if (cur === 'php') return 'PH';
      if (cur === 'ngn') return 'NG';
      return 'US';
    }

    // ── Context safety guards ──
    function isChromeValid() {
      try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
    }
    function safeSendMessage(msg, cb) {
      if (!isChromeValid()) { if (cb) try { cb(null); } catch (_) { } return; }
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          if (chrome.runtime.lastError) { /* suppress */ }
          if (cb) try { cb(res); } catch (_) { }
        });
      } catch (e) {
        if (cb) try { cb(null); } catch (_) { }
      }
    }
    function safeStorageGet(keys, cb) {
      if (!isChromeValid()) { if (cb) cb({}); return; }
      try { chrome.storage.local.get(keys, cb); } catch (e) { if (cb) cb({}); }
    }
    function safeStorageSet(obj) {
      if (!isChromeValid()) return;
      try { chrome.storage.local.set(obj); } catch (e) { }
    }

    // ── Data & State ──
    const DEFAULT_TONE_MAP = {
      'mail.google.com': 'Formal', 'outlook.live.com': 'Formal', 'outlook.office.com': 'Formal',
      'web.whatsapp.com': 'Casual', 'twitter.com': 'Casual', 'x.com': 'Casual',
      'linkedin.com': 'Confident', 'slack.com': 'Friendly', 'notion.so': 'Polite',
    };
    const DEFAULT_TONES = [
      { id: 'Confident', icon: '🔵', desc: 'Direct, strong' },
      { id: 'Polite', icon: '🟢', desc: 'Warm, considerate' },
      { id: 'Casual', icon: '🟡', desc: 'Light, relaxed' },
      { id: 'Formal', icon: '🔷', desc: 'Professional, clear' },
      { id: 'Friendly', icon: '🟠', desc: 'Approachable, kind' },
      { id: 'Assertive', icon: '🔴', desc: 'Firm, confident' }
    ];
    const TONES = typeof RP_TONES !== 'undefined' ? RP_TONES : DEFAULT_TONES;
    let toneMemory = {}, selectedTone = 'Confident', autoImprove = false;
    let licenseKey = null, freeCount = 0, bonusRewrites = 0;
    /** Synced with API: when limit > 0 and left === 0, all actions are blocked (free + capped plans). */
    let replypalUsageLeft = null;
    let replypalRewritesLimit = null;
    /** API plan: anon | free | pro | team — drives messaging */
    let replypalPlan = null;
    /** Fallback until API response; align with server default free monthly cap */
    const FREE_LIMIT_BASE = 10;

    function applyFreeTierBonusFromApiPayload(data) {
      if (!data || licenseKey) return;
      const lim = Number(data.rewrites_limit != null ? data.rewrites_limit : FREE_LIMIT_BASE);
      if (typeof data.bonus_rewrites === 'number') {
        bonusRewrites = Math.max(0, data.bonus_rewrites);
      } else {
        const base = typeof data.monthly_base_limit === 'number' && data.monthly_base_limit >= 0
          ? data.monthly_base_limit
          : FREE_LIMIT_BASE;
        bonusRewrites = Math.max(0, lim - base);
      }
    }

    safeStorageGet(['toneMemory', 'replypalAutoImprove', 'replypalLicense', 'replypalCount', 'explainExpanded', 'replypalBonusRewrites', 'replypalUsageUsed', 'replypalUsageLimit', 'replypalUsageLeft', 'replypalRewritesLimit', 'replypalMonthlyBaseLimit', 'replypalPlan'], function (s) {
      toneMemory = s.toneMemory || {};
      autoImprove = s.replypalAutoImprove || false;
      licenseKey = s.replypalLicense || null;
      freeCount = s.replypalCount || 0;
      bonusRewrites = s.replypalBonusRewrites || 0;
      if (typeof s.replypalUsageUsed === 'number') {
        freeCount = s.replypalUsageUsed;
      }
      if (typeof s.replypalUsageLimit === 'number') {
        applyFreeTierBonusFromApiPayload({
          rewrites_limit: s.replypalUsageLimit,
          bonus_rewrites: typeof s.replypalBonusRewrites === 'number' ? s.replypalBonusRewrites : undefined,
          monthly_base_limit: typeof s.replypalMonthlyBaseLimit === 'number' ? s.replypalMonthlyBaseLimit : undefined
        });
      }
      if (typeof s.replypalUsageLeft === 'number') replypalUsageLeft = s.replypalUsageLeft;
      if (typeof s.replypalRewritesLimit === 'number') replypalRewritesLimit = s.replypalRewritesLimit;
      if (typeof s.replypalPlan === 'string') replypalPlan = s.replypalPlan;
      window.explainExpanded = s.explainExpanded || false;
      var host = window.location.hostname;
      if (toneMemory[host]) selectedTone = toneMemory[host];
      else if (DEFAULT_TONE_MAP[host]) selectedTone = DEFAULT_TONE_MAP[host];
    });

    // ── Toast Notification ──
    function showToast(message, type) {
      var toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:10px 18px;border-radius:10px;font-family:var(--rp-font);font-size:13px;font-weight:500;box-shadow:0 4px 14px rgba(0,0,0,0.1);animation:rp-state-in 0.3s ease;max-width:320px;text-align:center;';
      if (type === 'error') { toast.style.background = '#FEF2F2'; toast.style.color = '#991B1B'; toast.style.border = '1px solid #FECACA'; }
      else if (type === 'success') { toast.style.background = '#ECFDF5'; toast.style.color = '#065F46'; toast.style.border = '1px solid #A7F3D0'; }
      else { toast.style.background = '#0F2544'; toast.style.color = '#fff'; }
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(function () { if (toast.parentNode) toast.remove(); }, 3000);
    }

    function resetToHomeState() {
      // Re-render home state if popup is open
    }

    function saveToneMemory(tone) {
      selectedTone = tone;
      toneMemory[window.location.hostname] = tone;
      safeStorageSet({ toneMemory: toneMemory });
    }

    function rpHydrateQuotaFromStorage(cb) {
      safeStorageGet(['replypalLicense', 'replypalUsageUsed', 'replypalUsageLimit', 'replypalCount', 'replypalBonusRewrites', 'replypalUsageLeft', 'replypalRewritesLimit', 'replypalMonthlyBaseLimit', 'replypalPlan'], function (s) {
        licenseKey = s.replypalLicense || licenseKey || null;
        if (typeof s.replypalUsageUsed === 'number') {
          freeCount = s.replypalUsageUsed;
        } else if (typeof s.replypalCount === 'number') {
          freeCount = s.replypalCount;
        }
        if (typeof s.replypalUsageLimit === 'number') {
          applyFreeTierBonusFromApiPayload({
            rewrites_limit: s.replypalUsageLimit,
            bonus_rewrites: typeof s.replypalBonusRewrites === 'number' ? s.replypalBonusRewrites : undefined,
            monthly_base_limit: typeof s.replypalMonthlyBaseLimit === 'number' ? s.replypalMonthlyBaseLimit : undefined
          });
        } else if (typeof s.replypalBonusRewrites === 'number') {
          bonusRewrites = s.replypalBonusRewrites;
        }
        if (typeof s.replypalUsageLeft === 'number') replypalUsageLeft = s.replypalUsageLeft;
        if (typeof s.replypalRewritesLimit === 'number') replypalRewritesLimit = s.replypalRewritesLimit;
        if (typeof s.replypalPlan === 'string') replypalPlan = s.replypalPlan;
        if (cb) cb();
      });
    }

    function rpIsQuotaBlocked() {
      if (typeof replypalRewritesLimit === 'number' && replypalRewritesLimit > 0) {
        if (typeof replypalUsageLeft === 'number' && replypalUsageLeft <= 0) return true;
      }
      if (!licenseKey) {
        var eff = (typeof replypalRewritesLimit === 'number' && replypalRewritesLimit > 0)
          ? replypalRewritesLimit
          : (FREE_LIMIT_BASE + bonusRewrites);
        return freeCount >= eff;
      }
      return false;
    }

    function rpApplyQuotaFromApi(data) {
      if (!data) return;
      if (typeof data.plan === 'string') {
        replypalPlan = data.plan;
        safeStorageSet({ replypalPlan: data.plan });
        if (data.plan === 'anon') bonusRewrites = 0;
      }
      if (typeof data.rewrites_left === 'number') {
        replypalUsageLeft = data.rewrites_left;
        safeStorageSet({ replypalUsageLeft: data.rewrites_left });
      }
      if (typeof data.rewrites_limit === 'number') {
        replypalRewritesLimit = data.rewrites_limit;
        safeStorageSet({ replypalRewritesLimit: data.rewrites_limit });
        if (!licenseKey) {
          applyFreeTierBonusFromApiPayload(data);
          safeStorageSet({
            replypalUsageLimit: data.rewrites_limit,
            replypalBonusRewrites: bonusRewrites,
            replypalMonthlyBaseLimit: typeof data.monthly_base_limit === 'number' ? data.monthly_base_limit : undefined
          });
        }
      }
      if (typeof data.rewrites_used === 'number' && !licenseKey) {
        freeCount = data.rewrites_used;
        var usedPatch = {
          replypalCount: data.rewrites_used,
          replypalUsageUsed: data.rewrites_used
        };
        if (typeof data.rewrites_limit === 'number') usedPatch.replypalUsageLimit = data.rewrites_limit;
        safeStorageSet(usedPatch);
      }
      if (typeof data.rewrites_used === 'number' && typeof data.rewrites_limit === 'number' && typeof data.rewrites_left !== 'number') {
        var impliedLeft = Math.max(0, data.rewrites_limit - data.rewrites_used);
        replypalUsageLeft = impliedLeft;
        safeStorageSet({ replypalUsageLeft: impliedLeft });
      }
    }

    function rpUnlockPopupChromeIfNeeded() {
      var pop = document.getElementById('rp-popup');
      if (!pop || pop.dataset.rpSubLock !== '1') return;
      delete pop.dataset.rpSubLock;
      var c = pop.querySelector('.rp-close');
      if (c) {
        c.style.display = '';
        c.onclick = function () { pop.remove(); _popup = null; clearInterval(_tipTimer); };
      }
    }

    function rpIsLimitReachedError(res) {
      var msg = String((res && res.error) || '').toLowerCase();
      return msg.indexOf('limit_reached') >= 0 ||
             msg.indexOf('limit reached') >= 0 ||
             msg.indexOf('"error":"limit_reached"') >= 0 ||
             msg.indexOf('status 429') >= 0 ||
             msg.indexOf('server error: 429') >= 0;
    }

    function rpOpenUpgradeForLimit(contextText) {
      if (!licenseKey && replypalPlan === 'anon') {
        showToast('3 tries without an account. Sign up on the site for 10 free rewrites/month.', 'error');
        try { window.open(SITE_ORIGIN + '/login', '_blank', 'noopener'); } catch (_) { }
        return;
      }
      showToast('⚠️ You\'ve reached your plan limit. Subscribe or upgrade to continue.', 'error');
      var anchor = getWriteTarget(_activeEl || _rpMiniActive) || _activeEl || _rpMiniActive;
      var rect = anchor && anchor.getBoundingClientRect
        ? anchor.getBoundingClientRect()
        : { left: Math.max(8, (window.innerWidth - 290) / 2), top: 120, width: 290, height: 40, right: 0, bottom: 0 };
      var fallbackText = contextText || (anchor ? readText(anchor) : '') || '';
      if (!licenseKey) {
        var effectiveLimit = (typeof replypalRewritesLimit === 'number' && replypalRewritesLimit > 0)
          ? replypalRewritesLimit
          : (FREE_LIMIT_BASE + bonusRewrites);
        freeCount = Math.max(freeCount, effectiveLimit);
        safeStorageSet({ replypalCount: freeCount, replypalUsageUsed: freeCount });
      }
      openPopup(rect, fallbackText, false, { subscriptionOnly: true });
    }

    // ── Language ──
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

    // ── Styles (Redesigned) ──
    if (!document.getElementById('rp-styles')) {
      var style = document.createElement('style');
      style.id = 'rp-styles';
      style.textContent = `
        :root {
          --rp-primary: #FF6B35;
          --rp-primary-dark: #E85520;
          --rp-secondary: #2D3561;
          --rp-surface: #FFFFFF;
          --rp-surface-2: #F8F9FE;
          --rp-border: #EAECF4;
          --rp-text-main: #1A1D2E;
          --rp-text-grey: #6B7280;
          --rp-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        }
        
        /* Floating selection button */
        #rp-fab {
          position: fixed; z-index: 2147483647; display: none;
          background: linear-gradient(135deg, #FF6B35, #FF8C42);
          color: #fff; border: none; padding: 10px 20px; border-radius: 100px;
          font-family: var(--rp-font); font-size: 13px; font-weight: 600;
          cursor: pointer; box-shadow: 0 4px 12px rgba(255,107,53,0.3);
          transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
          animation: rp-spring-up 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          display: flex; align-items: center; gap: 6px;
        }
        #rp-fab:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(255,107,53,0.4); }
        #rp-fab:active { transform: scale(0.97); }

        /* Fix This Toolbar Button */
        .rp-fix-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 14px; background: linear-gradient(135deg, #FF6B35, #FF8C42);
          color: #fff !important; border-radius: 100px; font-family: var(--rp-font);
          font-size: 13px; font-weight: 600; cursor: pointer; border: none;
          box-shadow: 0 2px 8px rgba(255,107,53,0.4); transition: all 0.2s;
          white-space: nowrap; z-index: 2147483645;
        }
        .rp-fix-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(255,107,53,0.5); }
        .rp-fix-btn:active { transform: scale(0.97); }
        .rp-fix-float { position: fixed; }

        /* Inline Icon */
        .rp-inline-icon {
          position: fixed; z-index: 2147483646; width: 30px; height: 30px;
          border-radius: 50%; background: #fff; border: 1.5px solid var(--rp-primary);
          display: flex; align-items: center; justify-content: center;
          color: var(--rp-primary); font-family: 'Segoe UI', sans-serif; font-weight: 700;
          font-size: 14px; cursor: pointer; transition: 0.2s;
          box-shadow: 0 2px 8px rgba(255,107,53,0.3); display: none;
        }
        .rp-inline-icon:hover { background: var(--rp-primary); color: #fff; }
        .rp-inline-dot {
          position: absolute; top: 0; right: 0; width: 8px; height: 8px;
          background: #DC2626; border-radius: 50%; border: 1.5px solid #fff;
          display: none;
        }

        /* Popup Container */
        #rp-popup {
          position: fixed; width: 290px; background: var(--rp-surface);
          border-radius: 16px; box-shadow: 0 8px 30px rgba(0,0,0,0.12);
          z-index: 2147483647; font-family: var(--rp-font); overflow: hidden;
          animation: rp-popup-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
          color: var(--rp-text-main);
        }
        @media (max-width: 400px) {
          #rp-popup { width: 92vw; left: 4vw !important; }
        }

        /* Header */
        .rp-header {
          height: 80px; background: linear-gradient(135deg, #FF6B35 0%, #FF8C42 50%, #FFB347 100%);
          position: relative; padding: 16px; box-sizing: border-box; color: #fff;
        }
        .rp-header-top { display: flex; justify-content: space-between; align-items: center; }
        .rp-logo-row { display: flex; align-items: center; gap: 8px; }
        .rp-logo-mark {
          width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.8);
          display: flex; align-items: center; justify-content: center;
          font-weight: 700; font-size: 12px;
        }
        .rp-title { font-weight: 700; font-size: 15px; }
        .rp-subtitle { font-size: 11px; opacity: 0.8; font-style: italic; margin-top: 6px; padding-left: 32px; }
        .rp-close { background: none; border: none; color: rgba(255,255,255,0.7); font-size: 18px; cursor: pointer; padding: 0; line-height: 1; transition: 0.2s;}
        .rp-close:hover { color: #fff; }
        .rp-head-blob {
          position: absolute; right: -10px; bottom: -10px; opacity: 0.25; pointer-events: none;
        }

        /* Body Area */
        .rp-body { padding: 14px; position: relative; min-height: 100px; }
        .rp-state-view { animation: rp-state-in 0.15s ease; width: 100%; box-sizing: border-box; }

        /* Section Labels */
        .rp-label { font-size: 11px; color: var(--rp-text-grey); margin-bottom: 6px; display: block; }
        
        /* Working With Box */
        .rp-context-box {
          background: #FFF3ED; border-radius: 8px; padding: 10px 12px;
          display: flex; gap: 8px; align-items: flex-start; margin-bottom: 12px;
        }
        .rp-context-icon { font-size: 14px; margin-top: -1px; }
        .rp-context-text { font-size: 12px; color: var(--rp-text-grey); flex: 1; line-height: 1.4; word-break: break-word; }
        .rp-refresh { background: none; border: none; color: var(--rp-primary); cursor: pointer; padding: 2px; font-size: 13px; opacity: 0.7; }
        .rp-refresh:hover { opacity: 1; }

        .rp-divider { height: 1px; background: var(--rp-border); margin: 12px 0; }

        /* Tone Selector */
        .rp-tone-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; position: relative; }
        .rp-tone-btn {
          background: #fff; border: 1.5px solid var(--rp-border); border-radius: 100px;
          padding: 5px 12px; font-size: 13px; font-weight: 600; cursor: pointer; text-align: left;
          color: var(--rp-text-main); display: flex; align-items: center; gap: 6px;
        }
        .rp-tone-dropdown {
          position: absolute; top: calc(100% + 4px); right: 0; width: 200px;
          background: #fff; border: 1.5px solid var(--rp-border); border-radius: 12px;
          box-shadow: 0 6px 16px rgba(0,0,0,0.08); z-index: 10; display: none; overflow: hidden;
        }
        .rp-tone-item {
          padding: 8px 12px; font-size: 12px; cursor: pointer; display: block; border-bottom: 1px solid #F3F4F6;
        }
        .rp-tone-item:last-child { border-bottom: none; }
        .rp-tone-item:hover, .rp-tone-item.active { background: #F8F9FE; }
        .rp-tone-item.active { color: var(--rp-primary-dark); font-weight: 600; }
        .rp-tone-desc { color: var(--rp-text-grey); font-size: 10px; font-weight: 400; margin-left: 4px; }

        /* Quick Actions */
        .rp-actions { margin-bottom: 12px; }
        .rp-action-row {
          width: 100%; display: flex; align-items: center; justify-content: space-between;
          height: 44px; padding: 0 12px; box-sizing: border-box;
          background: #fff; border: none; border-radius: 8px; cursor: pointer;
          font-family: inherit; font-size: 14px; font-weight: 500; color: var(--rp-text-main);
          transition: 0.12s ease; border-left: 3px solid transparent; margin-bottom: 4px;
        }
        .rp-action-row:hover { background: var(--rp-surface-2); border-left-color: var(--rp-primary); }
        .rp-action-left { display: flex; align-items: center; gap: 8px; }
        .rp-action-chevron { color: #9CA3AF; font-size: 12px; }
        
        /* Custom Input */
        .rp-custom {
          display: flex; gap: 6px; background: var(--rp-surface-2); border: 1.5px solid var(--rp-border);
          border-radius: 10px; padding: 4px; align-items: center;
        }
        .rp-custom input {
          flex: 1; border: none; background: transparent; padding: 8px;
          font-size: 13px; outline: none; font-family: inherit;
        }
        .rp-custom input::placeholder { color: #9CA3AF; font-style: italic; }
        .rp-go {
          width: 30px; height: 30px; border-radius: 50%; background: var(--rp-primary);
          color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: 0.2s; font-weight: 600;
        }
        .rp-go:hover { background: var(--rp-primary-dark); }

        /* Write from scratch state */
        .rp-back { color: var(--rp-text-grey); font-size: 12px; cursor: pointer; margin-bottom: 12px; display: inline-block; }
        .rp-back:hover { color: var(--rp-primary); text-decoration: underline; }
        .rp-textarea {
          width: 100%; box-sizing: border-box; background: var(--rp-surface-2);
          border: 1.5px solid var(--rp-border); border-radius: 10px; padding: 10px;
          font-size: 13px; font-family: inherit; outline: none; margin-bottom: 10px; resize: none;
        }
        .rp-textarea:focus { border-color: var(--rp-primary); }
        .rp-chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 12px; scrollbar-width: none; }
        .rp-chips::-webkit-scrollbar { display: none; }
        .rp-chip {
          flex-shrink: 0; padding: 5px 10px; background: #fff; border: 1px solid var(--rp-border);
          border-radius: 100px; font-size: 11px; cursor: pointer; color: var(--rp-text-main); font-weight: 500;
        }
        .rp-chip:hover { border-color: var(--rp-primary); color: var(--rp-primary); }
        .rp-btn-full {
          width: 100%; padding: 11px; background: var(--rp-primary); color: #fff;
          border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: 0.15s;
        }
        .rp-btn-full:hover { background: var(--rp-primary-dark); }
        
        /* Loading state */
        .rp-loading-view { text-align: center; padding: 20px 0; }
        .rp-spinner {
          width: 32px; height: 32px; border: 3px solid #FFF3ED; border-top-color: var(--rp-primary);
          border-radius: 50%; animation: rp-spin 1s linear infinite; margin: 0 auto 16px;
        }
        .rp-loading-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; }
        .rp-progress-track { width: 100%; height: 4px; background: var(--rp-surface-2); border-radius: 4px; overflow: hidden; margin-bottom: 16px; }
        .rp-progress-fill { height: 100%; background: var(--rp-primary); width: 0%; transition: width 1.5s ease-out; }
        .rp-loading-tip { font-size: 12px; color: var(--rp-text-grey); font-style: italic; min-height: 18px; }

        /* Result State */
        .rp-score-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
        .rp-score-badge { font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 100px; border: 1px solid; }
        .rp-score-high { background: #ECFDF5; color: #059669; border-color: #A7F3D0; }
        .rp-score-mid { background: #FFFBEB; color: #D97706; border-color: #FDE68A; }
        .rp-score-low { background: #FEF2F2; color: #DC2626; border-color: #FECACA; }
        .rp-mini-prog { flex: 1; max-width: 120px; height: 6px; background: #E5E7EB; border-radius: 4px; overflow: hidden; margin-right: 12px; }
        .rp-mini-prog-fill { height: 100%; transition: width 0.6s ease; }
        
        .rp-res-editable {
          width: 100%; box-sizing: border-box; background: var(--rp-surface-2); border: 1.5px solid var(--rp-border);
          border-radius: 10px; padding: 10px; font-size: 13px; font-family: inherit; outline: none; resize: vertical; margin-bottom: 10px;
        }
        
        .rp-res-tip {
          background: #FFF3ED; border-left: 3px solid var(--rp-primary); padding: 8px 10px;
          font-size: 12px; font-style: italic; color: #9A3412; margin-bottom: 10px; border-radius: 0 4px 4px 0;
        }

        /* Voice button styles */
        .rp-voice-btn {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          border: 1.5px solid #EAECF4;
          background: white;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: all 0.15s ease;
          color: #6B7280;
          margin-left: 8px;
        }
        .rp-voice-btn:hover {
          border-color: #FF6B35;
          color: #FF6B35;
          background: #FFF3ED;
        }
        .rp-voice-btn.recording {
          background: #FF6B35;
          border-color: #FF6B35;
          color: white;
          animation: rp-pulse 1.2s infinite;
        }
        @keyframes rp-pulse {
          0%, 100% { 
            box-shadow: 0 0 0 0 rgba(255,107,53,0.5); 
          }
          50%  { 
            box-shadow: 0 0 0 8px rgba(255,107,53,0); 
          }
        }

        /* Expand/Collapse extra actions */
        #rp-extra-actions {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.25s ease;
        }
        #rp-extra-actions.expanded {
          max-height: 200px;
        }
        
        /* Expand button style */
        .rp-expand-btn {
          width: 100%;
          height: 36px;
          background: #F8F9FE;
          border-top: 1px solid #EAECF4;
          font-family: inherit;
          font-size: 12px;
          color: #6B7280;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          margin-bottom: 12px;
          border-radius: 0 0 8px 8px;
        }
        .rp-expand-btn:hover {
          background: #F0F1F5;
        }
        .rp-expand-btn svg {
          margin-left: 4px;
          transition: transform 0.2s ease;
        }
        .rp-expand-btn.expanded svg {
          transform: rotate(180deg);
        }

        /* Resize handle */
        .rp-resize-handle {
          width: 10px; height: 10px;
          background: transparent;
          border-right: 2px solid #EAECF4;
          border-bottom: 2px solid #EAECF4;
          cursor: se-resize;
          position: absolute; bottom: 4px; right: 4px;
        }
        
        .rp-explain-toggle { font-size: 11px; color: var(--rp-text-grey); cursor: pointer; display: flex; align-items: center; gap: 4px; margin-bottom: 10px; }
        .rp-explain-content { display: none; margin-bottom: 10px; }
        .rp-diff-box { font-size: 11px; padding: 6px; background: #fff; border: 1px solid var(--rp-border); border-radius: 6px; color: #333; line-height: 1.4; }
        
        .rp-btn-half-row { display: flex; gap: 8px; margin-bottom: 10px; }
        .rp-btn-half { flex: 1; height: 40px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: 0.15s; }
        .rp-btn-replace { background: var(--rp-primary); color: #fff; }
        .rp-btn-replace:hover { background: var(--rp-primary-dark); transform: scale(1.02); }
        .rp-btn-orig { background: #fff; border: 1.5px solid var(--rp-border); color: var(--rp-text-grey); }
        .rp-btn-orig:active { background: #F3F4F6; }
        
        .rp-btn-sub-row { display: flex; gap: 12px; justify-content: space-between; align-items: center; }
        .rp-btn-ghost { background: none; border: none; color: var(--rp-text-grey); font-size: 12px; cursor: pointer; padding: 4px; }
        .rp-btn-ghost:hover { color: #374151; }
        
        /* Upgrade Card inline */
        .rp-upg-title { font-weight: 700; font-size: 15px; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;}
        .rp-upg-feats { font-size: 12px; color: var(--rp-text-grey); margin-bottom: 12px; line-height: 1.6; }
        .rp-upg-cards { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
        .rp-upg-card { flex: 1 1 calc(50% - 4px); min-width: 72px; box-sizing: border-box; border: 1.5px solid var(--rp-border); border-radius: 8px; padding: 8px 4px; text-align: center; cursor: pointer; opacity: 0.6; font-size: 11px; }
        .rp-upg-card.active { border-color: var(--rp-primary); background: #FFF3ED; opacity: 1; }
        .rp-upg-input { width: 100%; box-sizing: border-box; padding: 8px; border: 1.5px solid var(--rp-border); border-radius: 8px; margin-bottom: 8px; }

        @keyframes rp-popup-in {
          0% { opacity: 0; transform: scale(0.92) translateY(8px); }
          60% { opacity: 1; transform: scale(1.02) translateY(-2px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes rp-state-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes rp-spin { 100% { transform: rotate(360deg); } }
        @keyframes rp-spring-up { 0% { opacity: 0; transform: translateY(20px); } 60% { transform: translateY(-4px); } 100% { opacity: 1; transform: translateY(0); } }

        /* Privacy tooltip */
        .rp-privacy-tooltip {
          position: fixed; z-index: 2147483647; background: #fff; color: #374151;
          font-size: 12px; padding: 6px 10px; border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.12); white-space: nowrap;
          opacity: 0; transition: opacity 0.15s ease; pointer-events: none;
        }
        .rp-privacy-tooltip.visible { opacity: 1; }
        
        .rp-wave-bar {
          display: block; width: 4px; border-radius: 2px;
          background: var(--rp-primary);
          animation: inline-wave 0.8s ease-in-out infinite;
        }
        @keyframes inline-wave {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1.5); }
        }
        .rp-va-btn:hover { border-color: var(--rp-primary) !important; color: var(--rp-primary) !important; background: #FFF3ED !important; }
      `;
      document.head.appendChild(style);
    }

    // ── Utils ──
    const LOADING_TIPS = [
      "Removing non-native phrases…",
      "Adjusting tone and flow…",
      "Making it sound natural…",
      "Checking word choice…",
      "Almost there…",
      "Polishing the final result…"
    ];

    function getWriteTarget(el) {
      if (!el) return null;
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el;
      if (el.isContentEditable || el.getAttribute('role') === 'textbox') return el;
      try {
        var child = el.querySelector && el.querySelector('[contenteditable="true"],[role="textbox"],textarea,input,[g_editable="true"],div[aria-label="Message Body"]');
        if (child) return child;
      } catch (_) {}
      return el;
    }

    function readText(el) {
      var target = getWriteTarget(el);
      if (!target) return '';
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return target.value || '';
      return target.innerText || target.textContent || '';
    }
    function setText(el, text) {
      var target = getWriteTarget(el);
      if (!target) return;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
        target.value = text;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        target.focus();
        var sel = window.getSelection();
        if (sel) {
          var range = document.createRange();
          range.selectNodeContents(target);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        // Prefer native insertion for editors like Gmail/LinkedIn.
        if (!document.execCommand('insertText', false, text)) {
          target.innerText = text;
        }
        target.dispatchEvent(new InputEvent('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
      }
    }
    function isTextLikeInput(el) {
      if (!el || el.tagName !== 'INPUT') return false;
      var t = (el.getAttribute('type') || el.type || 'text').toLowerCase();
      if (t === 'password' || t === 'checkbox' || t === 'radio' || t === 'file' ||
          t === 'hidden' || t === 'button' || t === 'submit' || t === 'reset' ||
          t === 'image' || t === 'color' || t === 'range' ||
          t === 'date' || t === 'time' || t === 'datetime-local' || t === 'month' || t === 'week') {
        return false;
      }
      return true;
    }

    function getEditableRoot(el) {
      if (!el || !el.nodeType) return null;
      if (el.tagName === 'INPUT' && !isTextLikeInput(el)) return null;
      if (el.tagName === 'TEXTAREA') return el;
      if (el.tagName === 'INPUT') return el;
      if (el.isContentEditable || el.getAttribute('role') === 'textbox') {
        if (el.closest && el.closest('[role="checkbox"],[role="radio"],input[type="checkbox"],input[type="radio"]')) {
          return null;
        }
        var parent = el;
        while (parent.parentElement && (parent.parentElement.isContentEditable || parent.parentElement.getAttribute('role') === 'textbox')) {
          parent = parent.parentElement;
        }
        return parent;
      }
      return null;
    }

    function rpIsSelectionInsideExcludedInput(sel) {
      if (!sel || sel.rangeCount < 1) return false;
      try {
        var node = sel.anchorNode;
        if (node && node.nodeType === 3) node = node.parentElement;
        while (node && node.nodeType === 1) {
          if (node.tagName === 'INPUT') {
            var t = (node.type || '').toLowerCase();
            if (t === 'checkbox' || t === 'radio' || t === 'password' || t === 'hidden') return true;
          }
          if (node.getAttribute && (node.getAttribute('role') === 'checkbox' || node.getAttribute('role') === 'radio')) {
            return true;
          }
          node = node.parentElement;
        }
      } catch (_) {}
      return false;
    }

    function isEditable(el) {
      return getEditableRoot(el) !== null;
    }
    function diffWords(a, b) {
      var aW = a.split(' '), bW = b.split(' '), oA = '', oB = '', i = 0, j = 0;
      while (i < aW.length || j < bW.length) {
        if (aW[i] === bW[j]) { oA += aW[i] + ' '; oB += bW[j] + ' '; i++; j++; }
        else { if (aW[i]) oA += '<s>' + aW[i] + '</s> '; if (bW[j]) oB += '<b>' + bW[j] + '</b> '; i++; j++; }
      }
      return { a: oA.trim(), b: oB.trim() };
    }

    // ── Inline Icon ──
    var _fixBtn = null, _fixEl = null;

    function rpResolveAnchorElement(el) {
      if (!el) return null;
      var anchor = el;
      var r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { width: 0, height: 0 };
      if (r.width > 0 || r.height > 0) return anchor;

      var ae = document.activeElement;
      if (ae && (ae === el || (el.contains && el.contains(ae)))) {
        var ra = ae.getBoundingClientRect ? ae.getBoundingClientRect() : { width: 0, height: 0 };
        if (ra.width > 0 || ra.height > 0) return ae;
      }

      try {
        var cand = el.querySelector && el.querySelector('[contenteditable="true"],[role="textbox"],textarea,input,[g_editable="true"],div[aria-label="Message Body"]');
        if (cand) {
          var rc = cand.getBoundingClientRect ? cand.getBoundingClientRect() : { width: 0, height: 0 };
          if (rc.width > 0 || rc.height > 0) return cand;
        }
      } catch (_) {}

      return el;
    }

    function positionIcon() {
      if (!_fixBtn || !_fixEl) return;
      var anchor = rpResolveAnchorElement(_fixEl) || _fixEl;
      var r = anchor.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { _fixBtn.style.display = 'none'; return; }
      // Position inside the bottom right corner of the field
      _fixBtn.style.display = 'flex';
      _fixBtn.style.left = (r.right - 30 - 8) + 'px';
      _fixBtn.style.top = (r.bottom - 30 - 8) + 'px';
    }

    function renderFixBtn(el) {
      if (!isEditable(el)) return;
      var txt = readText(el);
      // Show the inline icon as soon as the field has content.
      if (txt.length < 1) { if (_fixBtn) _fixBtn.style.display = 'none'; return; }
      if (_fixBtn && _fixEl === el) { positionIcon(); return; }
      if (_fixBtn) _fixBtn.remove();

      var btn = document.createElement('div');
      btn.className = 'rp-inline-icon';
      btn.innerHTML = 'R<div class="rp-inline-dot"></div>';
      btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      btn.onclick = function (e) { e.preventDefault(); e.stopPropagation(); doInlineRewrite(el); };

      // Privacy tooltip on hover (1.5s delay)
      var _privacyTooltip = null;
      var _hoverTimer = null;
      btn.addEventListener('mouseenter', function () {
        _hoverTimer = setTimeout(function () {
          if (_privacyTooltip) _privacyTooltip.remove();
          _privacyTooltip = document.createElement('div');
          _privacyTooltip.className = 'rp-privacy-tooltip';
          _privacyTooltip.textContent = '🔒 Your text is never stored';
          document.body.appendChild(_privacyTooltip);
          var r = btn.getBoundingClientRect();
          _privacyTooltip.style.left = (r.left + r.width / 2 - _privacyTooltip.offsetWidth / 2) + 'px';
          _privacyTooltip.style.top = (r.top - _privacyTooltip.offsetHeight - 6) + 'px';
          setTimeout(function () { if (_privacyTooltip) _privacyTooltip.classList.add('visible'); }, 10);
        }, 1500);
      });
      btn.addEventListener('mouseleave', function () {
        clearTimeout(_hoverTimer);
        if (_privacyTooltip) { _privacyTooltip.remove(); _privacyTooltip = null; }
      });

      document.body.appendChild(btn);
      _fixBtn = btn;
      _fixEl = rpResolveAnchorElement(el) || el;
      positionIcon();
    }

    window.addEventListener('scroll', positionIcon, true);
    window.addEventListener('resize', positionIcon);

    // ── Selection Toolbar placeholder (created lazily below) ──
    var _rpSelToolbar = null;
    var RP_SEL_ID = 'rp-sel-toolbar';

    // ── Popup Logic ──
    var _popup = null, _activeEl = null, _tipTimer = null;

    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        if (changes.replypalUsageLeft) replypalUsageLeft = changes.replypalUsageLeft.newValue;
        if (changes.replypalRewritesLimit) replypalRewritesLimit = changes.replypalRewritesLimit.newValue;
        if (changes.replypalLicense) licenseKey = changes.replypalLicense.newValue || null;
        if (changes.replypalUsageUsed) freeCount = changes.replypalUsageUsed.newValue;
        if (changes.replypalUsageLimit && typeof changes.replypalUsageLimit.newValue === 'number') {
          applyFreeTierBonusFromApiPayload({
            rewrites_limit: changes.replypalUsageLimit.newValue,
            bonus_rewrites: changes.replypalBonusRewrites && typeof changes.replypalBonusRewrites.newValue === 'number'
              ? changes.replypalBonusRewrites.newValue : undefined,
            monthly_base_limit: changes.replypalMonthlyBaseLimit && typeof changes.replypalMonthlyBaseLimit.newValue === 'number'
              ? changes.replypalMonthlyBaseLimit.newValue : undefined
          });
        }
        try {
          if (_popup && rpIsQuotaBlocked() && !_popup.querySelector('.rp-upg-title')) {
            rpOpenUpgradeForLimit('');
          }
        } catch (_) {}
      });
    } catch (_) {}

    function doInlineRewrite(el) {
      var target = getWriteTarget(el) || el;
      _activeEl = target;
      openPopup(target.getBoundingClientRect(), readText(target), false);
    }

    function positionPopup(p, rect) {
      function apply(r) {
        let attempts = 0;
        
        // Use safe fallback
        if (r.width === 0) {
          p.style.bottom = '80px';
          p.style.right = '20px';
          p.style.top = 'auto';
          p.style.left = 'auto';
          return;
        }
        
        const popupWidth = p.offsetWidth || 300;
        const popupHeight = p.offsetHeight || 220;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        
        // Preferred: just above the trigger element
        let top = r.top - popupHeight - 8;
        let left = r.right - popupWidth;
        
        // Not enough space above → show below
        if (top < 10) top = r.bottom + 8;
        
        // Goes off right edge → shift left
        if (left + popupWidth > vw - 10) {
          left = vw - popupWidth - 10;
        }
        
        // Goes off left edge → pin to left
        if (left < 10) left = 10;
        
        // Goes off bottom → shift up
        if (top + popupHeight > vh - 10) {
          top = vh - popupHeight - 10;
        }
        
        p.style.top  = top + 'px';
        p.style.left = left + 'px';
        p.style.bottom = 'auto';
        p.style.right  = 'auto';
      }
      if (rect.width === 0 && rect.height === 0) {
        if (!_activeEl) {
          p.style.bottom = '80px'; p.style.right = '20px'; p.style.top = 'auto'; p.style.left = 'auto';
          return;
        }
        var tries = 0;
        var iv = setInterval(function () {
          tries++;
          var nr = _activeEl.getBoundingClientRect();
          if (nr.width > 0 || tries > 5) {
            clearInterval(iv);
            if (nr.width > 0) { p.style.bottom = ''; p.style.right = ''; apply(nr); }
            else { p.style.bottom = '80px'; p.style.right = '20px'; p.style.top = 'auto'; p.style.left = 'auto'; }
          }
        }, 300);
      } else {
        apply(rect);
      }
    }

    function getToneIcon(id) {
      return TONES.find(t => t.id === id)?.icon || '🔵';
    }

    function openPopup(rect, text, isReplyMode, opts) {
      opts = opts || {};
      rpHydrateQuotaFromStorage(function () {
      if (_popup) _popup.remove();
      var p = document.createElement('div');
      p.id = 'rp-popup';
      
      // Load saved width
      safeStorageGet(['replypalPopupWidth'], function(s) {
        if (s.replypalPopupWidth) {
          p.style.width = s.replypalPopupWidth + 'px';
        } else {
          p.style.width = '300px';
        }
      });

      document.body.appendChild(p);
      _popup = p;

      var lang = detectLanguage(text);

      // Header remains constant
      var head = document.createElement('div');
      head.className = 'rp-header';
      head.innerHTML = `
        <div class="rp-header-top">
          <div class="rp-logo-row">
            <div class="rp-logo-mark">R</div>
            <span class="rp-title">ReplyPals</span>
          </div>
          <button type="button" class="rp-close" aria-label="Close">&times;</button>
        </div>
        <div class="rp-subtitle">AI writing for everyone</div>
        <svg class="rp-head-blob" width="120" height="80" viewBox="0 0 120 80">
          <path fill="#ffffff" d="M100,20 C110,60 70,80 30,70 C-10,60 0,10 40,0 C80,-10 90,-20 100,20 Z" />
        </svg>
      `;
      var closeBtn = head.querySelector('.rp-close');
      var lockUi = !!opts.subscriptionOnly || rpIsQuotaBlocked();
      if (lockUi) {
        p.dataset.rpSubLock = '1';
        closeBtn.style.display = 'none';
      } else {
        closeBtn.onclick = function () { p.remove(); _popup = null; clearInterval(_tipTimer); };
      }
      p.appendChild(head);

      var body = document.createElement('div');
      body.className = 'rp-body';
      p.appendChild(body);

      function renderHome() {
        if (opts.subscriptionOnly || rpIsQuotaBlocked()) {
          renderUpgrade();
          return;
        }

        body.innerHTML = '';
        var v = document.createElement('div');
        v.className = 'rp-state-view';

        // Working with
        var shortText = text ? text.substring(0, 45) + (text.length > 45 ? '…' : '') : '';
        var wordCount = text ? text.trim().split(/\s+/).length : 0;
        var infoText = text ? '"' + shortText + '" · ' + wordCount + ' words' : 'Start typing in the field below';
        if (isReplyMode) infoText = '💬 Replying to: "' + shortText + '"';

        v.innerHTML += `
          <span class="rp-label">Working with:</span>
          <div class="rp-working-row rp-context-box" style="display: flex; align-items: center; justify-content: space-between;">
            <div class="rp-working-left" style="display: flex; align-items: flex-start; gap: 8px;">
              <span class="rp-context-icon" style="margin-top: -1px;">${text ? '📝' : '👀'}</span>
              <div class="rp-working-preview rp-context-text" id="rp-ctx-text" style="flex: 1;">${infoText}</div>
              ${!isReplyMode ? '<button class="rp-refresh" id="rp-ref-btn" style="margin-left:4px;">↻</button>' : ''}
            </div>
            <div style="position:relative; display:flex; align-items:flex-end;">
              <div id="rp-inline-wave" style="display:none; margin-right:8px; height:18px; align-items:flex-end; gap:3px;">
                <span class="rp-wave-bar" style="animation-delay:0s; height:8px;"></span>
                <span class="rp-wave-bar" style="animation-delay:0.15s; height:14px;"></span>
                <span class="rp-wave-bar" style="animation-delay:0.3s; height:8px;"></span>
              </div>
              <button id="rp-voice-inline" class="rp-voice-btn" title="Speak in any language">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </button>
              <div id="rp-lang-drop" style="display:none; position:absolute; right:0; top:36px; background:white; border:1px solid #EAECF4; border-radius:8px; box-shadow:0 10px 25px rgba(0,0,0,0.1); padding:8px; z-index:100; max-height:180px; overflow-y:auto; width:160px;">
                <div style="font-size:10px; color:#6B7280; margin-bottom:6px; padding:0 4px; font-weight:600; text-transform:uppercase;">Language</div>
                <div id="rp-lang-list"></div>
              </div>
            </div>
          </div>
          <div class="rp-divider"></div>

          <div id="rp-voice-actions" style="display:none; background:#FFF8F5; border:1px solid #FECAA6; border-radius:8px; padding:10px; margin-bottom:10px;">
            <p style="font-size:11px; color:#6B7280; margin:0 0 6px 0; font-weight:500;">What do you want to do with this?</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
              <button id="rp-va-rewrite" style="padding:6px; font-size:11px; border-radius:6px; background:#FF6B35; color:white; border:none; cursor:pointer;" class="rp-va-btn">✨ Rewrite it</button>
              <button id="rp-va-reply" style="padding:6px; font-size:11px; border-radius:6px; background:white; color:#1A1D2E; border:1px solid #EAECF4; cursor:pointer;" class="rp-va-btn">⚡ Generate reply</button>
              <button id="rp-va-use" style="padding:6px; font-size:11px; border-radius:6px; background:white; color:#1A1D2E; border:1px solid #EAECF4; cursor:pointer;" class="rp-va-btn">✍️ Use as-is</button>
              <button id="rp-va-redo" style="padding:6px; font-size:11px; border-radius:6px; background:white; color:#1A1D2E; border:1px solid #EAECF4; cursor:pointer;" class="rp-va-btn">🎤 Record again</button>
            </div>
          </div>
          
          <div class="rp-tone-row">
            <span class="rp-label" style="margin:0">🎨 Set your tone</span>
            <button class="rp-tone-btn" id="rp-tone-sel">${getToneIcon(selectedTone)} ${selectedTone} ▾</button>
            <div class="rp-tone-dropdown" id="rp-tone-drop"></div>
          </div>
          <div class="rp-divider"></div>
          
          <span class="rp-label">Quick actions:</span>
          <div class="rp-actions">
            ${!isReplyMode ? '<button class="rp-action-row" data-act="improve"><div class="rp-action-left">✨ Improve it</div><span class="rp-action-chevron">></span></button>' : ''}
            <button class="rp-action-row" data-act="friendly"><div class="rp-action-left">😊 Make it friendly</div><span class="rp-action-chevron">></span></button>
            <button class="rp-action-row" data-act="formal"><div class="rp-action-left">💼 Make it formal</div><span class="rp-action-chevron">></span></button>
            <div id="rp-extra-actions">
              <button class="rp-action-row" data-act="shorter"><div class="rp-action-left">✂️ Make it shorter</div><span class="rp-action-chevron">></span></button>
              ${!isReplyMode ? '<button class="rp-action-row" data-act="reply"><div class="rp-action-left">💬 Generate reply</div><span class="rp-action-chevron">></span></button>' : ''}
              ${!isReplyMode ? '<button class="rp-action-row" data-act="scratch"><div class="rp-action-left">✍️ Write from scratch</div><span class="rp-action-chevron">></span></button>' : ''}
            </div>
            <div id="rp-expand-btn" class="rp-expand-btn">
              <span id="rp-expand-text">+ 3 more actions</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
          </div>
          <div class="rp-divider"></div>
          
          <div class="rp-custom">
            <input type="text" id="rp-cust-in" placeholder="Ask anything about the text above… (e.g. turn this into a blog intro)" />
            <button class="rp-go" id="rp-cust-go">→</button>
          </div>
        `;
        body.appendChild(v);

        // Bindings
        if (!isReplyMode) {
          v.querySelector('#rp-ref-btn').onclick = function () {
            var nVal = readText(_activeEl);
            text = nVal;
            lang = detectLanguage(nVal);
            var nShort = text ? text.substring(0, 45) + '…' : '';
            var nWords = text ? text.trim().split(/\s+/).length : 0;
            v.querySelector('#rp-ctx-text').textContent = text ? '"' + nShort + '" · ' + nWords + ' words' : 'Start typing in the field below';
          };
        }

        // Tone Dropdown
        var drop = v.querySelector('#rp-tone-drop');
        drop.innerHTML = TONES.map(t =>
          `<div class="rp-tone-item ${t.id === selectedTone ? 'active' : ''}" data-id="${t.id}">
            ${t.icon} ${t.id} <span class="rp-tone-desc">· ${t.desc}</span>
          </div>`
        ).join('');

        v.querySelector('#rp-tone-sel').onclick = function () { drop.style.display = drop.style.display === 'block' ? 'none' : 'block'; };
        drop.querySelectorAll('.rp-tone-item').forEach(item => {
          item.onclick = function () {
            selectedTone = item.dataset.id;
            saveToneMemory(selectedTone);
            v.querySelector('#rp-tone-sel').innerHTML = `${getToneIcon(selectedTone)} ${selectedTone} ▾`;
            drop.style.display = 'none';
            renderHome(); // Re-render to update active state
          };
        });

        // Quick Actions
        v.querySelectorAll('.rp-action-row').forEach(btn => {
          btn.onclick = function () {
            var act = btn.dataset.act;
            if (act === 'scratch') return renderScratch();

            var payload = { tone: selectedTone, language: lang, license_key: licenseKey };
            var msgType = 'rewrite';

            if (act === 'improve') { payload.text = text; }
            else if (act === 'friendly') { payload.tone = 'Friendly'; payload.text = text; }
            else if (act === 'shorter') { payload.tone = selectedTone; payload.text = text; payload.instruction = 'short'; }
            else if (act === 'formal') { payload.tone = 'Formal'; payload.text = text; }
            else if (act === 'reply' || isReplyMode) {
              payload.prompt = "Write a reply to the following: " + (text || "");
              payload.mode = 'reply';
              payload.text = text;
              msgType = 'generate';
            } // Use background mapping

            executeAction(msgType, payload);
          };
        });

        // Custom Go
        var cIn = v.querySelector('#rp-cust-in');
        var cGo = v.querySelector('#rp-cust-go');
        function sendCustom() {
          var ins = cIn.value.trim();
          if (!ins) return;
          var src = (text || '').trim();
          if (!src) {
            executeAction('generate', { prompt: ins, tone: selectedTone, license_key: licenseKey, language: lang });
            return;
          }
          executeAction('rewrite', {
            text: src,
            tone: selectedTone,
            language: lang,
            license_key: licenseKey,
            instruction: ins
          });
        }
        cGo.onclick = sendCustom;
        cIn.onkeydown = function (e) { if (e.key === 'Enter') sendCustom(); };

        // Expand Collapse Actions
        var expandBtn = v.querySelector('#rp-expand-btn');
        var extraActions = v.querySelector('#rp-extra-actions');
        var expandText = v.querySelector('#rp-expand-text');
        
        if (sessionStorage.getItem('replypalPopupExpanded') === 'true') {
          extraActions.classList.add('expanded');
          expandBtn.classList.add('expanded');
          expandText.textContent = '- Show less';
        }

        expandBtn.onclick = function() {
          var isExpanded = extraActions.classList.contains('expanded');
          if (isExpanded) {
            extraActions.classList.remove('expanded');
            expandBtn.classList.remove('expanded');
            expandText.textContent = '+ 3 more actions';
            sessionStorage.setItem('replypalPopupExpanded', 'false');
          } else {
            extraActions.classList.add('expanded');
            expandBtn.classList.add('expanded');
            expandText.textContent = '- Show less';
            sessionStorage.setItem('replypalPopupExpanded', 'true');
          }
        };

        // Resize handle logic
        var resizeHandle = document.createElement('div');
        resizeHandle.className = 'rp-resize-handle';
        p.appendChild(resizeHandle);
        var isResizing = false;
        var startX, startWidth;

        resizeHandle.addEventListener('mousedown', function(e) {
          isResizing = true;
          startX = e.clientX;
          startWidth = p.offsetWidth;
          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
          e.preventDefault();
        });

        function handleMouseMove(e) {
          if (!isResizing) return;
          var diffX = e.clientX - startX;
          var newWidth = startWidth + diffX;
          if (newWidth >= 260 && newWidth <= 400) {
            p.style.width = newWidth + 'px';
            safeStorageSet({replypalPopupWidth: newWidth});
          }
        }

        function handleMouseUp(e) {
          isResizing = false;
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
        }

        // Voice button initialization
        attachVoiceButton(lang || 'auto');

        positionPopup(p, rect);
      }
      
      let voiceTranscript = '';

      function attachVoiceButton(currentLang) {
        const btn = document.getElementById('rp-voice-inline');
        const wave = document.getElementById('rp-inline-wave');
        const actionsBox = document.getElementById('rp-voice-actions');
        const langDrop = document.getElementById('rp-lang-drop');
        const langList = document.getElementById('rp-lang-list');

        if (!btn || typeof ReplyPalsVoice === 'undefined') return;

        if (!ReplyPalsVoice.isSupported()) {
          btn.style.display = 'none';
          return;
        }

        if (typeof RP_LANGUAGES !== 'undefined' && langList) {
           langList.innerHTML = RP_LANGUAGES.map(l => 
             `<div class="rp-lang-opt" data-lang="${l.code}" style="padding:6px 8px; font-size:12px; border-radius:4px; cursor:pointer; color:#1A1D2E;">${l.label}</div>`
           ).join('');
           
           langDrop.querySelectorAll('.rp-lang-opt').forEach(opt => {
              opt.onmouseover = () => opt.style.background = '#F3F4F6';
              opt.onmouseout = () => opt.style.background = 'transparent';
              opt.onclick = (ev) => {
                 ev.stopPropagation();
                 langDrop.style.display = 'none';
                 startVoice(opt.dataset.lang);
              };
           });
        }

        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (ReplyPalsVoice.getIsRecording()) {
            ReplyPalsVoice.stop();
            return;
          }

          if (langDrop.style.display === 'block') {
             langDrop.style.display = 'none';
          } else {
             langDrop.style.display = 'block';
          }
        });

        document.addEventListener('click', (e) => {
           if (langDrop && langDrop.style.display === 'block' && !langDrop.contains(e.target) && e.target !== btn) {
             langDrop.style.display = 'none';
           }
        });

        function updateWorkingWithPreview(mainText, subText) {
          var ctxText = document.getElementById('rp-ctx-text');
          if (ctxText) {
            ctxText.innerHTML = mainText + (subText ? ' ' + subText : '');
          }
        }

        function startVoice(lang) {
          actionsBox.style.display = 'none';
          wave.style.display = 'none';

          ReplyPalsVoice.start(lang, {
            onStart: () => {
              btn.classList.add('recording');
              btn.title = 'Recording... click to stop';
              wave.style.display = 'flex';
              updateWorkingWithPreview('🎤 Listening...', '');
            },
            onInterim: (interim) => {
              updateWorkingWithPreview(
                '"' + interim.substring(0, 45) + '..."',
                '· listening...'
              );
            },
            onFinal: (finalState) => {
              text = finalState;
              if (_activeEl) setText(_activeEl, text);
              updateWorkingWithPreview(
                '"' + finalState.substring(0, 45) + '..."',
                '· ready'
              );
            },
            onEnd: (finalText) => {
              btn.classList.remove('recording');
              btn.title = 'Speak in any language';
              wave.style.display = 'none';

              voiceTranscript = finalText;
              if (finalText && finalText.trim().length > 2) {
                updateWorkingWithPreview(
                  '"' + finalText.substring(0, 45) + '..."',
                  '· ' + finalText.split(' ').length + ' words'
                );
                actionsBox.style.display = 'block';
              } else {
                updateWorkingWithPreview(
                  text ? '"' + text.substring(0, 45) + '..."' : 'Start typing or speak',
                  ''
                );
                if (!finalText) showToast('No speech detected. Try again.');
              }
            },
            onError: (msg) => {
              showToast(msg, 'error');
              updateWorkingWithPreview(
                text ? '"' + text.substring(0, 45) + '..."' : 'Start typing or speak',
                ''
              );
              wave.style.display = 'none';
            }
          }, true); // continuous = true
        }

        // Voice action buttons
        document.getElementById('rp-va-rewrite')?.addEventListener('click', () => {
          actionsBox.style.display = 'none';
          executeAction('rewrite', { text: voiceTranscript, tone: selectedTone, language: detectLanguage(voiceTranscript), license_key: licenseKey });
        });

        document.getElementById('rp-va-reply')?.addEventListener('click', () => {
          actionsBox.style.display = 'none';
          executeAction('generate', { text: voiceTranscript, prompt: "Write a reply to the following: " + voiceTranscript, tone: selectedTone, mode: 'reply', license_key: licenseKey });
        });

        document.getElementById('rp-va-use')?.addEventListener('click', () => {
          actionsBox.style.display = 'none';
          if (_activeEl) _activeEl.focus();
        });

        document.getElementById('rp-va-redo')?.addEventListener('click', () => {
          actionsBox.style.display = 'none';
          updateWorkingWithPreview('Recording...', '');
          setTimeout(() => btn.click(), 300);
        });
      }

      function renderScratch() {
        body.innerHTML = '';
        var v = document.createElement('div');
        v.className = 'rp-state-view';
        v.innerHTML = `
          <div class="rp-back" id="rp-scr-back">← Back</div>
          <span class="rp-label" style="color:var(--rp-text-main); font-size:14px; margin-bottom:10px;">Write something new</span>
          <textarea class="rp-textarea" id="rp-scr-area" rows="3" placeholder="Describe what you want: e.g. LinkedIn post about AI trends, short blog intro, product blurb, or a polite leave request…"></textarea>
          
          <span class="rp-label">Quick picks:</span>
          <div class="rp-chips">
            <button class="rp-chip" data-txt="Short LinkedIn post about [topic] for a professional audience">📣 LinkedIn</button>
            <button class="rp-chip" data-txt="Blog intro paragraph about [topic], engaging and clear">✍️ Blog</button>
            <button class="rp-chip" data-txt="Twitter/X thread outline (3–5 tweets) about [topic]">🧵 Thread</button>
            <button class="rp-chip" data-txt="Product description for [product] highlighting benefits in 2–3 sentences">📦 Product</button>
            <button class="rp-chip" data-txt="Leave request message for [dates] to my manager">📅 Leave</button>
            <button class="rp-chip" data-txt="Follow-up message about [topic]">💼 Follow up</button>
            <button class="rp-chip" data-txt="Thank-you note to [name] for [reason]">🎉 Thanks</button>
            <button class="rp-chip" data-txt="Politely decline [offer/meeting]">❌ Decline</button>
          </div>
          
          <button class="rp-btn-full" id="rp-scr-go">✨ Write it</button>
        `;
        body.appendChild(v);

        var ta = v.querySelector('#rp-scr-area');
        if (text) ta.value = text;

        v.querySelector('#rp-scr-back').onclick = renderHome;
        v.querySelectorAll('.rp-chip').forEach(c => {
          c.onclick = function () { ta.value = c.dataset.txt; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); };
        });
        v.querySelector('#rp-scr-go').onclick = function () {
          if (!ta.value.trim()) return;
          executeAction('generate', { prompt: ta.value, tone: selectedTone, license_key: licenseKey, language: lang });
        };
        positionPopup(p, rect);
      }

      function executeAction(type, payload) {
        rpHydrateQuotaFromStorage(function () {
          if (rpIsQuotaBlocked()) {
            var ctx = (payload && (payload.text || payload.prompt)) || text || '';
            rpOpenUpgradeForLimit(ctx);
            return;
          }
          renderLoading(type, payload);
          var sendPayload = Object.assign({}, payload, { event_id: crypto.randomUUID() });
          safeSendMessage({ type: type, payload: sendPayload }, function (res) {
            clearInterval(_tipTimer);
            if (res && res.error === 'offline') {
              showToast('🔴 ReplyPals offline — check your connection', 'error');
              renderHome();
              return;
            }
            if (res && res.error === 'timeout') {
              showToast('⏱ Request timed out — please try again', 'error');
              renderHome();
              return;
            }
            if (res && res.success && res.data) {
              rpApplyQuotaFromApi(res.data);
              renderResult(res.data, type, payload);
            } else if (rpIsLimitReachedError(res)) {
              rpOpenUpgradeForLimit(text);
            } else {
              showToast('⚠️ Something went wrong — try again', 'error');
              renderError(res?.error || 'Failed to connect to server.');
            }
          });
        });
      }

      function renderLoading(type, payload) {
        var mode = (payload && payload.mode) || type || 'rewrite';
        var instruction = (payload && payload.instruction) || '';
        var LOADING_LABELS = {
          rewrite:   'Rewriting as ' + selectedTone + '…',
          generate:  'Generating…',
          reply:     'Writing your reply…',
          summary:   'Summarizing…',
          fix:       'Fixing grammar…',
          meaning:   'Explaining…',
          translate: 'Translating…',
          short:     'Making it shorter…',
        };
        var loadingLabel = (instruction === 'short')
          ? 'Making it shorter…'
          : (LOADING_LABELS[mode] || 'Rewriting as ' + selectedTone + '…');
        body.innerHTML = '';
        var v = document.createElement('div');
        v.className = 'rp-state-view rp-loading-view';
        v.innerHTML = `
          <div class="rp-spinner"></div>
          <div class="rp-loading-title">${loadingLabel}</div>
          <div class="rp-progress-track"><div class="rp-progress-fill" id="rp-prog" style="width:0%"></div></div>
          <div class="rp-loading-tip" id="rp-tip">Removing non-native phrases…</div>
        `;
        body.appendChild(v);

        setTimeout(() => { var bf = v.querySelector('#rp-prog'); if (bf) bf.style.width = '85%'; }, 50);

        var tipIdx = 0;
        clearInterval(_tipTimer);
        _tipTimer = setInterval(() => {
          tipIdx = (tipIdx + 1) % LOADING_TIPS.length;
          var tb = v.querySelector('#rp-tip');
          if (tb) tb.textContent = LOADING_TIPS[tipIdx];
        }, 1500);
      }

      function renderResult(data, reqType, lastPayload) {
        body.innerHTML = '';
        var v = document.createElement('div');
        v.className = 'rp-state-view';

        var outText = data.rewritten || data.generated || data.text || '';
        var sc = (data.score != null && data.score !== 0) ? data.score : null;
        var scClass = !sc ? '' : sc >= 80 ? 'rp-score-high' : (sc >= 60 ? 'rp-score-mid' : 'rp-score-low');
        var scColor = !sc ? '#94a3b8' : sc >= 80 ? '#10B981' : (sc >= 60 ? '#F59E0B' : '#EF4444');

        v.innerHTML = `
          <div class="rp-score-row" style="${!sc ? 'display:none' : ''}">
            <span class="rp-label" style="margin:0; font-size:12px;">Native Score:</span>
            <div style="display:flex; align-items:center; flex:1; margin:0 12px; max-width:120px; justify-content:flex-end;">
              <div class="rp-mini-prog"><div class="rp-mini-prog-fill" style="width:0%; background:${scColor}"></div></div>
              <span class="rp-score-badge ${scClass}">${sc ? sc + '/100 🎯' : '—'}</span>
            </div>
          </div>
          
          ${data.subject ? '<div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--rp-secondary)">Subject: ' + data.subject + '</div>' : ''}
          
          <textarea class="rp-res-editable" rows="4">${outText}</textarea>
          
          ${data.tip && reqType !== 'generate' ? '<div class="rp-res-tip">💡 "' + data.tip + '"</div>' : ''}
          
          ${reqType === 'rewrite' ? `
            <div class="rp-explain-toggle" id="rp-expl-tgl"><span id="rp-expl-arr">${window.explainExpanded ? '▼' : '▶'}</span> Why did this change?</div>
            <div class="rp-explain-content" id="rp-expl-cnt" style="display:${window.explainExpanded ? 'block' : 'none'}">
              <div class="rp-diff-box"></div>
            </div>
          ` : ''}
          
          <div class="rp-btn-half-row">
            <button class="rp-btn-half rp-btn-replace" id="rp-btn-rep">✅ ${isReplyMode ? 'Insert Reply' : 'Replace'}</button>
            <button class="rp-btn-half rp-btn-orig" id="rp-btn-org">↩ Original</button>
          </div>
          
          <div class="rp-btn-sub-row">
            <button class="rp-btn-ghost" id="rp-btn-copy">📋 Copy</button>
            <button class="rp-btn-ghost" id="rp-btn-try">↻ Try Again</button>
            <button class="rp-btn-ghost" id="rp-btn-back">← Try something else</button>
          </div>
        `;
        body.appendChild(v);

        setTimeout(() => { var mp = v.querySelector('.rp-mini-prog-fill'); if (mp) mp.style.width = sc + '%'; }, 100);

        var ta = v.querySelector('textarea');

        if (reqType === 'rewrite') {
          var d = diffWords(lastPayload.text, outText);
          v.querySelector('.rp-diff-box').innerHTML = d.a + '<hr style="margin:4px 0; border:0; border-top:1px solid #EAECF4">' + d.b;
          v.querySelector('#rp-expl-tgl').onclick = function () {
            window.explainExpanded = !window.explainExpanded;
            safeStorageSet({ explainExpanded: window.explainExpanded });
            v.querySelector('#rp-expl-cnt').style.display = window.explainExpanded ? 'block' : 'none';
            v.querySelector('#rp-expl-arr').textContent = window.explainExpanded ? '▼' : '▶';
          };
        }

        v.querySelector('#rp-btn-rep').onclick = function () {
          if (isReplyMode) {
            var rBtn = document.querySelector('[data-tooltip="Reply"]');
            if (rBtn) {
              rBtn.click();
              setTimeout(function () { var box = document.querySelector('div[aria-label="Message Body"]'); if (box) setText(box, ta.value); p.remove(); }, 600);
            }
          } else {
            if (_activeEl) setText(_activeEl, ta.value);
            this.textContent = 'Done!';
            setTimeout(() => p.remove(), 800);
          }
        };
        v.querySelector('#rp-btn-org').onclick = function () {
          if (!isReplyMode && _activeEl) setText(_activeEl, text);
          this.style.background = '#F8F9FE'; setTimeout(() => this.style.background = '#fff', 300);
        };
        v.querySelector('#rp-btn-copy').onclick = function () {
          navigator.clipboard.writeText(ta.value).then(() => {
            this.textContent = '✅ Copied!'; setTimeout(() => this.textContent = '📋 Copy', 1500);
          });
        };
        v.querySelector('#rp-btn-try').onclick = function () { executeAction(reqType, lastPayload); };
        v.querySelector('#rp-btn-back').onclick = renderHome;

        positionPopup(p, rect);
      }

      function renderError(msg) {
        body.innerHTML = '';
        var v = document.createElement('div');
        v.className = 'rp-state-view';
        v.innerHTML = `
          <div style="color:#DC2626; font-size:13px; font-weight:500; text-align:center; padding:20px 10px;">
            ⚠️ ${msg}
          </div>
          <button class="rp-btn-full" id="rp-err-back" style="margin-top:20px">← Go Back</button>
        `;
        body.appendChild(v);
        v.querySelector('#rp-err-back').onclick = renderHome;
      }

      function renderUpgrade() {
        body.innerHTML = '';
        var v = document.createElement('div');
        v.className = 'rp-state-view';
        v.innerHTML = `
           <div class="rp-upg-title">⚡ Unlock ReplyPals Pro</div>
           <div style="font-size:12px;color:var(--rp-text-grey);text-align:center;margin:-4px 0 12px;line-height:1.45">
             You've reached your plan limit. Subscribe or activate a license below to continue.
           </div>
           <div class="rp-upg-feats">
             ✅ Plan limits shown on each card above<br>
             ✅ Tone Memory & Templates<br>
             ✅ Smart Reply generator<br>
             ✅ All 6 tones + slash commands
           </div>
           <div id="rp-upg-loader" style="text-align:center;padding:12px;font-size:12px;color:var(--rp-text-grey);">Loading prices…</div>
           <div class="rp-upg-cards" id="rp-upg-cards-container" style="display:none;"></div>
           <input type="email" class="rp-upg-input" id="rp-upg-email" placeholder="you@email.com" />
           <button class="rp-btn-full" id="rp-upg-checkout" style="margin-bottom:12px">⚡ Get Pro Access</button>
           <div id="rp-upg-note" style="display:none;text-align:center;font-size:10px;color:var(--rp-text-grey);margin-bottom:8px;"></div>
           <div style="text-align:center; font-size:12px">
             <span style="color:var(--rp-text-grey)">Already have a key?</span><br>
             <input type="text" class="rp-upg-input" id="rp-upg-license" placeholder="License Key" style="margin-top:6px;width:70%;display:inline-block;padding:5px;" />
             <button id="rp-upg-activate" style="display:inline-block;padding:6px;border:none;background:var(--rp-surface-2);border-radius:6px;cursor:pointer">Activate</button>
           </div>
         `;
        body.appendChild(v);

        var selectedUpgPlan = 'pro';
        var selectedTier = 'tier1';
        var lastUpgPricing = null;

        // Fetch pricing dynamically
        safeSendMessage({ type: 'fetchPricing' }, function (pricing) {
          var loader = v.querySelector('#rp-upg-loader');
          var cardsContainer = v.querySelector('#rp-upg-cards-container');
          if (loader) loader.style.display = 'none';
          if (cardsContainer) cardsContainer.style.display = '';

          var plans;
          if (pricing && pricing.plans) {
            lastUpgPricing = pricing;
            plans = pricing.plans;
            selectedTier = pricing.tier || 'tier1';
          } else {
            lastUpgPricing = null;
            plans = {
              starter: { display: '$2', per: '/mo' },
              pro: { display: '$9', per: '/mo' },
              growth: { display: '$15', per: '/mo' },
              team: { display: '$25', per: '/mo' },
            };
          }

          if (cardsContainer) {
            var L = (pricing && pricing.plan_limit_labels) || {};
            var order = ['starter', 'pro', 'growth', 'team'].filter(function (k) { return plans[k]; });
            var cardsHtml = order.map(function (k) {
              var p = plans[k];
              var per = p.per || '/mo';
              var sub = k === 'team'
                ? (L.team ? ('5 seats · ' + L.team) : '5 seats · 150/mo · 15/day')
                : (L[k] || '');
              var label = k === 'pro' ? 'Pro ⭐' : (k.charAt(0).toUpperCase() + k.slice(1));
              var active = k === 'pro' ? ' active' : '';
              return '<div class="rp-upg-card' + active + '" data-p="' + k + '">' + label + '<br><strong style="font-size:14px">' + p.display + per + '</strong><br><span style="font-size:10px;color:var(--rp-text-grey)">' + sub + '</span></div>';
            }).join('');
            cardsContainer.innerHTML = cardsHtml;

            var cards = cardsContainer.querySelectorAll('.rp-upg-card');
            cards.forEach(function (c) {
              c.onclick = function () {
                cards.forEach(function (x) { x.classList.remove('active'); });
                c.classList.add('active');
                selectedUpgPlan = c.dataset.p;
                var label = selectedUpgPlan.charAt(0).toUpperCase() + selectedUpgPlan.slice(1);
                var btn = v.querySelector('#rp-upg-checkout');
                if (btn) btn.textContent = '⚡ Get ' + label + ' Access';
              };
            });
          }

          // Regional note
          var noteEl = v.querySelector('#rp-upg-note');
          if (pricing && pricing.note && noteEl) {
            noteEl.textContent = pricing.note + ' 🌍';
            noteEl.style.display = 'block';
          }
        });

        // Checkout
        var checkoutBtn = v.querySelector('#rp-upg-checkout');
        if (checkoutBtn) {
          checkoutBtn.onclick = function () {
            var email = v.querySelector('#rp-upg-email').value.trim();
            if (!email || !email.includes('@')) { v.querySelector('#rp-upg-email').style.borderColor = '#EF4444'; setTimeout(function () { v.querySelector('#rp-upg-email').style.borderColor = ''; }, 1500); return; }
            checkoutBtn.textContent = 'Opening…';
            var p = lastUpgPricing;
            var cc = checkoutCountryFromPricing(p);
            var cur = (p && p.currency_code) ? String(p.currency_code).toLowerCase() : '';
            safeSendMessage({ type: 'createCheckout', payload: { email: email, plan: selectedUpgPlan, tier: selectedTier, country_code: cc, currency_code: cur } }, function (res) {
              var label = selectedUpgPlan.charAt(0).toUpperCase() + selectedUpgPlan.slice(1);
              checkoutBtn.textContent = '⚡ Get ' + label + ' Access';
              if (res && res.success && res.url) {
                window.open(res.url, '_blank');
              } else {
                showToast('⚠️ Checkout failed. Try again.', 'error');
              }
            });
          };
        }

        // Activate license
        var activateBtn = v.querySelector('#rp-upg-activate');
        if (activateBtn) {
          activateBtn.onclick = function () {
            var key = v.querySelector('#rp-upg-license').value.trim();
            if (!key) return;
            activateBtn.textContent = 'Checking…';
            safeSendMessage({ type: 'verifyLicense', payload: { license_key: key } }, function (res) {
              activateBtn.textContent = 'Activate';
              if (res && res.valid) {
                licenseKey = key;
                safeStorageSet({ replypalLicense: key });
                replypalUsageLeft = null;
                replypalRewritesLimit = null;
                try { chrome.storage.local.remove(['replypalUsageLeft', 'replypalRewritesLimit']); } catch (_) {}
                showToast('✅ License activated!', 'success');
                rpUnlockPopupChromeIfNeeded();
                renderHome();
              } else {
                showToast('Invalid or expired key.', 'error');
              }
            });
          };
        }

        positionPopup(p, rect);
      }

      renderHome();
      });
    }

    // ── Global Document Listeners ──
    document.addEventListener('focusin', function (e) {
      var root = getEditableRoot(e.target);
      if (root) renderFixBtn(root);
      // Also trigger mini-toolbar
      if (root) rpMiniShowOn(root);
    }, true);

    document.addEventListener('input', function (e) {
      var root = getEditableRoot(e.target);
      if (root) renderFixBtn(root);
    });
    document.addEventListener('mousedown', function (e) {
      if (_popup && !_popup.contains(e.target)) {
        if (_popup.dataset && _popup.dataset.rpSubLock === '1') return;
        _popup.remove(); _popup = null; clearInterval(_tipTimer);
      }
      // Hide mini-toolbar if clicking outside of it
      var tb = document.getElementById('rp-mini-toolbar');
      if (tb && !tb.contains(e.target)) rpMiniHide();
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _popup) {
        if (_popup.dataset && _popup.dataset.rpSubLock === '1') return;
        _popup.remove(); _popup = null; clearInterval(_tipTimer);
      }
    });

    new MutationObserver(function () {
      var root = getEditableRoot(document.activeElement);
      if (root) renderFixBtn(root);
    }).observe(document.body, { childList: true, subtree: true });

    // ══════════════════════════════════════════════════════════════════════
    // RP ROOT STYLES — single injected block for all UI elements
    // ══════════════════════════════════════════════════════════════════════
    (function rpInjectRootStyles() {
      if (document.getElementById('rp-root-styles')) return;
      var s = document.createElement('style');
      s.id = 'rp-root-styles';
      s.textContent = `
        /* ── Result panel & tone menu: isolated with all:initial ── */
        #rp-result-panel, #rp-tone-menu {
          all: initial !important;
          box-sizing: border-box !important;
          font-family: 'Segoe UI', system-ui, sans-serif !important;
          position: fixed !important;
          z-index: 2147483647 !important;
        }

        /* ═══ A. INPUT BADGE — Grammarly-style dot ═══
           NOTE: No all:initial here — it breaks display:flex toggling via class */
        #rp-input-badge {
          position: fixed !important;
          z-index: 2147483646 !important;
          width: 22px !important;
          height: 22px !important;
          border-radius: 50% !important;
          background: linear-gradient(135deg, #FF6B35, #FF4500) !important;
          cursor: pointer !important;
          display: none !important;        /* JS toggles via rp-badge-visible */
          align-items: center !important;
          justify-content: center !important;
          pointer-events: all !important;
          box-shadow: 0 2px 8px rgba(255,107,53,0.45), 0 0 0 2px rgba(255,107,53,0.18) !important;
          transition: transform 0.15s, box-shadow 0.15s !important;
          box-sizing: border-box !important;
          margin: 0 !important;
          padding: 0 !important;
          border: none !important;
          outline: none !important;
          opacity: 1 !important;
          visibility: visible !important;
          overflow: visible !important;
        }
        #rp-input-badge.rp-badge-visible {
          display: flex !important;
          animation: rpDotAppear 0.2s cubic-bezier(.34,1.56,.64,1) both !important;
        }
        #rp-input-badge:hover {
          transform: scale(1.18) !important;
          box-shadow: 0 4px 14px rgba(255,107,53,0.55), 0 0 0 3px rgba(255,107,53,0.22) !important;
        }
        #rp-input-badge { cursor: grab !important; }
        #rp-input-badge:active { cursor: grabbing !important; }

        /* ═══ A2. INPUT PILL (expands on badge hover) ═══ */
        #rp-input-pill {
          position: fixed !important;
          z-index: 2147483646 !important;
          display: none !important;        /* JS toggles via rp-pill-visible */
          flex-direction: row !important;
          align-items: center !important;
          gap: 2px !important;
          background: #1a1f2e !important;
          border-radius: 100px !important;
          padding: 5px 10px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.2) !important;
          pointer-events: all !important;
          box-sizing: border-box !important;
          margin: 0 !important;
          border: none !important;
          outline: none !important;
          opacity: 1 !important;
          visibility: visible !important;
          overflow: visible !important;
        }
        #rp-input-pill.rp-pill-visible {
          display: flex !important;
          animation: rpSlideIn 0.18s cubic-bezier(.4,0,.2,1) both !important;
        }
        #rp-input-pill .rp-pill-logo {
          width: 20px !important; height: 20px !important;
          border-radius: 6px !important;
          background: linear-gradient(135deg, #FF6B35, #FF4500) !important;
          display: flex !important;
          align-items: center !important; justify-content: center !important;
          flex-shrink: 0 !important;
          margin-right: 3px !important;
          box-sizing: border-box !important;
        }
        #rp-input-pill .rp-ip-sep {
          display: block !important;
          width: 1px !important; height: 14px !important;
          background: rgba(255,255,255,0.12) !important;
          margin: 0 3px !important;
          flex-shrink: 0 !important;
        }
        #rp-input-pill .rp-ip-btn {
          all: unset !important;
          width: 28px !important; height: 28px !important;
          border-radius: 50% !important;
          display: flex !important;
          align-items: center !important; justify-content: center !important;
          cursor: pointer !important;
          color: rgba(255,255,255,0.72) !important;
          flex-shrink: 0 !important;
          position: relative !important;
          transition: background 0.12s, color 0.12s, transform 0.1s !important;
          box-sizing: border-box !important;
        }
        #rp-input-pill .rp-ip-btn:hover { color:#fff !important; transform:scale(1.15) !important; }
        #rp-input-pill .rp-ip-btn.rp-ip-rewrite:hover { background:rgba(255,107,53,0.22) !important; color:#FF6B35 !important; }
        #rp-input-pill .rp-ip-btn.rp-ip-reply:hover   { background:rgba(99,102,241,0.22) !important; color:#818cf8 !important; }
        #rp-input-pill .rp-ip-btn.rp-ip-popup:hover   { background:rgba(79,70,229,0.22)  !important; color:#a5b4fc !important; }
        #rp-input-pill .rp-ip-btn::after {
          content: attr(data-tip) !important;
          position: absolute !important;
          bottom: calc(100% + 8px) !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
          background: #0f172a !important;
          color: #fff !important;
          font-size: 10px !important;
          font-weight: 700 !important;
          letter-spacing: 0.03em !important;
          text-transform: uppercase !important;
          white-space: nowrap !important;
          padding: 3px 7px !important;
          border-radius: 5px !important;
          opacity: 0 !important;
          pointer-events: none !important;
          transition: opacity 0.12s !important;
          font-family: system-ui !important;
        }
        #rp-input-pill .rp-ip-btn:hover::after { opacity: 1 !important; }
        #rp-input-pill.rp-loading .rp-pill-logo { animation: rpLogoSpin 1s linear infinite !important; }

        /* ═══ C. RESULT PANEL ═══ */
        #rp-result-panel {
          width: 300px !important;
          background: #fff !important;
          border-radius: 16px !important;
          padding: 0 !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08),
                      0 0 0 1px rgba(0,0,0,0.05) !important;
          overflow: hidden !important;
          display: none !important;
          flex-direction: column !important;
          bottom: 24px !important;
          right: 24px !important;
        }
        #rp-result-panel.rp-panel-visible {
          display: flex !important;
          animation: rpSlideUp 0.22s cubic-bezier(.4,0,.2,1) both !important;
        }

        /* ═══ D. TONE SUBMENU (used by inline rpSelShowToneMenu — this CSS is backup) ═══ */
        #rp-tone-menu {
          background: #1a1f2e !important;
          border-radius: 14px !important;
          padding: 6px !important;
          display: none !important;
          flex-direction: column !important;
          gap: 2px !important;
          box-shadow: 0 8px 28px rgba(0,0,0,0.35) !important;
          min-width: 140px !important;
        }
        #rp-tone-menu.rp-tone-visible { display: flex !important; }

        /* ═══ KEYFRAMES ═══ */
        @keyframes rpSlideIn {
          from { opacity:0; transform: translateY(6px) scale(0.97); }
          to   { opacity:1; transform: translateY(0) scale(1); }
        }
        @keyframes rpSlideUp {
          from { opacity:0; transform: translateY(16px); }
          to   { opacity:1; transform: translateY(0); }
        }
        @keyframes rpDotAppear {
          from { opacity:0; transform: scale(0.4); }
          to   { opacity:1; transform: scale(1); }
        }
        @keyframes rpDotPulse {
          0%,100% { box-shadow: 0 2px 8px rgba(255,107,53,0.45), 0 0 0 2px rgba(255,107,53,0.18); }
          50%     { box-shadow: 0 2px 8px rgba(255,107,53,0.45), 0 0 0 5px rgba(255,107,53,0); }
        }
        @keyframes rpLogoSpin {
          0%   { filter: brightness(1); }
          50%  { filter: brightness(1.45); }
          100% { filter: brightness(1); }
        }
        @keyframes rpScoreFill {
          from { width: 0%; }
          to   { width: var(--score-w); }
        }
      `;
      document.documentElement.appendChild(s);
    })();

    // ══════════════════════════════════════════════════════════════════════
    // SVG ICON CONSTANTS
    // ══════════════════════════════════════════════════════════════════════
    var RP_SVG = {
      /* Letter mark (replaces previous bulb-shaped logo) */
      logo: '<span style="font-size:11px;font-weight:800;color:#fff;font-family:system-ui,-apple-system,sans-serif;line-height:1;display:block">R</span>',
      rewrite: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
      reply: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><path d="M13 8l-2 4h4l-2 4" stroke-width="1.8"/></svg>',
      popup: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7M17.5 14v7" stroke-width="2.2"/></svg>',
      summarize: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="11" y2="18"/><polyline points="14 15 17 18 14 21" stroke-width="1.8"/></svg>',
      fix: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2L3 7v5c0 5.2 3.8 10 9 11 5.2-1 9-5.8 9-11V7L12 2z"/><polyline points="9 12 11 14 15 10" stroke-width="2.2"/></svg>',
      tone: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
      explain: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 015 12c-.6.6-1 1.4-1 2.2V17H8v-.8c0-.8-.4-1.6-1-2.2A7 7 0 0112 2z"/></svg>',
      close: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      copy: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
      replace: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>',
    };

    // ══════════════════════════════════════════════════════════════════════
    // A. INPUT TOOLBAR  — shows when user focuses any input/textarea/CE
    // ══════════════════════════════════════════════════════════════════════

    // ── Grammarly-style input badge: always-on dot near focused field ──
    var _rpMiniActive = null;
    var _rpMiniHideTimer = null;
    var _rpBadgeNudge = { x: 0, y: 0 };
    var _rpBadgeDrag = { active: false, moved: false, sx: 0, sy: 0, nx: 0, ny: 0 };

    function rpLoadBadgeNudge() {
      try {
        var j = localStorage.getItem('replypal_badge_nudge');
        var o = j ? JSON.parse(j) : null;
        _rpBadgeNudge.x = Math.round(Number(o && o.x) || 0);
        _rpBadgeNudge.y = Math.round(Number(o && o.y) || 0);
      } catch (_) {
        _rpBadgeNudge.x = _rpBadgeNudge.y = 0;
      }
    }

    function rpSaveBadgeNudge() {
      try {
        localStorage.setItem('replypal_badge_nudge', JSON.stringify(_rpBadgeNudge));
      } catch (_) { /* ignore */ }
    }

    function rpWireBadgeDragOnce() {
      var badge = document.getElementById('rp-input-badge');
      if (!badge || badge._rpDragWired) return;
      badge._rpDragWired = true;
      badge.title = 'ReplyPals — drag to move · double-click to reset position';
      badge.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        _rpBadgeDrag.active = true;
        _rpBadgeDrag.moved = false;
        _rpBadgeDrag.sx = e.clientX;
        _rpBadgeDrag.sy = e.clientY;
        rpLoadBadgeNudge();
        _rpBadgeDrag.nx = _rpBadgeNudge.x;
        _rpBadgeDrag.ny = _rpBadgeNudge.y;
        e.preventDefault();
      });
      document.addEventListener('mousemove', function (e) {
        if (!_rpBadgeDrag.active) return;
        var dx = e.clientX - _rpBadgeDrag.sx;
        var dy = e.clientY - _rpBadgeDrag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 5) _rpBadgeDrag.moved = true;
        _rpBadgeNudge.x = _rpBadgeDrag.nx + dx;
        _rpBadgeNudge.y = _rpBadgeDrag.ny + dy;
        if (_rpMiniActive) rpPositionBadge(_rpMiniActive);
      });
      document.addEventListener('mouseup', function () {
        if (!_rpBadgeDrag.active) return;
        _rpBadgeDrag.active = false;
        if (_rpBadgeDrag.moved) rpSaveBadgeNudge();
      });
      badge.addEventListener('dblclick', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _rpBadgeNudge.x = _rpBadgeNudge.y = 0;
        rpSaveBadgeNudge();
        if (_rpMiniActive) rpPositionBadge(_rpMiniActive);
      });
    }

    function rpEnsureBadgeAndPill() {
      // Badge dot
      if (!document.getElementById('rp-input-badge')) {
        var badge = document.createElement('div');
        badge.id = 'rp-input-badge';
        badge.innerHTML = RP_SVG.logo;
        document.documentElement.appendChild(badge);
        rpWireBadgeDragOnce();
      }
      // Input pill (expanded view)
      if (document.getElementById('rp-input-pill')) return;

      var pill = document.createElement('div');
      pill.id = 'rp-input-pill';

      // Logo in pill
      var pLogo = document.createElement('div');
      pLogo.className = 'rp-pill-logo';
      pLogo.innerHTML = RP_SVG.logo;
      pill.appendChild(pLogo);

      var sep0 = document.createElement('span');
      sep0.className = 'rp-ip-sep';
      pill.appendChild(sep0);

      var IP_BTNS = [
        { cls: 'rp-ip-rewrite', tip: 'Rewrite',       icon: RP_SVG.rewrite, action: 'rewrite'       },
        { cls: 'rp-ip-reply',   tip: 'Generate Reply', icon: RP_SVG.reply,   action: 'generate-reply'},
        { cls: 'rp-ip-popup',   tip: 'Open ReplyPals',  icon: RP_SVG.popup,   action: 'open-popup'   },
      ];

      IP_BTNS.forEach(function(cfg) {
        var btn = document.createElement('button');
        btn.className = 'rp-ip-btn ' + cfg.cls;
        btn.setAttribute('data-tip', cfg.tip);
        btn.innerHTML = cfg.icon;
        btn.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopPropagation();
          rpHideInputPill();
          rpHandleInputAction(cfg.action);
        });
        pill.appendChild(btn);
      });

      pill.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
      });

      document.documentElement.appendChild(pill);
    }

    function rpPositionBadge(el) {
      var badge = document.getElementById('rp-input-badge');
      var pill  = document.getElementById('rp-input-pill');
      if (!badge || !el) return;
      rpLoadBadgeNudge();
      rpWireBadgeDragOnce();
      var anchor = rpResolveAnchorElement(el) || el;
      var r = anchor.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;

      // Badge sits at bottom-right corner of the field (like Grammarly)
      var bLeft = Math.min(r.right - 12, window.innerWidth - 28);
      var bTop  = Math.min(r.bottom - 12, window.innerHeight - 28);
      bLeft = Math.max(4, Math.min(window.innerWidth - 26, bLeft + _rpBadgeNudge.x));
      bTop  = Math.max(4, Math.min(window.innerHeight - 26, bTop + _rpBadgeNudge.y));
      badge.style.left = bLeft + 'px';
      badge.style.top  = bTop + 'px';

      // Pill appears just above the badge
      if (pill) {
        var pillW = 190;
        var baseLeft = Math.min(r.right - 12, window.innerWidth - 28);
        var baseTop  = Math.min(r.bottom - 12, window.innerHeight - 28);
        var pLeft = Math.max(4, Math.min(baseLeft - pillW + 22, window.innerWidth - pillW - 4) + _rpBadgeNudge.x);
        var pTop  = Math.max(4, baseTop - 46 + _rpBadgeNudge.y);
        pill.style.left = pLeft + 'px';
        pill.style.top  = pTop  + 'px';
      }
    }

    function rpShowInputBadge(el) {
      clearTimeout(_rpMiniHideTimer);
      _rpMiniActive = el;
      rpEnsureBadgeAndPill();
      rpPositionBadge(el);

      var badge = document.getElementById('rp-input-badge');
      if (!badge) return;
      badge.classList.add('rp-badge-visible');

      // Hover badge → show pill
      var pillHideTimer = null;
      badge.onmouseenter = function() {
        clearTimeout(pillHideTimer);
        var pill = document.getElementById('rp-input-pill');
        if (pill) { rpPositionBadge(_rpMiniActive); pill.classList.add('rp-pill-visible'); }
      };
      badge.onmouseleave = function() {
        pillHideTimer = setTimeout(function() {
          var pill = document.getElementById('rp-input-pill');
          if (pill && !pill.matches(':hover')) pill.classList.remove('rp-pill-visible');
        }, 300);
      };
      var pill = document.getElementById('rp-input-pill');
      if (pill) {
        pill.onmouseenter = function() { clearTimeout(pillHideTimer); };
        pill.onmouseleave = function() {
          pillHideTimer = setTimeout(function() {
            pill.classList.remove('rp-pill-visible');
          }, 350);
        };
      }
    }

    function rpHideInputBadge(delay) {
      _rpMiniHideTimer = setTimeout(function() {
        var badge = document.getElementById('rp-input-badge');
        var pill  = document.getElementById('rp-input-pill');
        if (badge) badge.classList.remove('rp-badge-visible');
        if (pill)  pill.classList.remove('rp-pill-visible');
      }, delay || 300);
    }

    function rpHideInputPill() {
      var pill = document.getElementById('rp-input-pill');
      if (pill) pill.classList.remove('rp-pill-visible');
    }

    // Backward-compatible aliases used by global listeners.
    function rpMiniShowOn(el) { rpShowInputBadge(el); }
    function rpMiniHide() { rpHideInputBadge(0); }

    function rpHandleInputAction(action) {
      if (action === 'open-popup') {
        rpHydrateQuotaFromStorage(function () {
          if (rpIsQuotaBlocked()) {
            rpOpenUpgradeForLimit();
            return;
          }
          safeSendMessage({ action: 'openPopup' });
        });
        return;
      }
      rpHydrateQuotaFromStorage(function () {
        if (rpIsQuotaBlocked()) {
          rpOpenUpgradeForLimit();
          return;
        }

        var el = _rpMiniActive;
        if (!el) return;
        var txt = readText(el);
        if (!txt || !txt.trim()) { showToast('Type something first!', 'error'); return; }

        var pill = document.getElementById('rp-input-pill');
        if (pill) pill.classList.add('rp-loading');

        var mode = (action === 'generate-reply') ? 'reply' : 'rewrite';

        safeStorageGet(['replypalTone'], function (s) {
          var useTone = s.replypalTone || selectedTone || 'Friendly';
          safeSendMessage(
            { type: 'selectionAction', payload: { text: txt, mode: mode, tone: useTone } },
            function (res) {
              if (pill) pill.classList.remove('rp-loading');
              if (res && res.success && res.data) {
                rpApplyQuotaFromApi(res.data);
                var out = res.data.rewritten || res.data.generated || res.data.text || '';
                if (mode === 'rewrite') {
                  setText(el, out);
                  rpShowScoreToast(res.data.score);
                } else {
                  rpShowResultPanel(mode, out, res.data.score);
                }
              } else if (rpIsLimitReachedError(res)) {
                rpOpenUpgradeForLimit(txt);
              } else {
                rpShowErrorToast((res && res.error) || 'Failed');
              }
            }
          );
        });
      });
    }

    // ── Attach to a single element (idempotent) ──
    function rpMiniAttach(el) {
      if (el._rpMiniAttached) return;
      el._rpMiniAttached = true;
      el.addEventListener('focus', function() { rpShowInputBadge(el); }, true);
      el.addEventListener('blur',  function() { rpHideInputBadge(400); }, true);
      el.addEventListener('click', function() { rpShowInputBadge(el); }, true);
      el.addEventListener('input', function() {
        if (document.activeElement === el || el.contains(document.activeElement)) {
          rpPositionBadge(el); // reposition in case field grew
        }
      }, true);
    }

    var RP_EXTRA_SELECTORS = [
      'input:not([type="hidden"]):not([type="password"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="submit"]):not([type="button"]):not([type="reset"])',
      'input[type="text"]','input[type="email"]','input[type="search"]',
      'input[type="url"]','input[type="tel"]','input:not([type])',
      'textarea',
      '[contenteditable="true"]','[contenteditable=""]',
      '[role="textbox"]','[role="combobox"]',
      '.msg-form__contenteditable',
      '.comments-comment-box__form [contenteditable]',
      '[g_editable="true"]', '.Am.Al.editable',
      'div[aria-label="Message Body"]',
      'div[aria-label="Message Body"] [contenteditable="true"]',
      '[data-testid="tweetTextarea_0"]',
      '[data-testid="tweetTextarea_0_label"]',
      '.ql-editor', '.ProseMirror', '.public-DraftEditor-content',
      '.notion-page-content [contenteditable]',
    ].join(',');

    function rpMiniScanAndAttach(root) {
      root = root || document;
      try {
        root.querySelectorAll(RP_EXTRA_SELECTORS).forEach(function(el) {
          var r = getEditableRoot(el);
          if (r) rpMiniAttach(r);
        });
        root.querySelectorAll('[contenteditable]').forEach(function(el) {
          if (el.contentEditable !== 'false') rpMiniAttach(el);
        });
      } catch(e) {}
    }

    // MutationObserver for dynamic inputs (React/Vue/etc)
    var _rpDomObserver = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          var r = getEditableRoot(node);
          if (r) rpMiniAttach(r);
          try { if (node.querySelectorAll) rpMiniScanAndAttach(node); } catch(e) {}
        }
      }
    });
    _rpDomObserver.observe(document.documentElement, { childList: true, subtree: true });

    // Reposition badge on scroll/resize
    window.addEventListener('scroll', function() {
      if (_rpMiniActive) rpPositionBadge(_rpMiniActive);
    }, { passive: true });
    window.addEventListener('resize', function() {
      if (_rpMiniActive) rpPositionBadge(_rpMiniActive);
    }, { passive: true });

    // SPA URL-change rescan
    var _rpLastUrl = location.href;
    new MutationObserver(function() {
      if (location.href !== _rpLastUrl) {
        _rpLastUrl = location.href;
        setTimeout(function() { rpMiniScanAndAttach(document); }, 900);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });

    // Wire focusin to show badge
    document.addEventListener('focusin', function(e) {
      var root = getEditableRoot(e.target);
      if (root) { renderFixBtn(root); rpShowInputBadge(root); }
    }, true);
    document.addEventListener('mousedown', function(e) {
      if (_popup && !_popup.contains(e.target)) { _popup.remove(); _popup = null; clearInterval(_tipTimer); }
      // Hide input badge if clicking far from badge/pill
      var badge = document.getElementById('rp-input-badge');
      var pill  = document.getElementById('rp-input-pill');
      var root  = getEditableRoot(e.target);
      if (!root && badge && !badge.contains(e.target) && !pill?.contains(e.target)) {
        rpHideInputBadge(0);
      }
      // Hide selection toolbar if clicking outside
      var selTb = document.getElementById(RP_SEL_ID);
      if (selTb && !selTb.contains(e.target)) selTb.style.display = 'none';
      // Close tone submenu too
      var toneMenu = document.getElementById('rp-tone-menu');
      if (toneMenu && !toneMenu.contains(e.target)) toneMenu.remove();
    }, true);

    // Initial scan
    rpEnsureBadgeAndPill();
    rpMiniScanAndAttach(document);
    window.addEventListener('load', function() { rpMiniScanAndAttach(document); });

    // ══════════════════════════════════════════════════════════════════════
    // B. SELECTION TOOLBAR — Grammarly-style compact icon row
    // ══════════════════════════════════════════════════════════════════════

    var _rpSelTbNudge = { x: 0, y: 0 };
    function rpLoadSelTbNudge() {
      try {
        var j = localStorage.getItem('replypal_sel_toolbar_nudge');
        var o = j ? JSON.parse(j) : null;
        _rpSelTbNudge.x = Math.round(Number(o && o.x) || 0);
        _rpSelTbNudge.y = Math.round(Number(o && o.y) || 0);
      } catch (_) {
        _rpSelTbNudge.x = _rpSelTbNudge.y = 0;
      }
    }
    function rpSaveSelTbNudge() {
      try {
        localStorage.setItem('replypal_sel_toolbar_nudge', JSON.stringify(_rpSelTbNudge));
      } catch (_) { /* ignore */ }
    }

    var _rpSelTbDrag = null;
    function rpInitSelToolbarDragOnce() {
      if (rpInitSelToolbarDragOnce._done) return;
      rpInitSelToolbarDragOnce._done = true;
      document.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        var t = e.target;
        if (!t || t.id !== 'rp-sel-toolbar-logo') return;
        var tb = document.getElementById(RP_SEL_ID);
        if (!tb) return;
        rpLoadSelTbNudge();
        _rpSelTbDrag = {
          mx: e.clientX,
          my: e.clientY,
          n0x: _rpSelTbNudge.x,
          n0y: _rpSelTbNudge.y,
          tb: tb,
        };
        e.preventDefault();
        e.stopPropagation();
      }, true);
      document.addEventListener('mousemove', function (e) {
        if (!_rpSelTbDrag || !_rpSelTbDrag.tb) return;
        _rpSelTbNudge.x = _rpSelTbDrag.n0x + (e.clientX - _rpSelTbDrag.mx);
        _rpSelTbNudge.y = _rpSelTbDrag.n0y + (e.clientY - _rpSelTbDrag.my);
        var tb = _rpSelTbDrag.tb;
        var bl = typeof tb._rpBaseLeft === 'number' ? tb._rpBaseLeft : 0;
        var bt = typeof tb._rpBaseTop === 'number' ? tb._rpBaseTop : 0;
        var tw = tb.offsetWidth || 300;
        var th = tb.offsetHeight || 44;
        var nl = bl + _rpSelTbNudge.x;
        var nt = bt + _rpSelTbNudge.y;
        nl = Math.max(4, Math.min(nl, window.innerWidth - tw - 4));
        nt = Math.max(4, Math.min(nt, window.innerHeight - th - 4));
        tb.style.left = nl + 'px';
        tb.style.top = nt + 'px';
      });
      document.addEventListener('mouseup', function () {
        if (_rpSelTbDrag) {
          rpSaveSelTbNudge();
          _rpSelTbDrag = null;
        }
      });
      document.addEventListener('dblclick', function (e) {
        if (!e.target || e.target.id !== 'rp-sel-toolbar-logo') return;
        e.preventDefault();
        e.stopPropagation();
        _rpSelTbNudge.x = _rpSelTbNudge.y = 0;
        rpSaveSelTbNudge();
        var tb = document.getElementById(RP_SEL_ID);
        if (tb && typeof tb._rpBaseLeft === 'number') {
          tb.style.left = (tb._rpBaseLeft + _rpSelTbNudge.x) + 'px';
          tb.style.top = (tb._rpBaseTop + _rpSelTbNudge.y) + 'px';
        }
      }, true);
    }

    var SEL_BTNS = [
      {
        // index 0 — Rewrite: rewrites/improves the selected text
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
        label: 'Rewrite', action: 'sel-rewrite', color: '#FF6B35',
      },
      {
        // index 1 — Write: generates NEW original content from the selected text as a topic/idea
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
        label: 'Write', action: 'sel-write', color: '#a855f7',
      },
      {
        // index 2 — Reply: writes a REPLY to the selected message (as if someone sent it to you)
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>',
        label: 'Reply', action: 'sel-reply', color: '#6366f1',
      },
      {
        // index 3 — Summarize
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>',
        label: 'Summarize', action: 'sel-summary', color: '#0ea5e9',
      },
      {
        // index 4 — Explain
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
        label: 'Explain', action: 'sel-meaning', color: '#f59e0b',
      },
      {
        // index 5 — Fix Grammar
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
        label: 'Fix Grammar', action: 'sel-fix', color: '#10b981',
      },
      {
        // index 6 — Translate
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/></svg>',
        label: 'Translate', action: 'sel-translate', color: '#8b5cf6',
      },
      {
        // index 7 — Change Tone (has divider before it, set idx === 7 in rpCreateSelToolbar)
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>',
        label: 'Change Tone', action: 'sel-tone', color: '#ec4899', hasCaret: true,
      },
    ];


    function rpCreateSelToolbar() {
      var existing = document.getElementById(RP_SEL_ID);
      if (existing) existing.remove();

      var tb = document.createElement('div');
      tb.id = RP_SEL_ID;
      // ⚠️  Do NOT use all:initial/all:unset here — it fights with display:flex
      // Just set every needed property explicitly so host CSS can't override
      tb.setAttribute('style', [
        'position:fixed',
        'z-index:2147483647',
        'display:none',        // shown by rpShowSelToolbar
        'flex-direction:row',
        'align-items:center',
        'gap:2px',
        'background:#1a1d2e',
        'border-radius:100px',
        'padding:5px 10px',
        'box-shadow:0 4px 24px rgba(0,0,0,0.35),0 1px 6px rgba(0,0,0,0.2)',
        'font-family:system-ui,-apple-system,sans-serif',
        'pointer-events:all',
        'user-select:none',
        'box-sizing:border-box',
        'margin:0',
        'border:none',
        'outline:none',
        'opacity:1',
        'visibility:visible',
        'transform:none',
        'filter:none',
        'overflow:visible',
      ].join(';') + ';');

      // Logo mark (orange circle with R)
      var logo = document.createElement('div');
      logo.setAttribute('style',
        'width:20px;height:20px;border-radius:50%;' +
        'background:linear-gradient(135deg,#FF6B35,#FF8C42);' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-size:10px;line-height:1;color:#fff;font-weight:700;' +
        'margin-right:4px;flex-shrink:0;box-sizing:border-box;');
      logo.id = 'rp-sel-toolbar-logo';
      logo.textContent = 'R';
      logo.style.cursor = 'grab';
      logo.title = 'ReplyPals — drag to move toolbar · double-click to reset';
      tb.appendChild(logo);
      rpInitSelToolbarDragOnce();

      // Divider after logo
      var d0 = document.createElement('div');
      d0.setAttribute('style',
        'width:1px;height:18px;background:rgba(255,255,255,0.15);margin:0 4px;flex-shrink:0;');
      tb.appendChild(d0);

      SEL_BTNS.forEach(function(cfg, idx) {
        // Divider before Change Tone (index 7 after adding Write + Reply)
        if (idx === 7) {
          var dv = document.createElement('div');
          dv.setAttribute('style',
            'width:1px;height:18px;background:rgba(255,255,255,0.15);margin:0 3px;flex-shrink:0;');
          tb.appendChild(dv);
        }

        // Wrapper — needed for absolute-positioned tooltip
        var wrap = document.createElement('div');
        wrap.setAttribute('style',
          'position:relative;display:flex;align-items:center;justify-content:center;flex-shrink:0;');

        // Button
        var b = document.createElement('button');
        // Hardcode white stroke color in icon HTML so we never depend on currentColor
        var iconHtml = cfg.icon
          .replace(/stroke="currentColor"/g,  'stroke="rgba(255,255,255,0.75)"')
          .replace(/fill="currentColor"/g,    'fill="rgba(255,255,255,0.75)"');
        if (cfg.hasCaret) {
          iconHtml += '<svg width="6" height="6" viewBox="0 0 10 6" ' +
            'fill="rgba(255,255,255,0.5)" style="margin-left:2px;display:inline-block">' +
            '<path d="M0 0l5 6 5-6z"/></svg>';
        }
        b.innerHTML = iconHtml;
        b.setAttribute('style', [
          'display:flex',
          'align-items:center',
          'justify-content:center',
          'width:28px',
          'height:28px',
          'border-radius:50%',
          'cursor:pointer',
          'border:none',
          'outline:none',
          'background:transparent',
          'padding:0',
          'margin:0',
          'flex-shrink:0',
          'box-sizing:border-box',
          'transition:background 0.12s,transform 0.1s',
          'appearance:none',
          '-webkit-appearance:none',
        ].join(';') + ';');

        // Tooltip
        var tip = document.createElement('div');
        tip.textContent = cfg.label;
        tip.setAttribute('style', [
          'position:absolute',
          'bottom:calc(100% + 8px)',
          'left:50%',
          'transform:translateX(-50%)',
          'background:#0f172a',
          'color:#fff',
          'font-size:11px',
          'font-weight:600',
          'font-family:system-ui,-apple-system,sans-serif',
          'white-space:nowrap',
          'padding:4px 8px',
          'border-radius:6px',
          'pointer-events:none',
          'opacity:0',
          'transition:opacity 0.15s',
          'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
          'z-index:2147483647',
          'line-height:1.4',
        ].join(';') + ';');
        // Tooltip arrow
        var arr = document.createElement('div');
        arr.setAttribute('style',
          'position:absolute;top:100%;left:50%;transform:translateX(-50%);' +
          'width:0;height:0;border-left:4px solid transparent;' +
          'border-right:4px solid transparent;border-top:4px solid #0f172a;');
        tip.appendChild(arr);

        // Hover effects
        b.addEventListener('mouseenter', function() {
          b.style.background = cfg.color + '33';
          b.style.transform  = 'scale(1.18)';
          tip.style.opacity  = '1';
          // Tint the SVG strokes to the button's accent color
          var svgs = b.querySelectorAll('svg');
          svgs.forEach(function(s) {
            s.querySelectorAll('[stroke]').forEach(function(el) {
              el.setAttribute('stroke', cfg.color);
            });
            s.querySelectorAll('[fill]:not([fill="none"])').forEach(function(el) {
              if (el.getAttribute('fill') !== 'none') el.setAttribute('fill', cfg.color);
            });
          });
        });
        b.addEventListener('mouseleave', function() {
          b.style.background = 'transparent';
          b.style.transform  = 'scale(1)';
          tip.style.opacity  = '0';
          // Restore original stroke/fill colors
          var svgs = b.querySelectorAll('svg');
          svgs.forEach(function(s) {
            s.querySelectorAll('[stroke]').forEach(function(el) {
              el.setAttribute('stroke', 'rgba(255,255,255,0.75)');
            });
            s.querySelectorAll('[fill]:not([fill="none"])').forEach(function(el) {
              if (el.getAttribute('fill') !== 'none') el.setAttribute('fill', 'rgba(255,255,255,0.75)');
            });
          });
        });
        b.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopPropagation();
          if (cfg.action === 'sel-tone') {
            rpSelShowToneMenu(wrap);
            return;
          }
          if (cfg.action === 'sel-translate') {
            // Always show full translate picker for selection flow.
            rpSelShowTranslatePicker(wrap, function(targetLang) {
              tb.style.display = 'none';
              rpTriggerTranslate(text || (window.getSelection() ? window.getSelection().toString().trim() : ''), targetLang);
            });
            return;
          }
          tb.style.display = 'none';
          rpHandleSelAction(cfg.action);
        });

        wrap.appendChild(b);
        wrap.appendChild(tip);
        tb.appendChild(wrap);
      });

      tb.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
      });

      document.documentElement.appendChild(tb);
      _rpSelToolbar = tb;
      return tb;
    }

    function rpShowSelToolbar(rect) {
      rpInitSelToolbarDragOnce();
      var tb = _rpSelToolbar || rpCreateSelToolbar();
      var toolbarW = 300;
      var toolbarH = 44;

      var left = rect.left + (rect.width / 2) - (toolbarW / 2);
      var top  = rect.top - toolbarH - 10;
      if (top < 8) top = rect.bottom + 10;

      var baseLeft = Math.max(8, Math.min(left, window.innerWidth - toolbarW - 8));
      var baseTop = Math.max(8, top);
      tb._rpBaseLeft = baseLeft;
      tb._rpBaseTop = baseTop;
      rpLoadSelTbNudge();
      tb.style.left = (baseLeft + _rpSelTbNudge.x) + 'px';
      tb.style.top = (baseTop + _rpSelTbNudge.y) + 'px';
      tb.style.display = 'flex';
    }

    function rpHideSelToolbar() {
      if (_rpSelToolbar) _rpSelToolbar.style.display = 'none';
    }

    function rpHandleSelAction(action) {
      var sel  = window.getSelection();
      var text = sel ? sel.toString().trim() : '';
      if (!text) return;
      rpHideSelToolbar();

      var modeMap = {
        'sel-rewrite':   'rewrite',
        'sel-write':     'write',    // generate NEW content from topic
        'sel-reply':     'reply',    // reply TO the selected message
        'sel-summary':   'summary',
        'sel-meaning':   'meaning',
        'sel-fix':       'fix',
        'sel-translate': 'translate',
      };
      var mode = modeMap[action] || 'rewrite';
      rpTriggerSelAction(text, mode, null);
    }

    function rpTriggerSelAction(text, mode, tone) {
      if (!text || !text.trim()) {
        rpShowErrorToast('No selected text found');
        return;
      }
      rpHydrateQuotaFromStorage(function() {
        if (rpIsQuotaBlocked()) {
          rpOpenUpgradeForLimit(text);
          return;
        }

        rpShowLoadingPanel(mode);
        safeStorageGet(['replypalLanguage'], function(st) {
          var selectedLang = (st && st.replypalLanguage) ? String(st.replypalLanguage) : 'auto';
          safeSendMessage(
            { type: 'selectionAction', payload: {
              text: text,
              mode: mode,
              tone: tone || null,
              language: selectedLang,
              event_id: crypto.randomUUID()
            } },
            function(res) {
              var errMsg = (res && res.error) ? String(res.error)
                : (!res ? 'No response from extension. Reload the page or check the extension.' : 'Action failed');
              if (res && res.success && res.data) {
                rpApplyQuotaFromApi(res.data);
                var out = res.data.rewritten || res.data.generated || res.data.text || '';
                if (!out || !String(out).trim()) out = '⚠️ No output returned from AI';
                rpShowResultPanel(mode, out, res.data.score);
              } else if (rpIsLimitReachedError(res)) {
                var pnl = document.getElementById('rp-result-panel');
                if (pnl) pnl.classList.remove('rp-panel-visible');
                rpOpenUpgradeForLimit(text);
              } else {
                rpShowResultPanel(mode, '⚠️ ' + errMsg, null);
                rpShowErrorToast(errMsg);
              }
            }
          );
        });
      });
    }

    function rpSelShowToneMenu(anchorEl) {
      var existing = document.getElementById('rp-tone-menu');
      if (existing) { existing.remove(); return; }

      var TONES_SEL = [
        { emoji: '\uD83D\uDC54', label: 'Formal'     },
        { emoji: '\uD83D\uDE0A', label: 'Friendly'   },
        { emoji: '\uD83D\uDE4F', label: 'Polite'     },
        { emoji: '\uD83D\uDCAA', label: 'Confident'  },
        { emoji: '\uD83D\uDC99', label: 'Empathetic' },
        { emoji: '\u26A1',       label: 'Concise'    },
      ];

      var menu = document.createElement('div');
      menu.id = 'rp-tone-menu';
      var ar = anchorEl.getBoundingClientRect();
      menu.style.cssText = [
        'all:initial!important',
        'position:fixed!important',
        'z-index:2147483647!important',
        'bottom:' + (window.innerHeight - ar.top + 8) + 'px',
        'left:' + Math.max(8, ar.left - 60) + 'px',
        'background:#1a1d2e',
        'border-radius:12px',
        'padding:6px',
        'box-shadow:0 8px 28px rgba(0,0,0,0.3)',
        'display:flex',
        'flex-direction:column',
        'gap:2px',
        'font-family:system-ui!important',
        'pointer-events:all',
      ].join(';');

      TONES_SEL.forEach(function(tone) {
        var item = document.createElement('button');
        item.style.cssText = 'all:unset;display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;color:rgba(255,255,255,0.8);white-space:nowrap;transition:background 0.1s;font-family:system-ui!important;';
        item.innerHTML = '<span style="font-size:14px">' + tone.emoji + '</span>' + tone.label;
        item.addEventListener('mouseenter', function() { item.style.background = 'rgba(255,107,53,0.2)'; item.style.color = '#FF6B35'; });
        item.addEventListener('mouseleave', function() { item.style.background = 'none'; item.style.color = 'rgba(255,255,255,0.8)'; });
        item.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopPropagation();
          menu.remove();
          rpHideSelToolbar();
          var sel  = window.getSelection();
          var text = sel ? sel.toString().trim() : '';
          if (text) rpTriggerSelAction(text, 'rewrite', tone.label);
        });
        menu.appendChild(item);
      });

      document.documentElement.appendChild(menu);
      // Close on outside click
      setTimeout(function() {
        document.addEventListener('mousedown', function removeToneMenu() {
          menu.remove();
          document.removeEventListener('mousedown', removeToneMenu);
        });
      }, 100);
    }

    // mouseup → show / hide selection toolbar
    document.addEventListener('mouseup', function(e) {
      var selTb = document.getElementById(RP_SEL_ID);
      if (selTb && selTb.contains(e.target)) return;
      // Don't re-show toolbar when interacting with the result panel
      var resultPanel = document.getElementById('rp-result-panel');
      if (resultPanel && resultPanel.contains(e.target)) return;

      setTimeout(function() {
        var sel  = window.getSelection();
        var text = sel ? sel.toString().trim() : '';

        if (text && text.length >= 5 && sel.rangeCount > 0 && !rpIsSelectionInsideExcludedInput(sel)) {
          try {
            var rect = sel.getRangeAt(0).getBoundingClientRect();
            if (rect.width >= 0 && rect.height >= 0) {
              rpShowSelToolbar(rect);
            }
          } catch(ex) {}
        } else {
          rpHideSelToolbar();
        }
      }, 20);
    });

    // ══════════════════════════════════════════════════════════════════════
    // C. RESULT PANEL
    // ══════════════════════════════════════════════════════════════════════


    // ─── Translate language picker ───────────────────────────────────────────
    var TRANSLATE_LANGS = [
      { code: 'en',    label: 'English 🇬🇧',    flag: '🇬🇧' },
      { code: 'hi',    label: 'Hindi 🇮🇳',       flag: '🇮🇳' },
      { code: 'ar',    label: 'Arabic 🇸🇦',       flag: '🇸🇦' },
      { code: 'es',    label: 'Spanish 🇪🇸',      flag: '🇪🇸' },
      { code: 'fr',    label: 'French 🇫🇷',       flag: '🇫🇷' },
      { code: 'de',    label: 'German 🇩🇪',       flag: '🇩🇪' },
      { code: 'pt',    label: 'Portuguese 🇧🇷',   flag: '🇧🇷' },
      { code: 'zh',    label: 'Chinese 🇨🇳',      flag: '🇨🇳' },
      { code: 'ja',    label: 'Japanese 🇯🇵',     flag: '🇯🇵' },
      { code: 'ko',    label: 'Korean 🇰🇷',       flag: '🇰🇷' },
      { code: 'ml',    label: 'Malayalam 🇮🇳',    flag: '🇮🇳' },
      { code: 'ta',    label: 'Tamil 🇮🇳',        flag: '🇮🇳' },
      { code: 'te',    label: 'Telugu 🇮🇳',       flag: '🇮🇳' },
      { code: 'bn',    label: 'Bengali 🇧🇩',      flag: '🇧🇩' },
      { code: 'fil',   label: 'Filipino 🇵🇭',     flag: '🇵🇭' },
      { code: 'ru',    label: 'Russian 🇷🇺',      flag: '🇷🇺' },
      { code: 'tr',    label: 'Turkish 🇹🇷',      flag: '🇹🇷' },
      { code: 'id',    label: 'Indonesian 🇮🇩',   flag: '🇮🇩' },
      { code: 'it',    label: 'Italian 🇮🇹',      flag: '🇮🇹' },
      { code: 'nl',    label: 'Dutch 🇳🇱',        flag: '🇳🇱' },
      { code: 'pl',    label: 'Polish 🇵🇱',       flag: '🇵🇱' },
      { code: 'sv',    label: 'Swedish 🇸🇪',      flag: '🇸🇪' },
      { code: 'no',    label: 'Norwegian 🇳🇴',    flag: '🇳🇴' },
      { code: 'da',    label: 'Danish 🇩🇰',       flag: '🇩🇰' },
      { code: 'fi',    label: 'Finnish 🇫🇮',      flag: '🇫🇮' },
      { code: 'el',    label: 'Greek 🇬🇷',        flag: '🇬🇷' },
      { code: 'he',    label: 'Hebrew 🇮🇱',       flag: '🇮🇱' },
      { code: 'uk',    label: 'Ukrainian 🇺🇦',    flag: '🇺🇦' },
      { code: 'vi',    label: 'Vietnamese 🇻🇳',   flag: '🇻🇳' },
      { code: 'th',    label: 'Thai 🇹🇭',         flag: '🇹🇭' },
      { code: 'ms',    label: 'Malay 🇲🇾',        flag: '🇲🇾' },
      { code: 'ur',    label: 'Urdu 🇵🇰',         flag: '🇵🇰' },
    ];

    function rpSelShowTranslatePicker(anchorEl, onSelect) {
      var existing = document.getElementById('rp-translate-picker');
      if (existing) { existing.remove(); return; }

      var menu = document.createElement('div');
      menu.id = 'rp-translate-picker';
      var ar = anchorEl.getBoundingClientRect();
      menu.style.cssText = [
        'position:fixed',
        'z-index:2147483647',
        'bottom:' + (window.innerHeight - ar.top + 8) + 'px',
        'left:' + Math.max(8, ar.left - 40) + 'px',
        'background:#1a1d2e',
        'border-radius:14px',
        'padding:10px 8px',
        'box-shadow:0 10px 32px rgba(0,0,0,0.35),0 2px 8px rgba(0,0,0,0.2)',
        'display:flex',
        'flex-direction:column',
        'gap:2px',
        'font-family:system-ui,-apple-system,sans-serif',
        'pointer-events:all',
        'max-height:300px',
        'overflow-y:auto',
        'min-width:200px',
      ].join(';');

      // Header
      var header = document.createElement('div');
      header.style.cssText = 'color:rgba(255,255,255,0.5);font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:2px 8px 8px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:4px;';
      header.textContent = 'Translate to…';
      menu.appendChild(header);

      TRANSLATE_LANGS.forEach(function(lang) {
        var item = document.createElement('button');
        item.style.cssText = 'all:unset;display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:500;color:rgba(255,255,255,0.85);white-space:nowrap;transition:background 0.12s,color 0.12s;box-sizing:border-box;width:100%;';
        item.innerHTML = '<span style="font-size:16px;width:22px;flex-shrink:0">' + lang.flag + '</span>' +
                         '<span>' + lang.label.split(' ')[0] + '</span>';
        item.addEventListener('mouseenter', function() { item.style.background = 'rgba(139,92,246,0.25)'; item.style.color = '#a78bfa'; });
        item.addEventListener('mouseleave', function() { item.style.background = 'none'; item.style.color = 'rgba(255,255,255,0.85)'; });
        item.addEventListener('mousedown', function(ev) {
          ev.preventDefault(); ev.stopPropagation();
          menu.remove();
          onSelect(lang);
        });
        menu.appendChild(item);
      });

      document.documentElement.appendChild(menu);
      setTimeout(function() {
        function closeOnOutside(ev) {
          if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', closeOnOutside, true); }
        }
        document.addEventListener('mousedown', closeOnOutside, true);
      }, 100);
    }

    function rpTriggerTranslate(text, targetLang) {
      if (!text) return;
      // Build a translate prompt that specifies the target language explicitly
      var prompt = text;
      var mode = 'translate';
      var cleanName = 'English';
      if (targetLang && targetLang.label) {
        // Keep only the language word(s) before flag/emoji, e.g. "French 🇫🇷" -> "French"
        cleanName = String(targetLang.label).split(' ').filter(function(tok) {
          return tok && tok.charCodeAt(0) < 0xd800; // skip surrogate-pair emoji tokens
        }).join(' ').trim() || 'English';
      }
      rpHydrateQuotaFromStorage(function() {
        if (rpIsQuotaBlocked()) {
          rpOpenUpgradeForLimit(text);
          return;
        }

        rpShowLoadingPanel(mode);
        safeSendMessage(
          { type: 'selectionAction', payload: {
              text: text,
              mode: mode,
              tone: null,
              targetLang: cleanName,
              targetLangCode: targetLang ? targetLang.code : 'en',
              targetLangName: cleanName,
              event_id: crypto.randomUUID()
            }
          },
          function(res) {
            if (res && res.success && res.data) {
              rpApplyQuotaFromApi(res.data);
              var out = res.data.rewritten || res.data.generated || res.data.text || '';
              rpShowResultPanel(mode, out, null);
            } else if (rpIsLimitReachedError(res)) {
              rpOpenUpgradeForLimit(text);
            } else {
              var msg = (res && (res.error || res.message)) || 'Translation failed';
              rpShowResultPanel(mode, '⚠️ ' + msg, null);
              rpShowErrorToast(msg);
            }
          }
        );
      });
    }


    function rpGetOrCreatePanel() {
      var p = document.getElementById('rp-result-panel');
      if (!p) {
        p = document.createElement('div');
        p.id = 'rp-result-panel';
        document.documentElement.appendChild(p);
      }
      return p;
    }

    function rpShowLoadingPanel(mode) {
      var panel = rpGetOrCreatePanel();
      var LABELS = {
        rewrite:   'Rewriting…',
        write:     'Writing content…',
        reply:     'Writing your reply…',
        summary:   'Summarizing…',
        fix:       'Fixing grammar…',
        meaning:   'Explaining…',
        translate: 'Translating…',
      };
      panel.innerHTML =
        '<div style="background:linear-gradient(135deg,#FF6B35,#FF4500);padding:12px 16px;' +
            'display:flex;align-items:center;justify-content:space-between">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<div style="width:22px;height:22px;border-radius:7px;background:rgba(255,255,255,0.2);' +
                'display:flex;align-items:center;justify-content:center">' + RP_SVG.logo + '</div>' +
            '<span style="color:white;font-size:12px;font-weight:700;letter-spacing:0.04em;' +
                'text-transform:uppercase">ReplyPals</span>' +
          '</div>' +
          '<button id="rp-panel-close-inner" style="all:unset;color:rgba(255,255,255,0.7);cursor:pointer;' +
              'display:flex;align-items:center;justify-content:center;width:22px;height:22px;' +
              'border-radius:50%">' + RP_SVG.close + '</button>' +
        '</div>' +
        '<div style="padding:20px 16px;display:flex;align-items:center;gap:10px;background:#fff">' +
          '<div style="width:8px;height:8px;border-radius:50%;background:#FF6B35;flex-shrink:0;' +
              'animation:rpDotPulse 1s infinite"></div>' +
          '<span style="font-size:13px;color:#64748b;font-style:italic">' +
            (LABELS[mode] || 'Processing\u2026') +
          '</span>' +
        '</div>';
      panel.classList.add('rp-panel-visible');
      var closeInner = document.getElementById('rp-panel-close-inner');
      if (closeInner) closeInner.addEventListener('click', function() { panel.classList.remove('rp-panel-visible'); });
    }

    function rpShowResultPanel(mode, text, score) {
      var panel = rpGetOrCreatePanel();
      var META = {
        rewrite:   { label: 'Rewritten',       color: '#FF6B35' },
        write:     { label: 'Generated Content', color: '#a855f7' },
        reply:     { label: 'Your Reply',        color: '#6366f1' },
        summary:   { label: 'Summary',           color: '#0ea5e9' },
        fix:       { label: 'Fixed',             color: '#10b981' },
        meaning:   { label: 'Explanation',       color: '#f59e0b' },
        translate: { label: 'Translation',       color: '#8b5cf6' },
      };
      var meta = META[mode] || META.rewrite;
      var scoreColor = !score ? '#94a3b8' : score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
      var scoreW = score ? score + '%' : '0%';
      var canInsert = (mode === 'rewrite' || mode === 'write' || mode === 'reply' || mode === 'fix' || mode === 'summary') && _rpMiniActive;

      panel.innerHTML =
        // Header
        '<div style="background:linear-gradient(135deg,#FF6B35,#FF4500);padding:12px 16px;' +
            'display:flex;align-items:center;justify-content:space-between">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<div style="width:22px;height:22px;border-radius:7px;background:rgba(255,255,255,0.2);' +
                'display:flex;align-items:center;justify-content:center">' + RP_SVG.logo + '</div>' +
            '<span style="color:white;font-size:12px;font-weight:700;letter-spacing:0.04em;' +
                'text-transform:uppercase">ReplyPals</span>' +
            '<span style="color:rgba(255,255,255,0.65);font-size:10px;font-weight:500;margin-left:2px">' +
                '· ' + meta.label + '</span>' +
          '</div>' +
          '<button id="rp-panel-close" style="all:unset;color:rgba(255,255,255,0.7);cursor:pointer;' +
              'display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%">' +
            RP_SVG.close +
          '</button>' +
        '</div>' +
        // Body
        '<div id="rp-panel-body" style="padding:14px 16px;font-size:13px;color:#1e293b;line-height:1.65;' +
            'max-height:160px;overflow-y:auto;background:#fff;border-bottom:1px solid #f1f5f9">' +
          (text || '') +
        '</div>' +
        // Score bar
        (score ?
          '<div style="padding:10px 16px 0;background:#fff">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">' +
              '<span style="font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:0.06em;' +
                  'text-transform:uppercase">Native Score</span>' +
              '<span style="font-size:13px;font-weight:800;color:' + scoreColor + '">' + score + '/100</span>' +
            '</div>' +
            '<div style="height:4px;background:#f1f5f9;border-radius:2px;overflow:hidden">' +
              '<div style="height:100%;width:0%;background:' + scoreColor + ';border-radius:2px;' +
                  '--score-w:' + scoreW + ';animation:rpScoreFill 0.8s 0.2s ease forwards"></div>' +
            '</div>' +
          '</div>'
        : '') +
        // Actions
        '<div style="padding:10px 12px 12px;background:#fff;display:flex;gap:6px;flex-wrap:wrap">' +
          '<button id="rp-panel-copy" style="all:unset;display:flex;align-items:center;gap:5px;' +
              'background:#FF6B35;color:white;border-radius:8px;padding:7px 12px;font-size:11px;' +
              'font-weight:700;cursor:pointer;letter-spacing:0.02em;' +
              'box-shadow:0 2px 8px rgba(255,107,53,0.3)">' +
            RP_SVG.copy + ' Copy' +
          '</button>' +
          (canInsert ?
            '<button id="rp-panel-replace" style="all:unset;display:flex;align-items:center;gap:5px;' +
                'background:#0f172a;color:white;border-radius:8px;padding:7px 12px;font-size:11px;' +
                'font-weight:700;cursor:pointer;letter-spacing:0.02em">' +
              RP_SVG.replace + (mode === 'reply' ? ' Use this reply' : mode === 'summary' ? ' Use this summary' : ' Use this') +
            '</button>'
          : '') +
        '</div>';

      panel.classList.add('rp-panel-visible');

      // Wire close
      var closeBtn = document.getElementById('rp-panel-close');
      if (closeBtn) closeBtn.addEventListener('click', function() { panel.classList.remove('rp-panel-visible'); });

      // Wire copy
      var copyBtn = document.getElementById('rp-panel-copy');
      if (copyBtn) copyBtn.addEventListener('click', function() {
        navigator.clipboard.writeText(text).then(function() {
          copyBtn.innerHTML = '\u2713 Copied!';
          setTimeout(function() { copyBtn.innerHTML = RP_SVG.copy + ' Copy'; }, 2000);
        });
      });

      // Wire replace
      var replaceBtn = document.getElementById('rp-panel-replace');
      if (replaceBtn) replaceBtn.addEventListener('click', function() {
        if (_rpMiniActive) setText(_rpMiniActive, text);
        panel.classList.remove('rp-panel-visible');
      });

      // Auto-dismiss after 25s
      setTimeout(function() { panel.classList.remove('rp-panel-visible'); }, 25000);
    }

    // ══════════════════════════════════════════════════════════════════════
    // D. SCORE TOAST  (shown after inline rewrite)
    // ══════════════════════════════════════════════════════════════════════

    function rpShowScoreToast(score) {
      var old = document.getElementById('rp-score-toast');
      if (old) old.remove();
      if (!score) return;
      var t = document.createElement('div');
      t.id = 'rp-score-toast';
      var color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
      t.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483647!important;' +
        'bottom:24px;right:24px;background:#1a1f2e;color:white;border-left:3px solid ' + color + ';' +
        'border-radius:10px;padding:10px 16px;font-size:12px;font-weight:700;font-family:system-ui!important;' +
        'box-shadow:0 4px 20px rgba(0,0,0,0.25);display:flex;align-items:center;gap:8px;' +
        'animation:rpSlideUp 0.2s ease both;';
      t.innerHTML =
        '<div style="width:18px;height:18px;border-radius:5px;background:linear-gradient(135deg,#FF6B35,#FF4500);' +
            'display:flex;align-items:center;justify-content:center">' + RP_SVG.logo + '</div>' +
        '<span>Rewritten \xB7 <span style="color:' + color + '">' + score + '/100</span> native score</span>';
      document.documentElement.appendChild(t);
      setTimeout(function() { if (t.parentNode) t.remove(); }, 3500);
    }

    function rpShowErrorToast(msg) {
      var t = document.createElement('div');
      t.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483647!important;' +
        'bottom:24px;right:24px;background:#1a1f2e;color:#ef4444;border-left:3px solid #ef4444;' +
        'border-radius:10px;padding:10px 16px;font-size:12px;font-weight:600;font-family:system-ui!important;' +
        'box-shadow:0 4px 20px rgba(0,0,0,0.2);animation:rpSlideUp 0.2s ease both;';
      t.textContent = '\u2715  ' + msg;
      document.documentElement.appendChild(t);
      setTimeout(function() { if (t.parentNode) t.remove(); }, 3500);
    }



  })();
} catch (e) { console.warn('ReplyPals content script error:', e); }

