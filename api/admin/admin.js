// ═══════════════════════════════════════════
// ReplyPals Admin Dashboard — JS
// ═══════════════════════════════════════════
const API_BASE = location.origin;
let TOKEN = sessionStorage.getItem('rp_admin_token') || null;
let currentPage = 'dashboard';
let chartInstances = {};

// ─── Auth ───
function togglePassVis() {
    const p = document.getElementById('loginPass');
    p.type = p.type === 'password' ? 'text' : 'password';
}
async function doLogin() {
    const u = document.getElementById('loginUser').value.trim();
    const p = document.getElementById('loginPass').value;
    const err = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');
    if (!u || !p) { err.textContent = 'Enter username and password'; err.classList.remove('hidden'); return; }
    btn.textContent = 'Signing in…'; btn.disabled = true;
    try {
        const r = await fetch(`${API_BASE}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || 'Invalid credentials'); }
        const d = await r.json(); TOKEN = d.token; sessionStorage.setItem('rp_admin_token', TOKEN);
        showDashboard();
    } catch (e) {
        err.textContent = e.message; err.classList.remove('hidden');
        document.querySelector('#loginScreen > div').classList.add('shake');
        setTimeout(() => document.querySelector('#loginScreen > div').classList.remove('shake'), 300);
    } finally { btn.textContent = 'Sign In'; btn.disabled = false; }
}
function doLogout() { TOKEN = null; sessionStorage.removeItem('rp_admin_token'); location.reload(); }
function showDashboard() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainLayout').classList.remove('hidden');
    document.getElementById('mainLayout').classList.add('flex');
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const badge = document.getElementById('envBadge');
    badge.textContent = isLocal ? 'DEVELOPMENT' : 'PRODUCTION';
    badge.className = `badge ${isLocal ? 'badge-green' : 'badge-red'}`;
    navigate('dashboard');
}
if (TOKEN) showDashboard();

// ─── API Helper ───
async function api(path, opts = {}) {
    const h = { 'Content-Type': 'application/json' };
    if (TOKEN) h['Authorization'] = `Bearer ${TOKEN}`;
    const r = await fetch(`${API_BASE}${path}`, { ...opts, headers: { ...h, ...(opts.headers || {}) } });
    if (r.status === 401) { doLogout(); throw new Error('Session expired'); }
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `Error ${r.status}`); }
    return r.json();
}
function showModal(html) { document.getElementById('modalBox').innerHTML = html; document.getElementById('modalOverlay').classList.remove('hidden'); }
function hideModal() { document.getElementById('modalOverlay').classList.add('hidden'); }
document.getElementById('modalOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) hideModal(); });

let _refreshTimer = null;
function refreshPage() { navigate(currentPage); const el = document.getElementById('lastRefresh'); el.textContent = 'Just now'; el.classList.remove('hidden'); }

// ─── Navigation ───
document.getElementById('sidebarNav').addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    navigate(btn.dataset.page);
    document.getElementById('sidebar').classList.add('-translate-x-full');
});
const PAGE_TITLES = { dashboard: 'Dashboard', users: 'Users', licenses: 'Licenses', teams: 'Teams', analytics: 'Analytics', emails: 'Emails', logs: 'Logs', settings: 'Settings', commerce: 'Commerce & PPP', pricing: 'Pricing & display', security: 'Security' };
function navigate(page) {
    currentPage = page;
    document.getElementById('pageTitle').textContent = PAGE_TITLES[page] || page;
    document.querySelectorAll('.sidebar-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    Object.values(chartInstances).forEach(c => { try { c.destroy() } catch (e) { } }); chartInstances = {};
    if (_refreshTimer) clearInterval(_refreshTimer);
    const render = { dashboard: renderDashboard, users: renderUsers, licenses: renderLicenses, teams: renderTeams, analytics: renderAnalytics, emails: renderEmails, logs: renderLogs, settings: renderSettings, commerce: renderCommerce, pricing: renderPricing, security: renderSecurity };
    (render[page] || renderDashboard)();
}

// ─── Helpers ───
function fmtDate(s) { if (!s) return '—'; return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtTime(s) { if (!s) return '—'; return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function maskKey(k) { if (!k || k.length < 8) return '••••••••'; return k.slice(0, 4) + '•'.repeat(Math.min(k.length - 8, 12)) + k.slice(-4); }

// ═══════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════
async function renderDashboard() {
    const el = document.getElementById('pageContent');
    el.innerHTML = '<div class="text-center py-12 text-gray-400">Loading…</div>';
    try {
        const d = await api('/admin/dashboard-stats');
        let diag = null;
        try { diag = await api('/admin/diagnostics'); } catch (_) { diag = null; }
        const dbWarn = d.db_connected === false
            ? `<div class="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 text-yellow-800 px-4 py-3 text-sm">
                 DB connection issue: ${escHtml(d.db_error || 'Unable to fetch admin stats from database')}
               </div>`
            : '';
        const diagBar = diag ? `
          <div class="mb-4 flex flex-wrap gap-2 text-xs">
            <span class="badge ${diag.db_configured ? 'badge-green' : 'badge-red'}">DB ${diag.db_configured ? 'Configured' : 'Not Configured'}</span>
            <span class="badge ${diag.degraded_active ? 'badge-orange' : 'badge-green'}">Mode: ${diag.degraded_active ? 'Degraded' : 'Normal'}</span>
            <span class="badge badge-gray">Backoff: ${diag.supabase_backoff_active ? 'ON' : 'OFF'}</span>
            <span class="badge badge-gray">Log write errors: ${diag.log_write_errors || 0}</span>
          </div>` : '';
        const rwPct = d.rewrites_yesterday > 0 ? Math.round((d.rewrites_today - d.rewrites_yesterday) / d.rewrites_yesterday * 100) : 0;
        const userSub = `+${d.users_today} today · ${d.anonymous_users_total || 0} anon`;
        el.innerHTML = `
    ${dbWarn}
    ${diagBar}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${statCard('Total Users', d.total_users.toLocaleString(), userSub, '👥', d.users_today > 0)}
      ${statCard('Active Licenses', d.active_licenses.toLocaleString(), `+${d.licenses_today} today`, '🔑', d.licenses_today > 0)}
      ${statCard('Rewrites Today', d.rewrites_today.toLocaleString(), `${rwPct >= 0 ? '+' : ''}${rwPct}% vs yday`, '✍️', rwPct >= 0)}
      ${statCard('MRR', '$' + d.mrr.toLocaleString(), `+$${d.mrr_today || 0} today`, '💰', true)}
    </div>
    <div class="mb-6 flex flex-wrap gap-2 text-xs">
      <span class="badge badge-gray">Registered: ${d.registered_users_total || 0}</span>
      <span class="badge badge-blue">Leads (email only): ${d.lead_users_total || 0}</span>
      <span class="badge badge-orange">Anonymous temp: ${d.anonymous_users_total || 0}</span>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      <div class="bg-white rounded-xl shadow-sm p-5"><h3 class="font-semibold text-sm mb-3 text-navy">Rewrites Over Time</h3><canvas id="dashChart1" height="200"></canvas></div>
      <div class="bg-white rounded-xl shadow-sm p-5"><h3 class="font-semibold text-sm mb-3 text-navy">Plans Distribution</h3><canvas id="dashChart2" height="200"></canvas></div>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h3 class="font-semibold text-sm mb-3 text-navy">Recent Activity</h3>
      <div class="overflow-x-auto"><table class="w-full text-xs">
        <thead><tr class="text-left text-gray-400 border-b"><th class="pb-2 pr-3">Time</th><th class="pb-2 pr-3">Endpoint</th><th class="pb-2 pr-3">IP</th><th class="pb-2 pr-3">Status</th><th class="pb-2">Latency</th></tr></thead>
        <tbody id="recentTable"></tbody>
      </table></div>
    </div>`;
        // Recent activity rows
        const tbody = document.getElementById('recentTable');
        (d.recent_activity || []).forEach(a => {
            const sc = a.status_code || 200;
            const cls = sc >= 500 ? 'bg-red-50' : sc >= 400 ? 'bg-yellow-50' : '';
            const latCls = (a.latency_ms || 0) > 1000 ? 'text-orange-600 font-semibold' : '';
            tbody.innerHTML += `<tr class="${cls}"><td class="py-1.5 pr-3 text-gray-500">${fmtTime(a.created_at)}</td><td class="pr-3 font-mono">${a.endpoint || ''}</td><td class="pr-3 text-gray-500">${a.ip || ''}</td><td class="pr-3"><span class="badge ${sc < 300 ? 'badge-green' : sc < 500 ? 'badge-orange' : 'badge-red'}">${sc}</span></td><td class="${latCls}">${a.latency_ms || 0}ms</td></tr>`;
        });
        // Charts
        const analytics = await api('/admin/analytics?days=30');
        makeLineChart('dashChart1', analytics.rewrites_by_day);
        makeDoughnutChart('dashChart2', analytics.plan_distribution);
    } catch (e) { el.innerHTML = `<div class="text-center py-12 text-red-500">${escHtml(e.message)}</div>`; }
}
function statCard(title, value, change, icon, up) {
    return `<div class="stat-card bg-white rounded-xl shadow-sm p-5 relative">
    <span class="absolute top-4 right-4 text-2xl opacity-60">${icon}</span>
    <p class="text-xs text-gray-400 mb-1">${title}</p>
    <p class="text-2xl font-bold text-navy">${value}</p>
    <p class="text-xs mt-1 ${up ? 'text-green-600' : 'text-red-500'}">${up ? '↑' : '↓'} ${change}</p>
  </div>`;
}
function makeLineChart(id, data) {
    const ctx = document.getElementById(id); if (!ctx) return;
    chartInstances[id] = new Chart(ctx, { type: 'line', data: { labels: (data || []).map(d => d.date), datasets: [{ label: 'Rewrites', data: (data || []).map(d => d.count), borderColor: '#FF6B35', backgroundColor: 'rgba(255,107,53,0.1)', fill: true, tension: .3 }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true }, x: { ticks: { maxTicksToShow: 10 } } } } });
}
function makeDoughnutChart(id, data) {
    const ctx = document.getElementById(id); if (!ctx) return;
    const colors = { 'free': '#94A3B8', 'starter': '#3B82F6', 'pro': '#FF6B35', 'team': '#0F2544' };
    chartInstances[id] = new Chart(ctx, { type: 'doughnut', data: { labels: (data || []).map(d => d.plan), datasets: [{ data: (data || []).map(d => d.count), backgroundColor: (data || []).map(d => colors[d.plan] || '#ccc') }] }, options: { responsive: true, plugins: { legend: { position: 'bottom' } } } });
}

// ═══════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════
let usersPage = 1, usersSearch = '', usersFilter = 'all', usersSort = 'created_at';
async function renderUsers() {
    const el = document.getElementById('pageContent');
    el.innerHTML = `
  <div class="bg-white rounded-xl shadow-sm p-4 mb-4">
    <div class="flex flex-wrap gap-3 items-center">
      <input id="uSearch" type="text" placeholder="🔍 Search by email" class="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]" value="${escHtml(usersSearch)}"/>
      <select id="uFilter" class="border rounded-lg px-3 py-2 text-sm">
        <option value="all">All</option>
        <option value="registered">Registered users</option>
        <option value="anonymous">Anonymous temp users</option>
        <option value="lead">Leads (email only)</option>
        <option value="active">Active (7d)</option>
        <option value="inactive">Inactive</option>
        <option value="referred">Referred</option>
      </select>
      <select id="uSort" class="border rounded-lg px-3 py-2 text-sm"><option value="created_at">Newest</option><option value="total_rewrites">Rewrites ↓</option><option value="avg_score">Score ↓</option><option value="last_active">Last Active</option></select>
      <button onclick="exportCSV('free_users')" class="text-sm text-gray-500 hover:text-rp">📥 Export CSV</button>
      <span id="uTotal" class="text-sm text-gray-400 ml-auto"></span>
    </div>
  </div>
  <div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto"><table class="w-full text-sm">
      <thead><tr class="text-left text-gray-400 border-b text-xs"><th class="p-3">Email</th><th class="p-3">Rewrites</th><th class="p-3">Avg Score</th><th class="p-3">Goal</th><th class="p-3 hidden lg:table-cell">Joined</th><th class="p-3 hidden lg:table-cell">Last Active</th><th class="p-3">Actions</th></tr></thead>
      <tbody id="uBody"></tbody>
    </table></div>
    <div class="flex items-center justify-between p-3 border-t text-sm" id="uPager"></div>
  </div>`;
    document.getElementById('uFilter').value = usersFilter;
    document.getElementById('uSort').value = usersSort;
    document.getElementById('uSearch').addEventListener('input', debounce(e => { usersSearch = e.target.value; usersPage = 1; loadUsersTable(); }, 300));
    document.getElementById('uFilter').addEventListener('change', e => { usersFilter = e.target.value; usersPage = 1; loadUsersTable(); });
    document.getElementById('uSort').addEventListener('change', e => { usersSort = e.target.value; usersPage = 1; loadUsersTable(); });
    loadUsersTable();
}
async function loadUsersTable() {
    const tbody = document.getElementById('uBody'); if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-gray-400">Loading…</td></tr>';
    try {
        const d = await api(`/admin/users?page=${usersPage}&limit=50&search=${encodeURIComponent(usersSearch)}&filter=${usersFilter}&sort=${usersSort}`);
        if (d.db_connected === false) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-yellow-700">DB connection issue: ${escHtml(d.db_error || 'Unable to load users from database')}</td></tr>`;
            document.getElementById('uTotal').textContent = '0 users';
            document.getElementById('uPager').innerHTML = '';
            return;
        }
        document.getElementById('uTotal').textContent = `${d.total} users`;
        tbody.innerHTML = '';
        (d.users || []).forEach(u => {
            const uid = escHtml(u.user_id || '');
            const email = escHtml(u.email || '');
            const rewritesUsed = Number(u.rewrites_used || 0);
            const score = Number(u.avg_score || 0);
            tbody.innerHTML += `<tr class="border-b hover:bg-gray-50"><td class="p-3 font-mono text-xs">${email}</td><td class="p-3 font-semibold">${rewritesUsed}</td><td class="p-3"><span class="badge ${score >= 80 ? 'badge-green' : score >= 60 ? 'badge-orange' : 'badge-red'}">${Math.round(score)}</span></td><td class="p-3 text-xs text-gray-500">${escHtml(u.plan || 'free')}</td><td class="p-3 text-xs text-gray-400 hidden lg:table-cell">${fmtDate(u.created_at || u.last_seen)}</td><td class="p-3 text-xs text-gray-400 hidden lg:table-cell">${fmtDate(u.last_seen)}</td><td class="p-3 flex gap-1"><button onclick="viewUserById('${uid}')" class="text-xs hover:text-rp" title="View">👁</button><button onclick="emailUser('${email}')" class="text-xs hover:text-rp" title="Email">📧</button><button onclick="deleteUser('${uid}','${email}')" class="text-xs hover:text-red-600" title="Delete">🗑</button></td></tr>`;
        });
        if (!d.users || d.users.length === 0) tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-gray-400">No users found</td></tr>';
        const totalPages = Math.ceil(d.total / 50);
        document.getElementById('uPager').innerHTML = `<span class="text-gray-400">Showing ${(usersPage - 1) * 50 + 1}–${Math.min(usersPage * 50, d.total)} of ${d.total}</span><div class="flex gap-2"><button onclick="usersPage=Math.max(1,usersPage-1);loadUsersTable()" class="px-3 py-1 border rounded text-xs ${usersPage <= 1 ? 'opacity-30' : 'hover:bg-gray-100'}" ${usersPage <= 1 ? 'disabled' : ''}>← Prev</button><button onclick="usersPage=Math.min(${totalPages},usersPage+1);loadUsersTable()" class="px-3 py-1 border rounded text-xs ${usersPage >= totalPages ? 'opacity-30' : 'hover:bg-gray-100'}" ${usersPage >= totalPages ? 'disabled' : ''}>Next →</button></div>`;
    } catch (e) { tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-red-500">${escHtml(e.message)}</td></tr>`; }
}
async function viewUserById(userId) {
    showModal('<div class="text-center py-8 text-gray-400">Loading user details…</div>');
    try {
        const d = await api(`/admin/users/${encodeURIComponent(userId)}`);
        const profile = d.profile || {};
        const freeUser = d.free_user || {};
        const license = d.license || {};
        const logs = d.api_logs || [];
        const email = d.email || profile.email || freeUser.email || '—';
        const usageUsed = Number(d.rewrites_used ?? 0);
        const usageLimit = Number(d.rewrites_limit ?? 5);
        const usageLabel = usageLimit < 0 ? 'Unlimited' : `${usageUsed} / ${usageLimit}`;

        const logsHtml = `<div class="mt-4">
                 <div class="text-sm text-gray-500 mb-2">Recent activity logs</div>
                 <div class="flex flex-wrap gap-2 mb-2">
                   <select id="ulogAction" class="border rounded px-2 py-1 text-xs">
                     <option value="all">All actions</option>
                     <option value="rewrite">rewrite</option>
                     <option value="summary">summary</option>
                     <option value="fix">fix</option>
                     <option value="meaning">meaning</option>
                     <option value="translate">translate</option>
                     <option value="reply">reply</option>
                     <option value="write">write/generate</option>
                   </select>
                   <select id="ulogStatus" class="border rounded px-2 py-1 text-xs">
                     <option value="all">All status</option>
                     <option value="success">success</option>
                     <option value="error">error</option>
                   </select>
                   <select id="ulogProvider" class="border rounded px-2 py-1 text-xs">
                     <option value="all">All providers</option>
                     <option value="gemini">gemini</option>
                     <option value="openai">openai</option>
                     <option value="anthropic">anthropic</option>
                   </select>
                   <button id="ulogApply" class="px-2 py-1 border rounded text-xs hover:bg-gray-50">Apply</button>
                   <button id="ulogExport" class="px-2 py-1 border rounded text-xs hover:bg-gray-50">Export CSV</button>
                 </div>
                 <div class="max-h-64 overflow-auto border rounded-lg">
                   <table class="w-full text-xs">
                     <thead class="bg-gray-50 sticky top-0"><tr class="text-left text-gray-500"><th class="p-2">Time</th><th class="p-2">Action</th><th class="p-2">Provider</th><th class="p-2">Model</th><th class="p-2">Status</th><th class="p-2">Latency</th><th class="p-2">Cost</th></tr></thead>
                     <tbody id="ulogBody">
                       ${logs.length ? logs.map(l => `<tr class="border-t"><td class="p-2 text-gray-500">${fmtTime(l.created_at)}</td><td class="p-2">${escHtml(l.action || '—')}</td><td class="p-2">${escHtml(l.ai_provider || '—')}</td><td class="p-2 font-mono">${escHtml(l.ai_model || '—')}</td><td class="p-2"><span class="badge ${(l.status || '') === 'success' ? 'badge-green' : 'badge-red'}">${escHtml(l.status || '—')}</span></td><td class="p-2">${l.latency_ms || 0}ms</td><td class="p-2">$${Number(l.cost_usd || 0).toFixed(6)}</td></tr>`).join('') : '<tr><td colspan="7" class="p-2 text-gray-400">No logs yet.</td></tr>'}
                     </tbody>
                   </table>
                 </div>
               </div>`;

        showModal(`<h2 class="font-bold text-lg mb-4">👤 ${escHtml(email)}</h2>
    <div class="grid grid-cols-2 gap-3 text-sm mb-4">
      <div><span class="text-gray-400">User ID</span><br><span class="font-mono text-xs">${escHtml(d.user_id || userId)}</span></div>
      <div><span class="text-gray-400">Joined</span><br>${fmtDate(profile.created_at || freeUser.created_at)}</div>
      <div><span class="text-gray-400">Last Active</span><br>${fmtDate(profile.last_seen || freeUser.last_active)}</div>
      <div><span class="text-gray-400">Plan</span><br>${escHtml((license.plan || 'free').toUpperCase())}</div>
      <div><span class="text-gray-400">Rewrites</span><br>${usageLabel}</div>
      <div><span class="text-gray-400">Avg Score</span><br>${Math.round(profile.avg_score || freeUser.avg_score || 0)}/100</div>
    </div>
    ${logsHtml}
    <div class="flex gap-2 mt-4"><button onclick="emailUser('${escHtml(email)}');hideModal()" class="px-4 py-2 bg-rp text-white rounded-lg text-sm">📧 Send Email</button><button onclick="deleteUser('${escHtml(d.user_id || userId)}','${escHtml(email)}')" class="px-4 py-2 bg-red-500 text-white rounded-lg text-sm">🗑 Delete</button><button onclick="hideModal()" class="px-4 py-2 border rounded-lg text-sm">Close</button></div>`);

        const loadFilteredLogs = async () => {
            const action = document.getElementById('ulogAction')?.value || 'all';
            const status = document.getElementById('ulogStatus')?.value || 'all';
            const provider = document.getElementById('ulogProvider')?.value || 'all';
            const body = document.getElementById('ulogBody');
            if (!body) return;
            body.innerHTML = '<tr><td colspan="7" class="p-2 text-gray-400">Loading...</td></tr>';
            try {
                const q = `action=${encodeURIComponent(action)}&status=${encodeURIComponent(status)}&provider=${encodeURIComponent(provider)}&limit=200`;
                const resp = await api(`/admin/users/${encodeURIComponent(userId)}/logs?${q}`);
                const logs2 = resp.logs || [];
                body.innerHTML = logs2.length
                    ? logs2.map(l => `<tr class="border-t"><td class="p-2 text-gray-500">${fmtTime(l.created_at)}</td><td class="p-2">${escHtml(l.action || '—')}</td><td class="p-2">${escHtml(l.ai_provider || '—')}</td><td class="p-2 font-mono">${escHtml(l.ai_model || '—')}</td><td class="p-2"><span class="badge ${(l.status || '') === 'success' ? 'badge-green' : 'badge-red'}">${escHtml(l.status || '—')}</span></td><td class="p-2">${l.latency_ms || 0}ms</td><td class="p-2">$${Number(l.cost_usd || 0).toFixed(6)}</td></tr>`).join('')
                    : '<tr><td colspan="7" class="p-2 text-gray-400">No logs for current filters.</td></tr>';
            } catch (e) {
                body.innerHTML = `<tr><td colspan="7" class="p-2 text-red-500">${escHtml(e.message)}</td></tr>`;
            }
        };

        document.getElementById('ulogApply')?.addEventListener('click', loadFilteredLogs);
        document.getElementById('ulogExport')?.addEventListener('click', async () => {
            const action = document.getElementById('ulogAction')?.value || 'all';
            const status = document.getElementById('ulogStatus')?.value || 'all';
            const provider = document.getElementById('ulogProvider')?.value || 'all';
            const url = `${API_BASE}/admin/users/${encodeURIComponent(userId)}/logs/export?action=${encodeURIComponent(action)}&status=${encodeURIComponent(status)}&provider=${encodeURIComponent(provider)}`;
            const h = {};
            if (TOKEN) h['Authorization'] = `Bearer ${TOKEN}`;
            const r = await fetch(url, { headers: h });
            if (!r.ok) throw new Error(`Export failed (${r.status})`);
            const blob = await r.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `user_${userId}_logs.csv`;
            a.click();
        });
    } catch (e) {
        showModal(`<div class="text-center py-8 text-red-500">${escHtml(e.message)}</div>`);
    }
}
async function deleteUser(id, email) {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
    try { await api(`/admin/users/${id}`, { method: 'DELETE' }); hideModal(); loadUsersTable(); } catch (e) { alert(e.message); }
}
function emailUser(to) {
    showModal(`<h2 class="font-bold text-lg mb-4">📧 Send Email</h2>
    <label class="text-xs text-gray-400">To</label><input id="meTo" value="${escHtml(to)}" class="w-full border rounded-lg px-3 py-2 text-sm mb-3" readonly/>
    <label class="text-xs text-gray-400">Subject</label><input id="meSubject" class="w-full border rounded-lg px-3 py-2 text-sm mb-3" placeholder="Subject"/>
    <label class="text-xs text-gray-400">Body</label><textarea id="meBody" rows="6" class="w-full border rounded-lg px-3 py-2 text-sm mb-3" placeholder="Message…"></textarea>
    <div class="flex gap-2"><button onclick="sendManualEmail()" class="px-4 py-2 bg-rp text-white rounded-lg text-sm" id="meSendBtn">Send</button><button onclick="hideModal()" class="px-4 py-2 border rounded-lg text-sm">Cancel</button></div>`);
}
async function sendManualEmail() {
    const btn = document.getElementById('meSendBtn'); btn.textContent = 'Sending…'; btn.disabled = true;
    try {
        await api('/admin/send-email', { method: 'POST', body: JSON.stringify({ to: document.getElementById('meTo').value, subject: document.getElementById('meSubject').value, body: document.getElementById('meBody').value }) });
        hideModal(); alert('✅ Email sent!');
    } catch (e) { alert(e.message); btn.textContent = 'Send'; btn.disabled = false; }
}

// ═══════════════════════════════════════════
// LICENSES
// ═══════════════════════════════════════════
let licPage = 1, licSearch = '', licFilter = 'all';
async function renderLicenses() {
    const el = document.getElementById('pageContent');
    el.innerHTML = `
  <div id="licStats" class="flex flex-wrap gap-3 mb-4 text-xs"></div>
  <div class="bg-white rounded-xl shadow-sm p-4 mb-4">
    <div class="flex flex-wrap gap-3 items-center">
      <input id="lSearch" type="text" placeholder="🔍 Search email or key" class="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]" value="${escHtml(licSearch)}"/>
      <select id="lFilter" class="border rounded-lg px-3 py-2 text-sm"><option value="all">All</option><option value="active">Active</option><option value="revoked">Revoked</option><option value="starter">Starter</option><option value="pro">Pro</option><option value="team">Team</option></select>
      <button onclick="showCreateLicense()" class="px-4 py-2 bg-rp text-white rounded-lg text-sm">+ Create License</button>
      <button onclick="exportCSV('licenses')" class="text-sm text-gray-500 hover:text-rp">📥 Export</button>
    </div>
  </div>
  <div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto"><table class="w-full text-sm">
      <thead><tr class="text-left text-gray-400 border-b text-xs"><th class="p-3">Email</th><th class="p-3">License Key</th><th class="p-3">Plan</th><th class="p-3">Status</th><th class="p-3 hidden lg:table-cell">Created</th><th class="p-3">Actions</th></tr></thead>
      <tbody id="lBody"></tbody>
    </table></div>
    <div class="flex items-center justify-between p-3 border-t text-sm" id="lPager"></div>
  </div>`;
    document.getElementById('lFilter').value = licFilter;
    document.getElementById('lSearch').addEventListener('input', debounce(e => { licSearch = e.target.value; licPage = 1; loadLicTable(); }, 300));
    document.getElementById('lFilter').addEventListener('change', e => { licFilter = e.target.value; licPage = 1; loadLicTable(); });
    loadLicTable();
}
async function loadLicTable() {
    const tbody = document.getElementById('lBody'); if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-gray-400">Loading…</td></tr>';
    try {
        const d = await api(`/admin/licenses?page=${licPage}&limit=50&search=${encodeURIComponent(licSearch)}&filter=${licFilter}`);
        const st = d.stats || {};
        document.getElementById('licStats').innerHTML = `<span class="badge badge-orange">Pro: ${st.active_pro || 0}</span><span class="badge badge-blue">Starter: ${st.active_starter || 0}</span><span class="badge" style="background:#0F2544;color:#fff">Team: ${st.active_team || 0}</span><span class="badge badge-red">Revoked: ${st.revoked || 0}</span>`;
        tbody.innerHTML = '';
        (d.licenses || []).forEach(l => {
            const active = l.active !== false;
            tbody.innerHTML += `<tr class="border-b hover:bg-gray-50${!active ? ' opacity-50' : ''}"><td class="p-3 font-mono text-xs">${escHtml(l.email || '')}</td><td class="p-3 font-mono text-xs"><span id="lk_${l.id}">${maskKey(l.license_key)}</span> <button onclick="this.previousElementSibling.textContent=this.previousElementSibling.textContent.includes('•')?'${escHtml(l.license_key)}':'${maskKey(l.license_key)}'" class="text-xs hover:text-rp">👁</button> <button onclick="navigator.clipboard.writeText('${escHtml(l.license_key)}');this.textContent='✓';setTimeout(()=>this.textContent='📋',1000)" class="text-xs">📋</button></td><td class="p-3"><span class="badge ${l.plan === 'pro' ? 'badge-orange' : l.plan === 'starter' ? 'badge-blue' : 'badge-gray'}">${l.plan || 'pro'}</span></td><td class="p-3"><span class="badge ${active ? 'badge-green' : 'badge-red'}">${active ? 'Active' : 'Revoked'}</span></td><td class="p-3 text-xs text-gray-400 hidden lg:table-cell">${fmtDate(l.created_at)}</td><td class="p-3 flex gap-1"><button onclick="toggleLic('${l.id}',${!active})" class="text-xs" title="${active ? 'Revoke' : 'Activate'}">${active ? '🚫' : '✅'}</button><button onclick="resendLic('${l.id}')" class="text-xs hover:text-rp" title="Resend">📧</button><button onclick="deleteLic('${l.id}')" class="text-xs hover:text-red-600" title="Delete">🗑</button></td></tr>`;
        });
        if (!d.licenses || d.licenses.length === 0) tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-gray-400">No licenses</td></tr>';
        const tp = Math.ceil(d.total / 50);
        document.getElementById('lPager').innerHTML = `<span class="text-gray-400 text-xs">Page ${licPage} of ${tp || 1}</span><div class="flex gap-2"><button onclick="licPage=Math.max(1,licPage-1);loadLicTable()" class="px-3 py-1 border rounded text-xs" ${licPage <= 1 ? 'disabled' : ''}>←</button><button onclick="licPage=Math.min(${tp},licPage+1);loadLicTable()" class="px-3 py-1 border rounded text-xs" ${licPage >= tp ? 'disabled' : ''}>→</button></div>`;
    } catch (e) { tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">${escHtml(e.message)}</td></tr>`; }
}
function showCreateLicense() {
    showModal(`<h2 class="font-bold text-lg mb-4">+ Create License</h2>
    <label class="text-xs text-gray-400">Email</label><input id="clEmail" class="w-full border rounded-lg px-3 py-2 text-sm mb-3" placeholder="user@email.com"/>
    <label class="text-xs text-gray-400">Plan</label><select id="clPlan" class="w-full border rounded-lg px-3 py-2 text-sm mb-3"><option>starter</option><option selected>pro</option><option>team</option></select>
    <label class="flex items-center gap-2 text-sm mb-4"><input type="checkbox" id="clSend" checked/> Send license email to user</label>
    <div class="flex gap-2"><button onclick="createLicense()" id="clBtn" class="px-4 py-2 bg-rp text-white rounded-lg text-sm">Create</button><button onclick="hideModal()" class="px-4 py-2 border rounded-lg text-sm">Cancel</button></div>`);
}
async function createLicense() {
    const btn = document.getElementById('clBtn'); btn.textContent = 'Creating…'; btn.disabled = true;
    try {
        const d = await api('/admin/licenses', { method: 'POST', body: JSON.stringify({ email: document.getElementById('clEmail').value, plan: document.getElementById('clPlan').value, send_email: document.getElementById('clSend').checked }) });
        hideModal(); alert(`✅ License created: ${d.license_key}`); loadLicTable();
    } catch (e) { alert(e.message); btn.textContent = 'Create'; btn.disabled = false; }
}
async function toggleLic(id, active) { try { await api(`/admin/licenses/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }); loadLicTable(); } catch (e) { alert(e.message); } }
async function resendLic(id) { try { await api(`/admin/licenses/${id}/resend`, { method: 'POST' }); alert('✅ Email resent'); } catch (e) { alert(e.message); } }
async function deleteLic(id) { if (!confirm('Revoke this license?')) return; try { await api(`/admin/licenses/${id}`, { method: 'DELETE' }); loadLicTable(); } catch (e) { alert(e.message); } }

// ─── Utility ───
function debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }
async function exportCSV(table) {
    try {
        const d = await api(`/admin/export-data?table=${table}`);
        if (!d.data || d.data.length === 0) { alert('No data'); return; }
        const keys = Object.keys(d.data[0]);
        let csv = keys.join(',') + '\n';
        d.data.forEach(r => { csv += keys.map(k => `"${String(r[k] || '').replace(/"/g, '""')}"`).join(',') + '\n'; });
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${table}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    } catch (e) { alert(e.message); }
}

// ═══════════════════════════════════════════
// TEAMS
// ═══════════════════════════════════════════
async function renderTeams() {
    const el = document.getElementById('pageContent');
    el.innerHTML = '<div class="text-center py-12 text-gray-400">Loading…</div>';
    try {
        const d = await api('/admin/teams');
        if (!d.teams || d.teams.length === 0) { el.innerHTML = '<div class="text-center py-12 text-gray-400">No teams yet</div>'; return; }
        let html = '<div class="space-y-4">';
        d.teams.forEach(t => {
            html += `<div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="p-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer" onclick="this.nextElementSibling.classList.toggle('hidden')">
          <div><span class="font-semibold">${escHtml(t.name)}</span> <span class="text-xs text-gray-400 ml-2">${escHtml(t.admin_email)}</span></div>
          <div class="flex gap-3 text-xs text-gray-500"><span>${t.member_count}/${t.seat_count || 5} seats</span><span>${t.total_rewrites} rewrites</span><span>Avg ${t.avg_score}/100</span></div>
          <div class="flex gap-1"><button onclick="event.stopPropagation();editTeam('${t.id}',${escHtml(JSON.stringify(JSON.stringify(t)))})" class="text-xs hover:text-rp">✏️</button><button onclick="event.stopPropagation();deleteTeam('${t.id}','${escHtml(t.name)}')" class="text-xs hover:text-red-600">🗑</button></div>
        </div>
        <div class="hidden border-t">
          <table class="w-full text-xs"><thead><tr class="text-gray-400 border-b"><th class="p-2 text-left">Email</th><th class="p-2 text-left">Key</th><th class="p-2">Rewrites</th><th class="p-2">Score</th><th class="p-2">Joined</th></tr></thead>
          <tbody>${(t.members || []).map(m => `<tr class="border-b"><td class="p-2">${escHtml(m.email || '')}</td><td class="p-2 font-mono">${maskKey(m.member_key)}</td><td class="p-2 text-center">${m.rewrites || 0}</td><td class="p-2 text-center">${Math.round(m.avg_score || 0)}</td><td class="p-2 text-gray-400">${fmtDate(m.created_at)}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>`;
        });
        html += '</div>';
        el.innerHTML = html;
    } catch (e) { el.innerHTML = `<div class="text-center py-12 text-red-500">${escHtml(e.message)}</div>`; }
}
function editTeam(id, jsonStr) {
    const t = JSON.parse(jsonStr);
    showModal(`<h2 class="font-bold text-lg mb-4">✏️ Edit Team</h2>
    <label class="text-xs text-gray-400">Name</label><input id="etName" value="${escHtml(t.name)}" class="w-full border rounded-lg px-3 py-2 text-sm mb-3"/>
    <label class="text-xs text-gray-400">Seats</label><input id="etSeats" type="number" min="2" max="100" value="${t.seat_count || 5}" class="w-full border rounded-lg px-3 py-2 text-sm mb-3"/>
    <label class="text-xs text-gray-400">Brand Voice</label><textarea id="etVoice" rows="3" class="w-full border rounded-lg px-3 py-2 text-sm mb-3" placeholder="Describe your writing style…">${escHtml(t.brand_voice || '')}</textarea>
    <div class="flex gap-2"><button onclick="saveTeam('${id}')" id="etBtn" class="px-4 py-2 bg-rp text-white rounded-lg text-sm">Save</button><button onclick="hideModal()" class="px-4 py-2 border rounded-lg text-sm">Cancel</button></div>`);
}
async function saveTeam(id) {
    const btn = document.getElementById('etBtn'); btn.textContent = 'Saving…'; btn.disabled = true;
    try { await api(`/admin/teams/${id}`, { method: 'PATCH', body: JSON.stringify({ name: document.getElementById('etName').value, seat_count: +document.getElementById('etSeats').value, brand_voice: document.getElementById('etVoice').value }) }); hideModal(); renderTeams(); } catch (e) { alert(e.message); btn.textContent = 'Save'; btn.disabled = false; }
}
async function deleteTeam(id, name) { if (!confirm(`Delete team "${name}" and all members?`)) return; try { await api(`/admin/teams/${id}`, { method: 'DELETE' }); renderTeams(); } catch (e) { alert(e.message); } }

// ═══════════════════════════════════════════
// MODEL SETTINGS (Admin Panel)
// ═══════════════════════════════════════════
let MODEL_OPTIONS = {
  gemini: [],
  openai: [],
  anthropic: []
};

function updateModelOptions(selectValue = null) {
  const provider = document.getElementById("model-provider").value;
  const versionEl = document.getElementById("model-version");
  versionEl.innerHTML = "";
  
  if (MODEL_OPTIONS[provider] && MODEL_OPTIONS[provider].length > 0) {
    MODEL_OPTIONS[provider].forEach(opt => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (selectValue && opt.value === selectValue) o.selected = true;
      versionEl.appendChild(o);
    });
  } else {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "Loading or unavailable...";
    versionEl.appendChild(o);
  }
}

async function loadCurrentModel() {
  try {
    const data = await api("/admin/model");
    
    // Store dynamically fetched models from backend
    if (data.options) {
      MODEL_OPTIONS = data.options;
    }
    
    const providerEl = document.getElementById("model-provider");
    providerEl.value = data.provider;
    
    // Pass the model_id if it's a string, otherwise if it's an Event just pull from current value
    const valObj = typeof arguments[0] === 'object' ? data.model_id : data.model_id;
    updateModelOptions(valObj);
    
    const updated = data.updated_at
      ? new Date(data.updated_at).toLocaleString()
      : "unknown";
    document.getElementById("model-current-label").textContent =
      `Active: ${data.provider} / ${data.model_id}  (set ${updated})`;
  } catch (e) {
    document.getElementById("model-current-label").textContent =
      "Could not load current model.";
  }
}

async function saveModel() {
  const provider  = document.getElementById("model-provider").value;
  const model_id  = document.getElementById("model-version").value;
  const msgEl     = document.getElementById("model-save-msg");

  try {
    const data = await api("/admin/model", {
      method: "POST",
      body: JSON.stringify({ provider, model_id }),
    });
    if (data.ok) {
      msgEl.style.display = "block";
      msgEl.style.color   = "#059669";
      msgEl.textContent   = `✅ Saved! Now using ${provider} / ${model_id}`;
      document.getElementById("model-current-label").textContent =
        `Active: ${provider} / ${model_id}`;
    } else {
      throw new Error(data.detail || "Save failed");
    }
  } catch (e) {
    msgEl.style.display = "block";
    msgEl.style.color   = "#dc2626";
    msgEl.textContent   = "❌ " + e.message;
  }
}

async function testModel() {
  const provider  = document.getElementById("model-provider").value;
  const model_id  = document.getElementById("model-version").value;
  const resultEl  = document.getElementById("model-test-result");

  resultEl.style.display = "block";
  resultEl.textContent   = "⏳ Testing " + provider + " / " + model_id + "...";

  try {
    const start = Date.now();
    const data = await api("/rewrite", {
      method: "POST",
      body: JSON.stringify({
        text:     "Please do the needful and revert back at the earliest.",
        tone:     "Formal",
        language: "en",
        _test_model_override: { provider, model_id },
      }),
    });
    const ms   = Date.now() - start;

    if (data.rewritten) {
      resultEl.textContent =
        `✅ ${provider} / ${model_id} responded in ${ms}ms\n\n` +
        `Score: ${data.score}/100\n` +
        `Result: "${data.rewritten}"`;
      resultEl.style.border = "1px solid #bbf7d0";
    } else {
      resultEl.textContent = "❌ Rewrite failed:\n" + JSON.stringify(data, null, 2);
      resultEl.style.border = "1px solid #fecaca";
    }
  } catch (e) {
    resultEl.textContent = "❌ Error: " + e.message;
    resultEl.style.border = "1px solid #fecaca";
  }
}
