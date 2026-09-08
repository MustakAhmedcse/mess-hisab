import {
  subscribeDB, saveDB, resetToSeed, uid, ensureMonth, peekMonth,
  activeMembers, mealMembers, memberById, memberName,
  computeSummary, computeTransfers, getFixed, setFixed,
  managerOn, currentDuty, suggestNextManager,
  mealFor, dayConfirmed, memberMealTotal, allMealTotal,
  exportDB, exportMonth, importFile
} from './store.js';
import { avatarColor, initials, money, money2, num, openModal, closeModal, toast } from './ui.js';
import { todayISO, thisMonthISO, monthOf, daysInMonth, monthLabel, dayLabel, addDays } from './dates.js';

let DB = null;
let firstLoad = true;

/** Per-device, never shared: who holds this phone, which month they're looking at, their theme. */
const LS = {
  get me() { return safeGet('mess.me'); },
  set me(v) { safeSet('mess.me', v); },
  get month() { return safeGet('mess.month'); },
  set month(v) { safeSet('mess.month', v); },
  get theme() { return safeGet('mess.theme'); },
  set theme(v) { safeSet('mess.theme', v); }
};
function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

const ROUTES = ['today', 'khoroch', 'hisab', 'more', 'grid'];
const ROUTE_TITLES = {
  today: 'আজ', khoroch: 'খরচ', hisab: 'হিসাব', more: 'আরও', grid: 'পুরো মাসের meal'
};

const BILL_TYPES = ['কারেন্ট', 'নেট', 'পানি', 'গ্যাস', 'অন্যান্য'];

let viewMonth = null;       // the month this device is looking at
let viewDay = null;         // the day being edited on আজ
let mealDraft = null;       // { date, counts: {memberId: n} } — unsaved stepper state
let backfillDraft = null;   // { month, counts: {date: {memberId: n}} } — unsaved bulk entry
let entryBusy = false;      // true while someone is mid-entry; blocks disruptive re-renders

/* ---------------- boot ---------------- */

function init() {
  subscribeDB(
    (data, hasPendingWrites) => {
      // Never adopt remote data while we hold unflushed local work — the whole
      // document is written at once, so that would throw away what was just typed.
      const dirty = saveTimer !== null || savesInFlight > 0;
      if (DB && (dirty || hasPendingWrites)) return;
      if (DB && typeof data.rev === 'number' && typeof DB.rev === 'number' && data.rev <= DB.rev) return;

      DB = data;
      normalizeDB();
      applyTheme(LS.theme || 'light');
      if (firstLoad) {
        firstLoad = false;
        bindChrome();
        window.addEventListener('hashchange', () => { mealDraft = null; backfillDraft = null; render(); });
        if (!location.hash) location.hash = '#/today';
      }
      requestRender();
    },
    () => toast('সিংক হচ্ছে না — ইন্টারনেট চেক করো', 'error')
  );
}

function normalizeDB() {
  if (!DB.members) DB.members = [];
  if (!DB.months) DB.months = {};
  if (!DB.duty) DB.duty = [];
  if (!DB.rotationOrder) DB.rotationOrder = [];
  if (!DB.settings) DB.settings = {};

  // A stale device identity (after a reset or an import) must not stick around.
  if (LS.me && !DB.members.some((m) => m.id === LS.me)) LS.me = '';

  const monthsWithData = Object.keys(DB.months).sort();
  const stored = LS.month;
  if (stored && DB.months[stored]) viewMonth = stored;
  else viewMonth = monthsWithData[monthsWithData.length - 1] || thisMonthISO();

  // Roll to the new month on its own — but only once it exists or today's month
  // is newer than everything recorded.
  if (thisMonthISO() > viewMonth && !stored) viewMonth = thisMonthISO();
}

function me() { return LS.me ? memberById(DB, LS.me) : null; }
function currentMonth() { return viewMonth; }

function setMonth(m) {
  viewMonth = m;
  LS.month = m;
  mealDraft = null;
  backfillDraft = null;
  if (viewDay && monthOf(viewDay) !== m) viewDay = null;
  render();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  LS.theme = theme;
}

/* ---------------- writes ---------------- */

let savesInFlight = 0;
let saveTimer = null;

/**
 * Resolves DB and the month at event time (the snapshot listener swaps DB out
 * from under old closures) and bumps rev immediately, so a remote snapshot
 * arriving during the debounce window can't look newer than our unsaved work.
 */
function mutate(fn, monthKeyOverride) {
  const key = monthKeyOverride || currentMonth();
  const month = ensureMonth(DB, key);
  fn(month, DB, key);
  DB.rev = (Number(DB.rev) || 0) + 1;
  persist();
}

function mutateDB(fn) {
  fn(DB);
  DB.rev = (Number(DB.rev) || 0) + 1;
  persist();
}

function persist() {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    savesInFlight++;
    saveDB(DB)
      .catch((err) => {
        console.error('Save failed:', err);
        toast('সেভ হয়নি — কানেকশন চেক করো', 'error');
      })
      .finally(() => { savesInFlight = Math.max(0, savesInFlight - 1); });
  }, 250);
}

/* ---------------- rendering ---------------- */

let renderPending = false;

function isBusy() {
  if (document.getElementById('modalRoot').innerHTML.trim() !== '') return true;
  if (entryBusy) return true;
  const el = document.activeElement;
  // Buttons count: the meal steppers are buttons, and wiping the DOM mid-tap
  // would lose the row someone is adjusting.
  return !!(el && el.matches && el.matches('#viewRoot input, #viewRoot select, #viewRoot button'));
}

function requestRender() {
  if (isBusy()) { renderPending = true; return; }
  renderPending = false;
  render();
}

function bindChrome() {
  document.getElementById('themeToggle').onclick = () => {
    applyTheme((LS.theme || 'light') === 'dark' ? 'light' : 'dark');
    render();
  };
  document.getElementById('addMonthBtn').onclick = openMonthModal;
  const menu = document.getElementById('menuToggle');
  const shell = document.querySelector('.app-shell');
  let collapsed = safeGet('mess.sidebar') === 'collapsed';
  shell.classList.toggle('sidebar-collapsed', collapsed);
  menu.onclick = () => {
    collapsed = !shell.classList.contains('sidebar-collapsed');
    shell.classList.toggle('sidebar-collapsed', collapsed);
    safeSet('mess.sidebar', collapsed ? 'collapsed' : 'open');
  };
  document.getElementById('viewRoot').addEventListener('focusout', () => {
    setTimeout(() => { if (renderPending && !isBusy()) { renderPending = false; render(); } }, 80);
  });
}

