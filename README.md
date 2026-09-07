# Mess Hisab 🍽️

Shared-house (mess) bazar, meal and expense tracker for a few roommates. Free static site on **GitHub Pages**, with live data sync across everyone's phones via **Firebase Firestore** (Spark/free plan).

## The hisab it implements

Nobody deposits money anywhere. There is no fund and no treasurer — each person just spends from their own pocket during the month, and everything settles at month end.

| Money | How it splits | Where it's entered |
|---|---|---|
| **বাজার** (groceries) | by **meals eaten** — `mealRate = totalBazar ÷ totalMeals` | খরচ page, daily |
| **বিল** (internet, electricity, water, gas) | **equally per head** | খরচ page, as bills arrive |
| **ভাড়া + বুয়া** | fixed per member, goes to the landlord and the maid | হিসাব page, monthly |

```
paid[m]        = every entry recorded in m's name        ← computed, never typed
perHeadCost[m] = ownMeals × mealRate + billsPerHead
due[m]         = perHeadCost[m] − paid[m]                 +ve owes · −ve is owed
```

Because everyone pays out of their own pocket, **the dues always sum to zero** — a closed system. So the app can state exactly who hands cash to whom at month end, in as few handovers as possible, and a non-zero sum is a reliable signal that an entry is wrong.

**An entry belongs to whose money it was, not who walked to the market.** If the meal manager hands someone ৳500 and they shop, the entry is ৳500 in the *manager's* name. That's why the payer field reads **কার টাকায়**, and why it's always visible rather than a hidden default.

A member can be marked **not in meal** — they pay only rent and are left out of the bazar/bill split.

### The meal manager

One member is the meal manager at a time, and the role rotates weekly. They normally do the bazar out of their own pocket and enter everyone's daily meal counts. The app tracks whose week it is (`duty`, an append-only log — every swap, stand-in or short week is just one more row) but **never blocks anyone**: any member can add a cost or fill in a day, and any member can set who the manager is. No naming-and-shaming for a missed handover.

## Pages

- **আজ** — the landing screen and 95% of daily use. Whose duty it is, your own running numbers, today's meal steppers (pre-filled from the last confirmed day, so a normal day is one tap), a warning listing days nobody filled in, and buttons to add a bazar or a bill.
- **খরচ** — বাজার and বিল in one list, colour-coded, with two separate totals each labelled with its own split rule. Deliberately no combined grand total: the two pools divide by different rules, and one big number invites the wrong arithmetic.
- **হিসাব** — meal rate, bills per head, per-member breakdown you can expand down to the arithmetic, **কে কাকে দেবে**, and the ভাড়া/বুয়া section with this month's collector and a tick-list of who has handed their share over.
- **আরও** — members, this phone's identity/theme, manager history, backup, reset.
- The full-month meal grid lives at `#/grid`, reached from আজ — for corrections and month-end review, not daily entry.

## Data shape

```json
{
  "rev": 42,
  "members": [{ "id": "m1", "name": "Oashiur", "active": true, "inMeal": true, "rent": 4400, "bua": 1100 }],
  "duty": [{ "id": "d1", "from": "2026-09-01", "memberId": "m1" }],
  "rotationOrder": ["m1", "m2"],
  "months": {
    "2026-09": {
      "bazar":  [{ "id": "b1", "date": "2026-09-05", "memberId": "m1", "amount": 67, "details": "Tomato + Potol" }],
      "others": [{ "id": "o1", "type": "নেট", "date": "2026-09-01", "memberId": "m1", "amount": 600 }],
      "meals":  [{ "id": "me1", "date": "2026-09-01", "memberId": "m1", "count": 1 }],
      "mealDays": { "2026-09-01": true },
      "fixed":  { "m1": { "rent": 4400, "bua": 1100 } },
      "collector": "m2",
      "handedOver": { "m1": true }
    }
  }
}
```

`mealDays` records that a day was actually filled in — without it, "everyone ate nothing" and "nobody entered this day" look identical, and a missing day silently skews the meal rate. `fixed` snapshots each month's rent/bua so changing a member's rent later doesn't rewrite settled months.

**Per-device, in `localStorage` and never shared:** who holds this phone (`mess.me`), the month being viewed (`mess.month`), theme, sidebar state. These must not live in the shared document — otherwise one person checking last month drags everyone into it.

### Concurrency

The whole document is written at once, so writes are debounced (250ms), `rev` is bumped at mutation time, and incoming snapshots are ignored while local work is unflushed. Fast entry is therefore safe. Two people editing in the same second still resolves last-write-wins at the document level — fine for a household, but don't expect merge semantics.

## ⚠️ Firestore security rules (once)

Test-mode rules expire after 30 days and then lock everyone out. In the [Firebase Console](https://console.firebase.google.com) → **Firestore Database → Rules**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /mess/{document=**} {
      allow read, write: if true;
    }
  }
}
```

> There's no login by design — anyone with the link can read and write, the same trust model as a shared spreadsheet link. Fine for a mess; don't put anything more sensitive in it.

## Running locally

Plain HTML/CSS/JS, no build step, but it does need a server (ES modules) and internet (Firestore):

```bash
cd mess-hisab
node _devserver.cjs
# http://localhost:8099
```

`python -m http.server 8080` works too.

## Deploying

Push to a GitHub repo, then **Settings → Pages** → deploy from `main` / root. Live at `https://<username>.github.io/<repo>/`.

## Backup

**আরও → ব্যাকআপ → ⬇ সব** downloads the whole database as JSON. Keep it somewhere private, not in this public repo. Importing overwrites the live document for everyone.

## Folder structure

```
mess-hisab/
├── index.html
├── css/style.css
├── js/
│   ├── firebase-init.js   Firestore setup + offline persistence
│   ├── dates.js           local-time date helpers (never UTC)
│   ├── store.js           sync, the hisab math, settlement, backup
│   ├── ui.js              avatars, money formatting, modal, toast
│   └── app.js             routing, views, event handling
├── data/seed.json         empty template for a brand-new database
└── README.md
```
