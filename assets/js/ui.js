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
