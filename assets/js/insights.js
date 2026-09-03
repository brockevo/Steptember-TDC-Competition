/**
 * Daily talking points: milestones people have just hit, plus fun ways of
 * picturing the numbers.
 *
 * Everything here is derived from real step data. The comparisons are rough by
 * nature — a step isn't exactly 0.75 m and doesn't burn exactly 0.04 kcal — so
 * they're all worded as approximations rather than stated as fact.
 *
 * Three or four are shown at a time, chosen so that nobody is named twice and,
 * where the data allows, somebody from each of the three teams gets a mention.
 * Fresh milestones lead, since those are the news; the rest are drawn from a
 * pool rotated on the date, so the section changes daily but reads the same for
 * everyone on a given day.
 */

import { escapeHtml, formatNumber, formatPercent } from './format.js';

const METRES_PER_STEP = 0.75;
const KCAL_PER_STEP = 0.04;
const KCAL_PER_KWH = 860;
const AVERAGE_AUSTRALIAN_STEPS = 7400;

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

/** Milestones are the news, but a wall of them is dull — leave room for colour. */
const MAX_NEWS = 2;

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

/** "A", "A and B", "A, B and C" */
function listNames(names) {
  if (names.length === 1) return escapeHtml(names[0]);
  const last = names.at(-1);
  return `${names.slice(0, -1).map(escapeHtml).join(', ')} and ${escapeHtml(last)}`;
}

