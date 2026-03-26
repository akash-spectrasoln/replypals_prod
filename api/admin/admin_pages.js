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
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h3 class="font-semibold text-navy mb-4">🌍 Regional Pricing
        <span class="text-xs text-gray-400 font-normal ml-2">Auto-detects user's country and shows localized prices</span>
      </h3>
      <div class="overflow-x-auto mb-4">
        <table class="w-full text-xs">
          <thead><tr class="text-left text-gray-400 border-b"><th class="p-2">Tier</th><th class="p-2">Countries</th><th class="p-2">Starter</th><th class="p-2">Pro</th><th class="p-2">Team</th><th class="p-2">Currency</th></tr></thead>
          <tbody>
            <tr class="border-b"><td class="p-2 font-semibold">Tier 1</td><td class="p-2 text-gray-500">US, GB, AU, CA, NZ, DE, FR…</td><td class="p-2">$2</td><td class="p-2">$9</td><td class="p-2">$25</td><td class="p-2">USD</td></tr>
            <tr class="border-b bg-gray-50"><td class="p-2 font-semibold">Tier 2</td><td class="p-2 text-gray-500">AE, SA, QA, PL, CZ, TR…</td><td class="p-2">$1.5</td><td class="p-2">$6</td><td class="p-2">$20</td><td class="p-2">USD</td></tr>
            <tr class="border-b"><td class="p-2 font-semibold">Tier 3</td><td class="p-2 text-gray-500">IN</td><td class="p-2">₹149</td><td class="p-2">₹329</td><td class="p-2">₹1,999</td><td class="p-2">INR</td></tr>
            <tr class="border-b bg-gray-50"><td class="p-2 font-semibold">Tier 4</td><td class="p-2 text-gray-500">PH, MY, ID, TH, VN, MM</td><td class="p-2">₱99</td><td class="p-2">₱229</td><td class="p-2">₱1,299</td><td class="p-2">PHP</td></tr>
            <tr class="border-b"><td class="p-2 font-semibold">Tier 5</td><td class="p-2 text-gray-500">BR, MX, CO, AR, CL, PE</td><td class="p-2">R$9</td><td class="p-2">R$19</td><td class="p-2">R$99</td><td class="p-2">BRL</td></tr>
            <tr class="border-b bg-gray-50"><td class="p-2 font-semibold">Tier 6</td><td class="p-2 text-gray-500">Fallback (all others)</td><td class="p-2">$1</td><td class="p-2">$3</td><td class="p-2">$12</td><td class="p-2">USD</td></tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center gap-3 mb-2">
        <label class="text-xs text-gray-400">Preview as country:</label>
        <select id="pricingPreviewCountry" class="border rounded-lg px-3 py-1.5 text-sm" onchange="previewPricingForCountry(this.value)">
          <option value="">— Select —</option>
          <option value="US">🇺🇸 United States (Tier 1)</option>
          <option value="GB">🇬🇧 United Kingdom (Tier 1)</option>
          <option value="AE">🇦🇪 UAE (Tier 2)</option>
          <option value="TR">🇹🇷 Turkey (Tier 2)</option>
          <option value="IN">🇮🇳 India (Tier 3)</option>
          <option value="PH">🇵🇭 Philippines (Tier 4)</option>
          <option value="BR">🇧🇷 Brazil (Tier 5)</option>
          <option value="NG">🇳🇬 Nigeria (Tier 6)</option>
        </select>
        <div id="pricingPreviewResult" class="text-sm"></div>
      </div>
      <div class="text-xs text-gray-400 mt-2">⚠️ VPN/proxy users automatically see Tier 1 pricing. Non-tier1 users see "Pricing adjusted for your region 🌍".</div>
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

// ═══════════════════════════════════════════
// SECURITY PAGE
// ═══════════════════════════════════════════
async function renderSecurity() {
  const el = document.getElementById('pageContent');
  el.innerHTML = '<div class="text-center py-12 text-gray-400">Loading…</div>';
  try {
    const [sessions, blocked, audit] = await Promise.all([api('/admin/sessions'), api('/admin/blocked-ips'), api('/admin/audit-log?limit=50')]);
    el.innerHTML = `<div class="space-y-6">
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

// ═══════════════════════════════════════════
// PRICING PREVIEW
// ═══════════════════════════════════════════
async function previewPricingForCountry(cc) {
  const el = document.getElementById('pricingPreviewResult');
  if (!cc) { el.textContent = ''; return; }
  el.textContent = 'Loading…';
  try {
    const d = await api(`/admin/pricing-preview?country=${cc}`);
    const p = d.plans;
    el.innerHTML = `<span class="badge ${d.tier === 'tier1' ? 'badge-blue' : 'badge-green'}">${d.tier}</span>
            Starter: <strong>${p.starter.display}</strong> · Pro: <strong>${p.pro.display}</strong> · Team: <strong>${p.team.display}</strong>
            ${d.note ? `<span class="text-xs text-gray-400 ml-2">${d.note} 🌍</span>` : ''}`;
  } catch (e) { el.textContent = '⚠️ ' + e.message; }
}
