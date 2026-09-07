import { dbDocRef, setDoc, onSnapshot } from './firebase-init.js';
import { monthOf } from './dates.js';

let seedCache = null;

async function getSeed() {
  if (!seedCache) {
    const res = await fetch('data/seed.json');
    seedCache = await res.json();
  }
  return seedCache;
}

/**
 * Subscribes to the shared Firestore document so every device (phone, laptop,
 * any member) sees the same data live. onData fires once immediately and again
 * whenever anyone changes anything, anywhere.
 */
export function subscribeDB(onData, onError) {
  return onSnapshot(
    dbDocRef,
    async (snap) => {
      if (snap.exists()) {
        // hasPendingWrites = the local echo of our own not-yet-acked write.
        onData(snap.data(), snap.metadata.hasPendingWrites);
      } else {
        const seed = await getSeed();
        await setDoc(dbDocRef, seed);
      }
    },
    (err) => {
      console.error('Firestore sync error:', err);
      if (onError) onError(err);
    }
  );
}

export function saveDB(db) {
  return setDoc(dbDocRef, db);
}

export async function resetToSeed() {
  const seed = await getSeed();
  await setDoc(dbDocRef, seed);
}

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ---------------- shape ---------------- */

const EMPTY_MONTH = () => ({
  bazar: [],
  others: [],
  meals: [],
  mealDays: {},      // 'YYYY-MM-DD': true — the day was actually confirmed
  fixed: {},         // memberId: { rent, bua }
  collector: null,   // who collects rent+bua this month
  handedOver: {},    // memberId: true — gave their rent+bua to the collector
  claimedPaid: {}    // memberId: number — optional cross-check, never used in the math
});

/** Fills in missing fields and migrates older shapes. */
function normalizeMonth(month) {
  if (!month) return EMPTY_MONTH();
  if (month.costs && !month.bazar) {
    month.bazar = month.costs
      .filter((c) => c.category === 'bazar')
      .map((c) => ({ id: c.id, date: c.date, memberId: c.memberId, amount: c.amount, details: c.details }));
    month.others = month.costs
      .filter((c) => c.category !== 'bazar')
      .map((c) => ({
        id: c.id, date: c.date, memberId: c.memberId, amount: c.amount,
        type: c.category ? c.category.charAt(0).toUpperCase() + c.category.slice(1) : 'Other',
        details: c.details
      }));
    delete month.costs;
  }
  month.bazar = month.bazar || [];
  month.others = month.others || [];
  month.meals = month.meals || [];
  month.fixed = month.fixed || {};
  month.handedOver = month.handedOver || {};
  month.claimedPaid = month.claimedPaid || {};
  if (month.collector === undefined) month.collector = null;

  // Older data has no record of which days were confirmed. Infer it: any day
  // with a meal row was clearly filled in, so history reads as complete and
  // only genuinely untouched days show up as gaps.
  if (!month.mealDays) {
    month.mealDays = {};
    month.meals.forEach((m) => { month.mealDays[m.date] = true; });
  }
  return month;
}

export function ensureMonth(db, monthKey) {
  if (!db.months[monthKey]) db.months[monthKey] = EMPTY_MONTH();
  return normalizeMonth(db.months[monthKey]);
}

/** Read-only peek — never creates the month in the shared document. */
export function peekMonth(db, monthKey) {
  return db.months[monthKey] ? normalizeMonth(db.months[monthKey]) : EMPTY_MONTH();
}

export function activeMembers(db) {
  return db.members.filter((m) => m.active);
}

export function mealMembers(db) {
  return db.members.filter((m) => m.active && m.inMeal !== false);
}

export function memberById(db, id) {
  return db.members.find((m) => m.id === id) || null;
}

export function memberName(db, id) {
  const m = memberById(db, id);
  return m ? m.name : 'Unknown';
}

/* ---------------- the hisab ---------------- */

/**
 * Nobody deposits anything — each person spends from their own pocket, so what
 * they "paid" is simply the sum of the entries in their name. That makes the
 * whole thing a closed system: sum of all dues is always zero.
 *
 *   mealRate     = totalBazar / totalMeals        (bazar splits by meals eaten)
 *   billsPerHead = totalBills / eaters            (bills split equally)
 *   perHeadCost  = ownMeals * mealRate + billsPerHead
 *   due          = perHeadCost - paid             (+ve owes, -ve is owed)
 */
