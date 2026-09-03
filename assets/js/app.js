/** Renders the scoreboard from the derived competition data. */

import { loadCompetition } from './data.js';
import { initProfiles } from './member.js';
import { accentFor, avatar, handleBrokenAvatars, laneFor } from './ui.js';
import { chartBlock } from './chart.js';
import { buildInsights } from './insights.js';
import {
  escapeHtml,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  ordinal,
  plural,
} from './format.js';

const clampPercent = (fraction) => `${(Math.max(0, Math.min(1, fraction || 0)) * 100).toFixed(1)}%`;

/**
 * The signature bar: a pill track with the name and figure set inside it. The
 * label is drawn twice — once on the track, once clipped to the fill — so it
 * keeps its contrast no matter where the bar ends.
 */
function lane({ colour, title, figure, fraction, meta }) {
  const face = `<span class="lane-title">${escapeHtml(title)}</span>
    <span class="lane-figure">${escapeHtml(figure)}</span>`;

  return `<li class="lane-wrap" style="${laneFor(colour)}; --pct: ${clampPercent(fraction)}">
    <div class="lane" role="img" aria-label="${escapeHtml(`${title}: ${figure}`)}">
      <div class="lane-fill" aria-hidden="true"></div>
      <div class="lane-face" aria-hidden="true">${face}</div>
      <div class="lane-face over" aria-hidden="true">${face}</div>
    </div>
    ${meta ? `<p class="lane-meta">${meta}</p>` : ''}
  </li>`;
}

function rankChip(rank) {
  return `<span class="rank-chip${rank === 1 ? ' first' : ''}">${ordinal(rank)}</span>`;
}

/* ------------------------------------------------------------------- hero -- */

function renderHero(data) {
  const { competition, clock, totals } = data;
  document.getElementById('campaign-title').textContent = competition.name;
  document.title = `${competition.name} — three teams, two challenges`;

  const countdown = clock.finished
    ? 'The month is done — final results below.'
    : `${clock.daysRemaining} ${plural(clock.daysRemaining, 'day')} to go.`;
  document.getElementById('campaign-blurb').textContent =
    `Three teams. Two challenges. Most steps and most raised by 30 September wins. ${countdown}`;

  const raised = formatMoney(totals.raised, competition.currency);
  document.getElementById('hero-stats').innerHTML = `
    <div>
      <dd>${formatNumber(totals.steps)}</dd>
      <dt>Steps together</dt>
    </div>
    <div>
      <dd>${escapeHtml(raised)}</dd>
      <dt>Raised together</dt>
    </div>
    <div>
      <dd>${clock.finished ? clock.totalDays : clock.daysRemaining}</dd>
      <dt>${clock.finished ? 'Days completed' : `Days left of ${clock.totalDays}`}</dt>
    </div>`;
}

/* ------------------------------------------------------------ scoreboards -- */

function renderStepBoard(teams) {
  const rows = teams
    .map((team) =>
      lane({
        colour: team.colour,
        title: team.name,
        figure: formatNumber(team.steps),
        fraction: team.stepStanding.shareOfLeader,
        meta:
          rankChip(team.stepStanding.rank) +
          (team.stepStanding.rank === 1
            ? '<span>Leading the challenge</span>'
            : `<span>${formatNumber(team.stepStanding.gapToLeader)} steps behind</span>`),
      }),
    )
    .join('');

  return `<article class="card">
    <div class="board-head"><h3>Most steps</h3><span class="eyebrow">Challenge 1</span></div>
    <ol class="lanes">${rows}</ol>
  </article>`;
}

