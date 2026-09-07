import {
  subscribeDB, saveDB, resetToSeed, uid, ensureMonth, activeMembers, mealMembers,
  memberName, computeSummary, computeSettlement, getFixed, setFixed,
  exportDB, exportMonth, importFile
} from './store.js';
import { avatarColor, initials, money, money2, num, openModal, closeModal, toast } from './ui.js';
import { renderBreakdownChart, renderDueChart } from './charts.js';

let DB = null;
let firstLoad = true;

const ROUTES = ['dashboard', 'bazar', 'others', 'meals', 'settlement', 'more'];
const ROUTE_TITLES = {
  dashboard: 'Dashboard',
  bazar: 'Bazar Cost',
  others: 'Others Cost',
  meals: 'Meals',
  settlement: 'Monthly Settlement',
  more: 'Members & Settings'
};

const OTHER_TYPES = ['Internet', 'Electricity', 'Water', 'Gas', 'Other'];

/* ---------------- boot ---------------- */

function init() {
  subscribeDB(
    (data, hasPendingWrites) => {
      // The whole document is written at once, so adopting the echo of our
      // own in-flight write would silently throw away entries typed a moment
      // ago. `rev` tells the two cases apart: only strictly newer data (from
      // another device) is adopted.
      if (DB && typeof data.rev === 'number' && typeof DB.rev === 'number') {
        if (data.rev <= DB.rev) return;
      } else if (DB && (hasPendingWrites || savesInFlight > 0)) {
        return;
      }

      DB = data;
      normalizeDB();
      applyTheme(DB.settings.theme || 'light');
      if (firstLoad) {
        firstLoad = false;
        bindGlobalEvents();
        bindDeferredRender();
        window.addEventListener('hashchange', render);
        if (!location.hash) location.hash = '#/dashboard';
      }
      requestRender();
    },
    () => toast('Sync error — check your internet connection', 'error')
  );
}

function normalizeDB() {
  if (!DB.members) DB.members = [];
  if (!DB.months) DB.months = {};
  if (!DB.settings) DB.settings = { currentMonth: '', theme: 'light' };
  if (!DB.settings.currentMonth || !DB.months[DB.settings.currentMonth]) {
    DB.settings.currentMonth = DB.settings.currentMonth || Object.keys(DB.months).sort().pop() || thisMonth();
    ensureMonth(DB, DB.settings.currentMonth);
  }
}

/**
 * Re-rendering wipes the DOM, so never do it while a modal is open or while
 * someone is typing into a cell — defer until they're done, otherwise fast
 * data entry (meal cells especially) loses keystrokes and whole entries.
 */
let renderPending = false;

function isTyping() {
  const el = document.activeElement;
  return !!(el && el.matches && el.matches('#viewRoot input, #viewRoot select'));
}

function requestRender() {
  const modalOpen = document.getElementById('modalRoot').innerHTML.trim() !== '';
  if (modalOpen || isTyping()) {
    renderPending = true;
    return;
  }
  renderPending = false;
  render();
}

function bindDeferredRender() {
  document.getElementById('viewRoot').addEventListener('focusout', () => {
    setTimeout(() => {
      if (renderPending && !isTyping()) {
        renderPending = false;
        render();
      }
    }, 80);
  });
}

/**
 * Every mutation resolves DB and the month *at event time* — the snapshot
 * listener swaps DB out from under old closures, so a captured reference
 * would silently write to a stale object.
 */
function mutate(fn) {
  const monthKey = currentMonth();
  const month = ensureMonth(DB, monthKey);
  fn(month, DB, monthKey);
  persist();
}

/**
 * Writes are debounced and counted: a burst of meal-cell edits becomes one
 * document write, and while any write is in flight we keep our own copy as
 * the source of truth (see the snapshot handler).
 */
let savesInFlight = 0;
let saveTimer = null;

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    savesInFlight++;
    DB.rev = (Number(DB.rev) || 0) + 1;
    saveDB(DB)
      .catch((err) => {
        console.error('Save failed:', err);
        toast('Save failed — check connection', 'error');
      })
      .finally(() => { savesInFlight = Math.max(0, savesInFlight - 1); });
  }, 250);
}

function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

function currentMonth() {
  return DB.settings.currentMonth;
}

