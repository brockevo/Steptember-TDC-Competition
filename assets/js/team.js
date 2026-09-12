/**
 * The team dialog.
 *
 * Deliberately the same shape as the member dialog (`member.js`): the hash
 * prefix, the modal, the backdrop close, the focus return and the deep link all
 * work identically, so a team behaves the way a person already does rather than
 * introducing a second set of habits.
 */

import { avatar } from './ui.js';
import { chartBlock, moneyBlock } from './chart.js';
import { panelFor, scopesFor, switcher, initSwitcher } from './scope.js';
import {
  escapeHtml,
  formatMoney,
  formatNumber,
  formatPercent,
  ordinal,
  plural,
} from './format.js';

const HASH_PREFIX = '#team/';

function kpi(label, value, note) {
  return `<div class="kpi">
    <dt>${escapeHtml(label)}</dt>
    <dd>${escapeHtml(value)}${note ? `<small>${escapeHtml(note)}</small>` : ''}</dd>
  </div>`;
}

/** The team's own figures, among the three of us. */
function challengeStats(team, data) {
  const { competition, clock } = data;
  const stats = [
    kpi('Total steps', formatNumber(team.steps), `${ordinal(team.stepStanding.rank)} of the three teams`),
    kpi(
      'Per person per day',
      formatNumber(team.stepsPerMemberPerDay),
      `across ${team.memberCount} ${plural(team.memberCount, 'member')}`,
    ),
    kpi(
      'Projected by 30 Sep',
      formatNumber(team.projectedSteps),
      clock.daysElapsed < 5 ? 'at this pace — early days, so treat it lightly' : 'at their current pace',
    ),
    kpi(
      'Raised',
      formatMoney(team.raised, competition.currency),
      team.goal ? `${formatPercent(team.goalProgress)} of a ${formatMoney(team.goal, competition.currency)} goal` : 'no goal set',
    ),
  ];

  if (team.stepTarget) {
    stats.push(
      kpi(
        'Combined step target',
        formatNumber(team.stepTarget),
        `${formatPercent(team.steps / team.stepTarget)} of the way there`,
      ),
    );
  }

  return stats.join('');
}

function rosterRows(team, currency) {
  return [...team.members]
    .sort((a, b) => b.steps - a.steps)
    .map(
      (member) => `<li>
        <button type="button" class="person" data-member-id="${escapeHtml(member.id)}">
          ${avatar(member, 'sm')}
          <span class="person-name">${escapeHtml(member.name)}</span>
          <span class="person-figure">
            <strong>${formatNumber(member.steps)}</strong>
            <small>${formatMoney(member.raised, currency)}</small>
          </span>
        </button>
      </li>`,
    )
    .join('');
}

function buildTeam(team, data) {
  const { competition, clock } = data;
  const scopes = scopesFor(team);

  return `
    <div class="profile-head">
      ${avatar(team, 'lg is-team')}
      <div>
        <h2 id="team-name">${escapeHtml(team.name)}</h2>
        <a class="profile-team" href="${escapeHtml(team.url)}" target="_blank" rel="noopener">
          <span class="dot" aria-hidden="true"></span>${team.memberCount} ${plural(team.memberCount, 'member')}
        </a>
      </div>
      <button type="button" class="close" data-close aria-label="Close team">&times;</button>
    </div>

    ${switcher(scopes)}

    <div data-scope-panel="challenge">
      <dl class="kpis">${challengeStats(team, data)}</dl>
    </div>
    ${
      scopes.some((scope) => scope.id === 'org')
        ? `<div data-scope-panel="org" hidden>${panelFor('org', team, 'team')}</div>`
        : ''
    }

    ${chartBlock({
      title: 'Cumulative steps',
      values: team.cumulative,
      dates: data.history.dates,
      totalDays: clock.totalDays,
      target: team.stepTarget,
      colour: `var(--team-${team.colour})`,
      subject: team.name,
      label: `${team.name} cumulative steps through September, currently ${formatNumber(team.steps)}`,
      note: team.stepTarget
        ? `Dashed line is the pace to their combined ${formatNumber(team.stepTarget)} step target.`
        : null,
    })}

    ${moneyBlock({
      values: team.raisedCumulative,
      dates: data.history.dates,
      totalDays: clock.totalDays,
      target: team.goal,
      colour: `var(--team-${team.colour})`,
      subject: team.name,
      currency: competition.currency,
      startsOn: data.money.startsOn,
    })}

    <p class="roster-title">Team roster</p>
    <ul class="roster">${rosterRows(team, competition.currency)}</ul>

    <div class="profile-links">
      <a class="btn btn-solid" href="${escapeHtml(team.url)}" target="_blank" rel="noopener">
        Sponsor this team
      </a>
    </div>`;
}

export function initTeams(data) {
  const dialog = document.getElementById('team-dialog');
  const body = document.getElementById('team-body');
  if (!dialog || !body) return;
  let opener = null;

  function open(teamId, { fromHash = false } = {}) {
    const team = data.teamsById.get(teamId);
    if (!team) return;
    body.style.setProperty('--accent', `var(--team-${team.colour})`);
    body.style.setProperty('--lane', `var(--lane-${team.colour})`);
    body.innerHTML = buildTeam(team, data);
    initSwitcher(body);
    if (!dialog.open) dialog.showModal();
    if (!fromHash) history.replaceState(null, '', `${HASH_PREFIX}${teamId}`);
    dialog.querySelector('[data-close]')?.focus();
  }

  document.addEventListener('click', (event) => {
    // A member inside the team dialog opens their own profile, so the team
    // dialog steps aside rather than stacking two modals.
    if (dialog.open && event.target.closest('[data-member-id]')) {
      dialog.close();
      return;
    }
    const trigger = event.target.closest('[data-team-id]');
    if (!trigger) return;
    opener = trigger;
    open(trigger.dataset.teamId);
  });

  dialog.addEventListener('close', () => {
    if (location.hash.startsWith(HASH_PREFIX)) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    opener?.focus();
    opener = null;
  });

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

  // A shared or refreshed #team/<slug> link opens straight into that team.
  if (location.hash.startsWith(HASH_PREFIX)) {
    open(location.hash.slice(HASH_PREFIX.length), { fromHash: true });
  }
}
