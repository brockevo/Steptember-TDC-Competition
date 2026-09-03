/**
 * The member profile dialog.
 *
 * Every stat here comes from data we actually hold. Anything that needs
 * day-by-day history we don't have yet is left out rather than filled in.
 */

import {
  escapeHtml,
  formatMoney,
  formatNumber,
  formatPercent,
  ordinal,
  plural,
} from './format.js';

const HASH_PREFIX = '#member/';

function kpi(label, value, note) {
  return `<div class="kpi">
    <dt>${escapeHtml(label)}</dt>
    <dd>${escapeHtml(value)}${note ? `<small>${escapeHtml(note)}</small>` : ''}</dd>
  </div>`;
}

function progressBlock({ label, value, fraction, note, accentNote }) {
  const width = Math.max(0, Math.min(1, fraction || 0)) * 100;
  return `<div class="progress-block">
    <div class="progress-head">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
    <div class="bar" role="img" aria-label="${escapeHtml(`${label}: ${value}`)}">
      <span style="width: ${width.toFixed(1)}%"></span>
    </div>
    ${note ? `<p class="progress-note">${accentNote ?? ''}${escapeHtml(note)}</p>` : ''}
  </div>`;
}

function buildProfile(member, data) {
  const { competition, clock, members } = data;
  const currency = competition.currency;
  /** Under a week in, a straight-line projection is noise, not a forecast. */
  const earlyDays = clock.daysElapsed < 5;

  const stepStats = [
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
      // Early in the month a handful of days is a thin basis for a forecast, so
      // say so rather than dressing the arithmetic up as a prediction.
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
    stepStats.push(
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
    stepStats.push(kpi('Best day', formatNumber(member.bestDay.steps), `on ${member.bestDay.date}`));
  }
  if (member.lastDay) {
    stepStats.push(kpi('Latest day', formatNumber(member.lastDay.steps), `on ${member.lastDay.date}`));
  }

  stepStats.push(
    kpi('Distance walked', `${member.distanceKm.toFixed(1)} km`, 'estimated at 0.75 m per step'),
  );

  if (member.personAbove) {
    stepStats.push(
      kpi(
        'Gap to catch',
        formatNumber(member.gapToPersonAbove),
        `steps behind ${member.personAbove}`,
      ),
    );
  } else {
    stepStats.push(kpi('Overall position', 'Out in front', 'leading every stepper'));
  }

  const targetProgress = member.stepTarget
    ? progressBlock({
        label: 'Personal step target',
        value: `${formatNumber(member.steps)} of ${formatNumber(member.stepTarget)}`,
        fraction: member.targetProgress,
        note:
          member.stepsRemaining > 0
            ? `${formatPercent(member.targetProgress)} there — ${formatNumber(member.stepsRemaining)} steps to go.`
            : `Target smashed — ${formatPercent(member.targetProgress)} of the goal.`,
        accentNote: member.stepsRemaining === 0 ? '<span class="on-track">✓</span> ' : '',
      })
    : '';

  const fundraising = member.fundraisingGoal
    ? progressBlock({
        label: 'Personal fundraising goal',
        value: `${formatMoney(member.raised, currency)} of ${formatMoney(member.fundraisingGoal, currency)}`,
        fraction: member.fundraisingProgress,
        note:
          (member.raised ?? 0) > 0
            ? `${formatPercent(member.fundraisingProgress)} of their goal · ${formatPercent(member.shareOfTeamRaised)} of the team's total.`
            : 'No donations yet — a sponsor would put them on the fundraising board.',
      })
    : '';

  return `
    <div class="profile-head">
      <div>
        <h2 id="profile-name">${escapeHtml(member.name)}${
          member.captain ? '<span class="crown">Team captain</span>' : ''
        }</h2>
        <a class="profile-team" href="${escapeHtml(member.teamUrl)}" target="_blank" rel="noopener">
          <span class="dot" aria-hidden="true"></span>${escapeHtml(member.teamName)}
        </a>
      </div>
      <button type="button" class="close" data-close aria-label="Close profile">&times;</button>
    </div>

    <dl class="kpis">${stepStats.join('')}</dl>
    ${targetProgress}
    ${fundraising}

    <div class="profile-links">
      <a class="btn btn-primary" href="${escapeHtml(member.url)}" target="_blank" rel="noopener">
        Sponsor ${escapeHtml(member.name.split(' ')[0])}
      </a>
      <a class="btn" href="${escapeHtml(member.url)}" target="_blank" rel="noopener">
        Steptember profile
      </a>
    </div>`;
}

export function initProfiles(data) {
  const dialog = document.getElementById('profile-dialog');
  const body = document.getElementById('profile-body');
  let opener = null;

  function open(memberId, { fromHash = false } = {}) {
    const member = data.membersById.get(memberId);
    if (!member) return;
    // Their team's colour drives every accent inside the dialog.
    body.style.setProperty('--accent', `var(--team-${member.teamColour})`);
    body.innerHTML = buildProfile(member, data);
    if (!dialog.open) dialog.showModal();
    if (!fromHash) history.replaceState(null, '', `${HASH_PREFIX}${memberId}`);
    dialog.querySelector('[data-close]')?.focus();
  }

  // One delegated listener covers roster rows and both leaderboards.
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-member-id]');
    if (trigger) {
      opener = event.target.closest('button') ?? trigger;
      open(trigger.dataset.memberId);
      return;
    }
    if (event.target.closest('[data-close]')) dialog.close();
  });

  dialog.addEventListener('close', () => {
    if (location.hash.startsWith(HASH_PREFIX)) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    opener?.focus();
    opener = null;
  });

  // Clicking the backdrop (outside the dialog's own box) closes it too.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith(HASH_PREFIX)) {
      open(location.hash.slice(HASH_PREFIX.length), { fromHash: true });
    } else if (dialog.open) {
      dialog.close();
    }
  });

  // A shared or refreshed #member/<slug> link opens straight into that profile.
  if (location.hash.startsWith(HASH_PREFIX)) {
    open(location.hash.slice(HASH_PREFIX.length), { fromHash: true });
  }
}
