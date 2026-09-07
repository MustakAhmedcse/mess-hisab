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
 * any member) sees the same data live. onData fires once immediately (from
 * cache or server) and again whenever anyone changes anything, anywhere.
 */
export function subscribeDB(onData, onError) {
  return onSnapshot(
    dbDocRef,
    async (snap) => {
      if (snap.exists()) {
        onData(snap.data());
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
  setDoc(dbDocRef, db).catch((err) => console.error('Failed to save to Firestore:', err));
}

export async function resetToSeed() {
  const seed = await getSeed();
  await setDoc(dbDocRef, seed);
}

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function ensureMonth(db, monthKey) {
  if (!db.months[monthKey]) {
    db.months[monthKey] = { costs: [], meals: [], deposits: {}, rent: { total: 0, splitEqually: true } };
  }
  if (!db.months[monthKey].rent) {
    db.months[monthKey].rent = { total: 0, splitEqually: true };
  }
  return db.months[monthKey];
}

export function activeMembers(db) {
  return db.members.filter(m => m.active);
}

export function memberName(db, id) {
  const m = db.members.find(x => x.id === id);
  return m ? m.name : 'Unknown';
}

export function computeSummary(db, monthKey) {
  const month = db.months[monthKey] || { costs: [], meals: [], deposits: {}, rent: { total: 0, splitEqually: true } };
  const members = activeMembers(db);

  const totalCost = month.costs.reduce((s, c) => s + Number(c.amount || 0), 0);
  const byCategory = {};
  month.costs.forEach(c => {
    byCategory[c.category] = (byCategory[c.category] || 0) + Number(c.amount || 0);
  });

  const mealTotals = {};
  members.forEach(m => { mealTotals[m.id] = 0; });
  month.meals.forEach(me => {
    mealTotals[me.memberId] = (mealTotals[me.memberId] || 0) + Number(me.count || 0);
  });
  const totalMeals = Object.values(mealTotals).reduce((a, b) => a + b, 0);

  const rentTotal = Number(month.rent?.total || 0);
  const rentShare = members.length ? rentTotal / members.length : 0;

  const mealRate = totalMeals > 0 ? totalCost / totalMeals : 0;

  const rows = members.map(m => {
    const meals = mealTotals[m.id] || 0;
    const deposit = Number(month.deposits[m.id] || 0);
    const mealCost = mealRate * meals;
    const totalOwed = mealCost + rentShare;
    const balance = deposit - totalOwed;
    return { member: m, meals, deposit, mealCost, rentShare, totalOwed, balance };
  });

  return { totalCost, byCategory, totalMeals, mealRate, rentTotal, rentShare, rows };
}

export function exportDB(db) {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mess-hisab-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportMonth(db, monthKey) {
  const month = db.months[monthKey];
  const payload = { monthKey, members: db.members, month };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mess-hisab-${monthKey}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