function setMonth(m) {
  DB.settings.currentMonth = m;
  ensureMonth(DB, m);
  persist();
  render();
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
    applyTheme(DB.settings.theme === 'dark' ? 'light' : 'dark');
    persist();
    render();
  };
  document.getElementById('addMonthBtn').onclick = () => openAddMonthModal();
}

function currentRoute() {
  const h = (location.hash || '#/dashboard').replace('#/', '');
  return ROUTES.includes(h) ? h : 'dashboard';
}

function render() {
  const route = currentRoute();
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.route === route));
  document.getElementById('pageTitle').textContent = ROUTE_TITLES[route];
  populateMonthSelect();
  const root = document.getElementById('viewRoot');
  root.innerHTML = '';
  ({
    dashboard: renderDashboard,
    bazar: renderBazar,
    others: renderOthers,
    meals: renderMeals,
    settlement: renderSettlement,
    more: renderMore
  })[route](root);
}

function populateMonthSelect() {
  const sel = document.getElementById('monthSelect');
  const months = Object.keys(DB.months).sort();
  sel.innerHTML = months.map((m) => `<option value="${m}" ${m === currentMonth() ? 'selected' : ''}>${formatMonthLabel(m)}</option>`).join('');
  sel.onchange = () => setMonth(sel.value);
}

/* ---------------- small helpers ---------------- */

/** User-entered text (names, item details) goes through this before hitting innerHTML. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function avatarCell(name) {
  return `<div class="cell-name"><div class="avatar sm" style="background:${avatarColor(name)}">${esc(initials(name))}</div>${esc(name)}</div>`;
}

function statCard(label, value, icon, tone) {
  return `<div class="stat-card tone-${tone}"><div class="stat-icon">${icon}</div><div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div></div>`;
}

function rateCard(label, value, formula) {
  return `<div class="rate-card"><div class="rate-label">${label}</div><div class="rate-value">${value}</div><div class="rate-formula">${formula}</div></div>`;
}

/** +ve due = member owes the mess; -ve = mess owes the member. */
function dueBadge(due) {
  if (Math.abs(due) < 0.5) return '<span class="badge badge-muted">Settled</span>';
  return due > 0
    ? `<span class="badge badge-danger">Due ${money(due)}</span>`
    : `<span class="badge badge-success">Refund ${money(Math.abs(due))}</span>`;
}

function emptyRow(cols, msg) {
  return `<tr><td colspan="${cols}" class="empty">${msg}</td></tr>`;
}

