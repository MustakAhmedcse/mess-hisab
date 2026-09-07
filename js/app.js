import { loadDB, saveDB, uid, ensureMonth, activeMembers, memberName, computeSummary, exportDB, exportMonth, importFile } from './store.js';
import { avatarColor, initials, money, openModal, closeModal, toast } from './ui.js';
import { renderCostChart, renderMemberChart } from './charts.js';

let DB = null;

const ROUTES = ['dashboard', 'members', 'costs', 'meals', 'reports', 'settings'];
const ROUTE_TITLES = {
  dashboard: 'Dashboard',
  members: 'Members',
  costs: 'Bazar & Costs',
  meals: 'Meals',
  reports: 'Reports',
  settings: 'Settings'
};

const CATEGORIES = [
  { key: 'bazar', label: 'Bazar', icon: '🛒' },
  { key: 'utility', label: 'Utility', icon: '💡' },
  { key: 'rent', label: 'Rent', icon: '🏠' },
  { key: 'other', label: 'Other', icon: '📦' }
];

async function init() {
  DB = await loadDB();
  if (!DB.settings) DB.settings = { currentMonth: Object.keys(DB.months)[0] || '2026-08', theme: 'light' };
  applyTheme(DB.settings.theme || 'light');
  bindGlobalEvents();
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/dashboard';
  render();
}

function currentMonth() {
  return DB.settings.currentMonth;
}

function setMonth(m) {
  DB.settings.currentMonth = m;
  saveDB(DB);
  render();
}

function populateMonthSelect() {
  const sel = document.getElementById('monthSelect');
  const months = Object.keys(DB.months).sort();
  sel.innerHTML = months.map(m => `<option value="${m}" ${m === currentMonth() ? 'selected' : ''}>${formatMonthLabel(m)}</option>`).join('');
  sel.onchange = () => setMonth(sel.value);
}

