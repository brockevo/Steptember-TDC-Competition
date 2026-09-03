/**
 * Daily talking points: milestones people have just hit, plus fun ways of
 * picturing the numbers.
 *
 * Everything here is derived from real step data. The comparisons are rough by
 * nature — a step isn't exactly 0.75 m and doesn't burn exactly 0.04 kcal — so
 * they're all worded as approximations rather than stated as fact.
 *
 * Three or four are shown at a time. Fresh milestones come first, since those
 * are the news; the rest are drawn from a rotating pool keyed on the date, so
 * the section changes day to day but stays the same for everyone on that day.
 */

import { escapeHtml, formatNumber } from './format.js';

const METRES_PER_STEP = 0.75;
const KCAL_PER_STEP = 0.04;
const KCAL_PER_KWH = 860;

/** Landmarks to measure a distance against, shortest first. */
const LANDMARKS = [
  { km: 1.149, name: 'the Sydney Harbour Bridge' },
  { km: 3.2, name: 'a lap of Flemington racecourse' },
  { km: 6, name: 'the Bondi to Coogee coastal walk' },
  { km: 10.6, name: 'the Uluru base walk' },
  { km: 21.1, name: 'a half marathon' },
  { km: 42.2, name: 'a marathon' },
  { km: 96, name: 'the Kokoda Track' },
  { km: 120, name: 'the road from Sydney to Newcastle' },
  { km: 243, name: 'the Great Ocean Road' },
  { km: 878, name: 'the road from Sydney to Melbourne' },
  { km: 3935, name: 'the road from Sydney to Perth' },
];

const STEP_MILESTONES = [25e3, 50e3, 75e3, 100e3, 150e3, 200e3, 250e3, 300e3, 400e3, 500e3];
const TEAM_MILESTONES = [100e3, 250e3, 500e3, 750e3, 1e6, 1.5e6, 2e6, 3e6];
const FIELD_MILESTONES = [250e3, 500e3, 1e6, 2e6, 3e6, 4e6, 5e6];

const km = (steps) => (steps * METRES_PER_STEP) / 1000;

/** Picks the biggest landmark the distance covers at least once, and phrases it. */
function against(steps) {
  const distance = km(steps);
  const fit = [...LANDMARKS].reverse().find((landmark) => distance >= landmark.km);
  if (!fit) {
    const smallest = LANDMARKS[0];
    return `${Math.round((distance / smallest.km) * 100)}% of the way across ${smallest.name}`;
  }
  const times = distance / fit.km;
  if (times < 1.6) return `about the length of ${fit.name}`;
  return `${fit.name} ${times < 10 ? times.toFixed(1) : Math.round(times)} times over`;
}

/** Thresholds crossed on the most recent day of a cumulative series. */
function crossings(series, thresholds) {
  if (!series || series.length < 2) return [];
  const latest = series.at(-1);
  const previous = series.at(-2);
  return thresholds.filter((threshold) => previous < threshold && latest >= threshold);
}

const plainDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long' });

/* ------------------------------------------------------------- the facts -- */

/** "A", "A and B", "A, B and C" */
function listNames(names) {
  if (names.length === 1) return escapeHtml(names[0]);
  const last = names.at(-1);
  return `${names.slice(0, -1).map(escapeHtml).join(', ')} and ${escapeHtml(last)}`;
}

function milestoneFacts(data) {
  const facts = [];

  // Several people often cross the same mark on the same day; say it once.
  const byThreshold = new Map();
  for (const member of data.members) {
    for (const threshold of crossings(member.cumulative, STEP_MILESTONES)) {
      if (!byThreshold.has(threshold)) byThreshold.set(threshold, []);
      byThreshold.get(threshold).push(member);
    }
  }

  // Biggest achievement first.
  for (const [threshold, crossers] of [...byThreshold].sort((a, b) => b[0] - a[0])) {
    const names = crossers.map((member) => member.name);
    facts.push({
      kind: 'Milestone',
      colour: crossers.length === 1 ? crossers[0].teamColour : null,
      html: `${listNames(names)} ${
        { 1: 'has', 2: 'have both' }[crossers.length] ?? 'have all'
      } passed <strong>${formatNumber(threshold)} steps</strong> — that's ${against(threshold)}.`,
    });
  }

  for (const team of data.teams) {
    for (const threshold of crossings(team.cumulative, TEAM_MILESTONES)) {
      facts.push({
        kind: 'Team milestone',
        colour: team.colour,
        html: `<strong>${escapeHtml(team.name)}</strong> have walked past <strong>${formatNumber(threshold)} steps</strong> together.`,
      });
    }
  }

  for (const threshold of crossings(data.totals.cumulative, FIELD_MILESTONES)) {
    facts.push({
      kind: 'Milestone',
      colour: null,
      html: `All three teams together have now passed <strong>${formatNumber(threshold)} steps</strong> — roughly ${against(threshold)}.`,
    });
  }

  return facts;
}