function memberOptions(members, selectedId) {
  return members.map((m) => `<option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* ---------------- Dashboard ---------------- */

function renderDashboard(root) {
  const monthKey = currentMonth();
  const s = computeSummary(DB, monthKey);

  root.innerHTML = `
    <div class="stat-grid">
      ${statCard('Total Bazar', money(s.totalBazar), '🛒', 'primary')}
      ${statCard('Extra Cost', money(s.extraCost), '💡', 'accent')}
      ${statCard('Total Cost', money(s.totalCost), '💰', 'success')}
      ${statCard('Total Meals', num(s.totalMeals), '🍽️', 'warning')}
    </div>

    <div class="rate-row">
      ${rateCard('Meal Rate', s.mealRate ? money2(s.mealRate) + ' <span class="per">/ meal</span>' : '—', `Total Bazar ÷ ${num(s.totalMeals)} meals`)}
      ${rateCard('Others Per Head', s.othersPerHead ? money2(s.othersPerHead) : '—', `Extra Cost ÷ ${s.eaters.length} member${s.eaters.length === 1 ? '' : 's'}`)}
    </div>

    <div class="card">
      <h3>Per Head Hisab — ${formatMonthLabel(monthKey)}</h3>
      <div class="table-wrap">
        <table class="table summary-table">
          <thead>
            <tr>
              <th>Member</th><th class="num">Deposit</th><th class="num">Meals</th>
              <th class="num">Meal Cost</th><th class="num">Others</th>
              <th class="num">Per Head Cost</th><th class="num">Due</th>
            </tr>
          </thead>
          <tbody>
            ${s.rows.map((r) => `
              <tr>
                <td>${avatarCell(r.member.name)}</td>
                <td class="num">${money(r.deposit)}</td>
                <td class="num">${num(r.meals)}</td>
                <td class="num">${money(r.mealCost)}</td>
                <td class="num">${money(r.othersShare)}</td>
                <td class="num num-strong">${money(r.perHeadCost)}</td>
                <td class="num">${dueBadge(r.due)}</td>
              </tr>`).join('') || emptyRow(7, 'কোনো member নেই — Members page থেকে যোগ করো।')}
          </tbody>
          ${s.rows.length ? `<tfoot><tr>
            <td>Total</td>
            <td class="num">${money(s.totalDeposit)}</td>
            <td class="num">${num(s.totalMeals)}</td>
            <td class="num">${money(s.totalBazar)}</td>
            <td class="num">${money(s.extraCost)}</td>
            <td class="num">${money(s.totalCost)}</td>
            <td></td>
          </tr></tfoot>` : ''}
        </table>
      </div>
      <p class="hint">Due = Per Head Cost − Deposit · <b>লাল</b> = আরও দিতে হবে, <b>সবুজ</b> = ফেরত পাবে। Rent ও Bua এতে নেই — সেটা মাস শেষে <a href="#/settlement">Settlement</a> পেজে।</p>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Cost Breakdown</h3>
        ${s.totalCost > 0 ? '<canvas id="breakdownChart" height="220"></canvas>' : '<p class="empty">এখনো কোনো খরচ যোগ করা হয়নি।</p>'}
      </div>
      <div class="card">
        <h3>Deposit vs Per Head Cost</h3>
        ${s.rows.length ? '<canvas id="dueChart" height="220"></canvas>' : '<p class="empty">কোনো member নেই।</p>'}
      </div>
    </div>

    <div class="card">
      <h3>Recent Entries</h3>
      ${renderRecentActivity(monthKey)}
    </div>`;

  if (s.totalCost > 0) renderBreakdownChart(document.getElementById('breakdownChart'), s.byType);
  if (s.rows.length) renderDueChart(document.getElementById('dueChart'), s.rows);
}

function renderRecentActivity(monthKey) {
  const month = ensureMonth(DB, monthKey);
  const items = [
    ...month.bazar.map((b) => ({ date: b.date, text: `🛒 ${memberName(DB, b.memberId)} — bazar ${money(b.amount)}${b.details ? ' · ' + b.details : ''}` })),
    ...month.others.map((o) => ({ date: o.date, text: `💡 ${memberName(DB, o.memberId)} — ${o.type || 'Other'} ${money(o.amount)}` }))
  ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);

  if (!items.length) return '<p class="empty">এখনো কোনো entry নেই।</p>';
  return `<ul class="activity-list">${items.map((i) => `<li><span class="activity-date">${esc(i.date)}</span>${esc(i.text)}</li>`).join('')}</ul>`;
}

/* ---------------- Bazar Cost ---------------- */

function renderBazar(root) {
  const monthKey = currentMonth();
  const month = ensureMonth(DB, monthKey);
  const rows = [...month.bazar].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  root.innerHTML = `
    <div class="toolbar">
      <div class="inline-total">Total Bazar <b>${money(total)}</b></div>
      <button class="btn btn-primary" id="addBazarBtn">+ Add Bazar</button>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>SL</th><th>Date</th><th>Product From</th><th class="num">Amount</th><th>Bazar Item Details</th><th></th></tr></thead>
        <tbody>
          ${rows.map((b, i) => `
            <tr>
              <td class="muted">${i + 1}</td>
              <td>${esc(b.date)}</td>
              <td>${avatarCell(memberName(DB, b.memberId))}</td>
              <td class="num num-strong">${money(b.amount)}</td>
              <td class="muted">${esc(b.details) || '—'}</td>
              <td class="row-actions">
                <button class="icon-btn" data-edit="${b.id}" title="Edit">✏️</button>
                <button class="icon-btn" data-del="${b.id}" title="Delete">🗑️</button>
              </td>
            </tr>`).join('') || emptyRow(6, 'এই মাসে এখনো কোনো bazar entry নেই।')}
        </tbody>
        ${rows.length ? `<tfoot><tr><td colspan="3">Total</td><td class="num">${money(total)}</td><td colspan="2"></td></tr></tfoot>` : ''}
      </table>
    </div>`;

  root.querySelector('#addBazarBtn').onclick = () => openBazarModal();
  root.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openBazarModal(b.dataset.edit)));
  root.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    if (!confirm('এই entry মুছে ফেলব?')) return;
    mutate((m) => { m.bazar = m.bazar.filter((x) => x.id !== b.dataset.del); });
    render();
    toast('Deleted');
  }));
}

function openBazarModal(id) {
  const monthKey = currentMonth();
  const month = ensureMonth(DB, monthKey);
  const editing = id ? month.bazar.find((b) => b.id === id) : null;
  const members = activeMembers(DB);
  if (!members.length) return toast('আগে Members যোগ করো', 'error');

  openModal(`
    <h3>${editing ? 'Edit Bazar' : 'Add Bazar'}</h3>
    <form id="entryForm">
      <label>Date</label>
      <input type="date" name="date" required value="${editing?.date || defaultDateFor(monthKey)}">
      <label>Product From (কে বাজার করেছে)</label>
      <select name="memberId" required>${memberOptions(members, editing?.memberId)}</select>
      <label>Total Amount (৳)</label>
      <input type="number" step="0.01" min="0" name="amount" required value="${editing?.amount ?? ''}" placeholder="0">
      <label>Bazar Item Details</label>
      <input name="details" value="${esc(editing?.details || '')}" placeholder="e.g. Rice + Meat + Fish + Mosla">
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`);

  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('entryForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      date: fd.get('date'),
      memberId: fd.get('memberId'),
      amount: Number(fd.get('amount')),
      details: fd.get('details')
    };
    mutate((m) => {
      const target = id ? m.bazar.find((b) => b.id === id) : null;
      if (target) Object.assign(target, data);
      else m.bazar.push({ id: uid('b'), ...data });
    });
    closeModal();
    render();
    toast('Bazar saved');
  };
}

/** Pre-fill today's date if we're in that month, else the 1st of the selected month. */
function defaultDateFor(monthKey) {
  const t = today();
  return t.startsWith(monthKey) ? t : `${monthKey}-01`;
}

/* ---------------- Others Cost ---------------- */

function renderOthers(root) {
  const monthKey = currentMonth();
  const month = ensureMonth(DB, monthKey);
  const rows = [...month.others].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const eaters = mealMembers(DB);
  const perHead = eaters.length ? total / eaters.length : 0;

  root.innerHTML = `
    <div class="toolbar">
      <div class="inline-total">Extra Cost <b>${money(total)}</b> · Per Head <b>${money2(perHead)}</b></div>
      <button class="btn btn-primary" id="addOtherBtn">+ Add Others Cost</button>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>SL</th><th>Type</th><th>Date</th><th>Product From</th><th class="num">Amount</th><th>Details</th><th></th></tr></thead>
        <tbody>
          ${rows.map((o, i) => `
            <tr>
              <td class="muted">${i + 1}</td>
              <td><span class="tag">${esc(o.type || 'Other')}</span></td>
              <td>${esc(o.date)}</td>
              <td>${avatarCell(memberName(DB, o.memberId))}</td>
              <td class="num num-strong">${money(o.amount)}</td>
              <td class="muted">${esc(o.details) || '—'}</td>
              <td class="row-actions">
                <button class="icon-btn" data-edit="${o.id}" title="Edit">✏️</button>
                <button class="icon-btn" data-del="${o.id}" title="Delete">🗑️</button>
              </td>
            </tr>`).join('') || emptyRow(7, 'এই মাসে এখনো কোনো others cost নেই (Internet, Electricity, Water...)।')}
        </tbody>
        ${rows.length ? `<tfoot><tr><td colspan="4">Total</td><td class="num">${money(total)}</td><td colspan="2"></td></tr></tfoot>` : ''}
      </table>
    </div>
    <p class="hint">এই খরচগুলো meal অনুযায়ী না — সব meal-member এর মধ্যে <b>সমান ভাগ</b> হয় (${eaters.length} জন)।</p>`;

  root.querySelector('#addOtherBtn').onclick = () => openOtherModal();
  root.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openOtherModal(b.dataset.edit)));
  root.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    if (!confirm('এই entry মুছে ফেলব?')) return;
    mutate((m) => { m.others = m.others.filter((x) => x.id !== b.dataset.del); });
    render();
    toast('Deleted');
  }));
}

function openOtherModal(id) {
  const monthKey = currentMonth();
  const month = ensureMonth(DB, monthKey);
  const editing = id ? month.others.find((o) => o.id === id) : null;
  const members = activeMembers(DB);
  if (!members.length) return toast('আগে Members যোগ করো', 'error');

  openModal(`
    <h3>${editing ? 'Edit Others Cost' : 'Add Others Cost'}</h3>
    <form id="entryForm">
      <label>Type</label>
      <select name="type">${OTHER_TYPES.map((t) => `<option value="${t}" ${editing?.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label>Date</label>
      <input type="date" name="date" required value="${editing?.date || defaultDateFor(monthKey)}">
      <label>Product From (কে দিয়েছে)</label>
      <select name="memberId" required>${memberOptions(members, editing?.memberId)}</select>
      <label>Total Amount (৳)</label>
      <input type="number" step="0.01" min="0" name="amount" required value="${editing?.amount ?? ''}" placeholder="0">
      <label>Item Details</label>
      <input name="details" value="${esc(editing?.details || '')}" placeholder="optional">
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`);

  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('entryForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      type: fd.get('type'),
      date: fd.get('date'),
      memberId: fd.get('memberId'),
      amount: Number(fd.get('amount')),
      details: fd.get('details')
    };
    mutate((m) => {
      const target = id ? m.others.find((o) => o.id === id) : null;
      if (target) Object.assign(target, data);
      else m.others.push({ id: uid('o'), ...data });
    });
    closeModal();
    render();
    toast('Others cost saved');
  };
}

/* ---------------- Meals ---------------- */

function renderMeals(root) {
  const monthKey = currentMonth();
  const month = ensureMonth(DB, monthKey);
  const eaters = mealMembers(DB);

  if (!eaters.length) {
    root.innerHTML = '<div class="card"><p class="empty">কোনো meal member নেই — Members page থেকে যোগ করো।</p></div>';
    return;
  }

  const days = daysInMonth(monthKey);
  const t = today();

  root.innerHTML = `
    <div class="toolbar">
      <div class="inline-total">Total Meals <b>${num(sumAllMeals(month))}</b></div>
      <button class="btn btn-ghost" id="jumpTodayBtn">📅 আজকের দিনে যাও</button>
    </div>
    <div class="table-wrap">
      <table class="table meal-table" id="mealTable">
        <thead><tr><th>Date</th>${eaters.map((m) => `<th>${esc(m.name)}</th>`).join('')}<th class="num">Day Total</th></tr></thead>
        <tbody>
          ${days.map((date) => mealRowHTML(month, eaters, date, date === t)).join('')}
        </tbody>
        <tfoot>
          <tr><td>Total</td>${eaters.map((m) => `<td class="num" data-foot-member="${m.id}">${num(sumMemberMeals(month, m.id))}</td>`).join('')}<td class="num" data-foot-total>${num(sumAllMeals(month))}</td></tr>
        </tfoot>
      </table>
    </div>
    <p class="hint">প্রতিদিন প্রতি জনের meal সংখ্যা বসাও (0.5, 1, 1.5, 2...)। Meal Rate সাথে সাথে dashboard এ update হবে।</p>`;

  root.querySelectorAll('.meal-input').forEach((input) => {
    input.onchange = () => {
      const { date, member: memberId } = input.dataset;
      const val = input.value === '' ? 0 : Number(input.value);

      mutate((m) => {
        const existing = m.meals.find((x) => x.date === date && x.memberId === memberId);
        if (!val) m.meals = m.meals.filter((x) => !(x.date === date && x.memberId === memberId));
        else if (existing) existing.count = val;
        else m.meals.push({ id: uid('meal'), date, memberId, count: val });
      });

      // update totals in place — a full re-render here would fight the typing
      const live = ensureMonth(DB, currentMonth());
      const row = input.closest('tr');
      const dayTotal = eaters.reduce((s, m) => s + getMealVal(live, date, m.id), 0);
      row.querySelector('.day-total').textContent = dayTotal ? num(dayTotal) : '';
      eaters.forEach((m) => {
        const cell = root.querySelector(`[data-foot-member="${m.id}"]`);
        if (cell) cell.textContent = num(sumMemberMeals(live, m.id));
      });
      root.querySelector('[data-foot-total]').textContent = num(sumAllMeals(live));
    };
  });

  const todayRow = root.querySelector('tr.is-today');
  const jump = root.querySelector('#jumpTodayBtn');
  if (todayRow) {
    jump.onclick = () => todayRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    todayRow.scrollIntoView({ block: 'center' });
  } else {
    jump.disabled = true;
  }
}

function mealRowHTML(month, members, date, isToday) {
  let dayTotal = 0;
  const cells = members.map((m) => {
    const val = getMealVal(month, date, m.id);
    dayTotal += val;
    return `<td><input type="number" step="0.5" min="0" class="meal-input" data-date="${date}" data-member="${m.id}" value="${val || ''}"></td>`;
  }).join('');
  return `<tr class="${isToday ? 'is-today' : ''}"><td class="muted">${date.slice(8)} ${isToday ? '<span class="today-dot">আজ</span>' : ''}</td>${cells}<td class="num day-total">${dayTotal ? num(dayTotal) : ''}</td></tr>`;
}

function getMealVal(month, date, memberId) {
  const entry = month.meals.find((m) => m.date === date && m.memberId === memberId);
  return entry ? Number(entry.count || 0) : 0;
}

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, '0')}`);
}

function sumMemberMeals(month, memberId) {
  return month.meals.filter((m) => m.memberId === memberId).reduce((s, m) => s + Number(m.count || 0), 0);
}

function sumAllMeals(month) {
  return month.meals.reduce((s, m) => s + Number(m.count || 0), 0);
}

/* ---------------- Monthly Settlement ---------------- */

function renderSettlement(root) {
  const monthKey = currentMonth();
  const month = ensureMonth(DB, monthKey);
  const { rows, totals, summary } = computeSettlement(DB, monthKey);
  const eaters = mealMembers(DB);

  root.innerHTML = `
    <div class="card">
      <h3>💵 Deposit — কে কত টাকা জমা দিয়েছে</h3>
      <div class="table-wrap">
        <table class="table form-table">
          <thead><tr><th>Member</th><th class="num">Deposit (৳)</th></tr></thead>
          <tbody>
            ${eaters.map((m) => `<tr>
              <td>${avatarCell(m.name)}</td>
              <td class="num"><input type="number" min="0" step="1" class="cell-input deposit-input" data-member="${m.id}" value="${month.deposits[m.id] ?? 0}"></td>
            </tr>`).join('') || emptyRow(2, 'কোনো meal member নেই।')}
          </tbody>
          ${eaters.length ? `<tfoot><tr><td>Total</td><td class="num">${money(summary.totalDeposit)}</td></tr></tfoot>` : ''}
        </table>
      </div>
    </div>

    <div class="card">
      <h3>🏠 Fixed Monthly — Rent ও Bua bill</h3>
      <div class="table-wrap">
        <table class="table form-table">
          <thead><tr><th>Member</th><th class="num">Rent (৳)</th><th class="num">Bua (৳)</th></tr></thead>
          <tbody>
            ${activeMembers(DB).map((m) => {
              const f = getFixed(DB, monthKey, m);
              return `<tr>
                <td>${avatarCell(m.name)}</td>
                <td class="num"><input type="number" min="0" step="1" class="cell-input fixed-input" data-member="${m.id}" data-field="rent" value="${f.rent}"></td>
                <td class="num"><input type="number" min="0" step="1" class="cell-input fixed-input" data-member="${m.id}" data-field="bua" value="${f.bua}"></td>
              </tr>`;
            }).join('') || emptyRow(3, 'কোনো member নেই।')}
          </tbody>
        </table>
      </div>
      <p class="hint">প্রতি জনের rent আলাদা হতে পারে (room অনুযায়ী)। এখানে যা বসাবে তা শুধু <b>${formatMonthLabel(monthKey)}</b> এর জন্য সেভ হবে।</p>
    </div>

    <div class="card highlight-card">
      <h3>🧾 ${formatMonthLabel(monthKey)} — Final Hisab</h3>
      <div class="table-wrap">
        <table class="table summary-table">
          <thead><tr><th>Member</th><th class="num">Meal (Due)</th><th class="num">Rent</th><th class="num">Bua</th><th class="num">Total</th></tr></thead>
          <tbody>
            ${rows.map((r) => `<tr>
              <td>${avatarCell(r.member.name)}${r.inMeal ? '' : '<span class="tag tag-sm">rent only</span>'}</td>
              <td class="num ${r.meal > 0.5 ? 'val-neg' : r.meal < -0.5 ? 'val-pos' : ''}">${money(r.meal)}</td>
              <td class="num">${money(r.rent)}</td>
              <td class="num">${money(r.bua)}</td>
              <td class="num num-strong">${money(r.total)}</td>
            </tr>`).join('') || emptyRow(5, 'কোনো member নেই।')}
          </tbody>
          ${rows.length ? `<tfoot><tr>
            <td>Total</td>
            <td class="num">${money(totals.meal)}</td>
            <td class="num">${money(totals.rent)}</td>
            <td class="num">${money(totals.bua)}</td>
            <td class="num">${money(totals.total)}</td>
          </tr></tfoot>` : ''}
        </table>
      </div>
      <p class="hint">Total = Meal Due + Rent + Bua — মাস শেষে প্রত্যেকে এই টাকাটা দেবে। Meal Due ঋণাত্মক হলে (সে বেশি জমা দিয়েছে) সেটা তার rent থেকে কেটে যাচ্ছে।</p>
    </div>`;

  root.querySelectorAll('.deposit-input').forEach((inp) => (inp.onchange = () => {
    mutate((m) => { m.deposits[inp.dataset.member] = Number(inp.value) || 0; });
    requestRender();
  }));

  root.querySelectorAll('.fixed-input').forEach((inp) => (inp.onchange = () => {
    mutate(() => setFixed(DB, currentMonth(), inp.dataset.member, { [inp.dataset.field]: Number(inp.value) || 0 }));
    requestRender();
  }));
}

/* ---------------- Members & Settings ---------------- */

function renderMore(root) {
  root.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <h3>👥 Members</h3>
        <button class="btn btn-primary" id="addMemberBtn">+ Add Member</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Member</th><th>Meal</th><th class="num">Default Rent</th><th class="num">Default Bua</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${DB.members.map((m) => `<tr>
              <td>${avatarCell(m.name)}</td>
              <td>${m.inMeal === false ? '<span class="badge badge-muted">No</span>' : '<span class="badge badge-success">Yes</span>'}</td>
              <td class="num">${money(m.rent || 0)}</td>
              <td class="num">${money(m.bua || 0)}</td>
              <td><span class="badge ${m.active ? 'badge-success' : 'badge-muted'}">${m.active ? 'Active' : 'Inactive'}</span></td>
              <td class="row-actions">
                <button class="icon-btn" data-edit="${m.id}" title="Edit">✏️</button>
                <button class="icon-btn" data-toggle="${m.id}" title="${m.active ? 'Deactivate' : 'Activate'}">${m.active ? '🚫' : '✅'}</button>
              </td>
            </tr>`).join('') || emptyRow(6, 'কোনো member নেই — উপরের বাটন দিয়ে যোগ করো।')}
          </tbody>
        </table>
      </div>
      <p class="hint">"Meal = No" মানে সে শুধু rent দেয়, bazar/meal এর হিসাবে আসে না।</p>
    </div>

    <div class="card">
      <h3>🎨 Appearance</h3>
      <div class="chip-filter">
        <button class="btn ${DB.settings.theme !== 'dark' ? 'btn-primary' : 'btn-ghost'}" id="lightBtn">☀️ Light</button>
        <button class="btn ${DB.settings.theme === 'dark' ? 'btn-primary' : 'btn-ghost'}" id="darkBtn">🌙 Dark</button>
      </div>
    </div>

    <div class="card">
      <h3>📆 Months</h3>
      <div class="chip-filter">${Object.keys(DB.months).sort().map((m) => `<span class="tag">${formatMonthLabel(m)}</span>`).join('')}</div>
      <br><button class="btn btn-primary" id="addMonthBtn2">+ Add Month</button>
    </div>

    <div class="card">
      <h3>💾 Backup</h3>
      <div class="chip-filter">
        <button class="btn btn-primary" id="exportAllBtn">⬇ Export All Data</button>
        <button class="btn btn-ghost" id="exportMonthBtn">⬇ Export This Month</button>
        <label class="btn btn-ghost file-btn">⬆ Import JSON<input type="file" id="importInput" accept="application/json" hidden></label>
      </div>
      <p class="hint">সব ডেটা cloud এ (Firestore) সেভ থাকে ও সব ডিভাইসে live sync হয়। Export শুধু বাড়তি নিরাপত্তার জন্য।</p>
    </div>

    <div class="card">
      <h3>⚠️ Danger Zone</h3>
      <button class="btn btn-danger" id="resetBtn">Reset All Data</button>
      <p class="hint">সব ডিভাইস থেকেই ডেটা মুছে যাবে।</p>
    </div>`;

  root.querySelector('#addMemberBtn').onclick = () => openMemberModal();
  root.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openMemberModal(b.dataset.edit)));
  root.querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = () => {
    const m = DB.members.find((x) => x.id === b.dataset.toggle);
    m.active = !m.active;
    persist();
    render();
    toast(`${m.name} ${m.active ? 'activated' : 'deactivated'}`);
  }));

  document.getElementById('lightBtn').onclick = () => { applyTheme('light'); persist(); render(); };
  document.getElementById('darkBtn').onclick = () => { applyTheme('dark'); persist(); render(); };
  document.getElementById('addMonthBtn2').onclick = openAddMonthModal;
  document.getElementById('exportAllBtn').onclick = () => { exportDB(DB); toast('Exported'); };
  document.getElementById('exportMonthBtn').onclick = () => { exportMonth(DB, currentMonth()); toast('Exported'); };
  document.getElementById('importInput').onchange = handleImport;
  document.getElementById('resetBtn').onclick = async () => {
    if (!confirm('সব ডেটা মুছে যাবে (সব ডিভাইস থেকেই), নিশ্চিত?')) return;
    clearTimeout(saveTimer); // drop any queued write of the old data
    await resetToSeed();
    location.reload(); // start clean rather than re-saving the stale copy
  };
}

