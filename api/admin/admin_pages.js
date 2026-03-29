// ═══════════════════════════════════════════
// ANALYTICS PAGE
// ═══════════════════════════════════════════
let analyticsDays = 30;
async function renderAnalytics() {
  const el = document.getElementById('pageContent');
  el.innerHTML = `<div class="flex gap-2 mb-4">
    <button onclick="analyticsDays=7;renderAnalytics()" class="px-3 py-1.5 rounded-lg text-sm ${analyticsDays === 7 ? 'bg-rp text-white' : 'bg-white border'}">7 days</button>
    <button onclick="analyticsDays=30;renderAnalytics()" class="px-3 py-1.5 rounded-lg text-sm ${analyticsDays === 30 ? 'bg-rp text-white' : 'bg-white border'}">30 days</button>
    <button onclick="analyticsDays=90;renderAnalytics()" class="px-3 py-1.5 rounded-lg text-sm ${analyticsDays === 90 ? 'bg-rp text-white' : 'bg-white border'}">90 days</button>
  </div><div class="text-center py-12 text-gray-400">Loading charts…</div>`;
  try {
    const d = await api(`/admin/analytics?days=${analyticsDays}`);
    el.innerHTML = `<div class="flex gap-2 mb-4">
      <button onclick="analyticsDays=7;renderAnalytics()" class="px-3 py-1.5 rounded-lg text-sm ${analyticsDays === 7 ? 'bg-rp text-white' : 'bg-white border'}">7 days</button>
      <button onclick="analyticsDays=30;renderAnalytics()" class="px-3 py-1.5 rounded-lg text-sm ${analyticsDays === 30 ? 'bg-rp text-white' : 'bg-white border'}">30 days</button>
      <button onclick="analyticsDays=90;renderAnalytics()" class="px-3 py-1.5 rounded-lg text-sm ${analyticsDays === 90 ? 'bg-rp text-white' : 'bg-white border'}">90 days</button>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div class="bg-white rounded-xl shadow-sm p-5"><h3 class="font-semibold text-sm mb-3 text-navy">Rewrites Over Time</h3><canvas id="aC1" height="200"></canvas></div>
      <div class="bg-white rounded-xl shadow-sm p-5"><h3 class="font-semibold text-sm mb-3 text-navy">New Users Over Time</h3><canvas id="aC2" height="200"></canvas></div>
      <div class="bg-white rounded-xl shadow-sm p-5"><h3 class="font-semibold text-sm mb-3 text-navy">Score Distribution</h3><canvas id="aC3" height="200"></canvas></div>
      <div class="bg-white rounded-xl shadow-sm p-5"><h3 class="font-semibold text-sm mb-3 text-navy">Tone Usage</h3><canvas id="aC4" height="200"></canvas></div>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5"><h3 class="font-semibold text-sm mb-3 text-navy">Top Non-Native Patterns</h3><div id="patternCloud" class="flex flex-wrap gap-2"></div></div>`;
    makeLineChart('aC1', d.rewrites_by_day);
    const c2 = document.getElementById('aC2');
    if (c2) chartInstances['aC2'] = new Chart(c2, { type: 'bar', data: { labels: (d.users_by_day || []).map(x => x.date), datasets: [{ label: 'New Users', data: (d.users_by_day || []).map(x => x.count), backgroundColor: '#0F2544' }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
    const c3 = document.getElementById('aC3');
    if (c3) chartInstances['aC3'] = new Chart(c3, { type: 'bar', data: { labels: (d.score_distribution || []).map(x => x.range), datasets: [{ label: 'Count', data: (d.score_distribution || []).map(x => x.count), backgroundColor: ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#10B981'] }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
    const c4 = document.getElementById('aC4');
    if (c4) chartInstances['aC4'] = new Chart(c4, { type: 'bar', data: { labels: (d.tone_usage || []).map(x => x.tone), datasets: [{ label: 'Uses', data: (d.tone_usage || []).map(x => x.count), backgroundColor: '#FF6B35' }] }, options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } } } });
    const cloud = document.getElementById('patternCloud');
    (d.top_patterns || []).forEach((p, i) => { const sz = Math.max(12, Math.min(28, 12 + p.count * 2)); cloud.innerHTML += `<span style="font-size:${sz}px;opacity:${Math.max(0.4, 1 - i * 0.04)}" class="text-navy font-semibold">${escHtml(p.pattern)} <sup class="text-xs text-gray-400">${p.count}</sup></span>`; });
    if (!(d.top_patterns || []).length) cloud.innerHTML = '<span class="text-gray-400 text-sm">No patterns yet</span>';
  } catch (e) { el.innerHTML = `<div class="text-center py-12 text-red-500">${escHtml(e.message)}</div>`; }
}

// ═══════════════════════════════════════════
// EMAILS PAGE
// ═══════════════════════════════════════════
async function renderEmails() {
  const el = document.getElementById('pageContent');
  el.innerHTML = `<div class="flex gap-3 mb-4"><button onclick="showAnnouncement()" class="px-4 py-2 bg-rp text-white rounded-lg text-sm">📢 Send Announcement</button></div>
  <div class="bg-white rounded-xl shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm">
    <thead><tr class="text-left text-gray-400 border-b text-xs"><th class="p-3">Sent At</th><th class="p-3">To</th><th class="p-3">Subject</th><th class="p-3">Type</th><th class="p-3">Status</th></tr></thead>
    <tbody id="emailBody"></tbody></table></div></div>`;
  try {
    const d = await api('/admin/email-logs?limit=100');
    const tbody = document.getElementById('emailBody');
    (d.logs || []).forEach(l => {
      const typeCls = { license: 'badge-orange', welcome: 'badge-blue', weekly: 'badge-green', manual: 'badge-gray' }[l.type] || 'badge-gray';
      tbody.innerHTML += `<tr class="border-b${l.status === 'failed' ? ' border-l-4 border-l-red-400' : ''}"><td class="p-3 text-xs text-gray-500">${fmtTime(l.sent_at)}</td><td class="p-3 font-mono text-xs">${escHtml(l.to_email || '')}</td><td class="p-3 text-xs">${escHtml(l.subject || '')}</td><td class="p-3"><span class="badge ${typeCls}">${l.type || '—'}</span></td><td class="p-3"><span class="badge ${l.status === 'sent' ? 'badge-green' : 'badge-red'}">${l.status === 'sent' ? '✓ Sent' : '✗ Failed'}</span></td></tr>`;
    });
    if (!(d.logs || []).length) tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-400">No emails sent yet</td></tr>';
  } catch (e) { document.getElementById('emailBody').innerHTML = `<tr><td colspan="5" class="p-4 text-center text-red-500">${escHtml(e.message)}</td></tr>`; }
}
function showAnnouncement() {
  showModal(`<h2 class="font-bold text-lg mb-4">📢 Send Announcement</h2>
    <label class="text-xs text-gray-400">Target</label><select id="annTarget" class="w-full border rounded-lg px-3 py-2 text-sm mb-3"><option value="all_free">All Free Users</option><option value="pro">Pro Users</option><option value="starter">Starter Users</option><option value="team_admins">Team Admins</option><option value="everyone">Everyone</option></select>
    <label class="text-xs text-gray-400">Subject</label><input id="annSubject" class="w-full border rounded-lg px-3 py-2 text-sm mb-3" placeholder="Subject"/>
    <label class="text-xs text-gray-400">Body</label><textarea id="annBody" rows="6" class="w-full border rounded-lg px-3 py-2 text-sm mb-3" placeholder="Message…"></textarea>
    <div id="annProgress" class="hidden mb-3 text-sm"></div>
    <div class="flex gap-2"><button onclick="sendAnnouncement()" id="annBtn" class="px-4 py-2 bg-rp text-white rounded-lg text-sm">Send to All</button><button onclick="hideModal()" class="px-4 py-2 border rounded-lg text-sm">Cancel</button></div>`);
}
async function sendAnnouncement() {
  if (prompt('Type SEND to confirm:') !== 'SEND') return;
  const btn = document.getElementById('annBtn'); btn.textContent = 'Sending…'; btn.disabled = true;
  try {
    const d = await api('/admin/send-announcement', { method: 'POST', body: JSON.stringify({ target: document.getElementById('annTarget').value, subject: document.getElementById('annSubject').value, body: document.getElementById('annBody').value }) });
    document.getElementById('annProgress').classList.remove('hidden');
    document.getElementById('annProgress').textContent = `Sending to ${d.recipient_count} users…`;
    const poll = setInterval(async () => {
      try {
        const s = await api(`/admin/announcement-status/${d.task_id}`);
        document.getElementById('annProgress').textContent = `Sent: ${s.sent}/${s.total} | Failed: ${s.failed} | ${s.status}`;
        if (s.status === 'done') { clearInterval(poll); btn.textContent = 'Done ✅'; setTimeout(() => { hideModal(); renderEmails(); }, 1500); }
      } catch (e) { clearInterval(poll); }
    }, 2000);
  } catch (e) { alert(e.message); btn.textContent = 'Send to All'; btn.disabled = false; }
}

// ═══════════════════════════════════════════
// LOGS PAGE
// ═══════════════════════════════════════════
let logsFilter = 'all', logsAutoRefresh = false;
async function renderLogs() {
  const el = document.getElementById('pageContent');
  el.innerHTML = `<div class="flex flex-wrap gap-3 items-center mb-4">
    <select id="logFilter" class="border rounded-lg px-3 py-2 text-sm"><option value="all">All</option><option value="errors">Errors only</option><option value="slow">Slow (>2s)</option><option value="rewrite">/rewrite only</option></select>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="logAutoRefresh" ${logsAutoRefresh ? 'checked' : ''}/> Auto-refresh (5s)</label>
    <div id="logStats" class="ml-auto flex gap-3 text-xs text-gray-500"></div>
  </div>
  <div class="bg-white rounded-xl shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm">
    <thead><tr class="text-left text-gray-400 border-b text-xs"><th class="p-3">Time</th><th class="p-3">Endpoint</th><th class="p-3">Method</th><th class="p-3">IP</th><th class="p-3">Status</th><th class="p-3">Latency</th></tr></thead>
    <tbody id="logBody"></tbody></table></div></div>`;
  document.getElementById('logFilter').value = logsFilter;
  document.getElementById('logFilter').addEventListener('change', e => { logsFilter = e.target.value; loadLogTable(); });
  document.getElementById('logAutoRefresh').addEventListener('change', e => {
    logsAutoRefresh = e.target.checked;
    if (logsAutoRefresh) _refreshTimer = setInterval(loadLogTable, 5000);
    else if (_refreshTimer) clearInterval(_refreshTimer);
  });
  if (logsAutoRefresh) _refreshTimer = setInterval(loadLogTable, 5000);
  loadLogTable();
}
async function loadLogTable() {
  const tbody = document.getElementById('logBody'); if (!tbody) return;
  try {
    const d = await api(`/admin/logs?filter=${logsFilter}&limit=200`);
    const st = d.stats || {};
    const statsEl = document.getElementById('logStats');
    if (statsEl) statsEl.innerHTML = `<span>Today: ${st.requests_today || 0}</span><span>Avg: ${st.avg_latency || 0}ms</span><span>Errors: ${st.error_rate || 0}%</span><span>Slowest: ${st.slowest_ms || 0}ms</span>`;
    tbody.innerHTML = '';
    (d.logs || []).forEach(l => {
      const sc = l.status_code || 200;
      const cls = sc >= 500 ? 'bg-red-50' : sc >= 400 ? 'bg-yellow-50' : '';
      const latCls = (l.latency_ms || 0) > 1000 ? 'text-orange-600 font-bold' : '';
      tbody.innerHTML += `<tr class="${cls} border-b"><td class="p-3 text-xs text-gray-500">${fmtTime(l.created_at)}</td><td class="p-3 font-mono text-xs">${l.endpoint || ''}</td><td class="p-3 text-xs">${l.method || ''}</td><td class="p-3 text-xs text-gray-400">${l.ip || ''}</td><td class="p-3"><span class="badge ${sc < 300 ? 'badge-green' : sc < 500 ? 'badge-orange' : 'badge-red'}">${sc}</span></td><td class="p-3 ${latCls}">${l.latency_ms || 0}ms</td></tr>`;
    });
    if (!(d.logs || []).length) tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-gray-400">No logs yet</td></tr>';
  } catch (e) { tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">${escHtml(e.message)}</td></tr>`; }
}

// ═══════════════════════════════════════════
// SETTINGS PAGE
// ═══════════════════════════════════════════
function settingsKeyRow(label, id, masked, provider) {
  return `<div class="mb-3"><label class="text-xs text-gray-400">${label}</label><div class="flex gap-2"><input id="${id}" value="${escHtml(masked)}" type="password" class="flex-1 border rounded-lg px-3 py-2 text-sm font-mono" placeholder="Enter new key to update"/><button onclick="document.getElementById('${id}').type=document.getElementById('${id}').type==='password'?'text':'password'" class="text-sm">👁</button><button onclick="testAiKey('${provider}','${id}',this)" class="px-3 py-1 border rounded-lg text-xs hover:bg-gray-50">Test</button></div></div>`;
}
async function renderSettings() {
  const el = document.getElementById('pageContent');
  el.innerHTML = '<div class="text-center py-12 text-gray-400">Loading settings…</div>';
  try {
    const s = await api('/admin/settings');
    const as = s.app_settings || {};
    const db = s.db_stats || {};
    el.innerHTML = `<div class="space-y-6">
    <div class="bg-white rounded-xl shadow-sm p-5 mb-6" id="model-card">
      <h3 class="font-semibold text-sm mb-3 text-navy">🤖 Global AI Model</h3>
      <p id="model-current-label" style="color:#6b7280;font-size:13px;margin-bottom:16px;">
        Loading current model...
      </p>

      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <div>
          <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Provider</label>
          <select id="model-provider" onchange="updateModelOptions()" style="border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;font-size:13px;min-width:140px;background:white;cursor:pointer">
            <option value="gemini">Gemini (Google)</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Model Version</label>
          <select id="model-version" style="border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;font-size:13px;min-width:220px;background:white;cursor:pointer">
          </select>
        </div>
        <button onclick="saveModel()" style="background:#FF6B35;color:white;border:none;border-radius:8px;padding:9px 20px;font-size:13px;font-weight:600;cursor:pointer;height:38px">
          Save
        </button>
        <button onclick="testModel()" style="background:#0F2544;color:white;border:none;border-radius:8px;padding:9px 20px;font-size:13px;font-weight:600;cursor:pointer;height:38px">
          Test
        </button>
      </div>

      <div id="model-save-msg" style="margin-top:10px;font-size:13px;display:none"></div>
      <div id="model-test-result" style="margin-top:12px;background:#f9fafb;border-radius:8px;padding:12px;font-size:12px;display:none;border:1px solid #e5e7eb;font-family:monospace;white-space:pre-wrap"></div>
    </div>

    <div class="bg-white rounded-xl shadow-sm p-5" id="planLimitsCard">
      <h3 class="font-semibold text-sm mb-2 text-navy">📊 Rewrite limits (by plan)</h3>
      <p class="text-xs text-gray-500 mb-3">Stored in <code class="bg-gray-100 px-1 rounded text-[11px]">plan_config</code> (same source as the API). Monthly empty ⇒ unlimited. Daily caps are not enforced — leave daily blank.</p>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead><tr class="text-left border-b text-gray-400"><th class="p-2">Plan</th><th class="p-2">Monthly rewrites</th><th class="p-2">Daily cap</th></tr></thead>
          <tbody id="planLimitsBody"></tbody>
        </table>
      </div>
      <button type="button" onclick="savePlanLimits()" class="px-4 py-2 bg-rp text-white rounded-lg text-sm mt-3">💾 Save plan limits</button>
      <span id="planLimitsSaveMsg" class="text-sm ml-2 text-gray-600"></span>
    </div>
    
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h3 class="font-semibold text-navy mb-4">🔑 AI API Keys</h3>
      ${settingsKeyRow('Gemini API Key', 'sGemini', s.gemini_key, 'gemini')}
      ${settingsKeyRow('OpenAI API Key', 'sOpenai', s.openai_key, 'openai')}
      ${settingsKeyRow('Anthropic API Key', 'sAnthropic', s.anthropic_key, 'anthropic')}
      <button onclick="saveAiSettings()" class="px-4 py-2 bg-rp text-white rounded-lg text-sm mt-2">💾 Save API Keys</button>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h3 class="font-semibold text-navy mb-4">🗄️ Supabase</h3>
      <div class="flex items-center gap-2 mb-3"><span class="w-3 h-3 rounded-full ${s.supabase_connected ? 'bg-green-500' : 'bg-red-500'}"></span><span class="text-sm">${s.supabase_connected ? 'Connected' : 'Disconnected'}</span><button onclick="testSupabase(this)" class="ml-auto text-xs text-gray-500 hover:text-rp">Test DB</button></div>
      <div class="flex flex-wrap gap-2 text-xs text-gray-500 mb-3">${Object.entries(db).map(([k, v]) => `<span class="bg-gray-100 px-2 py-1 rounded">${k}: ${v}</span>`).join('')}</div>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h3 class="font-semibold text-navy mb-4">💳 Stripe</h3>
      <div id="stripeStatus" class="text-sm mb-3"></div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">${Object.entries(s.stripe_prices || {}).map(([p, v]) => `<div class="bg-gray-50 rounded p-2"><span class="text-gray-400">${p}</span><br><span class="font-mono">${v}</span></div>`).join('')}</div>
      <p class="text-xs text-gray-500 mt-3">PPP, bundles, and live price strings: <button type="button" class="text-rp font-semibold underline" onclick="navigate('pricing')">Pricing</button> page.</p>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h3 class="font-semibold text-navy mb-4">📧 Email (Gmail SMTP)</h3>
      <label class="text-xs text-gray-400">Gmail</label><input id="sGmail" value="${escHtml(s.gmail_address)}" class="w-full border rounded-lg px-3 py-2 text-sm mb-2" readonly/>
      <button onclick="testEmail(this)" class="px-3 py-1 border rounded-lg text-xs hover:bg-gray-50 mb-2">Send Test Email</button>
      <div class="flex items-center gap-3 mt-2"><span class="text-sm">Weekly Reports</span><div class="toggle ${as.weekly_reports_enabled !== 'false' ? 'on' : 'off'}" onclick="this.classList.toggle('on');this.classList.toggle('off')" id="sWeeklyToggle"></div></div>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h3 class="font-semibold text-navy mb-4">⚙️ App Settings</h3>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div><label class="text-xs text-gray-400">Free Tier Limit</label><input id="sFreeLimit" type="number" value="${as.free_limit || 5}" class="w-full border rounded-lg px-3 py-2 text-sm"/></div>
        <div><label class="text-xs text-gray-400">Starter Limit</label><input id="sStarterLimit" type="number" value="${as.starter_limit || 50}" class="w-full border rounded-lg px-3 py-2 text-sm"/></div>
        <div><label class="text-xs text-gray-400">Rate Limit</label><input id="sRateLimit" type="number" value="${as.rate_limit || 30}" class="w-full border rounded-lg px-3 py-2 text-sm"/></div>
      </div>
      <div class="flex items-center gap-3 mt-4"><span class="text-sm">Maintenance Mode</span><div class="toggle ${as.maintenance_mode === 'true' ? 'on' : 'off'}" onclick="this.classList.toggle('on');this.classList.toggle('off')" id="sMaintenanceToggle"></div></div>
      <button onclick="saveAppSettings()" class="px-4 py-2 bg-rp text-white rounded-lg text-sm mt-4">💾 Save App Settings</button>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5 border-2 border-red-200">
      <h3 class="font-semibold text-red-600 mb-4">🚨 Danger Zone</h3>
      <div class="flex flex-wrap gap-3">
        <button onclick="if(prompt('Type CONFIRM')!=='CONFIRM')return;api('/admin/clear-logs',{method:'POST'}).then(()=>alert('Logs cleared')).catch(e=>alert(e.message))" class="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50">🗑 Clear Logs</button>
        <button onclick="exportCSV('free_users')" class="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">📤 Export Data</button>
        <button onclick="if(prompt('Type CONFIRM')!=='CONFIRM')return;api('/admin/revoke-all-licenses',{method:'POST'}).then(()=>alert('All revoked')).catch(e=>alert(e.message))" class="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50">🔴 Revoke All</button>
      </div>
    </div></div>`;
    api('/admin/stripe-status').then(d => { const e = document.getElementById('stripeStatus'); if (e) e.innerHTML = d.connected ? `<span class="w-3 h-3 rounded-full ${d.mode === 'live' ? 'bg-green-500' : 'bg-yellow-500'} inline-block"></span> ${d.mode === 'live' ? 'Live' : 'Test'} Mode` : '<span class="text-red-500">Not connected</span>'; }).catch(() => { });
    
    // Load active model selector options
    updateModelOptions();
    loadCurrentModel();
    fillPlanLimitsTable();
  } catch (e) { el.innerHTML = `<div class="text-center py-12 text-red-500">${escHtml(e.message)}</div>`; }
}
async function testAiKey(provider, inputId, btn) {
  const key = document.getElementById(inputId).value;
  if (!key || key.includes('•')) { alert('Enter a new key to test'); return; }
  btn.textContent = 'Testing…'; btn.disabled = true;
  try { const d = await api('/admin/test-key', { method: 'POST', body: JSON.stringify({ provider, api_key: key }) }); btn.textContent = d.valid ? `✓ ${d.latency_ms}ms` : '✗ Invalid'; btn.style.color = d.valid ? '#059669' : '#DC2626'; } catch (e) { btn.textContent = '✗'; btn.style.color = '#DC2626'; }
  setTimeout(() => { btn.textContent = 'Test'; btn.style.color = ''; btn.disabled = false; }, 3000);
}
async function testSupabase(btn) {
  btn.textContent = 'Testing…';
  try { const d = await api('/admin/test-supabase'); btn.textContent = d.connected ? `✓ ${d.tables_found} tables` : '✗ Failed'; btn.style.color = d.connected ? '#059669' : '#DC2626'; } catch (e) { btn.textContent = '✗'; btn.style.color = '#DC2626'; }
  setTimeout(() => { btn.textContent = 'Test DB'; btn.style.color = ''; }, 3000);
}
async function testEmail(btn) {
  btn.textContent = 'Sending…'; btn.disabled = true;
  try { await api('/admin/send-email', { method: 'POST', body: JSON.stringify({ to: document.getElementById('sGmail').value, subject: 'ReplyPals Admin Test', body: 'Test email from admin panel.' }) }); btn.textContent = '✓ Sent'; btn.style.color = '#059669'; } catch (e) { btn.textContent = '✗ Failed'; btn.style.color = '#DC2626'; }
  setTimeout(() => { btn.textContent = 'Send Test Email'; btn.style.color = ''; btn.disabled = false; }, 3000);
}
async function saveAiSettings() {
  try {
    await api('/admin/env-key', { method: 'PATCH', body: JSON.stringify({ key: 'AI_PROVIDER', value: document.getElementById('sProvider').value }) });
    for (const [id, env] of [['sGemini', 'GEMINI_API_KEY'], ['sOpenai', 'OPENAI_API_KEY'], ['sAnthropic', 'ANTHROPIC_API_KEY']]) {
      const v = document.getElementById(id).value;
      if (v && !v.includes('•')) await api('/admin/env-key', { method: 'PATCH', body: JSON.stringify({ key: env, value: v }) });
    }
    alert('✅ AI settings saved (temporary until restart)');
  } catch (e) { alert(e.message); }
}
async function saveAppSettings() {
  try {
    await api('/admin/settings', { method: 'PATCH', body: JSON.stringify({ settings: { free_limit: document.getElementById('sFreeLimit').value, starter_limit: document.getElementById('sStarterLimit').value, rate_limit: document.getElementById('sRateLimit').value, maintenance_mode: document.getElementById('sMaintenanceToggle').classList.contains('on') ? 'true' : 'false', weekly_reports_enabled: document.getElementById('sWeeklyToggle').classList.contains('on') ? 'true' : 'false' } }) });
    alert('✅ Settings saved');
  } catch (e) { alert(e.message); }
}

const PLAN_LIMIT_KEYS = ['free', 'starter', 'pro', 'growth', 'team', 'enterprise'];
async function fillPlanLimitsTable() {
  const tb = document.getElementById('planLimitsBody');
  if (!tb) return;
  try {
    const d = await api('/admin/plan-limits');
    const L = d.limits || {};
    tb.innerHTML = PLAN_LIMIT_KEYS.map((p) => {
      const row = L[p] || {};
      const m = row.monthly === null || row.monthly === undefined ? '' : row.monthly;
      const day = row.daily === null || row.daily === undefined ? '' : row.daily;
      return `<tr class="border-b"><td class="p-2 font-medium capitalize">${p}</td><td class="p-2"><input type="number" min="0" id="pl-${p}-m" class="border rounded px-2 py-1 w-28 text-sm" value="${m}" placeholder="empty = unlimited"/></td><td class="p-2"><input type="number" min="0" id="pl-${p}-d" class="border rounded px-2 py-1 w-28 text-sm" value="${day}" placeholder="empty = none"/></td></tr>`;
    }).join('');
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="3" class="p-2 text-red-500">${escHtml(e.message)}</td></tr>`;
  }
}
async function savePlanLimits() {
  const msg = document.getElementById('planLimitsSaveMsg');
  const limits = {};
  for (const p of PLAN_LIMIT_KEYS) {
    const mi = document.getElementById(`pl-${p}-m`);
    const di = document.getElementById(`pl-${p}-d`);
    const ms = mi && mi.value !== '' ? String(mi.value).trim() : '';
    const ds = di && di.value !== '' ? String(di.value).trim() : '';
    limits[p] = {
      monthly: ms === '' ? null : parseInt(ms, 10),
      daily: ds === '' ? null : parseInt(ds, 10),
    };
    if (ms !== '' && Number.isNaN(limits[p].monthly)) { alert('Invalid monthly for ' + p); return; }
    if (ds !== '' && Number.isNaN(limits[p].daily)) { alert('Invalid daily for ' + p); return; }
  }
  if (msg) msg.textContent = 'Saving…';
  try {
    await api('/admin/plan-limits', { method: 'PUT', body: JSON.stringify({ limits }) });
    if (msg) { msg.textContent = '✓ Saved'; setTimeout(() => { if (msg) msg.textContent = ''; }, 4000); }
  } catch (e) {
    if (msg) msg.textContent = '';
    alert(e.message || String(e));
  }
}

// ═══════════════════════════════════════════
// SECURITY PAGE
// ═══════════════════════════════════════════
async function renderSecurity() {
  const el = document.getElementById('pageContent');
  el.innerHTML = '<div class="text-center py-12 text-gray-400">Loading…</div>';
  try {
    const [sessions, blocked, audit] = await Promise.all([api('/admin/sessions'), api('/admin/blocked-ips'), api('/admin/audit-log?limit=50')]);
    el.innerHTML = `<div class="space-y-6">
    <div class="bg-white rounded-xl shadow-sm p-5 border-2 border-red-200">
      <h3 class="font-semibold text-red-700 mb-2">⚠️ Danger zone — database cleanup</h3>
      <p class="text-xs text-gray-600 mb-3">Removes rows from app tables only. Does <strong>not</strong> delete Supabase <code class="bg-gray-100 px-1 rounded">auth.users</code>. Wiping <strong>user profiles</strong> removes billing/usage-linked data (cascades e.g. usage_logs); license <strong>rows</strong> stay but <code class="bg-gray-100 px-1 rounded">user_id</code> is cleared.</p>
      <label class="text-xs text-gray-500 block mb-1">Scope</label>
      <select id="bulkCleanScope" class="w-full border rounded-lg px-3 py-2 text-sm mb-2" onchange="updateBulkCleanHint()">
        <option value="free_users">free_users only (anon / leads / free-tier tracking)</option>
        <option value="user_profiles">user_profiles only (all signed-in app profiles)</option>
        <option value="both">Both free_users + user_profiles</option>
      </select>
      <label class="text-xs text-gray-500 block mb-1">Type confirmation phrase (shown below)</label>
      <input id="bulkCleanConfirm" type="text" placeholder="Exact phrase" class="w-full border rounded-lg px-3 py-2 text-sm mb-2 font-mono"/>
      <p id="bulkCleanPhraseHint" class="text-[11px] text-gray-500 mb-2 font-mono"></p>
      <button type="button" onclick="updateBulkCleanHint()" class="text-xs text-rp underline mb-2">Show required phrase for selected scope</button><br/>
      <button type="button" onclick="runBulkUserCleanup()" class="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium">Run cleanup</button>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h3 class="font-semibold text-navy mb-4">🔑 Change Admin Password</h3>
      <input id="secCurPass" type="password" placeholder="Current password" class="w-full border rounded-lg px-3 py-2 text-sm mb-2"/>
      <input id="secNewPass" type="password" placeholder="New password (min 12 chars)" class="w-full border rounded-lg px-3 py-2 text-sm mb-2"/>
      <input id="secConfPass" type="password" placeholder="Confirm new password" class="w-full border rounded-lg px-3 py-2 text-sm mb-3"/>
      <button onclick="changePassword()" id="secPassBtn" class="px-4 py-2 bg-rp text-white rounded-lg text-sm">Change Password</button>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h3 class="font-semibold text-navy mb-4">🔐 Active Sessions <button onclick="revokeAllSessions()" class="text-xs text-red-500 ml-3">Revoke All</button></h3>
      <table class="w-full text-xs"><thead><tr class="text-gray-400 border-b"><th class="p-2 text-left">Issued</th><th class="p-2 text-left">Expires</th><th class="p-2 text-left">IP</th><th class="p-2">Action</th></tr></thead>
      <tbody>${(sessions.sessions || []).map(s => `<tr class="border-b"><td class="p-2">${fmtTime(s.issued)}</td><td class="p-2">${fmtTime(s.expires)}</td><td class="p-2">${s.ip || ''}</td><td class="p-2 text-center"><button onclick="revokeSession('${s.jti}')" class="text-red-500 text-xs">Revoke</button></td></tr>`).join('')}</tbody></table>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h3 class="font-semibold text-navy mb-4">🚫 Blocked IPs</h3>
      ${(blocked.blocked || []).length ? `<table class="w-full text-xs"><tbody>${(blocked.blocked || []).map(b => `<tr class="border-b"><td class="p-2 font-mono">${b.ip}</td><td class="p-2">${Math.ceil(b.remaining_s / 60)}m left</td><td class="p-2"><button onclick="unblockIp('${b.ip}')" class="text-green-600 text-xs">Unblock</button></td></tr>`).join('')}</tbody></table>` : '<p class="text-gray-400 text-xs">No blocked IPs</p>'}
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h3 class="font-semibold text-navy mb-4">📋 Audit Log</h3>
      <div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr class="text-gray-400 border-b"><th class="p-2 text-left">Time</th><th class="p-2 text-left">Action</th><th class="p-2 text-left">Details</th><th class="p-2 text-left">IP</th></tr></thead>
      <tbody>${(audit.logs || []).map(l => `<tr class="border-b"><td class="p-2 text-gray-500">${fmtTime(l.created_at)}</td><td class="p-2"><span class="badge badge-gray">${l.action || ''}</span></td><td class="p-2 font-mono text-[10px] max-w-[200px] truncate">${escHtml(JSON.stringify(l.details || {}))}</td><td class="p-2 text-gray-400">${l.ip || ''}</td></tr>`).join('')}</tbody></table></div>
    </div></div>`;
    updateBulkCleanHint();
  } catch (e) { el.innerHTML = `<div class="text-center py-12 text-red-500">${escHtml(e.message)}</div>`; }
}
async function changePassword() {
  const nw = document.getElementById('secNewPass').value, cf = document.getElementById('secConfPass').value;
  if (nw !== cf) { alert('Passwords do not match'); return; }
  if (nw.length < 12) { alert('Minimum 12 characters'); return; }
  const btn = document.getElementById('secPassBtn'); btn.textContent = 'Changing…'; btn.disabled = true;
  try { await api('/admin/change-password', { method: 'POST', body: JSON.stringify({ current_password: document.getElementById('secCurPass').value, new_password: nw }) }); alert('✅ Password changed. Log in again.'); doLogout(); } catch (e) { alert(e.message); btn.textContent = 'Change Password'; btn.disabled = false; }
}
async function revokeSession(jti) { try { await api(`/admin/sessions/${jti}`, { method: 'DELETE' }); renderSecurity(); } catch (e) { alert(e.message); } }
async function revokeAllSessions() { if (!confirm('Revoke all sessions?')) return; try { await api('/admin/sessions', { method: 'DELETE' }); doLogout(); } catch (e) { alert(e.message); } }
async function unblockIp(ip) { try { await api(`/admin/blocked-ips/${ip}`, { method: 'DELETE' }); renderSecurity(); } catch (e) { alert(e.message); } }

const BULK_CLEAN_PHRASES = {
  free_users: 'DELETE_ALL_FREE_USERS',
  user_profiles: 'DELETE_ALL_USER_PROFILES',
  both: 'DELETE_ALL_APP_USER_DATA',
};
function updateBulkCleanHint() {
  const sc = document.getElementById('bulkCleanScope');
  const hint = document.getElementById('bulkCleanPhraseHint');
  if (!sc || !hint) return;
  const p = BULK_CLEAN_PHRASES[sc.value];
  hint.textContent = p ? ('Required phrase: ' + p) : '';
}
async function runBulkUserCleanup() {
  const sc = document.getElementById('bulkCleanScope');
  const inp = document.getElementById('bulkCleanConfirm');
  if (!sc || !inp) return;
  const scope = sc.value;
  const confirm = inp.value.trim();
  const need = BULK_CLEAN_PHRASES[scope];
  if (confirm !== need) {
    alert('Confirmation must match exactly:\n' + need);
    updateBulkCleanHint();
    return;
  }
  if (!confirm('This permanently deletes data. Continue?')) return;
  try {
    const d = await api('/admin/users/bulk-cleanup', {
      method: 'POST',
      body: JSON.stringify({ scope, confirm }),
    });
    const dr = d.deleted_rows || {};
    alert('Done. Rows removed: ' + JSON.stringify(dr));
    inp.value = '';
  } catch (e) {
    alert(e.message || String(e));
  }
}

// ═══════════════════════════════════════════
// PRICING PAGE + PREVIEW
// ═══════════════════════════════════════════
async function previewPricingForCountry(cc, resultElId) {
  const id = resultElId || 'pricingPreviewResult';
  const el = document.getElementById(id);
  if (!el) return;
  if (!cc) { el.textContent = ''; return; }
  el.textContent = 'Loading…';
  try {
    const d = await api(`/admin/pricing-preview?country=${encodeURIComponent(cc)}`);
    const plans = d.plans || {};
    const parts = Object.keys(plans).sort().map((k) => `<strong>${escHtml(k)}</strong>: ${escHtml(plans[k].display || '')}`).join(' · ');
    el.innerHTML = `<span class="badge badge-blue">×${escHtml(String(d.multiplier ?? 1))}</span> ${parts || '—'}
            ${d.note ? `<span class="text-xs text-gray-400 ml-2">${escHtml(d.note)}</span>` : ''}`;
  } catch (e) { el.textContent = '⚠️ ' + e.message; }
}

function formatPublicPricingHtml(p) {
  if (!p || typeof p !== 'object') return '<p class="text-sm text-gray-500">No JSON payload</p>';
  const country = escHtml(String(p.country || '—'));
  const ccy = escHtml(String(p.currency_code || ''));
  const sym = escHtml(String(p.currency_symbol || ''));
  const fx = p.exchange_rate_per_usd != null ? escHtml(String(p.exchange_rate_per_usd)) : '—';
  const mult = escHtml(String(p.price_multiplier != null ? p.price_multiplier : '—'));
  const note = p.note ? `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-2 mt-2">${escHtml(p.note)}</p>` : '';
  const vpn = p.vpn_detected ? '<span class="badge badge-orange ml-2">VPN → US</span>' : '';

  const plans = p.plans || {};
  const planRows = Object.keys(plans).sort().map((k) => {
    const x = plans[k] || {};
    return `<tr class="border-b border-gray-100"><td class="p-2 font-mono text-[11px]">${escHtml(k)}</td><td class="p-2">${escHtml(x.display_name || '')}</td><td class="p-2 font-semibold">${escHtml(x.display || '')}${escHtml(x.per || '')}</td><td class="p-2 text-xs">${escHtml(x.currency || '')}</td><td class="p-2 text-xs tabular-nums">${x.amount_local != null ? escHtml(String(x.amount_local)) : '—'}</td><td class="p-2 text-xs text-gray-500 tabular-nums">${x.localized_usd != null ? escHtml(String(x.localized_usd)) : '—'}</td><td class="p-2 font-mono text-[10px] text-gray-500 truncate max-w-[120px]" title="${escHtml(x.stripe_price_id || '')}">${escHtml(x.stripe_price_id || '—')}</td></tr>`;
  }).join('');

  const bundles = p.credit_bundles || {};
  const bundleRows = Object.keys(bundles).sort((a, b) => ((bundles[a].credits || 0) - (bundles[b].credits || 0))).map((k) => {
    const x = bundles[k] || {};
    return `<tr class="border-b border-gray-100"><td class="p-2 font-mono text-[11px]">${escHtml(k)}</td><td class="p-2">${escHtml(x.display_name || '')}</td><td class="p-2 tabular-nums">${x.credits != null ? escHtml(String(x.credits)) : '—'}</td><td class="p-2 font-semibold">${escHtml(x.display || '')}</td><td class="p-2 text-xs">${escHtml(x.currency || '')}</td></tr>`;
  }).join('');

  const labels = p.plan_limit_labels || {};
  const labelRows = Object.keys(labels).sort().map((k) => `<tr class="border-b border-gray-100"><td class="p-2 font-mono text-[11px] capitalize">${escHtml(k)}</td><td class="p-2 text-sm">${escHtml(String(labels[k]))}</td></tr>`).join('');

  return `<div class="text-xs text-gray-600 space-y-1 mb-3">
    <div><strong>Geo country</strong> (from this request’s IP): ${country} ${vpn}</div>
    <div><strong>Currency</strong>: ${ccy} ${sym ? '(' + sym + ')' : ''} · <strong>FX / USD</strong>: ${fx} · <strong>PPP mult</strong>: ${mult}</div>
  </div>${note}
  <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wide mt-4 mb-1">Subscription plans (public)</h4>
  <div class="overflow-x-auto border border-gray-100 rounded-lg">
    <table class="w-full text-xs text-left"><thead><tr class="bg-gray-50 text-gray-500"><th class="p-2">Key</th><th class="p-2">Name</th><th class="p-2">Display</th><th class="p-2">CCY</th><th class="p-2">Amt local</th><th class="p-2">PPP USD</th><th class="p-2">Stripe price</th></tr></thead><tbody>${planRows || '<tr><td colspan="7" class="p-3 text-gray-400">No plans</td></tr>'}</tbody></table>
  </div>
  <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wide mt-4 mb-1">Credit bundles</h4>
  <div class="overflow-x-auto border border-gray-100 rounded-lg">
    <table class="w-full text-xs text-left"><thead><tr class="bg-gray-50 text-gray-500"><th class="p-2">Key</th><th class="p-2">Name</th><th class="p-2">Credits</th><th class="p-2">Display</th><th class="p-2">CCY</th></tr></thead><tbody>${bundleRows || '<tr><td colspan="5" class="p-3 text-gray-400">No bundles</td></tr>'}</tbody></table>
  </div>
  <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wide mt-4 mb-1">Plan limit labels (same payload)</h4>
  <div class="overflow-x-auto border border-gray-100 rounded-lg max-h-48 overflow-y-auto">
    <table class="w-full text-xs text-left"><thead><tr class="bg-gray-50 text-gray-500"><th class="p-2">Plan</th><th class="p-2">Label</th></tr></thead><tbody>${labelRows || '<tr><td colspan="2" class="p-3 text-gray-400">—</td></tr>'}</tbody></table>
  </div>`;
}

async function fillPricingPlanLimitsReadonly() {
  const tb = document.getElementById('pricingPlanLimitsReadonly');
  if (!tb) return;
  try {
    const d = await api('/admin/plan-limits');
    const L = d.limits || {};
    tb.innerHTML = PLAN_LIMIT_KEYS.map((p) => {
      const row = L[p] || {};
      const m = row.monthly;
      const mDisp = m === null || m === undefined ? '— (unlimited)' : escHtml(String(m));
      return `<tr class="border-b"><td class="p-2 capitalize font-medium">${escHtml(p)}</td><td class="p-2">${mDisp}</td></tr>`;
    }).join('');
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="2" class="p-2 text-red-500">${escHtml(e.message)}</td></tr>`;
  }
}

async function renderPricing() {
  const el = document.getElementById('pageContent');
  el.innerHTML = '<div class="text-center py-12 text-gray-400">Loading pricing…</div>';
  let publicHtml = '';
  try {
    const r = await fetch(`${API_BASE}/pricing`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const p = await r.json();
    publicHtml = formatPublicPricingHtml(p);
  } catch (e) {
    publicHtml = `<p class="text-sm text-red-600">Could not load <code class="bg-red-50 px-1 rounded">GET /pricing</code>: ${escHtml(e.message)}</p>`;
  }

  el.innerHTML = `<div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="font-bold text-lg text-navy">Pricing &amp; regional display</h2>
        <p class="text-xs text-gray-500 mt-1">What the site and extension consume from the API. Edit source data under Commerce or plan caps under Settings.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" onclick="navigate('commerce')" class="px-4 py-2 bg-rp text-white rounded-lg text-sm font-medium">Edit Commerce (DB)</button>
        <button type="button" onclick="navigate('settings')" class="px-4 py-2 border border-gray-200 rounded-lg text-sm text-navy hover:bg-gray-50">Plan limits (Settings)</button>
        <button type="button" onclick="commerceRefreshCache()" class="px-4 py-2 border border-gray-200 rounded-lg text-sm text-navy hover:bg-gray-50">↻ Refresh API cache</button>
        <span id="pricingCacheMsg" class="text-xs text-gray-500 self-center"></span>
      </div>
    </div>

    <div class="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
      <h3 class="font-semibold text-navy mb-1">🌐 Public <code class="bg-gray-100 px-1 rounded text-sm">GET /pricing</code></h3>
      <p class="text-xs text-gray-500 mb-3">Resolved using <strong>this browser’s</strong> IP (same as opening your marketing site from here). For a chosen country code, use the admin preview below.</p>
      <div id="pricingPublicMount">${publicHtml}</div>
    </div>

    <div class="bg-white rounded-xl shadow-sm p-5">
      <h3 class="font-semibold text-navy mb-2">🌍 Admin preview by country</h3>
      <p class="text-xs text-gray-500 mb-3">Uses <code class="bg-gray-100 px-1 rounded text-[11px]">/admin/pricing-preview</code> — same math as the app, without IP geo. PPP multipliers, FX, and Stripe coupons are edited under <button type="button" class="text-rp font-semibold underline" onclick="navigate('commerce')">Commerce → Countries</button>.</p>
      <div class="flex flex-wrap items-center gap-3 mb-2">
        <label class="text-xs text-gray-400">Country</label>
        <select id="pricingPageCountry" class="border rounded-lg px-3 py-1.5 text-sm" onchange="previewPricingForCountry(this.value, 'pricingPagePreviewResult')">
          <option value="">— Select —</option>
          <option value="US">🇺🇸 United States</option>
          <option value="GB">🇬🇧 United Kingdom</option>
          <option value="IN">🇮🇳 India</option>
          <option value="BR">🇧🇷 Brazil</option>
          <option value="NG">🇳🇬 Nigeria</option>
          <option value="DE">🇩🇪 Germany</option>
          <option value="MX">🇲🇽 Mexico</option>
        </select>
        <div id="pricingPagePreviewResult" class="text-sm flex-1 min-w-[200px]"></div>
      </div>
      <p class="text-xs text-gray-400">End users on VPN/hosting IPs are forced to US pricing on the public API.</p>
    </div>

    <div class="bg-white rounded-xl shadow-sm p-5">
      <h3 class="font-semibold text-navy mb-2">📊 Monthly rewrite caps (<code class="bg-gray-100 px-1 rounded text-xs">plan_config</code>)</h3>
      <p class="text-xs text-gray-500 mb-3">Read-only here. To change values use <button type="button" class="text-rp font-semibold underline" onclick="navigate('settings')">Settings</button> → Rewrite limits.</p>
      <div class="overflow-x-auto max-w-xl border border-gray-100 rounded-lg">
        <table class="w-full text-xs text-left">
          <thead><tr class="bg-gray-50 text-gray-500"><th class="p-2">Plan</th><th class="p-2">Monthly rewrites</th></tr></thead>
          <tbody id="pricingPlanLimitsReadonly"></tbody>
        </table>
      </div>
    </div>

    <div class="bg-slate-50 rounded-xl p-5 text-xs text-gray-600 space-y-2">
      <p><strong>Checkout:</strong> <code class="bg-white px-1 rounded">POST /checkout/subscription</code> · <code class="bg-white px-1 rounded">POST /checkout/credits</code> — pass <code class="bg-white px-1 rounded">country_code</code> to match displayed prices.</p>
      <p><strong>Stripe:</strong> Webhook <code class="bg-white px-1 rounded">/stripe/webhook</code> for subscriptions and credit purchases.</p>
    </div>
  </div>`;

  await fillPricingPlanLimitsReadonly();
}

// ═══════════════════════════════════════════
// COMMERCE & PPP (plan_config, bundles, countries, system, nudges)
// ═══════════════════════════════════════════
let commerceTab = 'plans';

async function renderCommerce() {
  const el = document.getElementById('pageContent');
  el.innerHTML = `<div class="space-y-4">
    <div class="bg-gradient-to-r from-navy to-slate-800 text-white rounded-xl p-5 shadow-sm">
      <h2 class="font-bold text-lg mb-2">Setup checklist</h2>
      <ol class="text-sm space-y-1.5 list-decimal list-inside opacity-95">
        <li>Run Supabase migration <code class="bg-white/10 px-1 rounded text-xs">20260330_commerce_config_ppp.sql</code> (plans, bundles, PPP, system keys).</li>
        <li>In <strong>Plans</strong>, set each paid plan’s <strong>Stripe Price ID</strong> (from Stripe Dashboard) — checkout requires this.</li>
        <li>Configure <strong>Countries</strong> multipliers; saving creates/updates Stripe PPP coupons when Stripe is configured.</li>
        <li>Point the site/extension to <code class="bg-white/10 px-1 rounded text-xs">POST /checkout/subscription</code> and <code class="bg-white/10 px-1 rounded text-xs">POST /checkout/credits</code> with <code class="bg-white/10 px-1 rounded text-xs">country_code</code>.</li>
        <li>Stripe webhook URL: <code class="bg-white/10 px-1 rounded text-xs">/stripe/webhook</code> — must handle subscription + credit checkouts.</li>
        <li>After edits here, use <strong>Refresh config cache</strong> (or wait up to TTL, default 5 min).</li>
        <li>Open the <button type="button" class="text-white underline font-semibold" onclick="navigate('pricing')">Pricing</button> page for a live <code class="bg-white/10 px-1 rounded text-xs">GET /pricing</code> snapshot and country preview.</li>
      </ol>
      <div class="mt-4 flex flex-wrap gap-2">
        <button type="button" onclick="commerceRefreshCache()" class="px-4 py-2 bg-rp text-white rounded-lg text-sm font-medium">↻ Refresh config cache</button>
        <span id="commerceCacheMsg" class="text-xs self-center opacity-80"></span>
      </div>
    </div>
    <div class="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
      ${['plans', 'bundles', 'countries', 'system', 'nudges'].map((t) =>
    `<button type="button" data-ctab="${t}" class="commerce-tab px-4 py-2 rounded-lg text-sm font-medium ${commerceTab === t ? 'bg-rp text-white' : 'bg-white border border-gray-200 text-navy hover:bg-gray-50'}">${{ plans: 'Plans', bundles: 'Credit bundles', countries: 'Countries (PPP)', system: 'System', nudges: 'Upgrade nudges' }[t]}</button>`).join('')}
    </div>
    <div id="commercePanel" class="min-h-[320px]">Loading…</div>
  </div>`;
  el.querySelectorAll('.commerce-tab').forEach((btn) => {
    btn.addEventListener('click', () => { commerceTab = btn.getAttribute('data-ctab') || 'plans'; renderCommerce(); });
  });
  await commerceLoadPanel();
}

async function commerceRefreshCache() {
  const msg = document.getElementById('commerceCacheMsg');
  const msgPricing = document.getElementById('pricingCacheMsg');
  if (msg) msg.textContent = 'Refreshing…';
  if (msgPricing) msgPricing.textContent = 'Refreshing…';
  try {
    const d = await api('/admin/config/refresh', { method: 'POST' });
    const ok = `OK · ${d.at || ''}`;
    if (msg) msg.textContent = ok;
    if (msgPricing) msgPricing.textContent = ok;
  } catch (e) {
    if (msg) msg.textContent = 'Error';
    if (msgPricing) msgPricing.textContent = 'Error';
    alert(e.message);
  }
}

async function commerceLoadPanel() {
  const panel = document.getElementById('commercePanel');
  if (!panel) return;
  panel.innerHTML = '<div class="text-center py-8 text-gray-400">Loading…</div>';
  try {
    if (commerceTab === 'plans') await commerceRenderPlans(panel);
    else if (commerceTab === 'bundles') await commerceRenderBundles(panel);
    else if (commerceTab === 'countries') await commerceRenderCountries(panel);
    else if (commerceTab === 'system') await commerceRenderSystem(panel);
    else if (commerceTab === 'nudges') await commerceRenderNudges(panel);
  } catch (e) {
    panel.innerHTML = `<div class="text-red-600 text-sm p-4">${escHtml(e.message)}</div>`;
  }
}

async function commerceRenderPlans(panel) {
  const d = await api('/admin/config/plans');
  const rows = d.plans || [];
  panel.innerHTML = `<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-xs text-left">
        <thead><tr class="border-b bg-gray-50 text-gray-500">
          <th class="p-2">Key</th><th class="p-2">Name</th><th class="p-2">Monthly</th><th class="p-2">Base $</th><th class="p-2">Seats</th><th class="p-2">Sort</th><th class="p-2">Active</th><th class="p-2 min-w-[140px]">Stripe price id</th><th class="p-2"></th>
        </tr></thead>
        <tbody id="commercePlansBody"></tbody>
      </table>
    </div>
    <p class="text-xs text-gray-500 p-3 border-t">Edit a row and click Save. Enterprise monthly blank = unlimited.</p>
  </div>`;
  const tb = document.getElementById('commercePlansBody');
  rows.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  tb.innerHTML = rows.map((r) => {
    const rawPk = String(r.plan_key || '');
    const pkDisp = escHtml(rawPk);
    const m = r.monthly_rewrites;
    const monthlyVal = m === null || m === undefined ? '' : String(m);
    return `<tr class="border-b hover:bg-gray-50/80">
      <td class="p-2 font-mono">${pkDisp}</td>
      <td class="p-2"><input id="cp-${rawPk}-dn" class="border rounded px-1 py-0.5 w-24" value="${escHtml(r.display_name || '')}"/></td>
      <td class="p-2"><input id="cp-${rawPk}-mo" type="number" class="border rounded px-1 w-20" value="${monthlyVal}" placeholder="null"/></td>
      <td class="p-2"><input id="cp-${rawPk}-bp" type="number" step="0.01" class="border rounded px-1 w-20" value="${r.base_price_usd != null ? r.base_price_usd : ''}"/></td>
      <td class="p-2"><input id="cp-${rawPk}-st" type="number" class="border rounded px-1 w-14" value="${r.seat_count != null ? r.seat_count : 1}"/></td>
      <td class="p-2"><input id="cp-${rawPk}-so" type="number" class="border rounded px-1 w-14" value="${r.sort_order != null ? r.sort_order : 0}"/></td>
      <td class="p-2"><input id="cp-${rawPk}-ac" type="checkbox" ${r.is_active !== false ? 'checked' : ''}/></td>
      <td class="p-2"><input id="cp-${rawPk}-sp" class="border rounded px-1 py-0.5 w-full font-mono text-[10px]" value="${escHtml(r.stripe_price_id || '')}" placeholder="price_…"/></td>
      <td class="p-2"><button type="button" class="px-2 py-1 bg-navy text-white rounded text-[11px]" onclick="commerceSavePlan(${JSON.stringify(rawPk)})">Save</button></td>
    </tr>`;
  }).join('');
}

async function commerceSavePlan(planKey) {
  const pk = planKey;
  const mo = document.getElementById(`cp-${pk}-mo`).value.trim();
  const body = {
    display_name: document.getElementById(`cp-${pk}-dn`).value.trim(),
    monthly_rewrites: mo === '' ? null : parseInt(mo, 10),
    base_price_usd: parseFloat(document.getElementById(`cp-${pk}-bp`).value) || null,
    seat_count: parseInt(document.getElementById(`cp-${pk}-st`).value, 10) || 1,
    sort_order: parseInt(document.getElementById(`cp-${pk}-so`).value, 10) || 0,
    is_active: document.getElementById(`cp-${pk}-ac`).checked,
    stripe_price_id: document.getElementById(`cp-${pk}-sp`).value.trim() || null,
  };
  await api(`/admin/config/plans/${encodeURIComponent(pk)}`, { method: 'PUT', body: JSON.stringify(body) });
  alert('Saved plan ' + pk);
}

async function commerceRenderBundles(panel) {
  const d = await api('/admin/config/credits');
  const rows = d.bundles || [];
  panel.innerHTML = `<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <table class="w-full text-xs text-left">
      <thead><tr class="border-b bg-gray-50 text-gray-500">
        <th class="p-2">Key</th><th class="p-2">Name</th><th class="p-2">Credits</th><th class="p-2">Base $</th><th class="p-2">Sort</th><th class="p-2">Active</th><th class="p-2 min-w-[120px]">Stripe price id</th><th class="p-2"></th>
      </tr></thead>
      <tbody>${rows.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((r) => {
    const rawBk = String(r.bundle_key || '');
    const bkDisp = escHtml(rawBk);
    return `<tr class="border-b">
      <td class="p-2 font-mono">${bkDisp}</td>
      <td class="p-2"><input id="cb-${rawBk}-dn" class="border rounded px-1 w-28" value="${escHtml(r.display_name || '')}"/></td>
      <td class="p-2"><input id="cb-${rawBk}-cr" type="number" class="border rounded px-1 w-20" value="${r.credits != null ? r.credits : 0}"/></td>
      <td class="p-2"><input id="cb-${rawBk}-bp" type="number" step="0.01" class="border rounded px-1 w-20" value="${r.base_price_usd != null ? r.base_price_usd : ''}"/></td>
      <td class="p-2"><input id="cb-${rawBk}-so" type="number" class="border rounded px-1 w-14" value="${r.sort_order != null ? r.sort_order : 0}"/></td>
      <td class="p-2"><input id="cb-${rawBk}-ac" type="checkbox" ${r.is_active !== false ? 'checked' : ''}/></td>
      <td class="p-2"><input id="cb-${rawBk}-sp" class="border rounded px-1 w-full font-mono text-[10px]" value="${escHtml(r.stripe_price_id || '')}"/></td>
      <td class="p-2"><button type="button" class="px-2 py-1 bg-navy text-white rounded text-[11px]" onclick="commerceSaveBundle(${JSON.stringify(rawBk)})">Save</button></td>
    </tr>`;
  }).join('')}</tbody>
    </table>
    <p class="text-xs text-gray-500 p-3 border-t">One-time checkout uses <code class="bg-gray-100 px-1">price_data</code> in USD; optional Stripe Price ID for reference.</p>
  </div>`;
}

async function commerceSaveBundle(bundleKey) {
  const bk = bundleKey;
  const body = {
    display_name: document.getElementById(`cb-${bk}-dn`).value.trim(),
    credits: parseInt(document.getElementById(`cb-${bk}-cr`).value, 10) || 0,
    base_price_usd: parseFloat(document.getElementById(`cb-${bk}-bp`).value) || 0,
    sort_order: parseInt(document.getElementById(`cb-${bk}-so`).value, 10) || 0,
    is_active: document.getElementById(`cb-${bk}-ac`).checked,
    stripe_price_id: document.getElementById(`cb-${bk}-sp`).value.trim() || null,
  };
  await api(`/admin/config/credits/${encodeURIComponent(bk)}`, { method: 'PUT', body: JSON.stringify(body) });
  alert('Saved bundle ' + bk);
}

async function commerceRenderCountries(panel) {
  const d = await api('/admin/config/countries');
  const rows = d.countries || [];
  panel.innerHTML = `<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <table class="w-full text-xs text-left">
      <thead><tr class="border-b bg-gray-50 text-gray-500">
        <th class="p-2">Code</th><th class="p-2">Name</th><th class="p-2">× mult</th><th class="p-2">CCY</th><th class="p-2">Sym</th><th class="p-2">FX / USD</th><th class="p-2">Active</th><th class="p-2">Coupon id</th><th class="p-2"></th>
      </tr></thead>
      <tbody>${rows.sort((a, b) => (a.country_code || '').localeCompare(b.country_code || '')).map((r) => {
    const rawCc = String(r.country_code || '');
    const ccDisp = escHtml(rawCc);
    const fxVal = r.exchange_rate_per_usd != null && r.exchange_rate_per_usd !== '' ? r.exchange_rate_per_usd : '';
    return `<tr class="border-b">
      <td class="p-2 font-mono font-bold">${ccDisp}</td>
      <td class="p-2"><input id="cc-${rawCc}-nm" class="border rounded px-1 w-32" value="${escHtml(r.country_name || '')}"/></td>
      <td class="p-2"><input id="cc-${rawCc}-mu" type="number" step="0.001" min="0.01" max="2" class="border rounded px-1 w-20" value="${r.price_multiplier != null ? r.price_multiplier : 1}"/></td>
      <td class="p-2"><input id="cc-${rawCc}-cur" class="border rounded px-1 w-12 uppercase font-mono" maxlength="3" value="${escHtml((r.currency_code || 'USD').toString())}"/></td>
      <td class="p-2"><input id="cc-${rawCc}-sy" class="border rounded px-1 w-10" value="${escHtml(r.currency_symbol || '$')}"/></td>
      <td class="p-2"><input id="cc-${rawCc}-fx" type="number" step="0.0001" min="0" class="border rounded px-1 w-24" placeholder="e.g. 83" title="Local currency units per 1 USD; empty = PPP-USD display" value="${fxVal}"/></td>
      <td class="p-2"><input id="cc-${rawCc}-ac" type="checkbox" ${r.is_active !== false ? 'checked' : ''}/></td>
      <td class="p-2 font-mono text-[10px] text-gray-500">${escHtml(r.stripe_coupon_id || '—')}</td>
      <td class="p-2"><button type="button" class="px-2 py-1 bg-navy text-white rounded text-[11px]" onclick="commerceSaveCountry(${JSON.stringify(rawCc)})">Save</button></td>
    </tr>`;
  }).join('')}</tbody>
    </table>
    <p class="text-xs text-gray-500 p-3 border-t">PPP multiplier applies before display. <strong>FX / USD</strong> = local units per 1 USD (e.g. INR 83, GBP 0.79); leave empty to show PPP-adjusted USD with the symbol. Stripe coupon is regenerated on save when Stripe is available.</p>
  </div>`;
}

async function commerceSaveCountry(code) {
  const cc = code;
  const fxRaw = document.getElementById(`cc-${cc}-fx`).value.trim();
  const body = {
    country_name: document.getElementById(`cc-${cc}-nm`).value.trim(),
    price_multiplier: parseFloat(document.getElementById(`cc-${cc}-mu`).value) || 1,
    currency_code: document.getElementById(`cc-${cc}-cur`).value.trim() || 'USD',
    currency_symbol: document.getElementById(`cc-${cc}-sy`).value.trim() || '$',
    is_active: document.getElementById(`cc-${cc}-ac`).checked,
  };
  if (fxRaw === '') body.exchange_rate_per_usd = null;
  else {
    const n = parseFloat(fxRaw);
    body.exchange_rate_per_usd = Number.isFinite(n) && n > 0 ? n : null;
  }
  await api(`/admin/config/countries/${encodeURIComponent(cc)}`, { method: 'PUT', body: JSON.stringify(body) });
  alert('Saved ' + cc + ' — refresh list to see updated coupon id');
  await commerceRenderCountries(document.getElementById('commercePanel'));
}

async function commerceRenderSystem(panel) {
  const d = await api('/admin/config/system');
  const rows = d.settings || [];
  panel.innerHTML = `<div class="bg-white rounded-xl shadow-sm p-4 space-y-3">
    ${rows.map((s) => {
    const k = escHtml(s.key || '');
    const v = s.value != null ? String(s.value) : '';
    const desc = escHtml(s.description || '');
    return `<div class="border rounded-lg p-3">
      <div class="flex flex-wrap justify-between gap-2">
        <code class="text-xs font-mono bg-gray-100 px-1 rounded">${k}</code>
        <button type="button" class="text-xs px-2 py-1 bg-rp text-white rounded" onclick="commerceSaveSystem('${String(s.key).replace(/'/g, "\\'")}')">Save</button>
      </div>
      <p class="text-[11px] text-gray-500 mt-1">${desc}</p>
      <input id="sys-${k}-val" class="mt-2 w-full border rounded px-2 py-1 text-sm font-mono" value="${escHtml(v)}"/>
    </div>`;
  }).join('')}
  </div>`;
}

async function commerceSaveSystem(key) {
  const kid = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
  const v = document.getElementById(`sys-${kid}-val`);
  if (!v) return;
  await api(`/admin/config/system/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value: v.value }) });
  alert('Saved ' + key);
}

async function commerceRenderNudges(panel) {
  const d = await api('/admin/config/nudges');
  const rows = d.nudges || [];
  panel.innerHTML = `<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <table class="w-full text-xs text-left">
      <thead><tr class="border-b bg-gray-50 text-gray-500">
        <th class="p-2">From plan</th><th class="p-2">Spend ≥ ($)</th><th class="p-2">Nudge to</th><th class="p-2">Message template</th><th class="p-2"></th>
      </tr></thead>
      <tbody>${rows.map((r) => {
    const rawFp = String(r.from_plan || '');
    const fpDisp = escHtml(rawFp);
    return `<tr class="border-b align-top">
      <td class="p-2 font-mono">${fpDisp}</td>
      <td class="p-2"><input id="ng-${rawFp}-sp" type="number" step="0.01" class="border rounded px-1 w-20" value="${r.nudge_at_spend_usd != null ? r.nudge_at_spend_usd : ''}"/></td>
      <td class="p-2"><input id="ng-${rawFp}-to" class="border rounded px-1 w-24" value="${escHtml(r.nudge_to_plan || '')}"/></td>
      <td class="p-2"><textarea id="ng-${rawFp}-msg" rows="2" class="border rounded px-1 w-full max-w-md text-[11px]">${escHtml(r.message_template || '')}</textarea></td>
      <td class="p-2"><button type="button" class="px-2 py-1 bg-navy text-white rounded text-[11px]" onclick="commerceSaveNudge(${JSON.stringify(rawFp)})">Save</button></td>
    </tr>`;
  }).join('')}</tbody>
    </table>
    <p class="text-xs text-gray-500 p-3 border-t">Placeholders: <code class="bg-gray-100 px-1">{spent}</code>, <code class="bg-gray-100 px-1">{plan}</code>, <code class="bg-gray-100 px-1">{price}</code></p>
  </div>`;
}

async function commerceSaveNudge(fromPlan) {
  const fp = fromPlan;
  const body = {
    nudge_at_spend_usd: parseFloat(document.getElementById(`ng-${fp}-sp`).value) || 0,
    nudge_to_plan: document.getElementById(`ng-${fp}-to`).value.trim(),
    message_template: document.getElementById(`ng-${fp}-msg`).value,
  };
  await api(`/admin/config/nudges/${encodeURIComponent(fp)}`, { method: 'PUT', body: JSON.stringify(body) });
  alert('Saved nudge for ' + fp);
}
