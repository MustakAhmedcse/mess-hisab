# Mess Hisab 🍽️

Shared-house (mess) bazar, meal & expense tracker — free static web app hosted on **GitHub Pages**, with live data sync across every device via **Firebase Firestore** (also free, on the Spark plan).

## The hisab it implements

Two pools of money, calculated differently — this mirrors the mess's own spreadsheet:

| | How it's split | Where it's entered |
|---|---|---|
| **Bazar cost** (groceries) | by **meals eaten** — `mealRate = totalBazar ÷ totalMeals` | Bazar Cost page, daily |
| **Others cost** (internet, electricity, water, gas) | **equally per head** — `othersPerHead = extraCost ÷ members` | Others Cost page, as bills come |
| **Rent + Bua** | fixed per member, not shared | Settlement page, once a month |

```
perHeadCost = (own meals × mealRate) + othersPerHead
due         = perHeadCost − deposit          →  +ve owes the mess, −ve gets money back
monthTotal  = due + own rent + own bua        →  what they actually pay at month end
```

A member can be marked **not in meal** (rent-only, like a roommate who doesn't eat from the mess) — they're excluded from the bazar/others split and only appear in the settlement with their rent.

## Features

- **Dashboard** — Total Bazar / Extra Cost / Total Cost / Total Meals, the live **meal rate** and **others per head**, and the full per-head table (deposit, meals, meal cost, others, per head cost, due) — the running hisab, updating as entries come in
- **Bazar Cost** — daily grocery entries: date, who bought, amount, item details
- **Others Cost** — internet / electricity / water / gas bills, typed and split equally
- **Meals** — spreadsheet-style daily grid, one column per member, jumps to today
- **Monthly Settlement** — deposits, each member's fixed rent & bua, and the final `meal + rent + bua = total` table for the month
- **Members** — add/edit/deactivate, set default rent & bua, mark rent-only members
- **Live multi-device sync** — phone, laptop, anyone's browser: everyone sees the same data, updated the moment anyone changes anything
- **Export / Import** — download the whole database or a single month as JSON
- **Light / Dark mode**, fully responsive (sidebar on desktop, bottom nav on mobile)

## How data sync works

All data lives in **one Firestore document** (`mess/data` in the `mess-hisab-3f986` Firebase project). The app subscribes to that document:

- Every device that opens the site gets the current data immediately, and is pushed any change **live** — no refresh needed.
- Every add/edit/delete writes straight back to that same document, so it reaches every other open device within a second or two.
- Firestore's offline persistence is enabled, so the app still works with no internet — changes queue up and sync automatically once you're back online.

This means the earlier "phone vs laptop" problem is solved: there is no longer a separate copy per device/browser — everyone reads and writes the same shared record.

### Data shape

```json
{
  "rev": 42,
  "members": [
    { "id": "m1", "name": "Oashiur", "active": true, "inMeal": true, "rent": 4400, "bua": 1100 }
  ],
  "months": {
    "2026-09": {
      "bazar":  [ { "id": "b1", "date": "2026-09-05", "memberId": "m1", "amount": 67, "details": "Tomato + Potol" } ],
      "others": [ { "id": "o1", "type": "Internet", "date": "2026-09-01", "memberId": "m1", "amount": 600 } ],
      "meals":  [ { "id": "me1", "date": "2026-09-01", "memberId": "m1", "count": 1 } ],
      "deposits": { "m1": 2284 },
      "fixed":    { "m1": { "rent": 4400, "bua": 1100 } }
    }
  },
  "settings": { "currentMonth": "2026-09", "theme": "light" }
}
```

`fixed` snapshots each month's rent/bua so changing a member's rent later doesn't rewrite past months. `rev` is a counter bumped on every write — the app uses it to tell its own echo apart from a genuine update by another device (see below).

`data/seed.json` is only used the very first time the Firestore document doesn't exist — it's an empty template on purpose (no real names/amounts committed to this public repo).

### Concurrency note

The whole document is written at once, so writes are debounced (250ms) and the app ignores snapshots that aren't newer than its own `rev`. That makes fast data entry safe (a burst of meal-cell edits becomes one write and nothing is lost). Two people editing *at the same second* from different devices still resolves last-write-wins at the document level — fine for a household mess, but don't expect merge semantics.

## ⚠️ Firestore security rules (do this once)

The Firestore database was created in **test mode**, which only allows open read/write for 30 days and then locks everything out. Since this app has no login system (by design — anyone with the link can use it, meant for the mess members only), set a rule that stays open indefinitely:

1. Go to the [Firebase Console](https://console.firebase.google.com) → your project → **Firestore Database → Rules**
2. Replace the rules with:
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
3. **Publish**

This keeps the app's data readable/writable only through this specific `mess/data` document path, indefinitely — without it, the app stops syncing after 30 days.

> Because there's no auth, anyone who finds the site URL and knows how to open browser dev tools could technically read or edit the data — same trust model as a shared spreadsheet link. Fine for a household mess; don't put anything more sensitive in it.

## Running locally

No build step needed — it's plain HTML/CSS/JS talking to Firestore over the internet, so you do need an internet connection even locally. Serve the folder (not `file://`, since it uses ES modules):

```bash
cd mess-hisab
python -m http.server 8080
# then open http://localhost:8080
```

No Python? A tiny zero-dependency Node server is included too:

```bash
cd mess-hisab
node _devserver.cjs
# then open http://localhost:8099
```

## Deploying to GitHub Pages (free)

1. Create a new GitHub repo (public is fine — free Pages hosting doesn't require private).
2. Push this `mess-hisab` folder's contents to the repo (root, or a `/docs` folder).
3. Repo **Settings → Pages** → set source to the branch/folder you pushed.
4. Your app will be live at `https://<username>.github.io/<repo>/`.

## Backup workflow

Firestore is the live source of truth now, but it's still worth an occasional backup:

1. Open **Members & Settings → Backup**.
2. Click **Export All Data** (or **Export This Month**) to download a `.json` file.
3. Keep it somewhere private (personal cloud drive, etc. — not this public repo).
4. **Import JSON** restores from a backup file — this overwrites the live Firestore document for everyone, so use it deliberately.

## Folder structure

```
mess-hisab/
├── index.html
├── css/style.css
├── js/
│   ├── firebase-init.js   Firebase app + Firestore setup (config, offline persistence)
│   ├── store.js            data layer (Firestore sync, hisab calculations, export/import)
│   ├── ui.js               small UI helpers (avatar colors, money format, modal, toast)
│   ├── charts.js           Chart.js wrappers
│   └── app.js              routing + view rendering + event handling
├── data/seed.json         empty template, only used the very first time the Firestore doc doesn't exist
└── README.md
```
