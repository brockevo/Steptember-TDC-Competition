/**
 * The chart deck: two views of the same line, one swipe apart.
 *
 * "So far" is the cumulative chart the site has always shown and is what every
 * deck opens on, so nothing changes for someone who never touches it.
 * "Projected finish" is where the month is heading, read fresh each day.
 *
 * Delegated from the document, like the chart tooltips, so a deck rendered
 * later — inside a dialog, or when the Profile page builds itself — needs no
 * extra wiring.
 */

/** How far a drag must travel before it counts as a swipe rather than a tap. */
const THRESHOLD = 45;

function slides(deck) {
  return [...deck.querySelectorAll('[data-deck-slide]')];
}

function tabs(deck) {
  return [...deck.querySelectorAll('[data-deck-to]')];
}

function current(deck) {
  return Number(deck.dataset.deckAt ?? 0);
}

/**
 * Takes one slide out of play, or puts it back.
 *
 * `aria-hidden` and `inert` travel together: the first keeps the clipped chart
 * out of the accessibility tree, the second keeps its hit bands out of the tab
 * order and out of reach of a pointer — without it a chart nobody can see still
 * answers clicks. Both are invisible to layout, which is what lets the outgoing
 * and incoming slides stay painted while the track is mid-slide.
 *
 * `toggleAttribute` would write `aria-hidden=""`, which is not the string the
 * attribute is defined to take, so the pair is set out longhand.
 */
function setOffstage(slide, offstage) {
  if (offstage) slide.setAttribute('aria-hidden', 'true');
  else slide.removeAttribute('aria-hidden');
  slide.toggleAttribute('inert', offstage);
}

/** Shows one slide. */
function go(deck, to, { focus = false } = {}) {
  const panels = slides(deck);
  const index = Math.max(0, Math.min(to, panels.length - 1));
  if (index === current(deck)) return;

  deck.dataset.deckAt = String(index);

  const track = deck.querySelector('[data-deck-track]');
  if (track) track.style.transform = `translateX(-${index * 100}%)`;

  panels.forEach((slide, at) => setOffstage(slide, at !== index));

  for (const [at, tab] of tabs(deck).entries()) {
    const active = at === index;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  }

  // A tooltip is pinned to a point on the chart that just slid away.
  for (const tip of deck.querySelectorAll('.chart-tip')) tip.hidden = true;
  for (const cursor of deck.querySelectorAll('.chart-cursor')) cursor.setAttribute('opacity', '0');
}

/**
 * A suffix unique to each deck wired up, so the ids below stay distinct when
 * several decks share a page — three team cards, or a dialog over the
 * Leaderboard.
 */
let sequence = 0;

export function initChartDecks() {
  // Set the starting state on every deck: slide 1 is built into the markup
  // already, so it has to be made inert before anything can reach it. Tab and
  // panel are paired up here rather than in the template, so an id cannot drift
  // out of step with the `aria-controls` pointing at it.
  const arm = () => {
    for (const deck of document.querySelectorAll('[data-deck]')) {
      if (deck.dataset.deckAt) continue;
      deck.dataset.deckAt = '0';

      const group = `deck-${(sequence += 1)}`;
      const panels = slides(deck);
      for (const [at, tab] of tabs(deck).entries()) {
        const panel = panels[at];
        if (!panel) continue;
        tab.id = `${group}-tab-${at}`;
        panel.id = `${group}-panel-${at}`;
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tab.id);
        tab.setAttribute('aria-controls', panel.id);
      }

      panels.slice(1).forEach((slide) => setOffstage(slide, true));
    }
  };
  arm();

  // Dialogs and the Profile page render their decks after this runs. The
  // observer sees every DOM change on the page, tooltip text included, so the
  // sweep is coalesced into one frame rather than running per mutation.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      arm();
    });
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-deck-to]');
    if (!tab) return;
    go(tab.closest('[data-deck]'), Number(tab.dataset.deckTo));
  });

  document.addEventListener('keydown', (event) => {
    const tab = event.target.closest?.('[data-deck-to]');
    if (!tab) return;
    const deck = tab.closest('[data-deck]');
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (step) {
      event.preventDefault();
      go(deck, current(deck) + step, { focus: true });
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      go(deck, event.key === 'Home' ? 0 : slides(deck).length - 1, { focus: true });
    }
  });

  /* ------------------------------------------------------------- swiping -- */

  let drag = null;

  document.addEventListener(
    'pointerdown',
    (event) => {
      const viewport = event.target.closest?.('.deck-viewport');
      // Only a primary press, and never a second finger mid-gesture.
      if (!viewport || drag || event.button !== 0) return;
      drag = {
        deck: viewport.closest('[data-deck]'),
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        settled: false,
      };
    },
    { passive: true },
  );

  document.addEventListener(
    'pointermove',
    (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      // Decide once, on the first meaningful movement, whether this gesture
      // belongs to the deck or to the page scrolling underneath it. Without
      // that a diagonal drag would fight the scroll the whole way down.
      if (!drag.settled && Math.abs(dx) + Math.abs(dy) > 10) {
        drag.settled = true;
        drag.horizontal = Math.abs(dx) > Math.abs(dy);
      }
    },
    { passive: true },
  );

  const finish = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    if (drag.horizontal && Math.abs(dx) > THRESHOLD) {
      // Swiping right-to-left pulls the next slide in, the way a carousel and
      // a phone home screen both behave.
      go(drag.deck, current(drag.deck) + (dx < 0 ? 1 : -1));
    }
    drag = null;
  };

  document.addEventListener('pointerup', finish, { passive: true });
  document.addEventListener('pointercancel', () => { drag = null; }, { passive: true });
}
