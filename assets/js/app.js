/** Renders the scoreboard from the derived competition data. */

import { loadCompetition } from './data.js';
import { initProfiles } from './member.js';
import {
  escapeHtml,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  ordinal,
  plural,
} from './format.js';

const POSITION_LABEL = { 1: '1st', 2: '2nd', 3: '3rd' };

const accentFor = (team) => `--accent: var(--team-${team.colour})`;

/**
 * A bar carrying its own value in the label, so the figure never depends on
 * reading the geometry — and so the lighter palette slots stay legible.
 */
function bar(fraction, label) {
  const width = Math.max(0, Math.min(1, fraction || 0)) * 100;
  return `<div class="bar" role="img" aria-label="${escapeHtml(label)}">
    <span style="width: ${width.toFixed(1)}%"></span>
  </div>`;
}

/* ------------------------------------------------------------------- hero -- */

function renderHero(data) {
  const { competition, clock, totals } = data;
  document.getElementById('campaign-title').textContent =
    `${competition.name} ${competition.year ?? ''}`.trim();
  document.title = `${competition.name} — three teams, two challenges`;

  const window_ = clock.finished
    ? 'Finished — 30 September 2026'
    : `1–30 September ${competition.year ?? 2026}`;
  document.getElementById('campaign-window').textContent = window_;

  const countdown = clock.finished
    ? 'The month is done — final results below.'
    : `${clock.daysRemaining} ${plural(clock.daysRemaining, 'day')} to go.`;
  document.getElementById('campaign-blurb').textContent =
    `Three teams. Two challenges. Most steps and most raised by 30 September wins. ${countdown}`;

  document.getElementById('hero-stats').innerHTML = `
    <div class="stat">
      <dt>Steps together</dt>
      <dd class="num">${formatNumber(totals.steps)}</dd>
      <small>${totals.memberCount} steppers across 3 teams</small>
    </div>
    <div class="stat">
      <dt>Raised together</dt>
      <dd class="num">${formatMoney(totals.raised, competition.currency)}</dd>
      <small>of ${formatMoney(totals.goal, competition.currency)} in combined goals</small>
    </div>
    <div class="stat">
      <dt>${clock.finished ? 'Days completed' : 'Days remaining'}</dt>
      <dd class="num">${clock.finished ? clock.totalDays : clock.daysRemaining}</dd>
      <small>day ${clock.daysElapsed} of ${clock.totalDays}</small>
    </div>`;
}

/* ------------------------------------------------------------ scoreboards -- */

function renderBoard({ title, subtitle, teams, valueOf, standingOf, gapLabel }) {
  const rows = teams
    .map((team) => {
      const standing = standingOf(team);
      const isLeader = standing.rank === 1;
      const gap = isLeader
        ? '<span class="race-gap leading">Leading</span>'
        : `<span class="race-gap">${escapeHtml(gapLabel(standing.gapToLeader))}</span>`;

      return `<li style="${accentFor(team)}">
        <div class="race-top">
          <span class="pos">${POSITION_LABEL[standing.rank] ?? ordinal(standing.rank)}</span>
          <span class="race-name">${escapeHtml(team.name)}</span>
          <span class="race-value">${escapeHtml(valueOf(team))}</span>
        </div>
        ${bar(standing.shareOfLeader, `${team.name}: ${valueOf(team)}`)}
        ${gap}
      </li>`;
    })
    .join('');

  return `<article class="board">
    <div class="board-head">
      <h3>${escapeHtml(title)}</h3>
      <span class="eyebrow">${escapeHtml(subtitle)}</span>
    </div>
    <ol class="race">${rows}</ol>
  </article>`;
}

/**
 * Before the first donation every team is on $0, so ranking them would be
 * meaningless. Show the field level, with each team's goal and a way to give.
 */
function renderMoneyBoardAtZero(teams, currency) {
  const rows = teams
    .map(
      (team) => `<li style="${accentFor(team)}">
        <div class="race-top">
          <span class="pos">—</span>
          <span class="race-name">${escapeHtml(team.name)}</span>
          <span class="race-value">${formatMoney(0, currency)}</span>
        </div>
        <span class="race-gap">
          Goal ${formatMoney(team.goal, currency)} ·
          <a href="${escapeHtml(team.url)}" target="_blank" rel="noopener">Sponsor them</a>
        </span>
      </li>`,
    )
    .join('');

  return `<article class="board">
    <div class="board-head">
      <h3>Most raised</h3>
      <span class="eyebrow">Challenge 2</span>
    </div>
    <p class="empty">All three teams are level on nothing. The first donation takes the lead.</p>
    <ol class="race">${rows}</ol>
  </article>`;
}

