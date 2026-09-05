/**
 * The profile view: pick yourself once, answer a short baseline questionnaire,
 * then see your own September against the way you normally walk.
 *
 * Everything the viewer tells us lives in their own browser's localStorage and
 * goes nowhere else. There is no backend to send it to, and deliberately no
 * analytics, no cookies and nothing keyed to a person or a device — the site is
 * a folder of static files. Storage can be unavailable (private browsing, or a
 * browser set to block it), so every read and write is guarded and the view
 * falls back to remembering the choice for the current visit only.
 */

import { avatar } from './ui.js';
import { chartBlock } from './chart.js';
import { fundraisingLane, kpi, memberStats, targetLane } from './stats.js';
import { escapeHtml, formatNumber, ordinal, plural } from './format.js';

const KEY = 'steptember:me';

/**
 * Mirrors what's in storage. When storage is blocked this is the only copy, so
 * the view still behaves normally until the tab closes.
 */
let state = null;
let storageWorks = true;

function readState() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    storageWorks = false;
    return null;
  }
}

function writeState(next) {
  state = next;
  try {
    if (next === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(next));
  } catch (error) {
    storageWorks = false;
  }
}

/* ------------------------------------------------------------- the picker -- */

/** The team name is the heading above, so the card doesn't repeat it. */
function pickerCard(member) {
  return `<button type="button" class="pick" data-pick="${escapeHtml(member.id)}"
                  style="--accent: var(--team-${member.teamColour})">
    ${avatar(member)}
    <span class="pick-name">${escapeHtml(member.name)}</span>
  </button>`;
}

/**
 * @param excludeId the person already chosen, who is dropped from the list —
 *                  picking yourself again is never the thing you want from here
 */
function renderPicker(data, excludeId) {
  const teams = data.teams
    .map((team) => {
      const options = team.members.filter((member) => member.id !== excludeId);
      if (options.length === 0) return '';
      return `<section class="pick-group">
        <h3 style="--accent: var(--team-${team.colour})">${escapeHtml(team.name)}</h3>
        <div class="pick-grid">${options.map(pickerCard).join('')}</div>
      </section>`;
    })
    .join('');

  return `<div class="profile-pick">
    ${
      // Nothing in the unchanged case: the section heading above already says
      // what to do, and saying it twice reads as a stutter.
      excludeId
        ? `<p class="pick-lead">Pick whoever you actually are — you can change it again whenever you like.</p>
           <button type="button" class="btn" data-cancel-change>Keep the profile I have</button>`
        : ''
    }
    ${teams}
    ${privacyNote()}
  </div>`;
}

/* ------------------------------------------------------ the questionnaire -- */

function renderQuestions(member) {
  return `<form class="profile-quiz" data-quiz>
    <div class="quiz-head">
      ${avatar(member, 'lg')}
      <div>
        <h3>A couple of questions, ${escapeHtml(member.name.split(' ')[0])}</h3>
        <p>So the site can show what September actually changed for you.</p>
      </div>
    </div>

    <label class="field">
      <span class="field-label">Roughly how many steps did you do on a normal day <em>before</em> September?</span>
      <!-- step="1" rather than a rounder figure: the label invites a rough
           number, so 7,777 must be as acceptable as 8,000. -->
      <input type="number" name="dailySteps" min="0" max="100000" step="1" required
             inputmode="numeric" placeholder="e.g. 6000">
      <small>A rough number is fine — it's only used to compare against.</small>
    </label>

    <label class="field">
      <span class="field-label">How many days a week were you usually active? <em>(optional)</em></span>
      <input type="number" name="activeDays" min="0" max="7" step="1" inputmode="numeric" placeholder="0–7">
    </label>

    <fieldset class="field">
      <legend class="field-label">Do you normally walk or cycle to work? <em>(optional)</em></legend>
      <div class="choices">
        <label><input type="radio" name="commute" value="yes"> Yes</label>
        <label><input type="radio" name="commute" value="sometimes"> Sometimes</label>
        <label><input type="radio" name="commute" value="no"> No</label>
      </div>
    </fieldset>

    <div class="quiz-actions">
      <button type="submit" class="btn btn-solid">Show my progress</button>
      <button type="button" class="btn" data-skip>Skip for now</button>
    </div>
    ${privacyNote()}
  </form>`;
}

/* ------------------------------------------------------- before and after -- */

