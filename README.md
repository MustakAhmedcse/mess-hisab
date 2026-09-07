# Mess Hisab 🍽️

Shared-house (mess) bazar, meal & expense tracker — free static web app, no backend, no database server. Runs entirely in the browser and can be hosted for free on **GitHub Pages**.

## Features

- **Members** — add/edit/deactivate mess members anytime
- **Bazar & Costs** — log bazar purchases plus utility/rent/other costs, filterable by category
- **Meals** — spreadsheet-style daily grid to log each member's meal count
- **Dashboard** — stat cards, expense breakdown (doughnut chart), deposit-vs-cost (bar chart), per-member due/advance badges, recent activity feed
- **Reports** — full monthly summary table, deposit & rent editor
- **Export / Import** — download the whole database or a single month as JSON; re-import anytime as backup or to move data to another device
- **Light / Dark mode**, fully responsive (sidebar on desktop, bottom nav on mobile)

## Data model

Everything lives in one JSON object (see `data/seed.json` for the shape), persisted to the browser's `localStorage` under the key `messHisabDB`:

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

> **Note on data:** `data/seed.json` ships empty on purpose — this repo is public, and real member names / bazar amounts / deposits shouldn't live in public git history. The app is a blank template on first load; add your own members, costs, meals, and deposits from the UI. Everything is saved to your browser's `localStorage`, and you can back it up anytime via **Reports → Export All Data** (keep that exported `.json` somewhere private, e.g. a personal cloud drive — not this repo).

## Running locally

No build step needed — it's plain HTML/CSS/JS. Because it uses `fetch()` for the seed file and ES modules, open it through a local server (not `file://`):

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

1. Open **Reports → Backup**.
2. Click **Export All Data** (or **Export This Month**) to download a `.json` file.
3. Commit that file into the repo's `data/` folder (via GitHub web UI, or `git add && git commit && git push`) so it's safely versioned.
4. To restore on another device/browser, open **Reports → Backup → Import JSON** and pick the file.

## Possible future upgrade (not built yet)

A "Save to GitHub" button using the GitHub REST API + a personal access token could commit changes directly from the browser, so multiple members always see the same live data without manual export/import. Ask to add this as a phase 2 if useful.

## Folder structure

```
mess-hisab/
├── index.html
├── css/style.css
├── js/
│   ├── store.js     data layer (load/save, summary calculations, export/import)
│   ├── ui.js         small UI helpers (avatar colors, money format, modal, toast)
│   ├── charts.js      Chart.js wrappers
│   └── app.js         routing + view rendering + event handling
├── data/seed.json    initial data (only used the very first time, before localStorage exists)
└── README.md
```