function openMemberModal(id) {
  const editing = id ? DB.members.find((m) => m.id === id) : null;
  openModal(`
    <h3>${editing ? 'Edit Member' : 'Add Member'}</h3>
    <form id="memberForm">
      <label>Name</label>
      <input name="name" required value="${esc(editing?.name || '')}" placeholder="e.g. Oashiur">
      <label class="check-row">
        <input type="checkbox" name="inMeal" ${editing?.inMeal === false ? '' : 'checked'}>
        <span>Meal এ আছে (bazar ও others cost ভাগ করবে)</span>
      </label>
      <label>Monthly Rent (৳)</label>
      <input type="number" min="0" step="1" name="rent" value="${editing?.rent ?? 0}">
      <label>Bua Bill (৳ / month)</label>
      <input type="number" min="0" step="1" name="bua" value="${editing?.bua ?? 0}">
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`);

  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('memberForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      name: fd.get('name'),
      inMeal: fd.get('inMeal') === 'on',
      rent: Number(fd.get('rent')) || 0,
      bua: Number(fd.get('bua')) || 0
    };
    const target = id ? DB.members.find((m) => m.id === id) : null;
    if (target) Object.assign(target, data);
    else DB.members.push({ id: uid('m'), active: true, joinDate: today(), ...data });
    persist();
    closeModal();
    render();
    toast('Member saved');
  };
}

