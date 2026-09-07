# Mess Hisab 🍽️

Shared-house (mess) bazar, meal & expense tracker — free static web app hosted on **GitHub Pages**, with live data sync across every device via **Firebase Firestore** (also free, on the Spark plan).

## Features

- **Members** — add/edit/deactivate mess members anytime
- **Bazar & Costs** — log bazar purchases plus utility/rent/other costs, filterable by category
- **Meals** — spreadsheet-style daily grid to log each member's meal count
- **Dashboard** — stat cards, expense breakdown (doughnut chart), deposit-vs-cost (bar chart), per-member due/advance badges, recent activity feed
- **Reports** — full monthly summary table, deposit & rent editor
- **Live multi-device sync** — a phone, a laptop, anyone's browser: everyone sees the same data, updated the moment anyone changes anything (real-time, via Firestore)
- **Export / Import** — download the whole database or a single month as JSON, for backups or moving data around
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
  "members": [ { "id": "m1", "name": "Oashiur", "active": true, "joinDate": "2026-06-01" } ],
  "months": {
    "2026-08": {
      "costs": [ { "id": "c1", "date": "2026-08-02", "memberId": "m1", "category": "bazar", "amount": 2671, "details": "..." } ],
      "meals": [ { "id": "me1", "date": "2026-08-01", "memberId": "m1", "count": 2 } ],
      "deposits": { "m1": 2751 },
      "rent": { "total": 0, "splitEqually": true }
    }
  },
  "settings": { "currentMonth": "2026-08", "theme": "light" }
}
```

Due/advance per member = `deposit − (mealRate × meals + rentShare)`, where `mealRate = totalCost / totalMeals` for that month.

`data/seed.json` is only used the very first time the Firestore document doesn't exist yet — it's an empty template on purpose (no real names/amounts committed to this public repo).

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

1. Open **Reports → Backup**.
2. Click **Export All Data** (or **Export This Month**) to download a `.json` file.
3. Keep it somewhere private (personal cloud drive, etc. — not this public repo).
4. **Import JSON** on the Reports page restores from a backup file — this overwrites the live Firestore document for everyone, so use it deliberately.

## Folder structure

```
mess-hisab/
├── index.html
├── css/style.css
├── js/
│   ├── firebase-init.js   Firebase app + Firestore setup (config, offline persistence)
│   ├── store.js            data layer (Firestore subscribe/save, summary calculations, export/import)
│   ├── ui.js               small UI helpers (avatar colors, money format, modal, toast)
│   ├── charts.js           Chart.js wrappers
│   └── app.js              routing + view rendering + event handling
├── data/seed.json         empty template, only used the very first time the Firestore doc doesn't exist
└── README.md
```