function currentRoute() {
  const h = (location.hash || '#/today').replace('#/', '');
  return ROUTES.includes(h) ? h : 'today';
}

function render() {
  const route = currentRoute();
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.route === route));
  document.getElementById('pageTitle').textContent = ROUTE_TITLES[route];
  populateMonthSelect();
  const root = document.getElementById('viewRoot');
  root.innerHTML = '';

  if (!DB.members.length) return renderWelcome(root);
  if (!LS.me) return renderWhoAmI(root);

  ({ today: renderToday, khoroch: renderKhoroch, hisab: renderHisab, more: renderMore, grid: renderGrid })[route](root);
}

function populateMonthSelect() {
  const sel = document.getElementById('monthSelect');
  const months = new Set(Object.keys(DB.months));
  months.add(currentMonth());
  const list = [...months].sort();
  sel.innerHTML = list.map((m) => `<option value="${m}" ${m === currentMonth() ? 'selected' : ''}>${monthLabel(m)}</option>`).join('');
  sel.onchange = () => setMonth(sel.value);
}

/* ---------------- shared bits ---------------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function avatar(name, cls = '') {
  return `<div class="avatar ${cls}" style="background:${avatarColor(name)}">${esc(initials(name))}</div>`;
}

function nameCell(name, extra = '') {
  return `<div class="cell-name">${avatar(name, 'sm')}<span>${esc(name)}</span>${extra}</div>`;
}

function chips(members, selectedId, field = 'memberId') {
  return `<div class="who-chips" data-field="${field}">` + members.map((m) => `
    <button type="button" class="who-chip ${m.id === selectedId ? 'active' : ''}" data-id="${m.id}">
      ${avatar(m.name, 'xs')}<span>${esc(m.name)}</span>
    </button>`).join('') + '</div>';
}

function emptyMsg(text) { return `<p class="empty">${text}</p>`; }

function dueLine(due) {
  if (Math.abs(due) < 0.5) return '<span class="badge badge-muted">মিলে গেছে</span>';
  return due > 0
    ? `<span class="badge badge-danger">দেবে ${money(due)}</span>`
    : `<span class="badge badge-success">পাবে ${money(Math.abs(due))}</span>`;
}

/* ---------------- first-run ---------------- */

function renderWelcome(root) {
  root.innerHTML = `
    <div class="card center-card">
      <h2>🍽️ Mess Hisab</h2>
      <p class="hint">শুরু করতে মেসের সবাইকে যোগ করো।</p>
      <button class="btn btn-primary" id="addFirst">+ প্রথম member যোগ করো</button>
    </div>`;
  root.querySelector('#addFirst').onclick = () => openMemberModal();
}

function renderWhoAmI(root) {
  root.innerHTML = `
    <div class="card center-card">
      <h3>তুমি কে?</h3>
      <p class="hint">শুধু এই ফোনে মনে রাখা হবে — অন্য কেউ জানবে না।</p>
      <div class="who-grid">
        ${activeMembers(DB).map((m) => `
          <button class="who-big" data-id="${m.id}">${avatar(m.name)}<span>${esc(m.name)}</span></button>`).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" id="addMember" style="margin-top:18px">+ আরও member যোগ করো</button>
    </div>`;
  root.querySelectorAll('.who-big').forEach((b) => (b.onclick = () => {
    LS.me = b.dataset.id;
    render();
    toast(`স্বাগতম, ${memberName(DB, b.dataset.id)}`);
  }));
  root.querySelector('#addMember').onclick = () => openMemberModal();
}

/* ---------------- আজ ---------------- */

function renderToday(root) {
  const monthKey = currentMonth();
  const today = todayISO();
  const month = peekMonth(DB, monthKey);
  const eaters = mealMembers(DB);
  const mgr = managerOn(DB, today);
  const iAmManager = mgr && me() && mgr.id === me().id;
  const s = computeSummary(DB, monthKey);
  const mine = s.rows.find((r) => me() && r.member.id === me().id);

  // The day being edited is its own state — deriving it from "today" is what
  // made the ‹ আগের দিন button and the missing-day chips do nothing. Future
  // days are allowed: anyone can fill their meals in ahead of time.
  if (!viewDay || monthOf(viewDay) !== monthKey) {
    viewDay = monthOf(today) === monthKey ? today : `${monthKey}-01`;
  }
  const day = viewDay;
  const monthDays = daysInMonth(monthKey);
  const lastDay = monthDays[monthDays.length - 1];

  if (!mealDraft || mealDraft.date !== day) mealDraft = { date: day, counts: proposalFor(month, eaters, day) };
  const confirmed = dayConfirmed(month, day);

  const gaps = missingDays(month, monthKey);

  root.innerHTML = `
    <div class="duty-strip">
      ${mgr
        ? `<div class="duty-who">${avatar(mgr.name, 'sm')}<div><b>${iAmManager ? 'আজ তোমার ডিউটি' : esc(mgr.name) + ' এই সপ্তাহের ম্যানেজার'}</b>
             <div class="duty-sub">${dutySubtitle(today)}</div></div></div>`
        : `<div class="duty-who"><div><b>এই সপ্তাহে ম্যানেজার কে?</b><div class="duty-sub">কেউ ঠিক করা নেই</div></div></div>`}
      <button class="btn btn-ghost btn-sm" id="dutyBtn">${mgr ? 'বদলাও' : 'ঠিক করো'}</button>
    </div>

    ${mine ? `
    <div class="my-card">
      <div class="my-row"><span>আমি খেয়েছি</span><b>${num(mine.meals)} meal</b></div>
      <div class="my-row"><span>আমি দিয়েছি</span><b>${money(mine.paid)}</b></div>
      <div class="my-row muted-row"><span>${s.rateReady ? 'মাস শেষ হলে আনুমানিক' : 'হিসাব হবে meal বসানোর পর'}</span>
        <span>${s.rateReady ? dueLine(mine.due) : '—'}</span></div>
    </div>` : ''}

    <div class="card">
      <div class="day-head">
        <h3>${day === today ? 'আজকের meal' : `${fullDayLabel(day)} — meal`}</h3>
        ${confirmed ? '<span class="badge badge-success">বসানো হয়েছে</span>' : '<span class="badge badge-warn">বসানো হয়নি</span>'}
      </div>
      <div class="day-nav">
        <button class="btn btn-ghost btn-sm" id="prevDay" ${day <= monthDays[0] ? 'disabled' : ''}>‹ আগের</button>
        <span class="day-current">${fullDayLabel(day)}${day > today ? ' <span class="tag tag-sm">আগাম</span>' : ''}</span>
        <button class="btn btn-ghost btn-sm" id="nextDay" ${day >= lastDay ? 'disabled' : ''}>পরের ›</button>
      </div>
      ${eaters.length ? `
        <div class="stepper-list">
          ${eaters.map((m) => stepperRow(m, mealDraft.counts[m.id] || 0, confirmed)).join('')}
        </div>
        <button class="btn btn-primary btn-block" id="saveMeals">✓ সেভ করো</button>
        ${confirmed ? '' : '<p class="hint center">সংখ্যাগুলো আগের দিনের মতো ধরে বসানো — ঠিক থাকলে শুধু সেভ চাপো।</p>'}
      ` : emptyMsg('কোনো meal member নেই।')}
    </div>

    ${gaps.length && eaters.length ? backfillCard(month, eaters, gaps) : ''}

    <div class="card">
      <h3>খরচ যোগ করো</h3>
      <div class="big-actions">
        <button class="btn btn-primary btn-big" id="addBazar">🛒 বাজার</button>
        <button class="btn btn-ghost btn-big" id="addBill">💡 অন্যান্য</button>
      </div>
    </div>

    <a class="btn btn-ghost btn-block" href="#/grid">📅 পুরো মাসের meal দেখো</a>`;

  bindSteppers(root, day);
  bindBackfill(root, eaters);
  root.querySelector('#saveMeals') && (root.querySelector('#saveMeals').onclick = () => saveDay(day));
  root.querySelector('#prevDay').onclick = () => { if (day > monthDays[0]) goDay(addDays(day, -1)); };
  root.querySelector('#nextDay').onclick = () => { if (day < lastDay) goDay(addDays(day, 1)); };
  root.querySelector('#dutyBtn').onclick = openDutyModal;
  root.querySelector('#addBazar').onclick = () => openCostModal({ kind: 'bazar', date: day });
  root.querySelector('#addBill').onclick = () => openCostModal({ kind: 'bill', date: day });
}

