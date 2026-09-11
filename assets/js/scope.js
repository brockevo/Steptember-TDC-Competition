/**
 * The scope switcher: the same stats, seen against a wider field.
 *
 * "This challenge" is the twelve of us and is what every view shows by default,
 * so nothing changes for someone who never touches it. "Across KPMG" ranks the
 * same person or team against the whole organisation, from the leaderboard the
 * scrape reads.
 *
 * A scope is offered only when there is data behind it. We hold no national
 * figures, so no Australia chip appears — an empty tab would be worse than a
 * missing one. When only one scope exists the switcher is not rendered at all,
 * because a lone chip that does nothing is just furniture.
 *
 * The selection is per-view and deliberately not remembered: it is a lens on the
 * current thing, not a preference.
 */

import { escapeHtml, formatNumber, ordinal, plural } from './format.js';
import { ORG_NAME } from './stats.js';

/* ------------------------------------------------------------------ the meter -- */

/**
 * Where one entity sits in its field, as a meter.
 *
 * A single ratio against a limit, which is a meter rather than a chart: the
 * track is the whole field, the fill is everyone ahead, the marker is you. It
 * answers "where am I" before any number is read.
 *
 * The mark's colour sits below 3:1 against the track, which the palette
 * validator flags as needing relief — so the rank is always written out beside
 * it and never carried by colour alone. The marker takes the 2px surface ring
 * the mark specs call for, so it stays legible where it meets the fill.
 */
function meter({ rank, of, colour, label }) {
  if (!Number.isFinite(rank) || !Number.isFinite(of) || of < 2) return '';
  // Position across the track: first place sits at the left edge, last at the
  // right. Clamped so a rank momentarily outside the field cannot overflow.
  const position = Math.min(Math.max((rank - 1) / (of - 1), 0), 1) * 100;

  return `<div class="meter" role="img"
               aria-label="${escapeHtml(`${label}: ${ordinal(rank)} of ${formatNumber(of)}`)}">
    <div class="meter-track">
      <span class="meter-fill" style="width: ${position.toFixed(1)}%; background: var(--lane-${colour})"></span>
      <span class="meter-mark" style="left: ${position.toFixed(1)}%; background: var(--team-${colour})"></span>
    </div>
    <div class="meter-ends">
      <span>1st</span>
      <span>${ordinal(of)}</span>
    </div>
  </div>`;
}

/* ------------------------------------------------------------ the stat blocks -- */

function row(label, value, note) {
  return `<div class="kpi">
    <dt>${escapeHtml(label)}</dt>
    <dd>${escapeHtml(value)}${note ? `<small>${escapeHtml(note)}</small>` : ''}</dd>
  </div>`;
}

/**
 * How much of the field is behind you, as a share of the others.
 *
 * Divided by `of - 1` rather than `of`, so first place is ahead of 100% of the
 * rest and last is ahead of none. Dividing by the field size would cap the
 * leader at 99.8% and quietly tell them someone was ahead.
 */
function aheadOf(rank, of) {
  if (!Number.isFinite(rank) || !Number.isFinite(of) || of < 2) return null;
  return (of - rank) / (of - 1);
}

/** "Up 3 places", or nothing when we have no earlier reading to compare. */
function movement(place) {
  if (!Number.isFinite(place?.previous) || place.previous === place.rank) return null;
  const moved = place.previous - place.rank;
  return moved > 0
    ? `Up ${moved} ${plural(moved, 'place')}`
    : `Down ${Math.abs(moved)} ${plural(Math.abs(moved), 'place')}`;
}

function placeRows(place, { noun, measure }) {
  if (!place) return [];
  const share = aheadOf(place.rank, place.of);

  // The percentile rides in the rank's own note rather than taking a tile of
  // its own. Two tiles both labelled "Ahead of" — one for steps, one for
  // fundraising — are indistinguishable once the grid wraps and separates each
  // from the measure it belongs to.
  const note = [
    `of ${formatNumber(place.of)} ${noun}`,
    share === null ? null : `ahead of ${Math.round(share * 100)}%`,
  ]
    .filter(Boolean)
    .join(' · ');

  const rows = [row(`${measure} across ${ORG_NAME}`, ordinal(place.rank), note)];

  const moved = movement(place);
  if (moved) rows.push(row(`${measure}, since the last update`, moved, `was ${ordinal(place.previous)}`));

  return rows;
}

/* ------------------------------------------------------------------ the panels -- */