function renderMoneyBoard(teams, currency, started) {
  const rows = teams
    .map((team) =>
      lane({
        colour: team.colour,
        title: team.name,
        figure: formatMoney(team.raised, currency),
        // Before any donations the bars would all be empty, so show progress
        // toward each team's own goal instead of a meaningless ranking.
        fraction: started ? team.moneyStanding.shareOfLeader : 0,
        meta: started
          ? rankChip(team.moneyStanding.rank) +
            (team.moneyStanding.rank === 1
              ? '<span>Leading the challenge</span>'
              : `<span>${formatMoney(team.moneyStanding.gapToLeader, currency)} behind</span>`)
          : `<span>Goal ${formatMoney(team.goal, currency)}</span>
             <a class="link" href="${escapeHtml(team.url)}" target="_blank" rel="noopener">Sponsor them</a>`,
      }),
    )
    .join('');

  return `<article class="card">
    <div class="board-head"><h3>Most raised</h3><span class="eyebrow">Challenge 2</span></div>
    ${started ? '' : '<p class="empty">All three teams are level on nothing. The first donation takes the lead.</p>'}
    <ol class="lanes">${rows}</ol>
  </article>`;
}

function renderStandings(data) {
  const { competition, standings } = data;
  document.getElementById('boards').innerHTML =
    renderStepBoard([...data.teams].sort((a, b) => b.steps - a.steps)) +
    renderMoneyBoard(
      [...data.teams].sort((a, b) => (b.raised ?? 0) - (a.raised ?? 0)),
      competition.currency,
      standings.fundraisingStarted,
    );
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

  if (standings.outrightLeader) {
    const leader = standings.outrightLeader;
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
    headline = 'The challenges are split.';
    detail = `${stepLeader.name} leads on steps, ${standings.moneyLeaders[0].name} leads on fundraising.`;
  }

  document.getElementById('verdict').innerHTML = `<div class="verdict">
    <p class="eyebrow">Where it stands</p>
    <h2>${escapeHtml(headline)}</h2>
    <p>${escapeHtml(detail)}</p>
  </div>`;
}

/* ------------------------------------------------------------ team cards -- */

