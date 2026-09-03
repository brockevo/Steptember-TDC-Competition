#!/usr/bin/env node
/**
 * Pulls live figures for the three TDC teams from their public Steptember pages
 * and writes them into data/teams.json, appending a dated snapshot to
 * data/history.json.
 *
 * Steptember's own API is disallowed by robots.txt, so this reads the public
 * /fundraisers/<slug> pages, which server-render everything we need.
 *
 * The guiding rule throughout: never destroy good data. If a page fails to load
 * or fails to parse, the committed numbers for that team are left exactly as
 * they were and the reason is logged.
 *
 * Usage:
 *   node scripts/fetch-steptember.mjs [--dry-run]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEAMS_FILE = resolve(ROOT, 'data/teams.json');
const HISTORY_FILE = resolve(ROOT, 'data/history.json');

const ORIGIN = 'https://www.steptember.org.au';

/**
 * Steptember gives everyone who hasn't uploaded a photo the same stock image.
 * Showing that shoe twelve times says less than coloured initials do, so these
 * are treated as "no photo". Any image shared by two or more members in a run
 * is also treated as a default, which catches a new placeholder automatically.
 */
const KNOWN_DEFAULT_IMAGES = new Set(['13ru2hhxmnesk4g.png']);
const USER_AGENT =
  'TDC-Steptember-Scoreboard/1.0 (+https://github.com/brockevo/steptember-tdc-competition)';
const REQUEST_TIMEOUT_MS = 30_000;
const POLITE_DELAY_MS = 400;

const DRY_RUN = process.argv.includes('--dry-run');

/* ------------------------------------------------------------------ fetching */

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const html = await response.text();
  if (html.length < 5000) throw new Error(`suspiciously short response for ${url}`);
  return html;
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/* ------------------------------------------------------------------- parsing */

/** Strips tags and collapses whitespace, so text checks aren't fooled by markup. */
function textOf(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "$1,234.50" / "28,940" -> 1234.5 / 28940. Returns null when there's no number. */
function toNumber(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Reads the money figure sitting under a sidebar heading, e.g. "Raised so far". */
function moneyUnderHeading(html, heading) {
  const pattern = new RegExp(
    `<h4[^>]*>\\s*${heading}\\s*</h4>\\s*<h3[^>]*>\\s*<strong>([^<]*)</strong>`,
    'i',
  );
  return toNumber(html.match(pattern)?.[1]);
}

/** Splits the #membersSteps block into one chunk of markup per member tile. */
function memberTiles(html) {
  const start = html.indexOf('id="membersSteps"');
  if (start === -1) return [];
  const block = html.slice(start, start + 60_000);
  return block.split(/(?=<div[^>]*class="[^"]*member-item)/i).slice(1);
}

function parseTeamPage(html) {
  const members = memberTiles(html)
    .map((tile) => {
      const slug = tile.match(/\/fundraisers\/([A-Za-z0-9_-]+)/)?.[1];
      const name = tile.match(/class="profilename[^"]*"[^>]*>([^<]*)</i)?.[1];
      // The step count follows a "Total steps" caption inside the tile.
      const steps = toNumber(tile.match(/Total steps[\s\S]{0,300}?([\d,]{3,})/i)?.[1]);
      // The captain's crown is a separate img, so match the profile photo class.
      const photoTag = tile.match(/<img[^>]+class="[^"]*profile-image[^"]*"[^>]*>/i)?.[0];
      const photo = photoTag?.match(/src="([^"]+)"/i)?.[1] ?? null;
      if (!slug || !name || steps == null) return null;
      return {
        id: slug,
        name: textOf(name),
        captain: /Team captain/i.test(tile),
        url: `${ORIGIN}/fundraisers/${slug}`,
        steps,
        photo,
      };
    })
    .filter(Boolean);

  return {
    name: textOf(html.match(/<title>\s*Steptember\s*-\s*([^<]*)<\/title>/i)?.[1] ?? ''),
    raised: moneyUnderHeading(html, 'Raised so far'),
    goal: moneyUnderHeading(html, 'Our Goal'),
    members,
  };
}

function parseMemberPage(html) {
  // "My target 300000 Steps" lives in the activity-tracking panel.
  const stepTarget = toNumber(html.match(/My target[\s\S]{0,200}?([\d,]{3,})\s*Steps/i)?.[1]);
  return {
    raised: moneyUnderHeading(html, 'Raised so far'),
    fundraisingGoal: moneyUnderHeading(html, 'My goal'),
    stepTarget,
  };
}

/* -------------------------------------------------------------------- merging */

/**
 * Folds a freshly scraped team into the committed one. Anything the scrape
 * couldn't establish keeps its committed value rather than being zeroed.
 */
