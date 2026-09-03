# Steptember TDC Competition

A head-to-head scoreboard for three TDC Steptember teams, running two challenges to the end of
September 2026:

1. **Most steps** by 30 September
2. **Most money raised** by 30 September

The teams: **Walkoholics**, **Finding Our Footing**, and **Escalated to the Stepping Committee**.

Every participant is clickable — their profile shows daily average, progress against their own step
target, a projection for the end of the month, how many steps a day they need from here, their share
of the team's total, and more.

It is a static site: plain HTML, CSS and JavaScript, no build step and no dependencies.

## Running it locally

The page reads `data/teams.json` over `fetch`, so it needs to be served over HTTP — opening
`index.html` straight off disk will show a load error rather than the scoreboard.

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Where the numbers come from

`data/teams.json` is the single source of truth for the site. `scripts/fetch-steptember.mjs` fills it
in by reading each team's public Steptember page.

```sh
node scripts/fetch-steptember.mjs --dry-run   # report what would change, write nothing
node scripts/fetch-steptember.mjs             # update data/teams.json and data/history.json
```

Requires Node 20 or newer (it uses the built-in `fetch`). There is nothing to install.

The scraper is deliberately cautious, because it is parsing someone else's HTML:

- If a team's page fails to load or parse, that team keeps the figures already committed and the
  run carries on. The whole run only fails if *every* team was unreachable.
- Members are matched on their Steptember profile slug, so renaming a profile doesn't create a
  duplicate.
- `data/history.json` gets one dated snapshot per day, which is what makes "best day" and "latest
  day" possible — Steptember itself only publishes a running total.

### Why a scheduled job rather than a live API

Steptember's `robots.txt` disallows `/api`, and a static page can't read `steptember.org.au` from the
visitor's browser anyway — cross-origin requests to it are blocked. So
`.github/workflows/update-data.yml` runs the scraper every six hours on GitHub's runners, commits any
change to `data/`, and the commit redeploys the site. The page itself only ever reads its own
committed JSON.

### Editing the numbers by hand

Edit `data/teams.json` and commit. Everything on the page — team totals, both rankings, the gaps,
the bars, and every per-member stat — is derived at render time, so one number changing updates the
whole page. Note that the next scheduled scrape will overwrite `steps` and `raised` with whatever is
live on Steptember.

Team display names in `data/teams.json` are ours and are never overwritten by the scraper, so a team
can be labelled here however reads best on the scoreboard.

## Deploying

`.github/workflows/pages.yml` publishes the repo root to GitHub Pages on every push to `main`.

**One-time setup:** in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.
That can't be done from code, and the first deployment won't appear until it's set.

To use a custom domain later, add a `CNAME` file at the repo root containing the domain and point
the DNS at GitHub Pages. No code changes are needed.

## Layout

```
index.html                  page structure
assets/css/styles.css       design tokens, light/dark, responsive layout
assets/js/data.js           loads the JSON and derives every figure shown
assets/js/app.js            renders the hero, standings, team cards and leaderboards
assets/js/member.js         the member profile dialog
assets/js/format.js         number, currency and date formatting
data/teams.json             source of truth: teams, members, steps, raised, targets
data/history.json           dated daily snapshots, appended by the scraper
scripts/fetch-steptember.mjs  the scraper
```

## A note on accuracy

Distances are estimates (0.75 m per step). Projections are a straight line from the current pace and
are labelled as such — early in the month, off a few days of data, they are very rough. Everything
else on the page is either published by Steptember or arithmetic on figures that are.
