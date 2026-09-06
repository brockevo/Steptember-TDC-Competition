/**
 * Reads where our teams and people sit on our organisation's Steptember
 * leaderboard. Our teams are registered under KPMG, so that is the field.
 *
 * Unlike the public team pages, this one needs a session: the leaderboard
 * redirects to the login when signed out, and the login form is rendered
 * client-side, so there is no form to POST to. Hence a real browser.
 *
 * Two rules govern everything here.
 *
 * 1. **It never destroys data.** A failed login, a moved selector or an empty
 *    table leaves the committed placements exactly as they are and says why.
 *    The step and donation refresh is what the site actually depends on; this
 *    is a garnish, and a broken garnish must not cost us the meal.
 *
 * 2. **It only ever writes our own rows.** The leaderboard lists every team and
 *    participant in the organisation. We take a rank and a field size for our
 *    three teams and twelve people, and nothing else — enough to say where we
 *    sit without republishing anyone else's figures.
 *
 * Credentials come from the environment and are never logged, never written to
 * `data/`, and never reach the browser bundle.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEAMS_FILE = resolve(ROOT, 'data/teams.json');
const PLACEMENTS_FILE = resolve(ROOT, 'data/placements.json');

const ORIGIN = 'https://www.steptember.org.au';

/**
 * Our teams are registered under the KPMG organisation, so KPMG's page is the
 * field we are ranked in. Overridable in case that ever changes.
 */
const ORG = process.env.STEPTEMBER_ORG ?? 'kpmg';

/** Where the login is driven from; also the first place we look for a ladder. */
const LOGIN_URL = `${ORIGIN}/login/view/org-leaderboard`;

/**
 * Pages that might carry the organisation ladder, tried in order until one
 * yields rows we recognise.
 *
 * A list rather than a single URL because the first attempt landed somewhere
 * with only three fundraiser links on it — the org's own page among them — so
 * the ladder plainly lives somewhere other than where I first guessed, and one
 * run that tries several is worth more than several runs that each try one.
 */
const CANDIDATE_URLS = [
  `${ORIGIN}/login/view/org-leaderboard`,
  `${ORIGIN}/fundraisers/${ORG}`,
  `${ORIGIN}/fundraisers/${ORG}/leaderboard`,
  `${ORIGIN}/organisations/${ORG}`,
];

const EMAIL = process.env.STEPTEMBER_EMAIL;
const PASSWORD = process.env.STEPTEMBER_PASSWORD;

const NAV_TIMEOUT_MS = 45_000;
const DRY_RUN = process.argv.includes('--dry-run');

/* ----------------------------------------------------------------- matching -- */

/** Lowercase alphanumerics only, so "Finding Our Footing!" matches its slug. */
const normalise = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The trailing path segment of a fundraiser URL, which is the Steptember slug. */
export function slugFromUrl(url) {
  try {
    return normalise(new URL(url, ORIGIN).pathname.split('/').filter(Boolean).at(-1));
  } catch {
    return '';
  }
}

/**
 * Finds our entity in a scraped leaderboard row.
 *
 * Slug first, because a display name can be edited on Steptember at any time
 * and would silently orphan the row; the name is the fallback for a table that
 * doesn't link out.
 */
export function matchRow(row, entities) {
  const rowSlug = slugFromUrl(row.href);
  if (rowSlug) {
    const bySlug = entities.find(
      (entity) => slugFromUrl(entity.url) === rowSlug || normalise(entity.id) === rowSlug,
    );
    if (bySlug) return bySlug;
  }
  const rowName = normalise(row.name);
  return entities.find((entity) => normalise(entity.name) === rowName) ?? null;
}

/* ------------------------------------------------------------------ scraping -- */

/**
 * Every plausible leaderboard row on the page, grouped into lists.
 *
 * Deliberately markup-agnostic. The first attempt assumed `<table>` and found
 * none — the real leaderboard is built from something else — so this anchors on
 * the one thing a leaderboard row must contain: a link to the fundraiser it
 * ranks. From each link it climbs to the nearest ancestor that also carries a
 * figure, and that ancestor is the row.
 *
 * Rows are grouped by their shared parent, which is what a list is regardless of
 * whether it is a `<table>`, a `<ul>` or a stack of `<div>`s. The caller uses
 * those groups the way it would have used separate tables, so the team ladder
 * and the participant ladder keep their own field sizes.
 */
