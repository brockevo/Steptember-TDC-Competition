/**
 * Switches between the three views and keeps the hash in step.
 *
 * The member dialog owns `#member/<slug>` (see member.js), so this deliberately
 * ignores any hash it doesn't recognise: a shared link to a person still opens
 * that person's dialog over whichever view is showing, rather than being
 * rewritten to a view hash.
 */

const VIEWS = ['teams', 'leaderboard', 'profile'];
const DEFAULT_VIEW = 'teams';

/** Listeners fired when a view becomes visible, so it can render on demand. */
const listeners = new Map();

export function onView(name, handler) {
  if (!listeners.has(name)) listeners.set(name, []);
  listeners.get(name).push(handler);
}

/**
 * The hero is hidden on the profile view, so the theme toggle is relocated
 * rather than lost. Moving the same element keeps its listener and state — a
 * second copy would need its own wiring and could drift out of sync.
 */
function placeThemeToggle(name) {
  const toggle = document.getElementById('theme-toggle');
  const home =
    name === 'profile'
      ? document.getElementById('profile-toolbar')
      : document.querySelector('.topbar');
  if (toggle && home && toggle.parentElement !== home) home.prepend(toggle);
}

function show(name) {
  for (const view of VIEWS) {
    document.getElementById(`view-${view}`).hidden = view !== name;
  }
  // Lets the stylesheet hide the hero on the profile view.
  document.body.dataset.view = name;
  placeThemeToggle(name);
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.view === name;
    tab.classList.toggle('is-active', active);
    // aria-current marks the section being viewed; absent rather than "false".
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  for (const handler of listeners.get(name) ?? []) handler();
}

/** The view named by the hash, or null when the hash means something else. */
function viewFromHash() {
  const name = location.hash.replace(/^#/, '');
  return VIEWS.includes(name) ? name : null;
}

export function initRouter() {
  let current = viewFromHash() ?? DEFAULT_VIEW;
  show(current);

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      current = tab.dataset.view;
      show(current);
      // A real entry, so the back button returns to the previous view.
      location.hash = current;
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  }

  window.addEventListener('hashchange', () => {
    const next = viewFromHash();
    // Leave #member/<slug> alone — the dialog handles it on top of this view.
    if (next && next !== current) {
      current = next;
      show(current);
    }
  });
}
