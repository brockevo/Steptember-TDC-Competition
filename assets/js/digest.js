/**
 * "Since you last looked" — what has changed since the viewer last acknowledged
 * the scoreboard.
 *
 * A thirty-day competition needs a reason to come back, and until now the site
 * greeted a returning viewer exactly as it greeted a first-time one.
 *
 * Everything it remembers lives in this browser's own localStorage and goes
 * nowhere else — the same posture as the Profile page. There is no backend to
 * send it to: the site is a folder of static files with no analytics, no
 * cookies and nothing keyed to a person or a device.
 */

import { escapeHtml, formatMoney, formatNumber, ordinal, plural } from './format.js';

const KEY = 'steptember:seen';

/**
 * Storage can be unavailable — private browsing, or a browser set to block it.
 * Every read and write is guarded; when it fails the digest simply never
 * appears, which is a better failure than a thrown error on load.
 */
function readSeen() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeSeen(next) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (error) {
    /* Nothing to do: the digest is a nicety, not something to fail the page for. */
  }
}

/** Which profile the viewer picked, if any. Read-only — this never sets it. */
function myId() {
  try {
    return JSON.parse(localStorage.getItem('steptember:me') ?? 'null')?.memberId ?? null;
  } catch (error) {
    return null;
  }
}

/** The handful of figures worth diffing, small enough to keep in storage. */
function snapshot(data) {
  const me = myId();
  const mine = me ? data.membersById?.get(me) : null;

  return {
    version: data.competition.lastUpdated,
    at: new Date().toISOString(),
    steps: data.totals.steps,
    raised: data.totals.raised,
    leader: data.standings?.stepLeaders?.[0]?.id ?? null,
    me: mine ? { id: mine.id, steps: mine.steps, rank: mine.overallStepRank } : null,
  };
}

/** "yesterday", "on Tuesday", or a date once it is far enough back to need one. */
function when(iso) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'you last looked';
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 7) return then.toLocaleDateString('en-AU', { weekday: 'long' });
  return `${days} days ago`;
}

/**
 * The lines worth showing. Each is included only when it actually moved, so the
 * strip never pads itself out with "no change" — an empty list means no strip.
 */
function linesFor(before, now, data) {
  const lines = [];
  const { currency } = data.competition;

  const steps = now.steps - before.steps;
  const raised = now.raised - before.raised;
  if (steps > 0) {
    lines.push(
      `Between you all, <strong>${formatNumber(steps)}</strong> more ${plural(steps, 'step')}` +
        (raised > 0 ? ` and <strong>${formatMoney(raised, currency)}</strong> more raised.` : '.'),
    );
  } else if (raised > 0) {
    lines.push(`<strong>${formatMoney(raised, currency)}</strong> more raised.`);
  }

  // The viewer's own line, when they have picked a profile.
  const mine = now.me && before.me && before.me.id === now.me.id ? now.me : null;
  if (mine) {
    const added = mine.steps - before.me.steps;
    const moved = before.me.rank - mine.rank;
    const climbed = `<strong>${moved > 0 ? 'up' : 'down'} ${Math.abs(moved)} ${plural(Math.abs(moved), 'place')}</strong> to ${ordinal(mine.rank)}`;
    const walked = `You added <strong>${formatNumber(added)}</strong> ${plural(added, 'step')}`;

    if (added > 0 && moved !== 0) lines.push(`${walked}, and you're ${climbed}.`);
    else if (added > 0) lines.push(`${walked} — still ${ordinal(mine.rank)}.`);
    else if (moved !== 0) lines.push(`You're ${climbed}.`);
  }

  // A change of leader is the one thing worth saying outright.
  if (before.leader && now.leader && before.leader !== now.leader) {
    const team = data.teams.find((entry) => entry.id === now.leader);
    if (team) lines.push(`<strong>${escapeHtml(team.name)}</strong> have taken the lead on steps.`);
  }

  return lines;
}

export function initDigest(data) {
  const host = document.getElementById('digest');
  if (!host) return;

  const now = snapshot(data);
  const before = readSeen();

  // Nothing to compare on a first visit, so record the baseline and say nothing.
  if (!before) {
    writeSeen(now);
    return;
  }

  // Someone who picked a profile after their last baseline was taken has no
  // personal figures to diff against. Record them now — without touching the
  // rest of the baseline, so the field-wide news is still owed — and their own
  // line joins in at the next update rather than waiting for a dismissal.
  if (!before.me && now.me) {
    before.me = now.me;
    writeSeen(before);
  }

  // The baseline is replaced only on dismissal, not on load. Updating it here
  // would make the news vanish on a refresh; this way it keeps until it has
  // actually been acknowledged, and accumulates if it hasn't.
  if (before.version === now.version) return;

  const lines = linesFor(before, now, data);
  if (lines.length === 0) return;

  host.innerHTML = `<div class="digest" role="status">
    <div class="digest-body">
      <p class="digest-head">Since ${escapeHtml(when(before.at))}</p>
      ${lines.map((line) => `<p>${line}</p>`).join('')}
    </div>
    <button type="button" class="digest-close" data-digest-dismiss aria-label="Dismiss this summary">&times;</button>
  </div>`;
  host.hidden = false;

  host.addEventListener('click', (event) => {
    if (!event.target.closest('[data-digest-dismiss]')) return;
    writeSeen(snapshot(data));
    host.hidden = true;
    host.innerHTML = '';
  });
}