export function extractRows() {
  const money = (text) => {
    const match = text.match(/\$\s*([\d,]+(?:\.\d+)?)/);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  };

  /**
   * The largest bare number in the row, once dollar amounts are removed.
   *
   * Bounded by lookaround rather than `\b`, because inline markup means a row's
   * text often has no space between the name and the figure — "Jules
   * Rivera142,900". A leading `\b` finds no boundary between "a" and "1" there
   * and matches from after the comma instead, silently turning 142,900 into
   * 900 and scrambling the ranking. Largest wins so a leading position number
   * or a member count cannot be mistaken for a step total.
   */
  const steps = (text) => {
    const withoutMoney = text.replace(/\$\s*[\d,]+(?:\.\d+)?/g, ' ');
    const found = withoutMoney.match(/(?<![\d,.])(?:\d{1,3}(?:,\d{3})+|\d{3,})(?![\d,.])/g);
    return found ? Math.max(...found.map((value) => Number(value.replace(/,/g, '')))) : null;
  };

  /** A row's text should be one entry, not half the page. */
  const MAX_ROW_TEXT = 400;
  const MAX_CLIMB = 6;

  const groups = new Map();

  for (const link of document.querySelectorAll('a[href*="/fundraisers/"]')) {
    const name = (link.innerText || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;

    // Climb to the smallest ancestor that carries both the name and a figure.
    let row = link;
    let text = '';
    let hops = 0;
    while (row && hops <= MAX_CLIMB) {
      text = (row.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length <= MAX_ROW_TEXT && /\d[\d,]{2,}|\$/.test(text)) break;
      if (text.length > MAX_ROW_TEXT) {
        row = null;
        break;
      }
      row = row.parentElement;
      hops += 1;
    }
    if (!row || !text) continue;

    const parent = row.parentElement;
    if (!parent) continue;
    if (!groups.has(parent)) groups.set(parent, []);
    // One row per fundraiser: a card linking to the same person twice (photo
    // and name, say) would otherwise be counted as two entries in the field.
    const bucket = groups.get(parent);
    const href = link.getAttribute('href') ?? '';
    if (bucket.some((existing) => existing.href === href)) continue;
    bucket.push({ name, href, steps: steps(text), raised: money(text) });
  }

  // Two rows do not make a leaderboard; dropping singletons keeps stray
  // "view profile" links elsewhere on the page out of the field size.
  return [...groups.values()].filter((rows) => rows.length >= 3);
}

/**
 * Ranks a set of rows on one measure and returns the placements of ours.
 *
 * Ranked here rather than trusting a printed position: the page may be sorted
 * by steps while we also want the donation order, and a rank we computed from
 * the whole field is one we can explain.
 */
export function placeOurs(rows, entities, measure) {
  const ordered = rows
    .filter((row) => Number.isFinite(row[measure]))
    .sort((a, b) => b[measure] - a[measure]);
  if (ordered.length === 0) return new Map();

  const placements = new Map();
  let rank = 0;
  let previousValue = null;

  for (const [index, row] of ordered.entries()) {
    // Ties share the better rank, the same convention as the on-page ladders.
    if (row[measure] !== previousValue) {
      rank = index + 1;
      previousValue = row[measure];
    }
    const ours = matchRow(row, entities);
    if (ours) placements.set(ours.id, { rank, of: ordered.length });
  }

  return placements;
}

/* ---------------------------------------------------------------------- main -- */

/** Turns {steps: Map, raised: Map} into {<id>: {steps, raised}} for the file. */
export function byEntity(placementsByMeasure) {
  const out = {};
  for (const [measure, placements] of Object.entries(placementsByMeasure)) {
    for (const [id, placement] of placements) {
      out[id] = { ...(out[id] ?? {}), [measure]: placement };
    }
  }
  return out;
}

/**
 * Opens one candidate page and reports what it holds.
 *
 * Never throws: a candidate that 404s, renders nothing, or holds a different
 * page entirely is an answer, not a failure — the caller tries the next one.
 * It also waits for content rather than gating on it, since the ladder is
 * rendered client-side and the first attempt timed out on a `visible` check
 * against links that were present but hidden.
 */
async function readLadder(page, url, teams, members) {
  const empty = { steps: new Map(), raised: new Map() };
  const nothing = {
    teamPlacements: empty,
    memberPlacements: empty,
    matched: 0,
    tables: [],
    groups: [],
    shape: { links: 0, tables: 0, headings: '' },
  };

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
  } catch (error) {
    return nothing;
  }

  // Attached rather than visible, and non-fatal: the point is to look, not to
  // insist. A page that never grows a ladder simply reports none.
  await page
    .waitForSelector('a[href*="/fundraisers/"]', { state: 'attached', timeout: 15_000 })
    .catch(() => {});

  const shape = await page.evaluate(() => ({
    links: document.querySelectorAll('a[href*="/fundraisers/"]').length,
    tables: document.querySelectorAll('table').length,
    // The organisation's own headings, which describe the page rather than
    // anyone on it — safe to print, and the quickest way to see where we are.
    headings: [...document.querySelectorAll('h1, h2')]
      .map((h) => (h.innerText || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 6)
      .join(' / '),
  }));

  const tables = await page.evaluate(extractRows);

  const teamPlacements = { steps: new Map(), raised: new Map() };
  const memberPlacements = { steps: new Map(), raised: new Map() };
  for (const rows of tables) {
    for (const measure of ['steps', 'raised']) {
      const forTeams = placeOurs(rows, teams, measure);
      if (forTeams.size > teamPlacements[measure].size) teamPlacements[measure] = forTeams;
      const forMembers = placeOurs(rows, members, measure);
      if (forMembers.size > memberPlacements[measure].size) memberPlacements[measure] = forMembers;
    }
  }

  return {
    teamPlacements,
    memberPlacements,
    matched:
      teamPlacements.steps.size + teamPlacements.raised.size +
      memberPlacements.steps.size + memberPlacements.raised.size,
    tables,
    groups: tables.map((rows) => rows.length),
    shape,
  };
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error(
      'STEPTEMBER_EMAIL and STEPTEMBER_PASSWORD are not set — leaving the committed placements untouched.',
    );
    process.exit(1);
  }

  const teamsData = JSON.parse(await readFile(TEAMS_FILE, 'utf8'));
  const teams = teamsData.teams;
  const members = teams.flatMap((team) => team.members);
  const previous = await readFile(PLACEMENTS_FILE, 'utf8').catch(() => null);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ userAgent: undefined });
  page.setDefaultTimeout(NAV_TIMEOUT_MS);

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

    // The login is a client-rendered overlay, so wait for the field itself
    // rather than for a URL or a form element that may never exist.
    await page.waitForSelector('input[type="password"]', { timeout: NAV_TIMEOUT_MS });
    await page.fill('input[type="email"], input[name*="mail" i]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      page.click('button[type="submit"], input[type="submit"]'),
    ]);

    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    if (await page.$('input[type="password"]')) {
      throw new Error('still on the login after signing in — credentials rejected or the flow changed');
    }
    console.log('Signed in.');

    let teamPlacements = { steps: new Map(), raised: new Map() };
    let memberPlacements = { steps: new Map(), raised: new Map() };
    let matched = 0;
    let tables = [];

    for (const url of CANDIDATE_URLS) {
      const attempt = await readLadder(page, url, teams, members);
      // Structure only: counts, the page's own title and headings. Never
      // another participant's name or figures — this log is public.
      console.log(
        `  ${url.replace(ORIGIN, '')} → ${attempt.shape.links} fundraiser links, ` +
          `${attempt.shape.tables} tables, lists [${attempt.groups.join(', ') || 'none'}], ` +
          `matched ${attempt.matched} of ours` +
          (attempt.shape.headings ? ` · headings: ${attempt.shape.headings}` : ''),
      );
      if (attempt.matched > matched) {
        ({ teamPlacements, memberPlacements, matched, tables } = attempt);
      }
      // Every team and every member on one page is as good as it gets.
      if (matched >= teams.length + members.length) break;
    }

    if (matched === 0) {
      throw new Error(
        `none of the ${CANDIDATE_URLS.length} candidate pages carried a ladder with ` +
          `our ${teams.length} teams or ${members.length} members on it`,
      );
    }

    const next = {
      updated: new Date().toISOString(),
      scope: ORG,
      teams: byEntity(teamPlacements),
      members: byEntity(memberPlacements),
    };
    const serialised = `${JSON.stringify(next, null, 2)}\n`;

    console.log(
      `Matched ${teamPlacements.steps.size}/${teams.length} teams and ` +
        `${memberPlacements.steps.size}/${members.length} members on steps, ` +
        `${teamPlacements.raised.size} and ${memberPlacements.raised.size} on fundraising.`,
    );

    if (DRY_RUN) {
      console.log('[dry run] nothing written');
      console.log(serialised);
      return;
    }

    // Ignore the timestamp when deciding whether anything moved, so an
    // unchanged leaderboard doesn't churn a commit every two hours.
    const withoutStamp = (text) => {
      try {
        const { updated, ...rest } = JSON.parse(text);
        return JSON.stringify(rest);
      } catch {
        return null;
      }
    };
    if (previous && withoutStamp(previous) === withoutStamp(serialised)) {
      console.log('No change in the placements.');
      return;
    }

    await writeFile(PLACEMENTS_FILE, serialised);
    console.log('Wrote data/placements.json');
  } finally {
    await browser.close();
  }
}

// Only when run as a script. Exporting the parsing above means a test can
// import this file, and importing must not start a browser and a login.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
  // Deliberately the message only: an error from the browser can carry the page
  // it was on, and that page has our credentials typed into it.
    console.error(`Could not read the ${ORG.toUpperCase()} leaderboard: ${error.message}`);
    console.error('Leaving the committed placements untouched.');
    process.exit(1);
  });
}