function formatMonthLabel(m) {
  const [y, mo] = m.split('-');
  const names = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[Number(mo)]} ${y}`;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  DB.settings.theme = theme;
}

function bindGlobalEvents() {
  document.getElementById('themeToggle').onclick = () => {
    const next = DB.settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    saveDB(DB);
    render();
  };
  document.getElementById('addMonthBtn').onclick = () => openAddMonthModal();
  const menuToggle = document.getElementById('menuToggle');
  if (menuToggle) {
    menuToggle.onclick = () => document.body.classList.toggle('sidebar-open');
  }
}

function currentRoute() {
  const h = (location.hash || '#/dashboard').replace('#/', '');
  return ROUTES.includes(h) ? h : 'dashboard';
}

function render() {
  const route = currentRoute();
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.route === route));
  document.getElementById('pageTitle').textContent = ROUTE_TITLES[route];
  populateMonthSelect();
  const root = document.getElementById('viewRoot');
  root.innerHTML = '';
  const renderers = {
    dashboard: renderDashboard,
    members: renderMembers,
    costs: renderCosts,
    meals: renderMeals,
    reports: renderReports,
    settings: renderSettings
  };
  renderers[route](root);
}

/* ---------------- Dashboard ---------------- */

function renderDashboard(root) {
  const monthKey = currentMonth();
  const summary = computeSummary(DB, monthKey);
  const totalDeposit = Object.values(DB.months[monthKey]?.deposits || {}).reduce((a, b) => a + Number(b || 0), 0);

  root.innerHTML = `
    <div class="stat-grid">
      ${statCard('Total Cost', money(summary.totalCost), '🛒', 'primary')}
      ${statCard('Total Meals', summary.totalMeals.toFixed(1), '🍽️', 'accent')}
      ${statCard('Meal Rate', summary.mealRate ? money(summary.mealRate) : '—', '⚖️', 'warning')}
      ${statCard('Total Deposit', money(totalDeposit), '💰', 'success')}
    </div>
    <div class="grid-2">
      <div class="card">
        <h3>Expense Breakdown</h3>
        ${Object.keys(summary.byCategory).length ? '<canvas id="costChart" height="220"></canvas>' : '<p class="empty">এখনো কোনো খরচ যোগ করা হয়নি।</p>'}
      </div>
      <div class="card">
        <h3>Deposit vs Cost</h3>
        ${summary.rows.length ? '<canvas id="memberChart" height="220"></canvas>' : '<p class="empty">কোনো member নেই।</p>'}
      </div>
    </div>
    <div class="card">
      <h3>Member Balance</h3>
      <div class="member-grid">
        ${summary.rows.map(r => memberBalanceCard(r)).join('') || '<p class="empty">কোনো member নেই।</p>'}
      </div>
    </div>
    <div class="card">
      <h3>Recent Activity</h3>
      ${renderRecentActivity(monthKey)}
    </div>
  `;

  if (Object.keys(summary.byCategory).length) {
    renderCostChart(document.getElementById('costChart'), summary.byCategory);
  }
  if (summary.rows.length) {
    renderMemberChart(document.getElementById('memberChart'), summary.rows);
  }
}

function statCard(label, value, icon, tone) {
  return `<div class="stat-card tone-${tone}"><div class="stat-icon">${icon}</div><div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div></div>`;
}

function memberBalanceCard(r) {
  const positive = r.balance >= 0;
  const badgeClass = positive ? 'badge-success' : 'badge-danger';
  const badgeText = positive ? `Advance ${money(r.balance)}` : `Due ${money(Math.abs(r.balance))}`;
  return `
    <div class="member-card">
      <div class="avatar" style="background:${avatarColor(r.member.name)}">${initials(r.member.name)}</div>
      <div class="member-info">
        <div class="member-name">${r.member.name}</div>
        <div class="member-sub">${r.meals} meals · Deposit ${money(r.deposit)}</div>
      </div>
      <div class="badge ${badgeClass}">${badgeText}</div>
    </div>`;
}

function renderRecentActivity(monthKey) {
  const month = DB.months[monthKey] || { costs: [], meals: [] };
  const items = [
    ...month.costs.map(c => ({ date: c.date, text: `${memberName(DB, c.memberId)} added ${c.category} cost ${money(c.amount)}${c.details ? ' – ' + c.details : ''}` })),
    ...month.meals.map(m => ({ date: m.date, text: `${memberName(DB, m.memberId)} logged ${m.count} meal(s)` }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
  if (!items.length) return '<p class="empty">এখনো কোনো activity নেই।</p>';
  return `<ul class="activity-list">${items.map(i => `<li><span class="activity-date">${i.date}</span>${i.text}</li>`).join('')}</ul>`;
}

/* ---------------- Members ---------------- */

function renderMembers(root) {
  root.innerHTML = `
    <div class="toolbar"><span></span><button class="btn btn-primary" id="addMemberBtn">+ Add Member</button></div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Member</th><th>Join Date</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${DB.members.map(m => `
            <tr>
              <td><div class="cell-name"><div class="avatar sm" style="background:${avatarColor(m.name)}">${initials(m.name)}</div>${m.name}</div></td>
              <td>${m.joinDate || '—'}</td>
              <td><span class="badge ${m.active ? 'badge-success' : 'badge-muted'}">${m.active ? 'Active' : 'Inactive'}</span></td>
              <td class="row-actions">
                <button class="icon-btn" data-edit="${m.id}" title="Edit">✏️</button>
                <button class="icon-btn" data-toggle="${m.id}" title="${m.active ? 'Deactivate' : 'Activate'}">${m.active ? '🚫' : '✅'}</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  root.querySelector('#addMemberBtn').onclick = () => openMemberModal();
  root.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openMemberModal(btn.dataset.edit));
  root.querySelectorAll('[data-toggle]').forEach(btn => btn.onclick = () => {
    const m = DB.members.find(x => x.id === btn.dataset.toggle);
    m.active = !m.active;
    saveDB(DB);
    render();
    toast(`${m.name} ${m.active ? 'activated' : 'deactivated'}`);
  });
}

function openMemberModal(id) {
  const editing = id ? DB.members.find(m => m.id === id) : null;
  openModal(`
    <h3>${editing ? 'Edit Member' : 'Add Member'}</h3>
    <form id="memberForm">
      <label>Name</label>
      <input name="name" required value="${editing?.name || ''}" placeholder="e.g. Rafiq">
      <label>Join Date</label>
      <input type="date" name="joinDate" value="${editing?.joinDate || new Date().toISOString().slice(0, 10)}">
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`);
  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('memberForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (editing) {
      editing.name = fd.get('name');
      editing.joinDate = fd.get('joinDate');
    } else {
      DB.members.push({ id: uid('m'), name: fd.get('name'), joinDate: fd.get('joinDate'), active: true });
    }
    saveDB(DB);
    closeModal();
    render();
    toast('Member saved');
  };
}

/* ---------------- Costs ---------------- */

function renderCosts(root) {
  const monthKey = currentMonth();
  const month = ensureMonth(DB, monthKey);
  const sorted = [...month.costs].sort((a, b) => new Date(b.date) - new Date(a.date));
  root.innerHTML = `
    <div class="toolbar">
      <div class="chip-filter" id="catFilter">
        <button class="chip active" data-cat="all">All</button>
        ${CATEGORIES.map(c => `<button class="chip" data-cat="${c.key}">${c.icon} ${c.label}</button>`).join('')}
      </div>
      <button class="btn btn-primary" id="addCostBtn">+ Add Cost</button>
    </div>
    <div class="table-wrap">
      <table class="table" id="costsTable">
        <thead><tr><th>Date</th><th>Member</th><th>Category</th><th>Details</th><th>Amount</th><th></th></tr></thead>
        <tbody>${sorted.map(costRow).join('') || `<tr><td colspan="6" class="empty">এই মাসে এখনো কোনো খরচ যোগ করা হয়নি।</td></tr>`}</tbody>
      </table>
    </div>`;
  root.querySelector('#addCostBtn').onclick = () => openCostModal();
  root.querySelectorAll('[data-edit-cost]').forEach(b => b.onclick = () => openCostModal(b.dataset.editCost));
  root.querySelectorAll('[data-del-cost]').forEach(b => b.onclick = () => {
    if (!confirm('Delete this entry?')) return;
    month.costs = month.costs.filter(c => c.id !== b.dataset.delCost);
    saveDB(DB);
    render();
    toast('Deleted');
  });
  root.querySelectorAll('#catFilter .chip').forEach(chip => chip.onclick = () => {
    root.querySelectorAll('#catFilter .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const cat = chip.dataset.cat;
    root.querySelectorAll('#costsTable tbody tr[data-cat]').forEach(tr => {
      tr.style.display = (cat === 'all' || tr.dataset.cat === cat) ? '' : 'none';
    });
  });
}

function costRow(c) {
  const cat = CATEGORIES.find(x => x.key === c.category) || CATEGORIES[3];
  return `<tr data-cat="${c.category}">
    <td>${c.date}</td>
    <td>${memberName(DB, c.memberId)}</td>
    <td><span class="tag">${cat.icon} ${cat.label}</span></td>
    <td class="muted">${c.details || '—'}</td>
    <td class="num">${money(c.amount)}</td>
    <td class="row-actions"><button class="icon-btn" data-edit-cost="${c.id}" title="Edit">✏️</button><button class="icon-btn" data-del-cost="${c.id}" title="Delete">🗑️</button></td>
  </tr>`;
}

function openCostModal(id) {
  const monthKey = currentMonth();
  const month = ensureMonth(DB, monthKey);
  const editing = id ? month.costs.find(c => c.id === id) : null;
  const members = activeMembers(DB);
  openModal(`
    <h3>${editing ? 'Edit Cost' : 'Add Cost'}</h3>
    <form id="costForm">
      <label>Date</label>
      <input type="date" name="date" required value="${editing?.date || new Date().toISOString().slice(0, 10)}">
      <label>Member</label>
      <select name="memberId" required>${members.map(m => `<option value="${m.id}" ${editing?.memberId === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select>
      <label>Category</label>
      <select name="category">${CATEGORIES.map(c => `<option value="${c.key}" ${editing?.category === c.key ? 'selected' : ''}>${c.icon} ${c.label}</option>`).join('')}</select>
      <label>Amount (৳)</label>
      <input type="number" step="0.01" min="0" name="amount" required value="${editing?.amount ?? ''}">
      <label>Details</label>
      <input name="details" value="${editing?.details || ''}" placeholder="e.g. Rice, oil, vegetables">
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`);
  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('costForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      date: fd.get('date'),
      memberId: fd.get('memberId'),
      category: fd.get('category'),
      amount: Number(fd.get('amount')),
      details: fd.get('details')
    };
    if (editing) Object.assign(editing, data);
    else month.costs.push({ id: uid('c'), ...data });
    saveDB(DB);
    closeModal();
    render();
    toast('Cost saved');
  };
}

/* ---------------- Meals ---------------- */

function renderMeals(root) {
  const monthKey = currentMonth();
  const month = ensureMonth(DB, monthKey);
  const members = activeMembers(DB);
  const days = daysInMonth(monthKey);

  root.innerHTML = `
    <div class="toolbar"><p class="hint">সেলে ক্লিক করে meal count বসাও (0, 0.5, 1, 1.5, 2...)</p><span></span></div>
    <div class="table-wrap">
      <table class="table meal-table" id="mealTable">
        <thead><tr><th>Date</th>${members.map(m => `<th>${m.name}</th>`).join('')}<th>Day Total</th></tr></thead>
        <tbody>
          ${days.map(date => mealRowHTML(month, members, date)).join('')}
        </tbody>
        <tfoot>
          <tr><td>Total</td>${members.map(m => `<td class="num" data-foot-member="${m.id}">${sumMemberMeals(month, m.id)}</td>`).join('')}<td class="num" data-foot-total>${sumAllMeals(month)}</td></tr>
        </tfoot>
      </table>
    </div>`;

  root.querySelectorAll('.meal-input').forEach(input => {
    input.onchange = () => {
      const date = input.dataset.date;
      const memberId = input.dataset.member;
      const val = input.value === '' ? null : Number(input.value);
      const existing = month.meals.find(m => m.date === date && m.memberId === memberId);
      if (val === null || val === 0) {
        month.meals = month.meals.filter(m => !(m.date === date && m.memberId === memberId));
      } else if (existing) {
        existing.count = val;
      } else {
        month.meals.push({ id: uid('meal'), date, memberId, count: val });
      }
      saveDB(DB);

      const row = input.closest('tr');
      const dayTotal = members.reduce((s, m) => s + getMealVal(month, date, m.id), 0);
      const dayTotalCell = row.querySelector('.day-total');
      if (dayTotalCell) dayTotalCell.textContent = dayTotal || '';

      members.forEach(m => {
        const cell = root.querySelector(`[data-foot-member="${m.id}"]`);
        if (cell) cell.textContent = sumMemberMeals(month, m.id);
      });
      const totalCell = root.querySelector('[data-foot-total]');
      if (totalCell) totalCell.textContent = sumAllMeals(month);
    };
  });
}

function mealRowHTML(month, members, date) {
  let dayTotal = 0;
  const cells = members.map(m => {
    const val = getMealVal(month, date, m.id);
    if (val) dayTotal += val;
    return `<td><input type="number" step="0.5" min="0" class="meal-input" data-date="${date}" data-member="${m.id}" value="${val || ''}"></td>`;
  }).join('');
  return `<tr><td class="muted">${date}</td>${cells}<td class="num day-total">${dayTotal || ''}</td></tr>`;
}

function getMealVal(month, date, memberId) {
  const entry = month.meals.find(m => m.date === date && m.memberId === memberId);
  return entry ? Number(entry.count || 0) : 0;
}

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, '0')}`);
}

function sumMemberMeals(month, memberId) {
  return month.meals.filter(m => m.memberId === memberId).reduce((s, m) => s + Number(m.count || 0), 0);
}

function sumAllMeals(month) {
  return month.meals.reduce((s, m) => s + Number(m.count || 0), 0);
}

/* ---------------- Reports ---------------- */

function renderReports(root) {
  const monthKey = currentMonth();
  const month = ensureMonth(DB, monthKey);
  const summary = computeSummary(DB, monthKey);

  root.innerHTML = `
    <div class="card">
      <h3>${formatMonthLabel(monthKey)} Summary</h3>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Member</th><th>Meals</th><th>Meal Cost</th><th>Rent Share</th><th>Deposit</th><th>Balance</th></tr></thead>
          <tbody>
            ${summary.rows.map(r => `<tr>
              <td>${r.member.name}</td>
              <td>${r.meals}</td>
              <td>${money(r.mealCost)}</td>
              <td>${money(r.rentShare)}</td>
              <td>${money(r.deposit)}</td>
              <td><span class="badge ${r.balance >= 0 ? 'badge-success' : 'badge-danger'}">${r.balance >= 0 ? 'Advance' : 'Due'} ${money(Math.abs(r.balance))}</span></td>
            </tr>`).join('') || '<tr><td colspan="6" class="empty">কোনো member নেই।</td></tr>'}
          </tbody>
          <tfoot><tr><td>Total</td><td>${summary.totalMeals}</td><td colspan="2">${money(summary.totalCost)}</td><td colspan="2"></td></tr></tfoot>
        </table>
      </div>
    </div>
    <div class="card">
      <h3>Deposits — set / update</h3>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Member</th><th>Deposit (৳)</th></tr></thead>
          <tbody>${activeMembers(DB).map(m => `<tr><td>${m.name}</td><td><input type="number" min="0" class="deposit-input" data-member="${m.id}" value="${month.deposits?.[m.id] ?? 0}"></td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h3>Rent</h3>
      <label>Total Rent (৳)</label>
      <input type="number" min="0" id="rentInput" value="${month.rent?.total ?? 0}">
    </div>
    <div class="card">
      <h3>Backup</h3>
      <div class="toolbar">
        <div class="chip-filter">
          <button class="btn btn-primary" id="exportAllBtn">⬇ Export All Data</button>
          <button class="btn btn-ghost" id="exportMonthBtn">⬇ Export This Month</button>
          <label class="btn btn-ghost file-btn">⬆ Import JSON<input type="file" id="importInput" accept="application/json" hidden></label>
        </div>
        <span></span>
      </div>
      <p class="hint">Export করে JSON ফাইলটা তোমার GitHub repo এর <code>data/</code> ফোল্ডারে রেখে দাও backup হিসেবে। Import দিয়ে আগের ফাইল আবার লোড করতে পারবে।</p>
    </div>`;

  root.querySelectorAll('.deposit-input').forEach(inp => inp.onchange = () => {
    month.deposits[inp.dataset.member] = Number(inp.value) || 0;
    saveDB(DB);
    render();
  });
  document.getElementById('rentInput').onchange = (e) => {
    month.rent.total = Number(e.target.value) || 0;
    saveDB(DB);
    render();
  };
  document.getElementById('exportAllBtn').onclick = () => {
    exportDB(DB);
    toast('Exported all data');
  };
  document.getElementById('exportMonthBtn').onclick = () => {
    exportMonth(DB, monthKey);
    toast('Exported month data');
  };
  document.getElementById('importInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = await importFile(file);
      if (parsed.members && parsed.months) {
        if (!confirm('এটা পুরো ডেটাবেস replace করবে। Continue?')) return;
        DB = parsed;
        if (!DB.settings) DB.settings = { currentMonth: Object.keys(DB.months)[0] || monthKey, theme: 'light' };
        saveDB(DB);
        toast('Full data imported');
        applyTheme(DB.settings.theme || 'light');
        render();
      } else if (parsed.monthKey && parsed.month) {
        DB.months[parsed.monthKey] = parsed.month;
        (parsed.members || []).forEach(pm => {
          if (!DB.members.find(m => m.id === pm.id)) DB.members.push(pm);
        });
        saveDB(DB);
        toast(`${parsed.monthKey} imported`);
        render();
      } else {
        toast('Unrecognized file format', 'error');
      }
    } catch (err) {
      toast('Invalid JSON file', 'error');
    }
  };
}

