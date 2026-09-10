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
export function extractRows(known = []) {
  /**
   * Our own roster, normalised. The page cannot tell us which repeated
   * structure is the ladder, but we know exactly who we are looking for: a set
   * of rows containing "Dionne Marks" is the stepper ladder, and no shape
   * heuristic beats that. Same normalisation as `matchRow` uses, restated here
   * because this function is serialised into the browser and closes over
   * nothing.
   */
  const knownNames = new Set(
    known.map((name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '')),
  );
  const asKey = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

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
  const linked = [...groups.values()].filter((rows) => rows.length >= 3);
  if (linked.length > 0) return linked;

  /* ---- second pass: ladders whose rows are not links --------------------- */

  // The organisation leaderboard names its sections and does not link its rows
  // — the whole page carries three fundraiser links, all of them chrome. So
  // find the ladders by their headings instead, which is what the page itself
  // gives us to work with.
  const LADDER_HEADING = /top\s+(steppers|fundraisers|teams)/i;

  const ladders = [];
  for (const heading of document.querySelectorAll('h1, h2, h3, h4')) {
    if (!LADDER_HEADING.test(heading.innerText || '')) continue;

    // The block after the heading, up to the next heading.
    let block = heading.nextElementSibling;
    while (block && /^H[1-6]$/.test(block.tagName) === false) {
      const rows = rowsWithin(block);
      if (rows.length >= 3) {
        ladders.push(rows);
        break;
      }
      block = block.nextElementSibling;
    }
  }
  return ladders;

  /**
   * The repeated siblings inside a block that each carry a figure.
   *
   * Same idea as the grouping above — a ladder is a set of sibling elements
   * that all look alike — but without needing a link to anchor on. The deepest
   * such set wins, so a wrapper holding one big blob of text loses to the row
   * elements inside it.
   */
  function rowsWithin(block) {
    let best = [];
    let bestScore = -1;

    const consider = (parent) => {
      const children = [...parent.children];
      if (children.length < 3) return;
      const rows = children.map(readRow).filter(Boolean);
      // Most of the siblings must look like rows, or this is not a ladder.
      if (rows.length < 3 || rows.length < children.length - 1) return;

      // Scored, not last-one-wins. The previous version assigned `best` on
      // every qualifying set while walking descendants depth-first, so the
      // deepest match won by arriving last. On the live board each row carries
      // its own little strip of figures, and that strip qualifies — so the real
      // ladder was being read, then thrown away for three cells named "avg".
      // Nothing matched, forty pages were walked for nothing, and the log
      // looked healthy throughout.
      const hits = rows.filter((row) => knownNames.has(asKey(row.name))).length;
      const score = hits > 0 ? 1e6 + hits * 1000 + rows.length : rows.length;
      if (score > bestScore) {
        bestScore = score;
        best = rows;
      }
    };

    consider(block);
    for (const descendant of block.querySelectorAll('*')) consider(descendant);
    return best;
  }

  /**
   * One row, read from its own cells wherever it has them.
   *
   * Cells first, because a row's text is concatenated by the time innerText has
   * run and the pieces can corrupt each other. A name ending in a digit is the
   * case that matters: "Person 01" beside "147,300" reads as "1Person 01147,300",
   * where "147,300" has a digit immediately before it and no number can be
   * safely picked out at all. That row is then dropped, silently shrinking the
   * field and shifting every rank below it — the sort of failure that leaves a
   * plausible-looking result. Reading the cells separately avoids the whole
   * problem; the text fallback is only for rows that have no inner structure.
   */
  function readRow(element) {
    const whole = (element.innerText || '').replace(/\s+/g, ' ').trim();
    if (!whole || whole.length > MAX_ROW_TEXT) return null;

    const cells = [...element.children]
      .map((cell) => (cell.innerText || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    if (cells.length >= 2) {
      // A leading bare integer is the printed position, not a figure. Dropping
      // it first matters on the fundraiser ladder, where the only plain number
      // in the row is that position — "1 · Jules Rivera · $400.00" — and
      // keeping it would record one step for everyone on the board.
      const body = /^\d{1,4}$/.test(cells[0]) ? cells.slice(1) : cells;

      const counts = body.filter((cell) => /^\d[\d,]*$/.test(cell));
      const monies = body.filter((cell) => /^\$\s*[\d,]+(?:\.\d+)?$/.test(cell));
      const value = counts.length
        ? Math.max(...counts.map((cell) => Number(cell.replace(/,/g, ''))))
        : null;
      const amount = monies.length ? money(monies[0]) : null;
      if (value === null && amount === null) return null;

      const name = body.find((cell) => /[A-Za-z]/.test(cell) && !monies.includes(cell));
      if (!name) return null;
      return { name, href: '', steps: value, raised: amount };
    }

    const value = steps(whole);
    const amount = money(whole);
    if (value === null && amount === null) return null;
    return { name: nameFrom(whole, value, amount), href: '', steps: value, raised: amount };
  }

  /**
   * The name left over once a row's figures and leading position are removed.
   * Only used for rows with no cells of their own to read.
   */
  function nameFrom(text, value, amount) {
    let name = text;
    if (amount !== null) name = name.replace(/\$\s*[\d,]+(?:\.\d+)?/g, ' ');
    if (value !== null) {
      name = name.replace(
        new RegExp(`(?<![\\d,.])${value.toLocaleString('en-AU')}(?![\\d,.])`, 'g'),
        ' ',
      );
      name = name.replace(new RegExp(`(?<![\\d,.])${value}(?![\\d,.])`, 'g'), ' ');
    }
    // The leading position number, and any stray unit words. No whitespace is
    // required after the position: inline spans mean innerText runs it straight
    // into the name — "1Jules Rivera" — and a name left with that prefix
    // normalises to "1julesrivera" and matches nobody. The lookahead keeps it
    // from biting a name that legitimately starts with a digit.
    return name
      .replace(/^\s*\d{1,4}[.)]?\s*(?=[A-Za-z])/, '')
      .replace(/\b(steps?|raised|km)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

/**
 * The organisation-wide totals on the page: how many are taking part, how many
 * teams, and the combined steps and money.
 *
 * These are what make "ahead of 82% of KPMG" and "against the org's average"
 * possible. They are **aggregates, not people** — four numbers describing the
 * whole field, with nobody's individual row among them.
 *
 * Read by pairing a number with a label word near it, because that is how the
 * page presents them: a value and a caption, in whatever element the design
 * happened to use. Anything not found is simply absent, and every figure built
 * on it disappears with it rather than being estimated.
 */
export function extractAggregates() {
  // No leading \b on any of these. Inline markup runs the value into its
  // caption — "1,750,420steps" — and a boundary between "0" and "s" does not
  // exist, so requiring one finds nothing at all. The trailing boundary stays,
  // which is what keeps "steps" from matching inside "steppers".
  const LABELS = [
    ['participants', /(participants?|steppers?|walkers?|members?|people)\b/i],
    ['teams', /teams?\b/i],
    ['steps', /steps?\b/i],
    ['raised', /(raised|donations?|fundraised)\b/i],
  ];

  const found = {};

  for (const element of document.querySelectorAll('*')) {
    const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
    // Short enough to be a stat block rather than a section of the page.
    if (!text || text.length > 60) continue;

    const money = text.match(/\$\s*([\d,]+(?:\.\d+)?)/g);
    const bare = text.match(/(?<![\d,.$])(?:\d{1,3}(?:,\d{3})+|\d+)(?![\d,.])/g);
    const tokens = (money?.length ?? 0) + (bare?.length ?? 0);

    // Exactly one number, or this is a container rather than a stat block. The
    // wrapper around four stats reads "1,750,420steps$12,480raised191participants
    // 52teams", carries every label at once, and would hand its first number to
    // all of them.
    if (tokens !== 1) continue;

    for (const [key, pattern] of LABELS) {
      if (!pattern.test(text)) continue;
      // "Raised" is the only one written as currency; the rest are counts.
      const raw =
        key === 'raised'
          ? money?.[0]?.replace(/[$\s]/g, '')
          : bare?.[0];
      if (!raw) continue;
      const value = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(value) || value <= 0) continue;
      // An organisation has hundreds of people, not hundreds of thousands. The
      // last run read participants=467221 for a field of 191 — almost certainly
      // a national counter sitting on the same page. A figure that large is not
      // ours, and guessing would make every average wrong.
      if ((key === 'participants' || key === 'teams') && value > 100_000) continue;
      // The largest wins: an organisation total is bigger than any one row's
      // figure that happens to sit beside the same word.
      if (!(key in found) || value > found[key]) found[key] = value;
    }
  }

  return found;
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

  // On a ladder that doesn't link its rows, a name is all we have to match on,
  // and the organisation is far bigger than our twelve. Two people called the
  // same thing would give one of them the other's rank, so count the names
  // first and decline any that appear twice — a missing placement is a row
  // that doesn't render, which is much better than a confidently wrong one.
  const nameCounts = new Map();
  for (const row of ordered) {
    const key = normalise(row.name);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const placements = new Map();
  const ambiguous = [];
  let rank = 0;
  let previousValue = null;

  for (const [index, row] of ordered.entries()) {
    // Ties share the better rank, the same convention as the on-page ladders.
    if (row[measure] !== previousValue) {
      rank = index + 1;
      previousValue = row[measure];
    }
    const ours = matchRow(row, entities);
    if (!ours) continue;
    // A row that carries a slug identified itself; only name-matched rows are
    // at risk of the collision above.
    if (!slugFromUrl(row.href) && nameCounts.get(normalise(row.name)) > 1) {
      ambiguous.push(ours.name);
      continue;
    }
    placements.set(ours.id, { rank, of: ordered.length });
  }

  if (ambiguous.length > 0) {
    console.warn(
      `  ! skipped ${ambiguous.length} ${measure} placement(s) — more than one row on this ` +
        `ladder carries that name, so the rank could belong to someone else: ${ambiguous.join(', ')}`,
    );
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
 * Discards any "total" that is really one row's figure.
 *
 * A ladder row reads "412,880 steps", which looks exactly like an organisation
 * total sitting beside the word "steps" — and on a page with no stat block that
 * is what gets picked up. An organisation's total cannot equal, or be smaller
 * than, a single participant's, so a candidate failing that test is a row and
 * is dropped. Getting this wrong would not break anything visibly; it would
 * quietly make every "against the average" figure wrong, which is worse.
 */
function sane(candidates, tables) {
  const rowValues = new Set();
  // Per measure, because a money total is naturally far smaller than a step
  // total: comparing $12,480 raised against 412,880 steps would throw away a
  // perfectly good figure.
  const biggest = { steps: 0, raised: 0 };
  for (const rows of tables) {
    for (const row of rows) {
      for (const measure of ['steps', 'raised']) {
        if (Number.isFinite(row[measure])) {
          rowValues.add(row[measure]);
          biggest[measure] = Math.max(biggest[measure], row[measure]);
        }
      }
    }
  }

  const kept = {};
  for (const [key, value] of Object.entries(candidates)) {
    if (rowValues.has(value)) continue;
    if (key in biggest && value <= biggest[key]) continue;
    kept[key] = value;
  }
  return kept;
}

/** A ladder's rows are the same row twice if these match. */
const rowKey = (row) => `${normalise(row.name)}|${row.steps}|${row.raised}`;

/**
 * Reads a ladder across its pages, clicking "next" until it runs out.
 *
 * The organisation leaderboard shows five at a time out of 191, so a single
 * read can only ever see the top five — and none of our twelve are in it. The
 * field only exists if we walk it.
 *
 * Rows accumulate across pages and are keyed so a control that re-renders the
 * same page cannot inflate the field size. Three independent stops: the button
 * disappears or disables, a page adds nothing new, or the cap is hit. A rank is
 * only as good as the field it came from, so an incomplete walk must not be
 * mistaken for a complete one.
 */
async function readAllPages(page, known) {
  const NEXT = /^(next|more|show more|load more|view more|see more|›|»|→)\s*(page)?$/i;
  /** 191 participants at five a page is 39; the cap is slack, not a target. */
  const MAX_PAGES = 80;

  const merged = [];
  const seen = [];
  let pages = 0;
  let exhausted = true;

  for (let round = 0; round < MAX_PAGES; round += 1) {
    const groups = await page.evaluate(extractRows, known);

    let added = 0;
    groups.forEach((rows, index) => {
      merged[index] ??= [];
      seen[index] ??= new Set();
      for (const row of rows) {
        const key = rowKey(row);
        if (seen[index].has(key)) continue;
        seen[index].add(key);
        merged[index].push(row);
        added += 1;
      }
    });

    pages = round + 1;
    // A page that adds nothing means the control is looping or we are done.
    if (round > 0 && added === 0) break;

    const clicked = await page
      .evaluate((pattern) => {
        const source = new RegExp(pattern.source, pattern.flags);
        const controls = [...document.querySelectorAll('button, a, [role="button"]')];
        const next = controls.find((control) => {
          const label =
            (control.innerText || control.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          if (!source.test(label)) return false;
          if (control.disabled || control.getAttribute('aria-disabled') === 'true') return false;
          return control.offsetParent !== null;
        });
        if (!next) return false;
        next.click();
        return true;
      }, { source: NEXT.source, flags: NEXT.flags })
      .catch(() => false);

    if (!clicked) break;
    // Client-side paging, so there is nothing to wait on but the render.
    await page.waitForTimeout(400);

    if (round === MAX_PAGES - 1) exhausted = false;
  }

  return { ladders: merged.filter((rows) => rows.length >= 3), pages, exhausted };
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
  const known = [...teams, ...members].map((entity) => entity.name);
  const empty = { steps: new Map(), raised: new Map() };
  const nothing = {
    teamPlacements: empty,
    memberPlacements: empty,
    matched: 0,
    tables: [],
    aggregates: {},
    groups: [],
    pages: 0,
    exhausted: true,
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

  const walk = await readAllPages(page, known);
  const tables = walk.ladders;
  const aggregates = sane(await page.evaluate(extractAggregates), tables);

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
    aggregates,
    groups: tables.map((rows) => rows.length),
    pages: walk.pages,
    exhausted: walk.exhausted,
    shape,
  };
}

/**
 * Carries the last known rank forward, so the site can say "up three places".
 *
 * `previous` is the rank at the last successful read, whatever that was — not a
 * running history. One extra number, and it turns a static position into the
 * thing people actually check.
 */
function withMovement(current, before) {
  const out = {};
  for (const [id, measures] of Object.entries(current)) {
    out[id] = {};
    for (const [measure, placement] of Object.entries(measures)) {
      const wasRank = before?.[id]?.[measure]?.rank;
      out[id][measure] = Number.isFinite(wasRank)
        ? { ...placement, previous: wasRank }
        : placement;
    }
  }
  return out;
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
    const readings = {};

    for (const url of CANDIDATE_URLS) {
      const attempt = await readLadder(page, url, teams, members);
      // Structure only: counts, the page's own title and headings. Never
      // another participant's name or figures — this log is public.
      console.log(
        `  ${url.replace(ORIGIN, '')} → ${attempt.shape.links} fundraiser links, ` +
          `${attempt.shape.tables} tables, lists [${attempt.groups.join(', ') || 'none'}] ` +
          `over ${attempt.pages} page(s)${attempt.exhausted ? '' : ' (CAPPED — field incomplete)'}, ` +
          `matched ${attempt.matched} of ours` +
          (Object.keys(attempt.aggregates).length
            ? ` · totals: ${Object.entries(attempt.aggregates).map(([k, v]) => `${k}=${v}`).join(' ')}`
            : '') +
          (attempt.shape.headings ? ` · headings: ${attempt.shape.headings}` : ''),
      );
      // Every page's reading of the same figure is kept, so disagreement can be
      // spotted below rather than silently resolved by whichever page came
      // first. The last run had steps=161520000 on one page and steps=513147 on
      // another; picking either would have been a coin toss presented as fact.
      for (const [key, value] of Object.entries(attempt.aggregates)) {
        (readings[key] ??= new Set()).add(value);
      }
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

    // Only figures every page agreed on. A disagreement means we do not know
    // which is the organisation's, so we keep neither and say so.
    const aggregates = {};
    for (const [key, values] of Object.entries(readings)) {
      if (values.size === 1) aggregates[key] = [...values][0];
      else console.warn(`  ! dropped ${key}: pages disagreed (${[...values].join(' vs ')})`);
    }
    if (aggregates.participants && aggregates.teams && aggregates.teams > aggregates.participants) {
      console.warn('  ! dropped teams: more teams than participants, so one of them is not ours');
      delete aggregates.teams;
    }

    // Every one of ours, named, with the rank computed for them. These are our
    // own names — already public on the site — so this reveals nothing, and it
    // is the only way to tell a good parse from a plausible-looking bad one.
    // Four of these are known independently (Dionne Marks 16, chloe egle 20,
    // Finding Our Footing 7, Escalated to the Stepping Committee 10); if the
    // run disagrees with those, the parse is wrong however healthy it looks.
    const report = (label, entities, placements) => {
      const lines = entities.map((entity) => {
        const place = placements[entity.id];
        if (!place) return `${entity.name} —`;
        const parts = [];
        if (place.steps) parts.push(`${place.steps.rank}/${place.steps.of} steps`);
        if (place.raised) parts.push(`${place.raised.rank}/${place.raised.of} raised`);
        return `${entity.name} ${parts.join(', ')}`;
      });
      const missing = entities.filter((entity) => !placements[entity.id]).length;
      console.log(`${label} (${entities.length - missing}/${entities.length} placed): ${lines.join(' · ')}`);
      return missing;
    };

    const teamRows = byEntity(teamPlacements);
    const memberRows = byEntity(memberPlacements);
    const unplaced = report('Teams', teams, teamRows) + report('Members', members, memberRows);
    if (unplaced > 0) {
      console.warn(
        `  ! ${unplaced} of ours have no placement. Either the field is incomplete or a name did ` +
          `not match — worth chasing rather than shipping a partial board.`,
      );
    }

    const before = previous ? JSON.parse(previous) : null;
    const next = {
      updated: new Date().toISOString(),
      scope: ORG,
      org: { name: ORG.toUpperCase(), ...aggregates },
      teams: withMovement(teamRows, before?.teams),
      members: withMovement(memberRows, before?.members),
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
