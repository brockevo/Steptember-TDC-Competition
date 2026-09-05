/** Small presentational helpers shared by the page and the profile dialog. */

import { escapeHtml, initials } from './format.js';

/** Solid team colour, for avatars, dots, borders and buttons. */
export const accentFor = (colour) => `--accent: var(--team-${colour})`;

/** Lighter step of the same hue, for lane fills that carry a label on top. */
export const laneFor = (colour) => `--lane: var(--lane-${colour})`;

/**
 * Their Steptember photo when they have one, initials otherwise. The initials
 * stay in the markup underneath as the fallback if the image doesn't load.
 */
export function avatar(member, extraClass = '') {
  const photo = member.photo
    ? `<img src="${escapeHtml(member.photo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '';
  return `<span class="avatar ${extraClass}" style="${accentFor(member.teamColour)}" aria-hidden="true">${escapeHtml(
    initials(member.name),
  )}${photo}</span>`;
}

/**
 * Tucks the bottom nav away while reading down a long page and brings it back
 * on the first hint of scrolling up.
 */
export function initTabbarAutoHide() {
  const bar = document.querySelector('.tabbar');
  if (!bar) return;

  /** Never hide near the top, where the bar isn't in the way of anything. */
  const KEEP_VISIBLE_ABOVE = 140;
  /** Ignore the small jitter of a trackpad or a rubber-banding phone. */
  const MIN_MOVEMENT = 6;

  let last = window.scrollY;
  let pending = false;

  function update() {
    const y = window.scrollY;
    if (Math.abs(y - last) >= MIN_MOVEMENT) {
      bar.classList.toggle('is-tucked', y > last && y > KEEP_VISIBLE_ABOVE);
      last = y;
    }
    pending = false;
  }

  window.addEventListener(
    'scroll',
    () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(update);
    },
    { passive: true },
  );

  // A keyboard user tabbing into the bar must never be left pressing buttons
  // they can't see.
  bar.addEventListener('focusin', () => bar.classList.remove('is-tucked'));
}

/**
 * If a Steptember photo 404s or is blocked, drop the <img> so the initials
 * underneath show through. Error events don't bubble, hence the capture phase.
 */
export function handleBrokenAvatars() {
  document.addEventListener(
    'error',
    (event) => {
      const image = event.target;
      if (image.tagName === 'IMG' && image.closest('.avatar')) image.remove();
    },
    true,
  );
}
