/**
 * Loads the committed data and derives every figure the page shows.
 *
 * Nothing is precomputed in the JSON: change one member's steps and the team
 * total, both rankings, the gaps, the bars and every profile stat move with it.
 */

/** Average stride used for the distance estimate, in metres. */
const METRES_PER_STEP = 0.75;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

async function loadJson(path, fallback) {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Could not load ${path}: ${error.message}`);
  }
}

/** Parses "2026-09-01" as local midnight, avoiding UTC's off-by-one. */
function parseDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function buildClock({ startDate, endDate }) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalDays = Math.round((end - start) / MILLISECONDS_PER_DAY) + 1;
  const rawElapsed = Math.round((today - start) / MILLISECONDS_PER_DAY) + 1;
  const daysElapsed = Math.min(Math.max(rawElapsed, 1), totalDays);

  return {
    start,
    end,
    totalDays,
    daysElapsed,
    daysRemaining: Math.max(totalDays - daysElapsed, 0),
    beforeStart: today < start,
    finished: today > end,
  };
}

/**
 * Ranks entries by a value, sharing a rank on ties, and reports each entry's
 * gap to the leader and share of the field.
 */
function rank(entries, valueOf) {
  const values = entries.map(valueOf);
  const leader = Math.max(...values, 0);
  const total = values.reduce((sum, value) => sum + value, 0);

  const byId = new Map();
  entries.forEach((entry, index) => {
    const value = values[index];
    byId.set(entry.id, {
      value,
      // One plus however many entries are strictly ahead — so ties share a rank.
      rank: values.filter((other) => other > value).length + 1,
      gapToLeader: leader - value,
      shareOfField: total > 0 ? value / total : 0,
      shareOfLeader: leader > 0 ? value / leader : 0,
    });
  });
  return { byId, leader, total };
}

/** Turns dated cumulative snapshots into per-member daily step deltas. */
function buildHistory(snapshots) {
  const days = [...(snapshots ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const deltasByMember = new Map();

  for (let index = 1; index < days.length; index += 1) {
    const previous = days[index - 1].members ?? {};
    const current = days[index].members ?? {};
    for (const [memberId, total] of Object.entries(current)) {
      if (!(memberId in previous)) continue;
      const delta = total - previous[memberId];
      if (delta < 0) continue; // A correction downwards isn't a day's walking.
      if (!deltasByMember.has(memberId)) deltasByMember.set(memberId, []);
      deltasByMember.get(memberId).push({ date: days[index].date, steps: delta });
    }
  }

  return {
    dayCount: days.length,
    hasDailyData: days.length >= 2,
    deltasFor: (memberId) => deltasByMember.get(memberId) ?? [],
  };
}

export async function loadCompetition() {
  const teamsData = await loadJson('data/teams.json');
  const historyData = await loadJson('data/history.json', { snapshots: [] });

  const { competition } = teamsData;
  const clock = buildClock(competition);
  const history = buildHistory(historyData.snapshots);

  // --- teams -----------------------------------------------------------------
  const teams = teamsData.teams.map((team) => {
    const steps = team.members.reduce((sum, member) => sum + (member.steps ?? 0), 0);
    return { ...team, steps, memberCount: team.members.length };
  });

  const stepRanks = rank(teams, (team) => team.steps);
  const moneyRanks = rank(teams, (team) => team.raised ?? 0);

  // --- members ---------------------------------------------------------------
  const allMembers = teams.flatMap((team) =>
    team.members.map((member) => ({
      ...member,
      teamId: team.id,
      teamName: team.name,
      teamColour: team.colour,
      teamUrl: team.url,
      teamSteps: team.steps,
      teamRaised: team.raised ?? 0,
    })),
  );

  const memberStepRanks = rank(allMembers, (member) => member.steps ?? 0);
  const memberMoneyRanks = rank(allMembers, (member) => member.raised ?? 0);
  const byStepsDescending = [...allMembers].sort((a, b) => b.steps - a.steps);

  const members = allMembers.map((member) => {
    const overall = memberStepRanks.byId.get(member.id);
    const money = memberMoneyRanks.byId.get(member.id);
    const teamMates = allMembers.filter((other) => other.teamId === member.teamId);
    const dailyAverage = member.steps / clock.daysElapsed;
    const projected = Math.round(dailyAverage * clock.totalDays);
    const stepsRemaining = Math.max((member.stepTarget ?? 0) - member.steps, 0);
    const deltas = history.deltasFor(member.id);

    // Whoever sits directly above them on the overall step ladder.
    const position = byStepsDescending.findIndex((other) => other.id === member.id);
    const personAbove = position > 0 ? byStepsDescending[position - 1] : null;

    return {
      ...member,
      overallStepRank: overall.rank,
      overallMoneyRank: money.rank,
      teamStepRank:
        teamMates.filter((other) => other.steps > member.steps).length + 1,
      shareOfTeamSteps: member.teamSteps > 0 ? member.steps / member.teamSteps : 0,
      shareOfTeamRaised: member.teamRaised > 0 ? (member.raised ?? 0) / member.teamRaised : 0,
      dailyAverage,
      projected,
      stepsRemaining,
      targetProgress: member.stepTarget ? member.steps / member.stepTarget : null,
      onTrack: member.stepTarget ? projected >= member.stepTarget : null,
      neededPerDay:
        member.stepTarget && clock.daysRemaining > 0 && stepsRemaining > 0
          ? Math.ceil(stepsRemaining / clock.daysRemaining)
          : 0,
      fundraisingProgress: member.fundraisingGoal
        ? (member.raised ?? 0) / member.fundraisingGoal
        : null,
      distanceKm: (member.steps * METRES_PER_STEP) / 1000,
      gapToPersonAbove: personAbove ? personAbove.steps - member.steps : 0,
      personAbove: personAbove?.name ?? null,
      lastDay: deltas.at(-1) ?? null,
      bestDay: deltas.length
        ? deltas.reduce((best, day) => (day.steps > best.steps ? day : best))
        : null,
    };
  });

  const membersById = new Map(members.map((member) => [member.id, member]));

  // Re-attach the derived members to their teams so a team card has everything.
  const teamsWithStats = teams.map((team) => ({
    ...team,
    steps: team.steps,
    stepStanding: stepRanks.byId.get(team.id),
    moneyStanding: moneyRanks.byId.get(team.id),
    goalProgress: team.goal ? (team.raised ?? 0) / team.goal : null,
    stepsPerMemberPerDay:
      team.memberCount > 0 ? team.steps / team.memberCount / clock.daysElapsed : 0,
    projectedSteps: Math.round((team.steps / clock.daysElapsed) * clock.totalDays),
    members: team.members.map((member) => membersById.get(member.id)),
  }));

  // --- who's winning ---------------------------------------------------------
  const stepLeaders = teamsWithStats.filter((team) => team.stepStanding.rank === 1);
  const moneyLeaders = teamsWithStats.filter((team) => team.moneyStanding.rank === 1);
  const fundraisingStarted = moneyRanks.total > 0;

  return {
    competition,
    clock,
    history,
    teams: teamsWithStats,
    members,
    membersById,
    totals: {
      steps: stepRanks.total,
      raised: moneyRanks.total,
      goal: teamsWithStats.reduce((sum, team) => sum + (team.goal ?? 0), 0),
      memberCount: members.length,
    },
    standings: {
      stepLeaders,
      moneyLeaders,
      fundraisingStarted,
      // An outright leader tops both challenges; otherwise the two are split.
      outrightLeader:
        fundraisingStarted &&
        stepLeaders.length === 1 &&
        moneyLeaders.length === 1 &&
        stepLeaders[0].id === moneyLeaders[0].id
          ? stepLeaders[0]
          : null,
    },
  };
}