export function computeSummary(db, monthKey) {
  const month = peekMonth(db, monthKey);

  const paid = {};
  const addPaid = (id, amt) => { paid[id] = (paid[id] || 0) + Number(amt || 0); };
  month.bazar.forEach((b) => addPaid(b.memberId, b.amount));
  month.others.forEach((o) => addPaid(o.memberId, o.amount));

  const mealTotals = {};
  month.meals.forEach((me) => {
    mealTotals[me.memberId] = (mealTotals[me.memberId] || 0) + Number(me.count || 0);
  });

  // The settlement pool is a UNION, not a filter: anyone who spent money or ate
  // this month must get a row, even if they've since been deactivated —
  // otherwise their spending stays in the totals and the dues stop summing to zero.
  const pool = db.members.filter(
    (m) => m.active || (paid[m.id] || 0) > 0 || (mealTotals[m.id] || 0) > 0
  );
  const eaters = pool.filter((m) => m.inMeal !== false);

  const totalBazar = month.bazar.reduce((s, b) => s + Number(b.amount || 0), 0);
  const totalBills = month.others.reduce((s, o) => s + Number(o.amount || 0), 0);
  const totalCost = totalBazar + totalBills;
  const totalMeals = eaters.reduce((s, m) => s + (mealTotals[m.id] || 0), 0);

  const mealRate = totalMeals > 0 ? totalBazar / totalMeals : 0;
  const billsPerHead = eaters.length ? totalBills / eaters.length : 0;
  const rateReady = totalMeals > 0;

  const rows = pool.map((m) => {
    const eats = m.inMeal !== false;
    const meals = mealTotals[m.id] || 0;
    const mealCost = eats ? meals * mealRate : 0;
    const billShare = eats ? billsPerHead : 0;
    const perHeadCost = mealCost + billShare;
    const paidAmt = paid[m.id] || 0;
    return {
      member: m, eats, meals, mealCost, billShare, perHeadCost,
      paid: paidAmt,
      due: perHeadCost - paidAmt,
      claimed: Number(month.claimedPaid[m.id] || 0)
    };
  });

  const byType = totalBazar > 0 ? { 'বাজার': totalBazar } : {};
  month.others.forEach((o) => {
    const t = o.type || 'Other';
    byType[t] = (byType[t] || 0) + Number(o.amount || 0);
  });

  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  const dueSum = rows.reduce((s, r) => s + r.due, 0);

  return {
    month, pool, eaters, rows, byType,
    totalBazar, totalBills, totalCost, totalMeals, totalPaid,
    mealRate, billsPerHead, rateReady,
    balanced: Math.abs(dueSum) < 0.5,
    dueSum
  };
}

/**
 * Who hands cash to whom, in as few handovers as possible. Only the mess dues
 * net out here — rent and bua go to the landlord and the maid, not a roommate.
 */
export function computeTransfers(rows) {
  const debtors = rows.filter((r) => r.due > 0.5)
    .map((r) => ({ id: r.member.id, name: r.member.name, amt: r.due }))
    .sort((a, b) => b.amt - a.amt);
  const creditors = rows.filter((r) => r.due < -0.5)
    .map((r) => ({ id: r.member.id, name: r.member.name, amt: -r.due }))
    .sort((a, b) => b.amt - a.amt);

  const out = [];
  let i = 0;
  let j = 0;
  let guard = 0;
  while (i < debtors.length && j < creditors.length && guard++ < 200) {
    const amt = Math.min(debtors[i].amt, creditors[j].amt);
    if (amt > 0.5) out.push({ from: debtors[i], to: creditors[j], amount: amt });
    debtors[i].amt -= amt;
    creditors[j].amt -= amt;
    if (debtors[i].amt <= 0.5) i++;
    if (creditors[j].amt <= 0.5) j++;
  }
  return out;
}

/** Fixed monthly charges — read from the month's own snapshot, else the member default. */
export function getFixed(db, monthKey, member) {
  const f = peekMonth(db, monthKey).fixed[member.id] || {};
  return {
    rent: Number(f.rent ?? member.rent ?? 0),
    bua: Number(f.bua ?? member.bua ?? 0)
  };
}

export function setFixed(db, monthKey, memberId, patch) {
  const month = ensureMonth(db, monthKey);
  month.fixed[memberId] = { ...(month.fixed[memberId] || {}), ...patch };
  return month.fixed[memberId];
}

/* ---------------- meal manager duty ---------------- */

/** Append-only log; the manager on a date is the latest entry starting on or before it. */
export function managerOn(db, dateISO) {
  const log = (db.duty || []).filter((d) => d.from <= dateISO).sort((a, b) => a.from.localeCompare(b.from));
  const last = log[log.length - 1];
  return last ? memberById(db, last.memberId) : null;
}

export function currentDuty(db, dateISO) {
  const log = (db.duty || []).slice().sort((a, b) => a.from.localeCompare(b.from));
  const idx = log.reduce((acc, d, i) => (d.from <= dateISO ? i : acc), -1);
  if (idx < 0) return null;
  return { ...log[idx], next: log[idx + 1] || null };
}

export function suggestNextManager(db) {
  const order = (db.rotationOrder || []).length
    ? db.rotationOrder
    : activeMembers(db).map((m) => m.id);
  const current = (db.duty || []).slice().sort((a, b) => a.from.localeCompare(b.from)).pop();
  const eligible = order.filter((id) => {
    const m = memberById(db, id);
    return m && m.active && !m.skipDuty;
  });
  if (!eligible.length) return null;
  if (!current) return eligible[0];
  const i = eligible.indexOf(current.memberId);
  return eligible[(i + 1) % eligible.length];
}

/* ---------------- meal helpers ---------------- */

export function mealFor(month, dateISO, memberId) {
  const e = month.meals.find((m) => m.date === dateISO && m.memberId === memberId);
  return e ? Number(e.count || 0) : 0;
}

export function dayConfirmed(month, dateISO) {
  return !!month.mealDays[dateISO];
}

export function memberMealTotal(month, memberId) {
  return month.meals.filter((m) => m.memberId === memberId).reduce((s, m) => s + Number(m.count || 0), 0);
}

export function allMealTotal(month) {
  return month.meals.reduce((s, m) => s + Number(m.count || 0), 0);
}

/* ---------------- backup ---------------- */

function download(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportDB(db, stamp) {
  download(db, `mess-hisab-backup-${stamp}.json`);
}

export function exportMonth(db, monthKey) {
  download({ monthKey, members: db.members, month: db.months[monthKey] }, `mess-hisab-${monthKey}.json`);
}

export function importFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export { monthOf };