function goDay(dateISO) {
  const mk = monthOf(dateISO);
  mealDraft = null;
  backfillDraft = null;
  viewDay = dateISO;
  if (mk !== currentMonth()) setMonth(mk);
  else render();
}

function lastDayOfMonth(monthKey, today) {
  const all = daysInMonth(monthKey);
  const capped = all.filter((d) => d <= today);
  return (capped.length ? capped : all)[Math.max(0, (capped.length ? capped : all).length - 1)];
}

function fullDayLabel(dateISO) {
  const [, m, d] = dateISO.split('-');
  const months = ['', 'জানু', 'ফেব', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্ট', 'অক্টো', 'নভে', 'ডিসে'];
  return `${Number(d)} ${months[Number(m)]} · ${dayLabel(dateISO).split('· ')[1]}`;
}

/* ---------- bulk backfill: meals get entered every 7-15 days, not daily ---------- */

function backfillCard(month, eaters, gaps) {
  if (!backfillDraft || backfillDraft.month !== currentMonth()) {
    backfillDraft = { month: currentMonth(), counts: {}, filled: false };
  }
  const d = backfillDraft;

  return `
    <div class="card warn-card">
      <div class="day-head">
        <h3>⚠️ ${gaps.length} দিন বসানো হয়নি</h3>
        <button class="btn btn-ghost btn-sm" id="fillAll">সব দিন আগের মতো ভরো</button>
      </div>
      <p class="hint">সাত-পনেরো দিন পর একসাথে বসাতে এখানেই সব দিন পাবে। ঘরে চাপলে সংখ্যা বদলায় (০ → ০.৫ → ১ → ১.৫ → ২)।</p>
      <div class="mini-wrap">
        <div class="mini-grid">
          <div class="mini-row mini-head">
            <span class="mini-date">তারিখ</span>
            ${eaters.map((m) => `<span class="mini-cell-head">${esc(m.name.slice(0, 6))}</span>`).join('')}
          </div>
          ${gaps.map((date) => `
            <div class="mini-row" data-date="${date}">
              <span class="mini-date">${esc(dayLabel(date))}</span>
              ${eaters.map((m) => {
                const v = d.counts[date] ? d.counts[date][m.id] : undefined;
                return `<button class="mini-cell ${v === undefined ? 'blank' : ''}" data-date="${date}" data-member="${m.id}">${v === undefined ? '·' : num(v)}</button>`;
              }).join('')}
            </div>`).join('')}
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="saveBackfill">✓ এই দিনগুলো সেভ করো</button>
    </div>`;
}

function bindBackfill(root, eaters) {
  const fill = root.querySelector('#fillAll');
  if (!fill) return;
  const month = peekMonth(DB, currentMonth());

  fill.onclick = () => {
    entryBusy = true;
    root.querySelectorAll('.mini-row[data-date]').forEach((row) => {
      const date = row.dataset.date;
      const proposal = proposalFor(month, eaters, date);
      backfillDraft.counts[date] = { ...proposal };
      row.querySelectorAll('.mini-cell').forEach((c) => {
        c.textContent = num(proposal[c.dataset.member] || 0);
        c.classList.remove('blank');
      });
    });
    entryBusy = false;
    toast('সব দিন ভরা হয়েছে — দরকারে ঘরে চেপে বদলাও');
  };

  root.querySelectorAll('.mini-cell').forEach((cell) => (cell.onclick = () => {
    entryBusy = true;
    const { date, member } = cell.dataset;
    if (!backfillDraft.counts[date]) backfillDraft.counts[date] = {};
    const cur = backfillDraft.counts[date][member];
    const cycle = [0, 0.5, 1, 1.5, 2];
    const next = cur === undefined ? 1 : cycle[(cycle.indexOf(cur) + 1) % cycle.length];
    backfillDraft.counts[date][member] = next;
    cell.textContent = num(next);
    cell.classList.remove('blank');
  }));

  root.querySelector('#saveBackfill').onclick = () => {
    const dates = Object.keys(backfillDraft.counts);
    if (!dates.length) return toast('আগে দিনগুলো ভরো', 'error');
    const counts = JSON.parse(JSON.stringify(backfillDraft.counts));
    // Days can straddle a month boundary, so write each into its own month.
    const byMonth = {};
    dates.forEach((d) => { (byMonth[monthOf(d)] = byMonth[monthOf(d)] || []).push(d); });
    Object.entries(byMonth).forEach(([mk, ds]) => {
      mutate((m) => {
        ds.forEach((date) => {
          eaters.forEach((mem) => {
            const v = Number(counts[date][mem.id] || 0);
            const e = m.meals.find((x) => x.date === date && x.memberId === mem.id);
            if (e) e.count = v;
            else m.meals.push({ id: uid('meal'), date, memberId: mem.id, count: v });
          });
          m.mealDays[date] = true;
        });
      }, mk);
    });
    entryBusy = false;
    backfillDraft = null;
    mealDraft = null;
    render();
    toast(`${dates.length} দিন সেভ হয়েছে ✓`);
  };
}

function dutySubtitle(today) {
  const d = currentDuty(DB, today);
  if (!d) return '';
  const days = Math.round((new Date(today) - new Date(d.from)) / 86400000) + 1;
  return `দিন ${days} · শুরু ${dayLabel(d.from)}`;
}

/** Yesterday's confirmed counts, else 1 each — a proposal, never auto-saved. */
function proposalFor(month, eaters, dateISO) {
  if (dayConfirmed(month, dateISO)) {
    const out = {};
    eaters.forEach((m) => { out[m.id] = mealFor(month, dateISO, m.id); });
    return out;
  }
  let ref = null;
  for (let i = 1; i <= 10; i++) {
    const d = addDays(dateISO, -i);
    if (dayConfirmed(month, d)) { ref = d; break; }
  }
  const out = {};
  eaters.forEach((m) => { out[m.id] = ref ? mealFor(month, ref, m.id) : 1; });
  return out;
}

function stepperRow(m, value, confirmed) {
  return `
    <div class="stepper-row" data-member="${m.id}">
      ${avatar(m.name, 'sm')}
      <span class="stepper-name">${esc(m.name)}</span>
      <button class="step-btn" data-step="-1" aria-label="কম">−</button>
      <span class="step-val ${confirmed ? '' : 'ghost'}">${num(value)}</span>
      <button class="step-btn" data-step="1" aria-label="বেশি">+</button>
    </div>`;
}

function bindSteppers(root, day) {
  root.querySelectorAll('.stepper-row').forEach((row) => {
    const id = row.dataset.member;
    row.querySelectorAll('.step-btn').forEach((btn) => (btn.onclick = () => {
      entryBusy = true;
      const delta = Number(btn.dataset.step) * 0.5;
      const next = Math.max(0, Math.round(((mealDraft.counts[id] || 0) + delta) * 2) / 2);
      mealDraft.counts[id] = next;
      const val = row.querySelector('.step-val');
      val.textContent = num(next);
      val.classList.remove('ghost');
    }));
  });
}

function saveDay(day) {
  const eaters = mealMembers(DB);
  const counts = { ...mealDraft.counts };
  mutate((month) => {
    eaters.forEach((m) => {
      const v = Number(counts[m.id] || 0);
      const existing = month.meals.find((x) => x.date === day && x.memberId === m.id);
      if (existing) existing.count = v;
      else month.meals.push({ id: uid('meal'), date: day, memberId: m.id, count: v });
    });
    // Recording the day as confirmed is what separates "everyone ate nothing"
    // from "nobody filled this in".
    month.mealDays[day] = true;
  }, monthOf(day));
  entryBusy = false;
  mealDraft = null;
  render();
  toast('সেভ হয়েছে ✓');
}

function missingDays(month, monthKey) {
  const today = todayISO();
  return daysInMonth(monthKey).filter((d) => d <= today && !dayConfirmed(month, d));
}

/* ---------------- খরচ (bazar + bills, one page) ---------------- */

function renderKhoroch(root) {
  const monthKey = currentMonth();
  const s = computeSummary(DB, monthKey);
  const month = s.month;
  const all = [
    ...month.bazar.map((b) => ({ ...b, kind: 'bazar' })),
    ...month.others.map((o) => ({ ...o, kind: 'bill' }))
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  root.innerHTML = `
    <div class="pool-row">
      <div class="pool-card pool-bazar">
        <div class="pool-icon">🛒</div>
        <div><div class="pool-label">বাজার খরচ</div><div class="pool-value">${money(s.totalBazar)}</div>
          <div class="pool-rule">meal অনুযায়ী ভাগ${s.rateReady ? ` · ${money2(s.mealRate)}/meal` : ''}</div></div>
      </div>
      <div class="pool-card pool-bill">
        <div class="pool-icon">💡</div>
        <div><div class="pool-label">অন্যান্য খরচ</div><div class="pool-value">${money(s.totalBills)}</div>
          <div class="pool-rule">সমান ভাগ (${s.eaters.length} জন)${s.eaters.length ? ` · ${money2(s.billsPerHead)}/জন` : ''}</div></div>
      </div>
    </div>

    <div class="toolbar">
      <div class="chip-filter" id="kindFilter">
        <button class="chip active" data-kind="all">সব</button>
        <button class="chip" data-kind="bazar">🛒 বাজার</button>
        <button class="chip" data-kind="bill">💡 অন্যান্য</button>
      </div>
    </div>

    <div class="entry-list" id="entryList">
      ${all.map((e) => entryCard(e)).join('') || emptyMsg('এই মাসে এখনো কোনো খরচ যোগ করা হয়নি।')}
    </div>

    <div class="fab-row">
      <button class="fab fab-primary" id="fabBazar">🛒 বাজার</button>
      <button class="fab" id="fabBill">💡 অন্যান্য</button>
    </div>`;

  root.querySelectorAll('#kindFilter .chip').forEach((c) => (c.onclick = () => {
    root.querySelectorAll('#kindFilter .chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    root.querySelectorAll('.entry-card').forEach((card) => {
      card.style.display = (c.dataset.kind === 'all' || card.dataset.kind === c.dataset.kind) ? '' : 'none';
    });
  }));
  root.querySelectorAll('.entry-card').forEach((card) => (card.onclick = () =>
    openCostModal({ kind: card.dataset.kind, id: card.dataset.id })));
  root.querySelector('#fabBazar').onclick = () => openCostModal({ kind: 'bazar' });
  root.querySelector('#fabBill').onclick = () => openCostModal({ kind: 'bill' });
}

function entryCard(e) {
  return `
    <div class="entry-card kind-${e.kind}" data-kind="${e.kind}" data-id="${e.id}">
      <div class="entry-main">
        <div class="entry-top">
          <span class="entry-amount">${money(e.amount)}</span>
          <span class="tag">${e.kind === 'bazar' ? '🛒 বাজার' : '💡 ' + esc(e.type || 'অন্যান্য')}</span>
        </div>
        <div class="entry-sub">${esc(dayLabel(e.date))} · ${esc(memberName(DB, e.memberId))} এর টাকায়${e.details ? ' · ' + esc(e.details) : ''}</div>
      </div>
      <span class="entry-chevron">›</span>
    </div>`;
}

function openCostModal({ kind, id, date }) {
  const monthKey = currentMonth();
  const month = peekMonth(DB, monthKey);
  const list = kind === 'bazar' ? month.bazar : month.others;
  const editing = id ? list.find((x) => x.id === id) : null;
  const members = activeMembers(DB);
  if (!members.length) return toast('আগে member যোগ করো', 'error');

  const payer = editing?.memberId || (me() ? me().id : members[0].id);
  const d = editing?.date || date || defaultDate(monthKey);

  openModal(`
    <h3>${editing ? 'খরচ ঠিক করো' : (kind === 'bazar' ? '🛒 বাজার খরচ যোগ করো' : '💡 অন্যান্য খরচ যোগ করো')}</h3>
    <form id="costForm">
      <label>টাকা</label>
      <input type="number" inputmode="decimal" step="0.01" min="0" name="amount" required
             value="${editing?.amount ?? ''}" placeholder="0" class="big-input" autofocus>

      ${kind === 'bill' ? `
        <label>কীসের খরচ</label>
        <div class="chip-filter type-chips">
          ${BILL_TYPES.map((t) => `<button type="button" class="chip type-chip ${(editing?.type || BILL_TYPES[0]) === t ? 'active' : ''}" data-type="${t}">${t}</button>`).join('')}
        </div>
        <input type="hidden" name="type" value="${esc(editing?.type || BILL_TYPES[0])}">` : ''}

      <label>কার টাকায়</label>
      ${chips(members, payer)}
      <input type="hidden" name="memberId" value="${payer}">

      <label>তারিখ</label>
      <div class="chip-filter date-chips">
        <button type="button" class="chip date-chip" data-date="${todayISO()}">আজ</button>
        <button type="button" class="chip date-chip" data-date="${addDays(todayISO(), -1)}">গতকাল</button>
      </div>
      <input type="date" name="date" required value="${d}">

      <label>কী কিনেছ / নোট</label>
      <input name="details" value="${esc(editing?.details || '')}" placeholder="যেমন: চাল, তেল, মাছ">

      <div class="modal-actions">
        ${editing ? '<button type="button" class="btn btn-danger" id="delBtn">মুছে ফেলো</button>' : '<span></span>'}
        <div class="spacer"></div>
        <button type="button" class="btn btn-ghost" id="cancelBtn">বাতিল</button>
        <button type="submit" class="btn btn-primary">সেভ</button>
      </div>
    </form>`);

  const form = document.getElementById('costForm');
  form.querySelectorAll('.who-chip').forEach((c) => (c.onclick = () => {
    form.querySelectorAll('.who-chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    form.querySelector('[name="memberId"]').value = c.dataset.id;
  }));
  form.querySelectorAll('.type-chip').forEach((c) => (c.onclick = () => {
    form.querySelectorAll('.type-chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    form.querySelector('[name="type"]').value = c.dataset.type;
  }));
  form.querySelectorAll('.date-chip').forEach((c) => (c.onclick = () => {
    form.querySelector('[name="date"]').value = c.dataset.date;
  }));

  document.getElementById('cancelBtn').onclick = closeModal;
  const del = document.getElementById('delBtn');
  if (del) del.onclick = () => {
    if (!confirm('এই খরচটা মুছে ফেলব?')) return;
    mutate((m) => {
      if (kind === 'bazar') m.bazar = m.bazar.filter((x) => x.id !== id);
      else m.others = m.others.filter((x) => x.id !== id);
    }, monthKey);
    closeModal();
    render();
    toast('মুছে ফেলা হয়েছে');
  };

  form.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const dateVal = fd.get('date');
    const data = {
      date: dateVal,
      memberId: fd.get('memberId'),
      amount: Number(fd.get('amount')),
      details: fd.get('details')
    };
    if (kind === 'bill') data.type = fd.get('type');

    // File the entry into the month its own date belongs to, not whichever
    // month happens to be on screen.
    const targetMonth = monthOf(dateVal);
    mutate((m) => {
      const arr = kind === 'bazar' ? m.bazar : m.others;
      const target = id ? arr.find((x) => x.id === id) : null;
      if (target) Object.assign(target, data);
      else arr.push({ id: uid(kind === 'bazar' ? 'b' : 'o'), ...data });
    }, targetMonth);

    closeModal();
    if (targetMonth !== currentMonth()) setMonth(targetMonth);
    else render();
    toast('সেভ হয়েছে ✓');
  };
}

function defaultDate(monthKey) {
  const t = todayISO();
  return monthOf(t) === monthKey ? t : `${monthKey}-01`;
}

/* ---------------- হিসাব ---------------- */

function renderHisab(root) {
  const monthKey = currentMonth();
  const s = computeSummary(DB, monthKey);
  const month = s.month;
  const transfers = s.rateReady ? computeTransfers(s.rows.map((r) => ({ ...r }))) : [];
  const collector = month.collector ? memberById(DB, month.collector) : null;

  root.innerHTML = `
    <div class="rate-row">
      <div class="rate-card"><div class="rate-label">Meal রেট</div>
        <div class="rate-value">${s.rateReady ? money2(s.mealRate) : '—'}</div>
        <div class="rate-formula">বাজার ${money(s.totalBazar)} ÷ ${num(s.totalMeals)} meal</div></div>
      <div class="rate-card"><div class="rate-label">অন্যান্য খরচ / জন</div>
        <div class="rate-value">${s.eaters.length ? money2(s.billsPerHead) : '—'}</div>
        <div class="rate-formula">অন্যান্য ${money(s.totalBills)} ÷ ${s.eaters.length} জন</div></div>
    </div>

    <div class="card">
      <h3>${monthLabel(monthKey)} — কার কত</h3>
      <div class="hisab-list">
        ${s.rows.map((r) => hisabCard(r, s)).join('') || emptyMsg('কোনো member নেই।')}
      </div>
      ${!s.rateReady ? '<p class="hint">⏳ meal বসানো শুরু হয়নি — rate ও ভাগ এখনো বের করা যাচ্ছে না।</p>'
        : s.balanced ? '<p class="hint">✓ সব due যোগ করলে শূন্য — হিসাব মিলেছে।</p>'
        : `<p class="hint warn">⚠️ due গুলো যোগ করলে ${money(s.dueSum)} থাকছে, শূন্য হওয়ার কথা — কোনো entry গোলমাল আছে।</p>`}
    </div>

    ${transfers.length ? `
    <div class="card highlight-card">
      <h3>💸 কে কাকে দেবে</h3>
      <div class="transfer-list">
        ${transfers.map((t) => `
          <div class="transfer-row">
            <span class="t-from">${esc(t.from.name)}</span>
            <span class="t-arrow">→</span>
            <span class="t-to">${esc(t.to.name)}</span>
            <b class="t-amt">${money(t.amount)}</b>
          </div>`).join('')}
      </div>
      <button class="btn btn-ghost" id="copyBtn">📋 কপি করো</button>
      <p class="hint">ভাড়া ও বুয়ার টাকা এতে নেই — সেটা নিচে আলাদা।</p>
    </div>` : ''}

    <div class="card">
      <h3>🏠 ভাড়া ও বুয়া</h3>
      <div class="collector-row">
        <span>এ মাসে টাকা তুলছে</span>
        <select id="collectorSel" class="month-select">
          <option value="">— কেউ না —</option>
          ${activeMembers(DB).map((m) => `<option value="${m.id}" ${month.collector === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap">
        <table class="table form-table">
          <thead><tr><th>নাম</th><th class="num">ভাড়া</th><th class="num">বুয়া</th><th class="num">মোট</th><th>দিয়েছে</th></tr></thead>
          <tbody>
            ${activeMembers(DB).map((m) => {
              const f = getFixed(DB, monthKey, m);
              return `<tr>
                <td>${nameCell(m.name)}</td>
                <td class="num"><input type="number" inputmode="numeric" min="0" class="cell-input fixed-input" data-member="${m.id}" data-field="rent" value="${f.rent}"></td>
                <td class="num"><input type="number" inputmode="numeric" min="0" class="cell-input fixed-input" data-member="${m.id}" data-field="bua" value="${f.bua}"></td>
                <td class="num num-strong">${money(f.rent + f.bua)}</td>
                <td class="center"><input type="checkbox" class="hand-check" data-member="${m.id}" ${month.handedOver[m.id] ? 'checked' : ''}></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="hint">${collector ? `<b>${esc(collector.name)}</b> সবার থেকে তুলে ভাড়া ও বুয়ার বিল দেবে — টিক দিয়ে রাখো কে দিয়ে দিয়েছে।` : 'এ মাসে কে টাকা তুলবে সেটা উপরে বেছে নাও।'}</p>
    </div>`;

  const copy = root.querySelector('#copyBtn');
  if (copy) copy.onclick = () => {
    const text = `${monthLabel(monthKey)} — মেসের হিসাব\n` +
      transfers.map((t) => `${t.from.name} → ${t.to.name}: ${money(t.amount)}`).join('\n');
    navigator.clipboard?.writeText(text).then(() => toast('কপি হয়েছে')).catch(() => toast('কপি হয়নি', 'error'));
  };
  root.querySelector('#collectorSel').onchange = (e) => {
    mutate((m) => { m.collector = e.target.value || null; });
    render();
  };
  root.querySelectorAll('.fixed-input').forEach((inp) => (inp.onchange = () => {
    mutate(() => setFixed(DB, currentMonth(), inp.dataset.member, { [inp.dataset.field]: Number(inp.value) || 0 }));
    requestRender();
  }));
  root.querySelectorAll('.hand-check').forEach((c) => (c.onchange = () => {
    mutate((m) => {
      if (c.checked) m.handedOver[c.dataset.member] = true;
      else delete m.handedOver[c.dataset.member];
    });
  }));
}

function hisabCard(r, s) {
  const f = getFixed(DB, currentMonth(), r.member);
  return `
    <details class="hisab-card">
      <summary>
        ${avatar(r.member.name, 'sm')}
        <span class="h-name">${esc(r.member.name)}${r.eats ? '' : '<span class="tag tag-sm">শুধু ভাড়া</span>'}</span>
        <span class="h-due">${s.rateReady ? dueLine(r.due) : '<span class="badge badge-muted">—</span>'}</span>
      </summary>
      <div class="h-body">
        <div class="h-line"><span>${num(r.meals)} meal × ${s.rateReady ? money2(s.mealRate) : '—'}</span><b>${money(r.mealCost)}</b></div>
        <div class="h-line"><span>অন্যান্য খরচের ভাগ</span><b>${money(r.billShare)}</b></div>
        <div class="h-line total"><span>তার ভাগ</span><b>${money(r.perHeadCost)}</b></div>
        <div class="h-line"><span>নিজে দিয়েছে</span><b>− ${money(r.paid)}</b></div>
        <div class="h-line total"><span>${r.due > 0 ? 'দেবে' : 'পাবে'}</span><b>${money(Math.abs(r.due))}</b></div>
        <div class="h-line muted-row"><span>ভাড়া ${money(f.rent)} + বুয়া ${money(f.bua)}</span><b>আলাদা</b></div>
      </div>
    </details>`;
}

/* ---------------- পুরো মাসের grid ---------------- */

function renderGrid(root) {
  const monthKey = currentMonth();
  const month = peekMonth(DB, monthKey);
  const eaters = mealMembers(DB);
  if (!eaters.length) return void (root.innerHTML = emptyMsg('কোনো meal member নেই।'));

  const days = daysInMonth(monthKey);
  const today = todayISO();

  const filled = days.filter((d) => dayConfirmed(month, d)).length;
  const ahead = days.filter((d) => d > today && dayConfirmed(month, d)).length;

  root.innerHTML = `
    <div class="toolbar">
      <div class="inline-total">মোট meal <b>${num(allMealTotal(month))}</b> · ${filled}/${days.length} দিন বসানো${ahead ? ` · ${ahead} দিন আগাম` : ''}</div>
      <a class="btn btn-ghost btn-sm" href="#/today">← আজ</a>
    </div>

    <div class="card">
      <div class="mini-wrap">
        <div class="mini-grid glance">
          <div class="mini-row mini-head">
            <span class="mini-date">তারিখ</span>
            ${eaters.map((m) => `<span class="mini-cell-head">${esc(m.name.slice(0, 6))}</span>`).join('')}
            <span class="mini-cell-head">মোট</span>
          </div>
          ${days.map((d) => {
            const conf = dayConfirmed(month, d);
            const tot = eaters.reduce((s, m) => s + mealFor(month, d, m.id), 0);
            const cls = [d === today ? 'is-today' : '', !conf ? 'not-filled' : '', d > today ? 'future' : ''].join(' ');
            return `<div class="mini-row ${cls}" data-date="${d}">
              <span class="mini-date">${esc(dayLabel(d))}${d === today ? ' <b>·আজ</b>' : ''}</span>
              ${eaters.map((m) => {
                const v = mealFor(month, d, m.id);
                return `<button class="mini-cell ${conf ? (v ? '' : 'zero') : 'blank'}" data-date="${d}" data-member="${m.id}">${conf ? num(v) : '·'}</button>`;
              }).join('')}
              <span class="mini-cell-head strong">${conf ? num(tot) : '—'}</span>
            </div>`;
          }).join('')}
          <div class="mini-row mini-foot">
            <span class="mini-date">মোট</span>
            ${eaters.map((m) => `<span class="mini-cell-head strong">${num(memberMealTotal(month, m.id))}</span>`).join('')}
            <span class="mini-cell-head strong">${num(allMealTotal(month))}</span>
          </div>
        </div>
      </div>
      <p class="hint">ঘরে চাপলে সংখ্যা বদলায় (০ → ০.৫ → ১ → ১.৫ → ২)। <b>·</b> মানে ওই দিন কেউ বসায়নি। আগামী দিনের meal-ও আগে থেকে বসিয়ে রাখা যায়।</p>
    </div>`;

  root.querySelectorAll('.mini-cell').forEach((cell) => (cell.onclick = () => {
    entryBusy = true;
    const { date, member } = cell.dataset;
    const cycle = [0, 0.5, 1, 1.5, 2];
    const cur = dayConfirmed(peekMonth(DB, monthOf(date)), date) ? mealFor(peekMonth(DB, monthOf(date)), date, member) : undefined;
    const next = cur === undefined ? 1 : cycle[(cycle.indexOf(cur) + 1 + cycle.length) % cycle.length];
    mutate((m) => {
      const e = m.meals.find((x) => x.date === date && x.memberId === member);
      if (e) e.count = next;
      else m.meals.push({ id: uid('meal'), date, memberId: member, count: next });
      m.mealDays[date] = true;
    }, monthOf(date));
    entryBusy = false;
    render();
  }));
}

/* ---------------- আরও ---------------- */

function renderMore(root) {
  const meNow = me();
  root.innerHTML = `
    <div class="card">
      <div class="toolbar"><h3>👥 সদস্য</h3><button class="btn btn-primary btn-sm" id="addMember">+ যোগ করো</button></div>
      <div class="table-wrap">
        <table class="table form-table">
          <thead><tr><th>নাম</th><th>Meal</th><th class="num">ভাড়া</th><th class="num">বুয়া</th><th></th></tr></thead>
          <tbody>
            ${DB.members.map((m) => `<tr class="${m.active ? '' : 'row-off'}">
              <td>${nameCell(m.name, m.active ? '' : '<span class="tag tag-sm">বন্ধ</span>')}</td>
              <td>${m.inMeal === false ? '<span class="badge badge-muted">না</span>' : '<span class="badge badge-success">হ্যাঁ</span>'}</td>
              <td class="num">${money(m.rent || 0)}</td>
              <td class="num">${money(m.bua || 0)}</td>
              <td class="row-actions">
                <button class="icon-btn" data-edit="${m.id}">✏️</button>
                <button class="icon-btn" data-toggle="${m.id}">${m.active ? '🚫' : '✅'}</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3>📅 এই ফোন</h3>
      <div class="my-row"><span>আমি</span><b>${meNow ? esc(meNow.name) : '—'}</b></div>
      <div class="chip-filter">
        <button class="btn btn-ghost btn-sm" id="changeMe">অন্য কেউ</button>
        <button class="btn ${(LS.theme || 'light') !== 'dark' ? 'btn-primary' : 'btn-ghost'} btn-sm" id="lightBtn">☀️</button>
        <button class="btn ${(LS.theme || 'light') === 'dark' ? 'btn-primary' : 'btn-ghost'} btn-sm" id="darkBtn">🌙</button>
      </div>
      <p class="hint">নাম, মাস আর theme শুধু এই ফোনে — অন্যদের কিছু বদলাবে না।</p>
    </div>

    <div class="card">
      <h3>🔁 ম্যানেজার</h3>
      <div class="duty-log">
        ${(DB.duty || []).slice().sort((a, b) => b.from.localeCompare(a.from)).slice(0, 6).map((d) => `
          <div class="duty-log-row">${avatar(memberName(DB, d.memberId), 'xs')}
            <span>${esc(memberName(DB, d.memberId))}</span><span class="muted">${esc(d.from)} থেকে</span></div>`).join('')
          || emptyMsg('এখনো কেউ ঠিক করা হয়নি।')}
      </div>
      <button class="btn btn-primary btn-sm" id="dutyBtn2">ম্যানেজার বদলাও</button>
    </div>

    <div class="card">
      <h3>💾 ব্যাকআপ</h3>
      <div class="chip-filter">
        <button class="btn btn-ghost btn-sm" id="exportAll">⬇ সব</button>
        <button class="btn btn-ghost btn-sm" id="exportMonth">⬇ এই মাস</button>
        <label class="btn btn-ghost btn-sm file-btn">⬆ ফাইল থেকে<input type="file" id="importInput" accept="application/json" hidden></label>
      </div>
      <p class="hint">সব ডেটা cloud এ থাকে ও সব ফোনে live যায় — ব্যাকআপ শুধু বাড়তি নিরাপত্তা।</p>
    </div>

    <div class="card">
      <h3>⚠️ সাবধান</h3>
      <button class="btn btn-danger btn-sm" id="resetBtn">সব ডেটা মুছে ফেলো</button>
    </div>`;

  root.querySelector('#addMember').onclick = () => openMemberModal();
  root.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openMemberModal(b.dataset.edit)));
  root.querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = () => {
    const m = memberById(DB, b.dataset.toggle);
    const s = computeSummary(DB, currentMonth());
    const row = s.rows.find((r) => r.member.id === m.id);
    if (m.active && row && (row.paid > 0 || row.meals > 0)) {
      if (!confirm(`${m.name} এই মাসে ${money(row.paid)} খরচ করেছে ও ${num(row.meals)} meal খেয়েছে। বন্ধ করলেও ওই হিসাব থাকবে। ঠিক আছে?`)) return;
    }
    mutateDB(() => { m.active = !m.active; });
    render();
  }));
  root.querySelector('#changeMe').onclick = () => { LS.me = ''; render(); };
  root.querySelector('#lightBtn').onclick = () => { applyTheme('light'); render(); };
  root.querySelector('#darkBtn').onclick = () => { applyTheme('dark'); render(); };
  root.querySelector('#dutyBtn2').onclick = openDutyModal;
  root.querySelector('#exportAll').onclick = () => { exportDB(DB, todayISO()); toast('ডাউনলোড হয়েছে'); };
  root.querySelector('#exportMonth').onclick = () => { exportMonth(DB, currentMonth()); toast('ডাউনলোড হয়েছে'); };
  root.querySelector('#importInput').onchange = handleImport;
  root.querySelector('#resetBtn').onclick = async () => {
    if (!confirm('সব ডেটা মুছে যাবে — সব ফোন থেকেই। নিশ্চিত?')) return;
    if (!confirm('সত্যিই? এটা ফেরানো যাবে না।')) return;
    if (saveTimer !== null) clearTimeout(saveTimer);
    await resetToSeed();
    location.reload();
  };
}

function openMemberModal(id) {
  const editing = id ? memberById(DB, id) : null;
  openModal(`
    <h3>${editing ? 'সদস্য ঠিক করো' : 'নতুন সদস্য'}</h3>
    <form id="memberForm">
      <label>নাম</label>
      <input name="name" required value="${esc(editing?.name || '')}" placeholder="যেমন: Oashiur" autofocus>
      <label class="check-row">
        <input type="checkbox" name="inMeal" ${editing?.inMeal === false ? '' : 'checked'}>
        <span>Meal এ আছে (বাজার ও অন্যান্য খরচের ভাগ দেবে)</span>
      </label>
      <label>মাসিক ভাড়া</label>
      <input type="number" inputmode="numeric" min="0" name="rent" value="${editing?.rent ?? 0}">
      <label>বুয়ার বিল</label>
      <input type="number" inputmode="numeric" min="0" name="bua" value="${editing?.bua ?? 0}">
      <div class="modal-actions">
        <div class="spacer"></div>
        <button type="button" class="btn btn-ghost" id="cancelBtn">বাতিল</button>
        <button type="submit" class="btn btn-primary">সেভ</button>
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
    mutateDB((db) => {
      const t = id ? db.members.find((m) => m.id === id) : null;
      if (t) Object.assign(t, data);
      else db.members.push({ id: uid('m'), active: true, ...data });
    });
    closeModal();
    render();
    toast('সেভ হয়েছে ✓');
  };
}

function openDutyModal() {
  const suggested = suggestNextManager(DB);
  const members = activeMembers(DB);
  openModal(`
    <h3>এই সপ্তাহে ম্যানেজার কে?</h3>
    <p class="hint">যে কেউ বেছে দিতে পারে — কাউকে দোষ দেওয়ার কিছু নেই।</p>
    <form id="dutyForm">
      ${chips(members, suggested)}
      <input type="hidden" name="memberId" value="${suggested || ''}">
      <label>কবে থেকে</label>
      <input type="date" name="from" value="${todayISO()}">
      <div class="modal-actions">
        <div class="spacer"></div>
        <button type="button" class="btn btn-ghost" id="cancelBtn">বাতিল</button>
        <button type="submit" class="btn btn-primary">ঠিক আছে</button>
      </div>
    </form>`);
  const form = document.getElementById('dutyForm');
  form.querySelectorAll('.who-chip').forEach((c) => (c.onclick = () => {
    form.querySelectorAll('.who-chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    form.querySelector('[name="memberId"]').value = c.dataset.id;
  }));
  document.getElementById('cancelBtn').onclick = closeModal;
  form.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const memberId = fd.get('memberId');
    if (!memberId) return toast('একজনকে বেছে নাও', 'error');
    mutateDB((db) => {
      db.duty = (db.duty || []).filter((d) => d.from !== fd.get('from'));
      db.duty.push({ id: uid('duty'), from: fd.get('from'), memberId });
      if (!db.rotationOrder.length) db.rotationOrder = activeMembers(db).map((m) => m.id);
    });
    closeModal();
    render();
    toast('ম্যানেজার ঠিক হয়েছে ✓');
  };
}

function openMonthModal() {
  openModal(`
    <h3>মাস</h3>
    <form id="monthForm">
      <label>কোন মাস</label>
      <input type="month" name="month" required value="${thisMonthISO()}">
      <div class="modal-actions">
        <div class="spacer"></div>
        <button type="button" class="btn btn-ghost" id="cancelBtn">বাতিল</button>
        <button type="submit" class="btn btn-primary">খোলো</button>
      </div>
    </form>`);
  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('monthForm').onsubmit = (e) => {
    e.preventDefault();
    setMonth(new FormData(e.target).get('month'));
    closeModal();
  };
}

async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = await importFile(file);
    if (parsed.members && parsed.months) {
      if (!confirm('এটা সব ফোনের ডেটা বদলে দেবে। নিশ্চিত?')) return;
      DB = parsed;
      normalizeDB();
      mutateDB(() => {});
      toast('ফাইল থেকে নেওয়া হয়েছে');
    } else if (parsed.monthKey && parsed.month) {
      mutateDB((db) => {
        db.months[parsed.monthKey] = parsed.month;
        (parsed.members || []).forEach((pm) => {
          if (!db.members.find((m) => m.id === pm.id)) db.members.push(pm);
        });
      });
      toast(`${parsed.monthKey} নেওয়া হয়েছে`);
    } else {
      return toast('ফাইলটা চেনা গেল না', 'error');
    }
    render();
  } catch (err) {
    toast('ফাইলটা ঠিক নেই', 'error');
  }
}

init();