/** Plain words for a change, so the number isn't left to speak for itself. */
function verdictFor(change) {
  if (change >= 100) return 'more than double your usual — a serious September.';
  if (change >= 50) return 'half again on top of your usual walking.';
  if (change >= 25) return 'a big lift on how you normally walk.';
  if (change >= 10) return 'clearly more than your usual.';
  if (change > 2) return 'a little above your usual.';
  if (change >= -2) return 'about the same as you normally walk.';
  if (change >= -15) return 'slightly below your usual — plenty of month left.';
  return 'below your usual so far — worth a few longer walks.';
}

function renderComparison(member, baseline, clock) {
  const before = Number(baseline?.dailySteps);
  if (!Number.isFinite(before) || before <= 0) return '';

  const now = member.dailyAverage;
  const change = ((now - before) / before) * 100;
  const extraPerDay = Math.round(now - before);
  const extraSoFar = Math.round(extraPerDay * clock.daysElapsed);
  const up = change >= 0;

  return `<section class="compare${up ? '' : ' is-down'}">
    <h3>September versus your usual</h3>
    <div class="compare-figures">
      <div class="compare-cell">
        <span class="compare-label">Before September</span>
        <strong>${formatNumber(before)}</strong>
        <small>steps a day</small>
      </div>
      <div class="compare-arrow" aria-hidden="true">→</div>
      <div class="compare-cell is-now">
        <span class="compare-label">This September</span>
        <strong>${formatNumber(now)}</strong>
        <small>steps a day</small>
      </div>
      <div class="compare-delta">
        <strong>${up ? '+' : '−'}${Math.abs(change).toFixed(0)}%</strong>
        <small>${up ? '+' : '−'}${formatNumber(Math.abs(extraPerDay))} a day</small>
      </div>
    </div>
    <p class="compare-verdict">That's ${escapeHtml(verdictFor(change))}</p>
    <p class="compare-note">${
      up
        ? `Across the ${clock.daysElapsed} ${plural(clock.daysElapsed, 'day')} so far that's about <strong>${formatNumber(extraSoFar)}</strong> steps you wouldn't otherwise have taken.`
        : `You're about <strong>${formatNumber(Math.abs(extraSoFar))}</strong> steps behind where your usual pace would have put you.`
    }</p>
  </section>`;
}

/* ------------------------------------------------------------- the profile -- */

/**
 * Where this person sits. Today that is within the twelve of us; the
 * organisation-wide placements arrive with the ranking scrape and slot in here
 * as soon as `member.placements` carries them.
 */
function renderPlacements(member, data) {
  const rows = [
    kpi('Steps, everyone here', ordinal(member.overallStepRank), `of ${data.members.length} steppers`),
    kpi('Steps, in your team', ordinal(member.teamStepRank), `of ${member.teamSize} in ${member.teamName}`),
    kpi('Fundraising, everyone here', ordinal(member.overallMoneyRank), `of ${data.members.length} steppers`),
  ];

  const org = member.placements;
  if (org?.steps) {
    rows.push(kpi('Steps, whole organisation', ordinal(org.steps.rank), `of ${formatNumber(org.steps.of)} taking part`));
  }
  if (org?.raised) {
    rows.push(kpi('Fundraising, whole organisation', ordinal(org.raised.rank), `of ${formatNumber(org.raised.of)} taking part`));
  }

  return `<section class="placements">
    <h3>Where you sit</h3>
    <dl class="kpis">${rows.join('')}</dl>
  </section>`;
}

function renderDashboard(member, data) {
  const { competition, clock } = data;
  const baseline = state?.baseline;

  return `<div class="profile-me" style="--accent: var(--team-${member.teamColour}); --lane: var(--lane-${member.teamColour})">
    <header class="me-head">
      ${avatar(member, 'lg')}
      <div class="me-id">
        <h3>${escapeHtml(member.name)}${member.captain ? '<span class="captain-tag">Captain</span>' : ''}</h3>
        <a class="profile-team" href="${escapeHtml(member.teamUrl)}" target="_blank" rel="noopener">
          <span class="dot" aria-hidden="true"></span>${escapeHtml(member.teamName)}
        </a>
      </div>
      <button type="button" class="btn btn-quiet" data-change>Not you? Change</button>
    </header>

    ${renderComparison(member, baseline, clock)}

    <dl class="kpis">${memberStats(member, data).join('')}</dl>

    ${renderPlacements(member, data)}

    ${chartBlock({
      title: 'Your cumulative steps',
      values: member.cumulative,
      dates: data.history.dates,
      totalDays: clock.totalDays,
      target: member.stepTarget,
      colour: `var(--team-${member.teamColour})`,
      label: `${member.name}'s cumulative steps through September, currently ${formatNumber(member.steps)}`,
      note: member.stepTarget
        ? `Dashed line is the pace to your ${formatNumber(member.stepTarget)} step target.`
        : null,
      wide: true,
    })}

    ${targetLane(member)}
    ${fundraisingLane(member, competition.currency)}

    ${
      baseline
        ? `<p class="baseline-recap">Comparing against <strong>${formatNumber(Number(baseline.dailySteps))}</strong> steps a day${
            baseline.activeDays ? ` and ${escapeHtml(String(baseline.activeDays))} active ${plural(Number(baseline.activeDays), 'day')} a week` : ''
          }${
            baseline.commute && baseline.commute !== 'no'
              ? `, ${baseline.commute === 'yes' ? 'walking or cycling to work' : 'sometimes walking or cycling to work'}`
              : ''
          }. <button type="button" class="linkish" data-requiz>Change these answers</button></p>`
        : `<p class="baseline-recap">You skipped the baseline questions, so there's nothing to compare September against yet. <button type="button" class="linkish" data-requiz>Answer them now</button></p>`
    }

    <div class="profile-links">
      <a class="btn btn-solid" href="${escapeHtml(member.url)}" target="_blank" rel="noopener">
        Your Steptember page
      </a>
      <button type="button" class="btn" data-forget>Forget me on this device</button>
    </div>

    ${privacyNote()}
  </div>`;
}

function privacyNote() {
  return `<p class="privacy-note">
    <span aria-hidden="true">🔒</span>
    Your choice and your answers are saved in this browser and nowhere else. The site is a
    set of static files with no server behind it, so nothing here is uploaded, logged or
    tied to you — no accounts, no cookies, no analytics, no addresses recorded.
    Clearing this site's data erases it.${
      storageWorks
        ? ''
        : ' This browser is blocking storage, so what you enter will be forgotten when you close the tab.'
    }
  </p>`;
}

/* ------------------------------------------------------------------- wiring -- */

export function initProfileView(data) {
  const host = document.getElementById('profile-view');
  const title = document.getElementById('profile-title');
  const lead = title?.nextElementSibling;
  if (!host) return;

  state = readState();
  /** Set while the picker is open over an existing choice, so it can be cancelled. */
  let changing = false;

  function render() {
    const member = state?.memberId ? data.membersById.get(state.memberId) : null;

    // A saved id that no longer matches anyone — a renamed profile, or a person
    // who left the team — should not strand the view on a blank page.
    if (state?.memberId && !member) {
      writeState(null);
      changing = false;
    }

    if (!member || changing) {
      if (title) title.textContent = 'Your profile';
      if (lead) lead.textContent = 'Pick yourself from the list to follow your own progress.';
      host.innerHTML = renderPicker(data, changing ? state?.memberId : null);
      return;
    }

    if (!state.baseline && !state.skippedBaseline) {
      if (title) title.textContent = 'A quick baseline';
      if (lead) lead.textContent = 'Two of these are optional — the first is what the comparison uses.';
      host.innerHTML = renderQuestions(member);
      return;
    }

    if (title) title.textContent = 'Your September';
    if (lead) lead.textContent = 'How your own month is going, and how it compares to the way you usually walk.';
    host.innerHTML = renderDashboard(member, data);
  }

  host.addEventListener('click', (event) => {
    const pick = event.target.closest('[data-pick]');
    if (pick) {
      // Changing to a different person keeps the baseline answers — they
      // describe the viewer, not the profile they picked.
      writeState({ ...(state ?? {}), memberId: pick.dataset.pick });
      changing = false;
      render();
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }

    if (event.target.closest('[data-change]')) {
      changing = true;
      render();
      return;
    }

    if (event.target.closest('[data-cancel-change]')) {
      changing = false;
      render();
      return;
    }

    if (event.target.closest('[data-skip]')) {
      writeState({ ...state, skippedBaseline: true });
      render();
      return;
    }

    if (event.target.closest('[data-requiz]')) {
      writeState({ memberId: state.memberId });
      render();
      return;
    }

    if (event.target.closest('[data-forget]')) {
      writeState(null);
      changing = false;
      render();
    }
  });

  host.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-quiz]');
    if (!form) return;
    event.preventDefault();

    const entries = new FormData(form);
    const dailySteps = Number(entries.get('dailySteps'));
    if (!Number.isFinite(dailySteps) || dailySteps < 0) return;

    writeState({
      memberId: state.memberId,
      baseline: {
        dailySteps,
        activeDays: entries.get('activeDays') ? Number(entries.get('activeDays')) : null,
        commute: entries.get('commute') ?? null,
      },
    });
    render();
  });

  render();
}