function renderStandings(data) {
  const { competition, standings } = data;
  const bySteps = [...data.teams].sort((a, b) => b.steps - a.steps);
  const byMoney = [...data.teams].sort((a, b) => (b.raised ?? 0) - (a.raised ?? 0));

  const moneyBoard = standings.fundraisingStarted
    ? renderBoard({
        title: 'Most raised',
        subtitle: 'Challenge 2',
        teams: byMoney,
        valueOf: (team) => formatMoney(team.raised, competition.currency),
        standingOf: (team) => team.moneyStanding,
        gapLabel: (gap) => `${formatMoney(gap, competition.currency)} behind`,
      })
    : renderMoneyBoardAtZero(byMoney, competition.currency);

  document.getElementById('boards').innerHTML =
    renderBoard({
      title: 'Most steps',
      subtitle: 'Challenge 1',
      teams: bySteps,
      valueOf: (team) => formatNumber(team.steps),
      standingOf: (team) => team.stepStanding,
      gapLabel: (gap) => `${formatNumber(gap)} steps behind`,
    }) + moneyBoard;
}

function renderVerdict(data) {
  const { standings, competition } = data;
  const [stepLeader] = standings.stepLeaders;
  const stepGap = [...data.teams]
    .map((team) => team.stepStanding)
    .filter((standing) => standing.rank !== 1)
    .reduce((closest, standing) => Math.min(closest, standing.gapToLeader), Infinity);

  let headline;
  let detail;
  let accent = `--accent: var(--team-${stepLeader.colour})`;

  if (standings.outrightLeader) {
    const leader = standings.outrightLeader;
    accent = `--accent: var(--team-${leader.colour})`;
    headline = `${leader.name} leads both challenges.`;
    detail = `${formatNumber(stepGap)} steps clear of second, with ${formatMoney(
      leader.moneyStanding.value,
      competition.currency,
    )} raised.`;
  } else if (!standings.fundraisingStarted) {
    headline =
      standings.stepLeaders.length > 1
        ? 'The step challenge is level at the top.'
        : `${stepLeader.name} leads the step challenge.`;
    detail =
      standings.stepLeaders.length > 1
        ? 'Fundraising has not started, so both challenges are still anyone’s.'
        : `${formatNumber(stepGap)} steps clear of second — and with no donations in yet, the fundraising challenge is untouched.`;
  } else {
    const moneyLeader = standings.moneyLeaders[0];
    headline = 'The challenges are split.';
    detail = `${stepLeader.name} leads on steps, ${moneyLeader.name} leads on fundraising.`;
  }

  document.getElementById('verdict').innerHTML = `<div class="verdict" style="${accent}">
    <p>${escapeHtml(headline)}</p>
    <span>${escapeHtml(detail)}</span>
  </div>`;
}

/* ------------------------------------------------------------ team cards -- */

function rosterRow(member, currency, teamBest) {
  const captain = member.captain ? '<span class="crown">Captain</span>' : '';
  // Measured against the team's top stepper, so the bars rank the same way the
  // numbers beside them do.
  return `<tr data-member-id="${escapeHtml(member.id)}">
    <td>
      <button type="button" class="member-button">${escapeHtml(member.name)}</button>${captain}
      ${bar(teamBest > 0 ? member.steps / teamBest : 0, `${member.name}: ${formatNumber(member.steps)} steps`)}
    </td>
    <td class="num">${formatNumber(member.steps)}</td>
    <td class="num">${formatMoney(member.raised, currency)}</td>
  </tr>`;
}

function renderTeams(data) {
  const { competition } = data;
  document.getElementById('teams').innerHTML = [...data.teams]
    .sort((a, b) => b.steps - a.steps)
    .map((team) => {
      const stepBadge =
        team.stepStanding.rank === 1
          ? '<span class="badge badge-lead">Leading on steps</span>'
          : `<span class="badge">${ordinal(team.stepStanding.rank)} on steps</span>`;
      const moneyBadge = data.standings.fundraisingStarted
        ? team.moneyStanding.rank === 1
          ? '<span class="badge badge-lead">Leading on fundraising</span>'
          : `<span class="badge">${ordinal(team.moneyStanding.rank)} on fundraising</span>`
        : '<span class="badge">Fundraising not started</span>';

      return `<article class="team" style="${accentFor(team)}">
        <h3>${escapeHtml(team.name)}</h3>
        <div class="badges">
          ${stepBadge}${moneyBadge}
          <span class="badge">${team.memberCount} ${plural(team.memberCount, 'member')}</span>
        </div>

        <div class="team-figures">
          <div class="figure">
            <div class="label">Total steps</div>
            <div class="value">${formatNumber(team.steps)}</div>
            <div class="note">${formatNumber(team.stepsPerMemberPerDay)} per person per day</div>
          </div>
          <div class="figure">
            <div class="label">Raised</div>
            <div class="value">${formatMoney(team.raised, competition.currency)}</div>
            <div class="note">
              ${
                team.goal
                  ? `${formatPercent(team.goalProgress)} of ${formatMoney(team.goal, competition.currency)} goal`
                  : 'no goal set'
              }
            </div>
          </div>
        </div>

        <table class="roster">
          <caption>Team roster</caption>
          <thead>
            <tr><th scope="col">Member</th><th scope="col">Steps</th><th scope="col">Raised</th></tr>
          </thead>
          <tbody>
            ${[...team.members]
              .sort((a, b) => b.steps - a.steps)
              .map((member, _, sorted) =>
                rosterRow(member, competition.currency, sorted[0].steps),
              )
              .join('')}
          </tbody>
        </table>

        <div class="team-links">
          <a class="btn btn-primary" href="${escapeHtml(team.url)}" target="_blank" rel="noopener">
            Sponsor this team
          </a>
          <a class="btn" href="${escapeHtml(team.url)}" target="_blank" rel="noopener">
            Steptember page
          </a>
        </div>
      </article>`;
    })
    .join('');
}