/** The organisation panel for one person. */
function memberOrgPanel(member) {
  const place = member.placements;
  const blocks = [
    ...placeRows(place?.steps, { noun: `${ORG_NAME} steppers`, measure: 'Steps' }),
    ...placeRows(place?.raised, { noun: `${ORG_NAME} fundraisers`, measure: 'Fundraising' }),
  ];

  // Their team's own standing, so a person can see the two together.
  const team = member.teamPlacements?.steps;
  if (team) {
    blocks.push(
      row(
        `${member.teamName} across ${ORG_NAME}`,
        ordinal(team.rank),
        `of ${formatNumber(team.of)} ${ORG_NAME} teams`,
      ),
    );
  }

  if (blocks.length === 0) return '';

  return `${meter({
    rank: place?.steps?.rank,
    of: place?.steps?.of,
    colour: member.teamColour,
    label: `${member.name}'s position among ${ORG_NAME} steppers`,
  })}
  <dl class="kpis">${blocks.join('')}</dl>`;
}

/** The organisation panel for one team. */
function teamOrgPanel(team) {
  const place = team.placements;
  const blocks = [
    ...placeRows(place?.steps, { noun: `${ORG_NAME} teams`, measure: 'Steps' }),
    ...placeRows(place?.raised, { noun: `${ORG_NAME} teams`, measure: 'Fundraising' }),
  ];
  if (blocks.length === 0) return '';

  return `${meter({
    rank: place?.steps?.rank,
    of: place?.steps?.of,
    colour: team.colour,
    label: `${team.name}'s position among ${ORG_NAME} teams`,
  })}
  <dl class="kpis">${blocks.join('')}</dl>`;
}

/* ---------------------------------------------------------------- the switcher -- */

/**
 * Which scopes this entity can actually offer.
 *
 * `challenge` always. `org` only where the leaderboard scrape found them. There
 * is no national data at all, so that scope is never in the list — the chip
 * appears when the figures do, not before.
 */
export function scopesFor(entity) {
  const scopes = [{ id: 'challenge', label: 'This challenge' }];
  if (entity?.placements?.steps || entity?.placements?.raised) {
    scopes.push({ id: 'org', label: `Across ${ORG_NAME}` });
  }
  return scopes;
}

/** The chip row, or nothing when there is only one scope to offer. */
export function switcher(scopes) {
  if (scopes.length < 2) return '';
  return `<div class="scopes" role="tablist" aria-label="Which field to compare against">
    ${scopes
      .map(
        (scope, index) =>
          `<button type="button" class="scope${index === 0 ? ' is-active' : ''}"
                   role="tab" aria-selected="${index === 0}" tabindex="${index === 0 ? '0' : '-1'}"
                   data-scope="${escapeHtml(scope.id)}">
            ${escapeHtml(scope.label)}
          </button>`,
      )
      .join('')}
  </div>`;
}

/** The panel for a scope, for either kind of entity. */
export function panelFor(scope, entity, kind) {
  if (scope !== 'org') return '';
  return kind === 'team' ? teamOrgPanel(entity) : memberOrgPanel(entity);
}

/**
 * A suffix unique to each switcher wired up.
 *
 * The Profile page and an open dialog can both be in the document at once, so
 * two switchers coexist and their `id`s would otherwise collide — pointing both
 * chips' `aria-controls` at the same panel.
 */
let sequence = 0;

/**
 * Wires one container's chips to its panels.
 *
 * The default panel is already in the markup, so switching only has to swap
 * which is shown — nothing is rebuilt, and "This challenge" is never a re-render
 * of what was already there.
 *
 * The chip/panel relationship is paired up here rather than written into the
 * templates: the callers then only have to name a panel's scope, and an id can
 * never drift out of step with the `aria-controls` pointing at it.
 */
export function initSwitcher(container) {
  const chips = container.querySelector('.scopes');
  if (!chips) return;

  const group = `scope-${(sequence += 1)}`;
  const tabs = [...chips.querySelectorAll('[data-scope]')];
  const panels = [...container.querySelectorAll('[data-scope-panel]')];

  for (const tab of tabs) {
    tab.id = `${group}-tab-${tab.dataset.scope}`;
    const panel = panels.find((p) => p.dataset.scopePanel === tab.dataset.scope);
    if (!panel) continue;
    panel.id = `${group}-panel-${tab.dataset.scope}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    tab.setAttribute('aria-controls', panel.id);
  }

  function select(chip, { focus = false } = {}) {
    for (const tab of tabs) {
      const active = tab === chip;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      // A roving tabindex, so the chip row is one Tab stop and the arrow keys
      // move within it — what a tablist is expected to do.
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.scopePanel !== chip.dataset.scope;
    }
    if (focus) chip.focus();
  }

  chips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-scope]');
    if (chip) select(chip);
  });

  chips.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const index = tabs.indexOf(document.activeElement);
    if (index === -1) return;

    if (step) {
      event.preventDefault();
      select(tabs[(index + step + tabs.length) % tabs.length], { focus: true });
    } else if (event.key === 'Home') {
      event.preventDefault();
      select(tabs[0], { focus: true });
    } else if (event.key === 'End') {
      event.preventDefault();
      select(tabs[tabs.length - 1], { focus: true });
    }
  });
}