function openAddMonthModal() {
  openModal(`
    <h3>Add Month</h3>
    <form id="addMonthForm">
      <label>Month</label>
      <input type="month" name="month" required value="${thisMonth()}">
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button type="submit" class="btn btn-primary">Add</button>
      </div>
    </form>`);
  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('addMonthForm').onsubmit = (e) => {
    e.preventDefault();
    setMonth(new FormData(e.target).get('month'));
    closeModal();
    toast('Month added');
  };
}

async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = await importFile(file);
    if (parsed.members && parsed.months) {
      if (!confirm('এটা সব ডিভাইসের ডেটা replace করবে। Continue?')) return;
      DB = parsed;
      if (!DB.settings) DB.settings = { currentMonth: Object.keys(DB.months)[0] || thisMonth(), theme: 'light' };
      persist();
      applyTheme(DB.settings.theme || 'light');
      toast('Data imported');
    } else if (parsed.monthKey && parsed.month) {
      DB.months[parsed.monthKey] = parsed.month;
      (parsed.members || []).forEach((pm) => {
        if (!DB.members.find((m) => m.id === pm.id)) DB.members.push(pm);
      });
      persist();
      toast(`${parsed.monthKey} imported`);
    } else {
      toast('Unrecognized file format', 'error');
    }
  } catch (err) {
    toast('Invalid JSON file', 'error');
  }
}

init();
