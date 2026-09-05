/**
 * The member profile dialog.
 *
 * Every stat here comes from data we actually hold. Anything that needs
 * day-by-day history we don't have yet is left out rather than filled in.
 */

import { avatar } from './ui.js';
import { chartBlock } from './chart.js';
import { fundraisingLane, memberStats, targetLane } from './stats.js';
import { escapeHtml, formatNumber } from './format.js';

const HASH_PREFIX = '#member/';

/**
 * Daily steps as bars with the value floating above each one. Only meaningful
 * once history holds two or more days to difference, so the caller checks first.
 */
function dailyChart(deltas) {
  const recent = deltas.slice(-6);
  const peak = Math.max(...recent.map((day) => day.steps), 1);
  const best = recent.reduce((top, day) => (day.steps > top.steps ? day : top));

  const columns = recent
    .map((day) => {
      const height = Math.max((day.steps / peak) * 100, 4);
      const label = new Date(`${day.date}T00:00:00`).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'short',
      });
      return `<div class="daily-col">
        <span class="bubble">${formatNumber(day.steps)}</span>
        <div class="daily-bar${day === best ? ' best' : ''}" style="height: ${height.toFixed(1)}%"></div>
        <span class="daily-label">${escapeHtml(label)}</span>
      </div>`;
    })
    .join('');

  return `<section class="daily">
    <h3>Steps per day</h3>
    <div class="daily-plot">${columns}</div>
  </section>`;
}

function buildProfile(member, data) {
  const { competition, clock } = data;
  const stats = memberStats(member, data);

  const deltas = data.history.deltasFor(member.id);

  return `
    <div class="profile-head">
      ${avatar(member, 'lg')}
      <div>
        <h2 id="profile-name">${escapeHtml(member.name)}${
          member.captain ? '<span class="captain-tag">Captain</span>' : ''
        }</h2>
        <a class="profile-team" href="${escapeHtml(member.teamUrl)}" target="_blank" rel="noopener">
          <span class="dot" aria-hidden="true"></span>${escapeHtml(member.teamName)}
        </a>
      </div>
      <button type="button" class="close" data-close aria-label="Close profile">&times;</button>
    </div>

    <dl class="kpis">${stats.join('')}</dl>
    ${chartBlock({
      title: 'Cumulative steps',
      values: member.cumulative,
      dates: data.history.dates,
      totalDays: clock.totalDays,
      target: member.stepTarget,
      colour: `var(--team-${member.teamColour})`,
      label: `${member.name}'s cumulative steps through September, currently ${formatNumber(member.steps)}${
        member.stepTarget ? ` against a ${formatNumber(member.stepTarget)} step target` : ''
      }`,
      note: member.stepTarget
        ? `Dashed line is the pace to their ${formatNumber(member.stepTarget)} step target.`
        : null,
    })}
    ${deltas.length ? dailyChart(deltas) : ''}
    ${targetLane(member)}
    ${fundraisingLane(member, competition.currency)}

    <div class="profile-links">
      <a class="btn btn-solid" href="${escapeHtml(member.url)}" target="_blank" rel="noopener">
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
    body.style.setProperty('--lane', `var(--lane-${member.teamColour})`);
    body.innerHTML = buildProfile(member, data);
    if (!dialog.open) dialog.showModal();
    if (!fromHash) history.replaceState(null, '', `${HASH_PREFIX}${memberId}`);
    dialog.querySelector('[data-close]')?.focus();
  }

  // One delegated listener covers roster rows and both leaderboards.
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-member-id]');
    if (trigger) {
      opener = trigger;
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
