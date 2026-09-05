/** Top-three podiums for each challenge. */

import { avatar } from './ui.js';
import { escapeHtml } from './format.js';

/** Second, first, third — the order they stand on a real podium. */
const STAND_ORDER = [1, 0, 2];
const PLACE_LABEL = ['1st', '2nd', '3rd'];

function step(member, place, valueOf) {
  return `<li class="podium-place place-${place + 1}">
    <button type="button" class="podium-person" data-member-id="${escapeHtml(member.id)}">
      ${avatar(member, place === 0 ? 'lg' : '')}
      <span class="podium-name">${escapeHtml(member.name)}</span>
      <span class="podium-value">${escapeHtml(valueOf(member))}</span>
    </button>
    <div class="podium-block">
      <span class="podium-rank">${PLACE_LABEL[place]}</span>
    </div>
  </li>`;
}

/**
 * @param members  already sorted best-first
 * @param valueOf  how to render each person's figure
 * @param empty    shown instead when there is nothing to rank yet
 */
export function podium({ title, subtitle, members, valueOf, empty }) {
  const top = members.slice(0, 3);

  const body =
    empty || top.length === 0
      ? `<p class="empty">${escapeHtml(empty ?? 'Nothing to rank yet.')}</p>`
      : `<ol class="podium">${STAND_ORDER.filter((index) => top[index])
          .map((index) => step(top[index], index, valueOf))
          .join('')}</ol>`;

  return `<article class="card">
    <div class="board-head">
      <h3>${escapeHtml(title)}</h3><span class="eyebrow">${escapeHtml(subtitle)}</span>
    </div>
    ${body}
  </article>`;
}