/* ---------------- Settings ---------------- */

function renderSettings(root) {
  root.innerHTML = `
    <div class="card">
      <h3>Appearance</h3>
      <div class="toolbar">
        <div class="chip-filter">
          <button class="btn ${DB.settings.theme !== 'dark' ? 'btn-primary' : 'btn-ghost'}" id="lightBtn">☀️ Light</button>
          <button class="btn ${DB.settings.theme === 'dark' ? 'btn-primary' : 'btn-ghost'}" id="darkBtn">🌙 Dark</button>
        </div>
        <span></span>
      </div>
    </div>
    <div class="card">
      <h3>Months</h3>
      <div class="toolbar"><div class="chip-filter">${Object.keys(DB.months).sort().map(m => `<span class="tag">${formatMonthLabel(m)}</span>`).join('')}</div><span></span></div>
      <button class="btn btn-primary" id="addMonthBtn2">+ Add Month</button>
    </div>
    <div class="card">
      <h3>Danger Zone</h3>
      <button class="btn btn-danger" id="resetBtn">Reset All Data</button>
    </div>`;
  document.getElementById('lightBtn').onclick = () => { applyTheme('light'); saveDB(DB); render(); };
  document.getElementById('darkBtn').onclick = () => { applyTheme('dark'); saveDB(DB); render(); };
  document.getElementById('addMonthBtn2').onclick = openAddMonthModal;
  document.getElementById('resetBtn').onclick = () => {
    if (confirm('সব ডেটা মুছে যাবে, নিশ্চিত?')) {
      localStorage.removeItem('messHisabDB');
      location.reload();
    }
  };
}

function openAddMonthModal() {
  openModal(`
    <h3>Add Month</h3>
    <form id="addMonthForm">
      <label>Month</label>
      <input type="month" name="month" required value="${new Date().toISOString().slice(0, 7)}">
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button type="submit" class="btn btn-primary">Add</button>
      </div>
    </form>`);
  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('addMonthForm').onsubmit = (e) => {
    e.preventDefault();
    const val = new FormData(e.target).get('month');
    ensureMonth(DB, val);
    DB.settings.currentMonth = val;
    saveDB(DB);
    closeModal();
    render();
    toast('Month added');
  };
}

init();