function mergeTeam(committed, scraped) {
  const previousById = new Map(committed.members.map((member) => [member.id, member]));

  // The live page returns members in a varying order; sorting by id keeps the
  // committed file stable so an unchanged scrape produces no diff.
  const members = [...scraped.members].sort((a, b) => a.id.localeCompare(b.id)).map((scrapedMember) => {
    const previous = previousById.get(scrapedMember.id) ?? {};
    return {
      id: scrapedMember.id,
      name: scrapedMember.name,
      captain: scrapedMember.captain,
      url: scrapedMember.url,
      steps: scrapedMember.steps,
      stepTarget: scrapedMember.stepTarget ?? previous.stepTarget ?? null,
      raised: scrapedMember.raised ?? previous.raised ?? 0,
      fundraisingGoal: scrapedMember.fundraisingGoal ?? previous.fundraisingGoal ?? null,
      photo: scrapedMember.photo ?? null,
    };
  });

  return {
    ...committed,
    // Team display names stay ours: the live titles carry emoji and get edited
    // mid-event, and we want a stable label on the scoreboard.
    raised: scraped.raised ?? committed.raised,
    goal: scraped.goal ?? committed.goal,
    members,
  };
}

/**
 * Clears the photo for anyone still on a stock image, so the page falls back to
 * their coloured initials. A file two or more people share is a placeholder by
 * definition, which keeps this working if Steptember swaps the artwork.
 */
function dropDefaultPhotos(teams) {
  const uses = new Map();
  for (const team of teams) {
    for (const { photo } of team.members) {
      if (photo) uses.set(photo, (uses.get(photo) ?? 0) + 1);
    }
  }

  const isDefault = (photo) =>
    uses.get(photo) > 1 || KNOWN_DEFAULT_IMAGES.has(photo.split('/').pop());

  let kept = 0;
  for (const team of teams) {
    for (const member of team.members) {
      if (member.photo && isDefault(member.photo)) member.photo = null;
      else if (member.photo) kept += 1;
    }
  }
  return kept;
}

/* ------------------------------------------------------------------- history */

function todayInSydney() {
  // The teams are Australian, so days roll over on their clock, not the runner's.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Records today's totals, replacing an earlier entry for the same date. */
function recordSnapshot(history, teams) {
  const date = todayInSydney();
  const members = {};
  for (const team of teams) {
    for (const member of team.members) members[member.id] = member.steps;
  }
  const snapshots = history.snapshots.filter((snapshot) => snapshot.date !== date);
  snapshots.push({ date, members });
  snapshots.sort((a, b) => a.date.localeCompare(b.date));
  return { snapshots };
}

/* ---------------------------------------------------------------------- main */

async function main() {
  const teamsData = JSON.parse(await readFile(TEAMS_FILE, 'utf8'));
  const history = JSON.parse(await readFile(HISTORY_FILE, 'utf8'));

  const updated = [];
  let failures = 0;

  for (const committed of teamsData.teams) {
    try {
      const scraped = parseTeamPage(await fetchPage(committed.url));

      // A team with no members parsed means the markup moved, not that everyone
      // left. Treat it as a failure so the committed roster survives.
      if (scraped.members.length === 0) throw new Error('no members found in page');

      for (const member of scraped.members) {
        await wait(POLITE_DELAY_MS);
        try {
          Object.assign(member, parseMemberPage(await fetchPage(member.url)));
        } catch (error) {
          console.warn(`  ! ${member.name}: profile unavailable (${error.message})`);
        }
      }

      updated.push(mergeTeam(committed, scraped));
      const total = scraped.members.reduce((sum, member) => sum + member.steps, 0);
      console.log(
        `✓ ${scraped.name}: ${scraped.members.length} members, ` +
          `${total.toLocaleString('en-AU')} steps, $${(scraped.raised ?? 0).toLocaleString('en-AU')}`,
      );
    } catch (error) {
      failures += 1;
      updated.push(committed);
      console.warn(`✗ ${committed.name}: keeping committed data (${error.message})`);
    }
    await wait(POLITE_DELAY_MS);
  }

  if (failures === teamsData.teams.length) {
    console.error('Every team failed to update — leaving all data untouched.');
    process.exit(1);
  }

  const withPhotos = dropDefaultPhotos(updated);
  console.log(`\n${withPhotos} of ${updated.flatMap((t) => t.members).length} members have a profile photo.`);

  const nextTeams = {
    ...teamsData,
    competition: {
      ...teamsData.competition,
      lastUpdated: new Date().toISOString(),
      dataSource: failures === 0 ? 'live' : 'partial',
    },
    teams: updated,
  };
  const nextHistory = recordSnapshot(history, updated);

  // Compare without lastUpdated, so an unchanged scrape doesn't churn a commit.
  const unchanged =
    JSON.stringify({ ...nextTeams, competition: { ...nextTeams.competition, lastUpdated: null } }) ===
      JSON.stringify({ ...teamsData, competition: { ...teamsData.competition, lastUpdated: null } }) &&
    JSON.stringify(nextHistory) === JSON.stringify(history);

  if (DRY_RUN) {
    console.log(unchanged ? '\n[dry run] no changes' : '\n[dry run] changes detected, nothing written');
    return;
  }
  if (unchanged) {
    console.log('\nNo changes.');
    return;
  }

  await writeFile(TEAMS_FILE, `${JSON.stringify(nextTeams, null, 2)}\n`);
  await writeFile(HISTORY_FILE, `${JSON.stringify(nextHistory, null, 2)}\n`);
  console.log('\nWrote data/teams.json and data/history.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
