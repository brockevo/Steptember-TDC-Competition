/**
 * The stat blocks describing one person.
 *
 * Shared by the member dialog and the profile view so the two can never drift
 * into describing the same person differently. Everything here is derived from
 * figures we actually hold — nothing is estimated to fill a gap.
 */

import {
  escapeHtml,
  formatMoney,
  formatNumber,
  formatPercent,
  ordinal,
  plural,
} from './format.js';

export function kpi(label, value, note) {
  return `<div class="kpi">
    <dt>${escapeHtml(label)}</dt>
    <dd>${escapeHtml(value)}${note ? `<small>${escapeHtml(note)}</small>` : ''}</dd>
  </div>`;
}

export function miniLane({ label, value, fraction, note, tick }) {
  const width = (Math.max(0, Math.min(1, fraction || 0)) * 100).toFixed(1);
  return `<div class="mini-lane">
    <div class="mini-head"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
    <div class="mini-track" role="img" aria-label="${escapeHtml(`${label}: ${value}`)}">
      <span style="width: ${width}%"></span>
    </div>
    ${note ? `<p class="mini-note">${tick ? '<span class="on-track">✓</span> ' : ''}${escapeHtml(note)}</p>` : ''}
  </div>`;
}

/** The full KPI grid for a person, as an array of blocks the caller joins. */
export function memberStats(member, data) {
  const { clock, members } = data;
  /** Under a week in, a straight-line projection is noise, not a forecast. */
  const earlyDays = clock.daysElapsed < 5;

  const stats = [
    kpi(
      'Total steps',
      formatNumber(member.steps),
      `${ordinal(member.overallStepRank)} of ${members.length} overall · ${ordinal(member.teamStepRank)} in team`,
    ),
    kpi(
      'Average per day',
      formatNumber(member.dailyAverage),
      `across ${clock.daysElapsed} ${plural(clock.daysElapsed, 'day')} so far`,
    ),
    kpi(
      'Projected by 30 Sep',
      formatNumber(member.projected),
      earlyDays
        ? `at this pace — only ${clock.daysElapsed} ${plural(clock.daysElapsed, 'day')} in, so treat it lightly`
        : member.stepTarget
          ? member.onTrack
            ? 'on track to beat their target'
            : 'short of their target at this pace'
          : 'at their current pace',
    ),
    kpi(
      'Share of team steps',
      formatPercent(member.shareOfTeamSteps),
      `of ${formatNumber(member.teamSteps)} team steps`,
    ),
  ];

  if (member.stepTarget) {
    stats.push(
      member.neededPerDay > 0
        ? kpi(
            'Needed per day',
            formatNumber(member.neededPerDay),
            `to hit ${formatNumber(member.stepTarget)} in the ${clock.daysRemaining} ${plural(clock.daysRemaining, 'day')} left`,
          )
        : kpi('Target', 'Reached', `passed ${formatNumber(member.stepTarget)} steps`),
    );
  }

  if (member.bestDay) {
    stats.push(kpi('Best day', formatNumber(member.bestDay.steps), `on ${member.bestDay.date}`));
  }

  stats.push(
    kpi('Distance walked', `${member.distanceKm.toFixed(1)} km`, 'estimated at 0.75 m per step'),
  );

  stats.push(
    member.personAbove
      ? kpi('Gap to catch', formatNumber(member.gapToPersonAbove), `steps behind ${member.personAbove}`)
      : kpi('Overall position', 'Out in front', 'leading every stepper'),
  );

  return stats;
}

/** Progress towards a personal step target, or nothing when they haven't set one. */
export function targetLane(member) {
  if (!member.stepTarget) return '';
  return miniLane({
    label: 'Personal step target',
    value: `${formatNumber(member.steps)} of ${formatNumber(member.stepTarget)}`,
    fraction: member.targetProgress,
    note:
      member.stepsRemaining > 0
        ? `${formatPercent(member.targetProgress)} there — ${formatNumber(member.stepsRemaining)} steps to go.`
        : `Target smashed — ${formatPercent(member.targetProgress)} of the goal.`,
    tick: member.stepsRemaining === 0,
  });
}

/** Progress towards a personal fundraising goal, or nothing when unset. */
export function fundraisingLane(member, currency) {
  if (!member.fundraisingGoal) return '';
  return miniLane({
    label: 'Personal fundraising goal',
    value: `${formatMoney(member.raised, currency)} of ${formatMoney(member.fundraisingGoal, currency)}`,
    fraction: member.fundraisingProgress,
    note:
      (member.raised ?? 0) > 0
        ? `${formatPercent(member.fundraisingProgress)} of their goal · ${formatPercent(member.shareOfTeamRaised)} of the team's total.`
        : 'No donations yet — a sponsor would put them on the fundraising board.',
  });
}