/* ---------------------------------------------------- individual ladders --- */

function renderLadder({ title, subtitle, members, valueOf, emptyBody }) {
  const rows = members
    .map(
      (member, index) => `<li style="--accent: var(--team-${member.teamColour})">
        <button type="button" class="ladder-row" data-member-id="${escapeHtml(member.id)}">
          <span class="pos">${index + 1}</span>
          <span class="dot" aria-hidden="true"></span>
          <span class="ladder-name">
            ${escapeHtml(member.name)}
            <small>${escapeHtml(member.teamName)}</small>
          </span>
          <span class="ladder-value">${escapeHtml(valueOf(member))}</span>
        </button>
      </li>`,
    )
    .join('');

  return `<article class="board">
    <div class="board-head">
      <h3>${escapeHtml(title)}</h3>
      <span class="eyebrow">${escapeHtml(subtitle)}</span>
    </div>
    ${emptyBody ?? `<ol class="ladder">${rows}</ol>`}
  </article>`;
}

function renderLadders(data) {
  const { competition, standings } = data;
  document.getElementById('ladders').innerHTML =
    renderLadder({
      title: 'Top steppers',
      subtitle: 'All teams',
      members: [...data.members].sort((a, b) => b.steps - a.steps),
      valueOf: (member) => formatNumber(member.steps),
    }) +
    renderLadder({
      title: 'Top fundraisers',
      subtitle: 'All teams',
      members: [...data.members].sort((a, b) => (b.raised ?? 0) - (a.raised ?? 0)),
      valueOf: (member) => formatMoney(member.raised, competition.currency),
      emptyBody: standings.fundraisingStarted
        ? null
        : `<p class="empty">
             Nobody has been sponsored yet. The first donation puts someone straight to the top
             of this list — every dollar goes to the Cerebral Palsy Alliance.
           </p>
           <div class="team-links" style="padding-top: 0">
             ${data.teams
               .map(
                 (team) =>
                   `<a class="btn" href="${escapeHtml(team.url)}" target="_blank" rel="noopener">
                      Sponsor ${escapeHtml(team.name)}
                    </a>`,
               )
               .join('')}
           </div>`,
    });
}

/* ----------------------------------------------------------------- footer -- */

function renderFooter(data) {
  const { competition } = data;
  const source =
    competition.dataSource === 'manual'
      ? 'Figures entered by hand.'
      : 'Figures pulled automatically from each team’s public Steptember page.';
  const partial =
    competition.dataSource === 'partial'
      ? ' Some teams could not be reached on the last run and are showing their previous figures.'
      : '';

  document.getElementById('footer-source').textContent =
    `${source}${partial} Last updated ${formatDateTime(competition.lastUpdated)}.`;

  document.getElementById('footer-links').innerHTML = data.teams
    .map(
      (team) =>
        `<li><a href="${escapeHtml(team.url)}" target="_blank" rel="noopener">${escapeHtml(team.name)}</a></li>`,
    )
    .join('');
}

/* ------------------------------------------------------------------- boot -- */

async function start() {
  try {
    const data = await loadCompetition();
    renderHero(data);
    renderStandings(data);
    renderVerdict(data);
    renderTeams(data);
    renderLadders(data);
    renderFooter(data);
    initProfiles(data);
  } catch (error) {
    const banner = document.getElementById('load-error');
    banner.hidden = false;
    banner.textContent = `The scoreboard data could not be loaded (${error.message}). If you opened this file directly, serve the folder over HTTP instead — for example: python3 -m http.server`;
    console.error(error);
  }
}

start();