/* ------------------------------------------------------------- the facts -- */

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
    facts.push({
      kind: 'Milestone',
      colour: crossers.length === 1 ? crossers[0].teamColour : null,
      members: crossers.map((member) => member.id),
      html: `${listNames(crossers.map((member) => member.name))} ${
        { 1: 'has', 2: 'have both' }[crossers.length] ?? 'have all'
      } passed <strong>${formatNumber(threshold)} steps</strong> — that's ${against(threshold)}.`,
    });
  }

  for (const team of data.teams) {
    for (const threshold of crossings(team.cumulative, TEAM_MILESTONES)) {
      facts.push({
        kind: 'Team milestone',
        colour: team.colour,
        members: [],
        html: `<strong>${escapeHtml(team.name)}</strong> have walked past <strong>${formatNumber(threshold)} steps</strong> together.`,
      });
    }
  }

  for (const threshold of crossings(data.totals.cumulative, FIELD_MILESTONES)) {
    facts.push({
      kind: 'Milestone',
      colour: null,
      members: [],
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

  facts.push({
    kind: 'Record day',
    colour: best.member.teamColour,
    members: [best.member.id],
    html:
      best.date === latestDate
        ? `<strong>${escapeHtml(best.member.name)}</strong> put in <strong>${formatNumber(best.steps)} steps</strong> on ${escapeHtml(plainDate(best.date))} — the biggest single day anyone has managed yet.`
        : `The best day so far belongs to <strong>${escapeHtml(best.member.name)}</strong>: <strong>${formatNumber(best.steps)} steps</strong> on ${escapeHtml(plainDate(best.date))}.`,
  });

  // Anyone whose most recent day was their own best gets a mention.
  for (const member of data.members) {
    const deltas = data.history.deltasFor(member.id);
    if (deltas.length < 3) continue;
    const last = deltas.at(-1);
    if (last.date !== latestDate) continue;
    if (deltas.every((day) => day.steps <= last.steps) && member.id !== best.member.id) {
      facts.push({
        kind: 'Personal best',
        colour: member.teamColour,
        members: [member.id],
        html: `<strong>${escapeHtml(member.name)}</strong> just had their biggest day yet — <strong>${formatNumber(last.steps)} steps</strong>.`,
      });
    }
  }

  return facts;
}

/**
 * A fun fact about one person. The template rotates with the day so the same
 * member isn't described the same way twice in a row.
 */
function spotlight(member, variant, clock) {
  const options = [
    {
      kind: 'Distance',
      html: `<strong>${escapeHtml(member.name)}</strong> has covered about <strong>${km(member.steps).toFixed(0)} km</strong> on foot — ${against(member.steps)}.`,
    },
    {
      kind: 'Pace',
      html: `<strong>${escapeHtml(member.name)}</strong> is averaging <strong>${formatNumber(member.dailyAverage)} steps a day</strong> — the average Australian manages about ${formatNumber(AVERAGE_AUSTRALIAN_STEPS)}.`,
    },
    {
      kind: 'Energy',
      html: `<strong>${escapeHtml(member.name)}</strong> has burned roughly <strong>${formatNumber(member.steps * KCAL_PER_STEP)} calories</strong> — about ${formatNumber((member.steps * KCAL_PER_STEP) / 95)} Tim Tams' worth.`,
    },
    member.stepTarget
      ? {
          kind: 'On target',
          html: `<strong>${escapeHtml(member.name)}</strong> is <strong>${formatPercent(member.targetProgress)}</strong> of the way to their own ${formatNumber(member.stepTarget)} step target, with ${clock.daysRemaining} days to go.`,
        }
      : null,
  ].filter(Boolean);

  return {
    ...options[variant % options.length],
    colour: member.teamColour,
    members: [member.id],
  };
}

/** For each team, one candidate fact per member, ordered so the pick rotates. */
function spotlightsByTeam(data, seed) {
  const byTeam = new Map();
  for (const team of data.teams) {
    const roster = [...team.members].sort((a, b) => b.steps - a.steps);
    // Start at a different person each day so everyone gets a turn.
    const offset = seed % roster.length;
    const ordered = roster.map((_, index) => roster[(index + offset) % roster.length]);
    byTeam.set(
      team.id,
      ordered.map((member, index) => spotlight(member, seed + index, data.clock)),
    );
  }
  return byTeam;
}

/** Comparisons about the whole field, naming nobody. */
function generalFacts(data) {
  const { totals, members, clock } = data;
  const totalKcal = totals.steps * KCAL_PER_STEP;
  const facts = [
    {
      kind: 'Distance',
      html: `Between them the twelve of you have covered roughly <strong>${km(totals.steps).toFixed(0)} km</strong> — ${against(totals.steps)}.`,
    },
    {
      kind: 'Energy',
      html: `Those steps have burned somewhere near <strong>${formatNumber(totalKcal)} calories</strong> — about ${formatNumber(totalKcal / 95)} Tim Tams' worth.`,
    },
    {
      kind: 'Energy',
      html: `Convert that effort to electricity and it's roughly <strong>${(totalKcal / KCAL_PER_KWH).toFixed(1)} kWh</strong> — enough to charge a phone about ${formatNumber(totalKcal / KCAL_PER_KWH / 0.011)} times.`,
    },
    {
      kind: 'Pace',
      html: `The group is averaging <strong>${formatNumber(totals.steps / members.length / clock.daysElapsed)} steps per person per day</strong> — the average Australian manages about ${formatNumber(AVERAGE_AUSTRALIAN_STEPS)}.`,
    },
  ];

  if (clock.daysRemaining > 0) {
    const toTarget = Math.max(totals.stepTarget - totals.steps, 0);
    facts.push({
      kind: 'The run home',
      html: `<strong>${formatNumber(toTarget)} steps</strong> still stand between everyone and the combined target — that's ${formatNumber(toTarget / clock.daysRemaining / members.length)} each per day for the ${clock.daysRemaining} days left.`,
    });
  }

  return facts.map((fact) => ({ ...fact, colour: null, members: [] }));
}

/** Small deterministic hash, so the rotation is stable for a given day. */
function seedFrom(text) {
  let hash = 0;
  for (const character of text) hash = (hash * 31 + character.codePointAt(0)) % 100000;
  return hash;
}

export function buildInsights(data, limit = 4) {
  const seed = seedFrom(data.history.dates.at(-1) ?? 'start');
  const teamOf = (memberId) => data.membersById.get(memberId)?.teamId;

  const spotlights = spotlightsByTeam(data, seed);
  const general = generalFacts(data);
  const rotatedGeneral = general.map((_, index) => general[(index + seed) % general.length]);

  const chosen = [];
  const usedMembers = new Set();
  const coveredTeams = new Set();

  /** Nobody gets named twice, so a fact is only free if all its people are. */
  const free = (fact) => fact.members.every((id) => !usedMembers.has(id));
  const take = (fact) => {
    chosen.push(fact);
    for (const id of fact.members) {
      usedMembers.add(id);
      coveredTeams.add(teamOf(id));
    }
  };

  // 1. Milestones and records lead, but only as many as still leave room for
  //    every team to be represented.
  const news = [...milestoneFacts(data), ...recordFacts(data)];
  const picked = [];
  const seen = new Set();
  for (const fact of news) {
    if (picked.length >= MAX_NEWS) break;
    if (fact.members.some((id) => seen.has(id))) continue;
    picked.push(fact);
    fact.members.forEach((id) => seen.add(id));
  }
  const teamsMissing = (facts) => {
    const covered = new Set(facts.flatMap((fact) => fact.members.map(teamOf)));
    return data.teams.filter((team) => !covered.has(team.id)).length;
  };
  while (picked.length > 0 && picked.length + teamsMissing(picked) > limit) picked.pop();
  picked.forEach(take);

  // 2. Give every remaining team somebody of its own.
  for (const team of data.teams) {
    if (chosen.length >= limit || coveredTeams.has(team.id)) continue;
    const candidate = spotlights.get(team.id).find(free);
    if (candidate) take(candidate);
  }

  // 3. Fill any spare slots with the day's general comparisons.
  for (const fact of rotatedGeneral) {
    if (chosen.length >= limit) break;
    take(fact);
  }

  return chosen;
}
