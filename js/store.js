import { dbDocRef, setDoc, onSnapshot } from './firebase-init.js';

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
        // hasPendingWrites = this snapshot is the local echo of our own
        // not-yet-acked write, so our in-memory copy is at least as new.
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

/* ---------------- shape helpers ---------------- */

const EMPTY_MONTH = () => ({ bazar: [], others: [], meals: [], deposits: {}, fixed: {} });

/** Fills in missing arrays and migrates the older single-`costs` shape. */
function normalizeMonth(month) {
  if (!month) return EMPTY_MONTH();
  if (month.costs && !month.bazar) {
    month.bazar = month.costs
      .filter((c) => c.category === 'bazar')
      .map((c) => ({ id: c.id, date: c.date, memberId: c.memberId, amount: c.amount, details: c.details }));
    month.others = month.costs
      .filter((c) => c.category !== 'bazar')
      .map((c) => ({
        id: c.id,
        date: c.date,
        memberId: c.memberId,
        amount: c.amount,
        type: c.category ? c.category.charAt(0).toUpperCase() + c.category.slice(1) : 'Other',
        details: c.details
      }));
    delete month.costs;
  }
  month.bazar = month.bazar || [];
  month.others = month.others || [];
  month.meals = month.meals || [];
  month.deposits = month.deposits || {};
  month.fixed = month.fixed || {};
  return month;
}

export function ensureMonth(db, monthKey) {
  if (!db.months[monthKey]) db.months[monthKey] = EMPTY_MONTH();
  return normalizeMonth(db.months[monthKey]);
}

export function activeMembers(db) {
  return db.members.filter((m) => m.active);
}

/** Members who eat from the mess — they share bazar + extra cost. */
export function mealMembers(db) {
  return db.members.filter((m) => m.active && m.inMeal !== false);
}

export function memberName(db, id) {
  const m = db.members.find((x) => x.id === id);
  return m ? m.name : 'Unknown';
}

/* ---------------- the hisab ---------------- */

/**
 * The daily-running calculation:
 *   mealRate      = totalBazar / totalMeals
 *   othersPerHead = extraCost / (number of meal members)
 *   perHeadCost   = ownMeals * mealRate + othersPerHead
 *   due           = perHeadCost - deposit   (+ve owes the mess, -ve gets money back)
 */
export function computeSummary(db, monthKey) {
  const month = normalizeMonth(db.months[monthKey]);
  const eaters = mealMembers(db);

  const totalBazar = month.bazar.reduce((s, b) => s + Number(b.amount || 0), 0);
  const extraCost = month.others.reduce((s, o) => s + Number(o.amount || 0), 0);
  const totalCost = totalBazar + extraCost;

  const mealTotals = {};
  eaters.forEach((m) => { mealTotals[m.id] = 0; });
  month.meals.forEach((me) => {
    if (mealTotals[me.memberId] !== undefined) mealTotals[me.memberId] += Number(me.count || 0);
  });
  const totalMeals = Object.values(mealTotals).reduce((a, b) => a + b, 0);

  const mealRate = totalMeals > 0 ? totalBazar / totalMeals : 0;
  const othersPerHead = eaters.length ? extraCost / eaters.length : 0;

  const rows = eaters.map((m) => {
    const meals = mealTotals[m.id] || 0;
    const mealCost = meals * mealRate;
    const perHeadCost = mealCost + othersPerHead;
    const deposit = Number(month.deposits[m.id] || 0);
    return { member: m, meals, mealCost, othersShare: othersPerHead, perHeadCost, deposit, due: perHeadCost - deposit };
  });

  const byType = { Bazar: totalBazar };
  month.others.forEach((o) => {
    const t = o.type || 'Other';
    byType[t] = (byType[t] || 0) + Number(o.amount || 0);
  });

  const totalDeposit = rows.reduce((s, r) => s + r.deposit, 0);

  return { totalBazar, extraCost, totalCost, totalMeals, mealRate, othersPerHead, totalDeposit, rows, byType, eaters };
}

/**
 * The month-end settlement: meal due + that member's fixed rent + bua bill.
 * Rent/bua come from the month's own snapshot, falling back to the member's default.
 */
export function computeSettlement(db, monthKey) {
  const summary = computeSummary(db, monthKey);
  const month = normalizeMonth(db.months[monthKey]);

  const rows = activeMembers(db).map((m) => {
    const sRow = summary.rows.find((r) => r.member.id === m.id);
    const meal = sRow ? sRow.due : 0;
    const fixed = month.fixed[m.id] || {};
    const rent = Number(fixed.rent ?? m.rent ?? 0);
    const bua = Number(fixed.bua ?? m.bua ?? 0);
    return { member: m, meal, rent, bua, total: meal + rent + bua, inMeal: !!sRow };
  });

  const totals = rows.reduce(
    (acc, r) => ({ meal: acc.meal + r.meal, rent: acc.rent + r.rent, bua: acc.bua + r.bua, total: acc.total + r.total }),
    { meal: 0, rent: 0, bua: 0, total: 0 }
  );

  return { rows, totals, summary };
}

export function getFixed(db, monthKey, member) {
  const month = ensureMonth(db, monthKey);
  const fixed = month.fixed[member.id] || {};
  return {
    rent: Number(fixed.rent ?? member.rent ?? 0),
    bua: Number(fixed.bua ?? member.bua ?? 0)
  };
}

export function setFixed(db, monthKey, memberId, patch) {
  const month = ensureMonth(db, monthKey);
  month.fixed[memberId] = { ...(month.fixed[memberId] || {}), ...patch };
  return month.fixed[memberId];
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

export function exportDB(db) {
  download(db, `mess-hisab-backup-${new Date().toISOString().slice(0, 10)}.json`);
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