/** Record-breaking days: the biggest single day so far, and personal bests. */
function recordFacts(data) {
  const facts = [];
  const days = data.members.flatMap((member) =>
    data.history.deltasFor(member.id).map((day) => ({ ...day, member })),
  );
  if (days.length === 0) return facts;

  const best = days.reduce((top, day) => (day.steps > top.steps ? day : top));
  const latestDate = days.reduce((latest, day) => (day.date > latest ? day.date : latest), '');

  if (best.date === latestDate) {
    facts.push({
      kind: 'Record day',
      colour: best.member.teamColour,
      html: `<strong>${escapeHtml(best.member.name)}</strong> put in <strong>${formatNumber(best.steps)} steps</strong> on ${escapeHtml(plainDate(best.date))} — the biggest single day anyone has managed yet.`,
    });
  } else {
    facts.push({
      kind: 'Record day',
      colour: best.member.teamColour,
      html: `The best day so far belongs to <strong>${escapeHtml(best.member.name)}</strong>: <strong>${formatNumber(best.steps)} steps</strong> on ${escapeHtml(plainDate(best.date))}.`,
    });
  }

  // Anyone whose most recent day was their own best gets a mention.
  for (const member of data.members) {
    const deltas = data.history.deltasFor(member.id);
    if (deltas.length < 3) continue;
    const last = deltas.at(-1);
    if (last.date !== latestDate) continue;
    const isPersonalBest = deltas.every((day) => day.steps <= last.steps);
    // Skip the overall record holder — they already have a card above.
    if (isPersonalBest && member.id !== best.member.id) {
      facts.push({
        kind: 'Personal best',
        colour: member.teamColour,
        html: `<strong>${escapeHtml(member.name)}</strong> just had their biggest day yet — <strong>${formatNumber(last.steps)} steps</strong>.`,
      });
    }
  }

  return facts;
}

/** The rotating pool of fun comparisons. */
function funFacts(data) {
  const { totals, members, clock } = data;
  const leader = [...members].sort((a, b) => b.steps - a.steps)[0];
  const totalKcal = totals.steps * KCAL_PER_STEP;
  const facts = [];

  facts.push({
    kind: 'Distance',
    colour: null,
    html: `Between them the twelve of you have covered roughly <strong>${km(totals.steps).toFixed(0)} km</strong> — ${against(totals.steps)}.`,
  });

  facts.push({
    kind: 'Distance',
    colour: leader.teamColour,
    html: `<strong>${escapeHtml(leader.name)}</strong> alone has walked about <strong>${km(leader.steps).toFixed(0)} km</strong> — ${against(leader.steps)}.`,
  });

  facts.push({
    kind: 'Energy',
    colour: null,
    html: `Those steps have burned somewhere near <strong>${formatNumber(totalKcal)} calories</strong> — about ${formatNumber(totalKcal / 95)} Tim Tams' worth.`,
  });

  facts.push({
    kind: 'Energy',
    colour: null,
    html: `Convert that effort to electricity and it's roughly <strong>${(totalKcal / KCAL_PER_KWH).toFixed(1)} kWh</strong> — enough to charge a phone about ${formatNumber(totalKcal / KCAL_PER_KWH / 0.011)} times.`,
  });

  facts.push({
    kind: 'Pace',
    colour: null,
    html: `The group is averaging <strong>${formatNumber(totals.steps / members.length / clock.daysElapsed)} steps per person per day</strong> — the average Australian manages about 7,400.`,
  });

  const furthestTeam = [...data.teams].sort((a, b) => b.steps - a.steps)[0];
  facts.push({
    kind: 'Distance',
    colour: furthestTeam.colour,
    html: `<strong>${escapeHtml(furthestTeam.name)}</strong> have covered about <strong>${km(furthestTeam.steps).toFixed(0)} km</strong> as a team — ${against(furthestTeam.steps)}.`,
  });

  if (clock.daysRemaining > 0) {
    const toTarget = Math.max(totals.stepTarget - totals.steps, 0);
    facts.push({
      kind: 'The run home',
      colour: null,
      html: `<strong>${formatNumber(toTarget)} steps</strong> still stand between everyone and the combined target — that's ${formatNumber(toTarget / clock.daysRemaining / members.length)} each per day for the ${clock.daysRemaining} days left.`,
    });
  }

  return facts;
}

/** Small deterministic hash, so the rotation is stable for a given day. */
function seedFrom(text) {
  let hash = 0;
  for (const character of text) hash = (hash * 31 + character.codePointAt(0)) % 100000;
  return hash;
}

/** Milestones are the news, but a wall of them is dull — leave room for colour. */
const MAX_NEWS = 2;

export function buildInsights(data, limit = 4) {
  const news = [...milestoneFacts(data), ...recordFacts(data)].slice(0, MAX_NEWS);
  const pool = funFacts(data);

  // Rotate the pool by the day, so the page has something new each morning.
  const seed = seedFrom(data.history.dates.at(-1) ?? 'start');
  const rotated = pool.map((_, index) => pool[(index + seed) % pool.length]);

  return [...news, ...rotated.slice(0, limit - news.length)];
}