function rosterRow(member, currency) {
  return `<li>
    <button type="button" class="person" data-member-id="${escapeHtml(member.id)}">
      ${avatar(member)}
      <span class="person-name">
        ${escapeHtml(member.name)}${member.captain ? '<span class="captain-tag">Captain</span>' : ''}
        <small>${formatPercent(member.targetProgress ?? 0)} of their target</small>
      </span>
      <span class="person-value">
        ${formatNumber(member.steps)}
        <small>${formatMoney(member.raised, currency)}</small>
      </span>
    </button>
  </li>`;
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

      return `<article class="team" style="${accentFor(team.colour)}">
        <div class="team-top"><h3>${escapeHtml(team.name)}</h3></div>
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

        ${chartBlock({
          title: 'Cumulative steps',
          values: team.cumulative,
          totalDays: data.clock.totalDays,
          target: team.stepTarget,
          colour: `var(--team-${team.colour})`,
          label: `${team.name} cumulative steps through September, currently ${formatNumber(team.steps)} against a combined target of ${formatNumber(team.stepTarget)}`,
          note: `Dashed line is the pace to their combined ${formatNumber(team.stepTarget)} step target.`,
        })}

        <p class="roster-title">Team roster</p>
        <ul class="roster">
          ${[...team.members]
            .sort((a, b) => b.steps - a.steps)
            .map((member) => rosterRow(member, competition.currency))
            .join('')}
        </ul>

        <div class="btn-row">
          <a class="btn btn-solid" href="${escapeHtml(team.url)}" target="_blank" rel="noopener">
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

function renderLadder({ title, subtitle, members, valueOf, body }) {
  const rows = members
    .map(
      (member, index) => `<li>
        <button type="button" class="person" data-member-id="${escapeHtml(member.id)}">
          <span class="pos">${index + 1}</span>
          ${avatar(member, 'sm')}
          <span class="person-name">
            ${escapeHtml(member.name)}
            <small>${escapeHtml(member.teamName)}</small>
          </span>
          <span class="person-value">${escapeHtml(valueOf(member))}</span>
        </button>
      </li>`,
    )
    .join('');

  return `<article class="card">
    <div class="board-head"><h3>${escapeHtml(title)}</h3><span class="eyebrow">${escapeHtml(subtitle)}</span></div>
    ${body ?? `<ul class="ladder">${rows}</ul>`}
  </article>`;
}

/** Everyone's steps combined, full width across the foot of the page. */
function renderOverallChart(data) {
  const { totals, clock } = data;
  document.getElementById('overall-chart').innerHTML = `<article class="card">
    ${chartBlock({
      title: `Cumulative steps · all ${totals.memberCount} steppers`,
      values: totals.cumulative,
      totalDays: clock.totalDays,
      target: totals.stepTarget,
      colour: 'var(--brand)',
      label: `Combined cumulative steps for all ${totals.memberCount} participants through September, currently ${formatNumber(totals.steps)} against a combined target of ${formatNumber(totals.stepTarget)}`,
      note: `Dashed line is the pace to everyone's combined ${formatNumber(totals.stepTarget)} step target.`,
      wide: true,
    })}
  </article>`;
}

/** Milestones and fun comparisons, under the verdict panel. */
function renderInsights(data) {
  const cards = buildInsights(data)
    .map(
      (fact) => `<article class="insight"${fact.colour ? ` style="${accentFor(fact.colour)}"` : ''}>
        <span class="insight-kind">${escapeHtml(fact.kind)}</span>
        <p>${fact.html}</p>
      </article>`,
    )
    .join('');
  document.getElementById('insights').innerHTML = cards ? `<div class="insights">${cards}</div>` : '';
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
      // Numbering twelve people who are all on $0 would assert an order that
      // doesn't exist. Show the prompt to give instead, until someone is ahead.
      body: standings.fundraisingStarted
        ? null
        : `<p class="empty">
             Nobody has been sponsored yet — the first donation puts someone straight to the top
             of this list. Every dollar goes to the Cerebral Palsy Alliance.
           </p>
           <div class="btn-row">
             ${data.teams
               .map(
                 (team) =>
                   `<a class="btn btn-solid" style="${accentFor(team.colour)}" href="${escapeHtml(team.url)}"
                       target="_blank" rel="noopener">Sponsor ${escapeHtml(team.name)}</a>`,
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
        `<li><a class="btn" href="${escapeHtml(team.url)}" target="_blank" rel="noopener">${escapeHtml(team.name)}</a></li>`,
    )
    .join('');
}

/* ------------------------------------------------------------------- boot -- */

/**
 * Light/dark toggle. The choice is remembered per browser and wins over the OS
 * setting in both directions; the CSS covers the OS default on its own.
 */
function initThemeToggle() {
  const button = document.getElementById('theme-toggle');
  if (!button) return;

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && prefersDark.matches);

  const sync = () => button.setAttribute('aria-pressed', String(isDark()));
  sync();

  button.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch (error) {
      /* Storage can be blocked; the toggle still works for this visit. */
    }
    sync();
  });

  // Follow the OS while the viewer hasn't made a choice of their own.
  prefersDark.addEventListener('change', sync);
}

async function start() {
  try {
    initThemeToggle();
    handleBrokenAvatars();
    const data = await loadCompetition();
    renderHero(data);
    renderStandings(data);
    renderVerdict(data);
    renderInsights(data);
    renderTeams(data);
    renderLadders(data);
    renderOverallChart(data);
    renderFooter(data);
    initProfiles(data);
  } catch (error) {
    console.error(error);
    const banner = document.getElementById('load-error');
    if (!banner) return;
    banner.hidden = false;
    banner.textContent =
      error.name === 'DataLoadError'
        ? `The scoreboard data could not be loaded (${error.message}). If you opened this file directly, serve the folder over HTTP instead — for example: python3 -m http.server`
        : // Anything else is a fault in the page's own code. By far the most
          // common cause is a stale script left over from a previous deploy.
          `Something went wrong drawing the scoreboard (${error.message}). This is usually an out-of-date script held in the browser cache — a hard refresh (Ctrl+Shift+R, or Cmd+Shift+R on a Mac) should clear it.`;
  }
}

start();
