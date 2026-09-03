/**
 * Cumulative step charts, drawn as inline SVG — no charting library, no
 * external requests.
 *
 * The x axis always spans the whole of September, so the line shows progress
 * against the month rather than stretching to fill whatever has happened so
 * far. A dashed pace line marks the steady rate needed to reach the target by
 * the 30th, which is what makes a short early line readable.
 */

import { escapeHtml, formatNumber } from './format.js';

const PAD = { top: 10, right: 10, bottom: 20, left: 10 };

let uid = 0;

/**
 * @param values      cumulative totals, one per elapsed day from 1 September
 * @param totalDays   days in the campaign, so the axis covers the full month
 * @param target      optional end-of-month goal, drawn as the dashed pace line
 * @param colour      CSS colour for the line and its area fill
 * @param label       accessible description of what the line represents
 * @param width       viewBox width — wider for the full-page chart, so the line
 *                    keeps sane proportions instead of stretching very tall
 * @param height      viewBox height
 */
export function cumulativeChart({
  values,
  totalDays,
  target,
  colour,
  label,
  width = 340,
  height = 150,
}) {
  const points = (values ?? []).filter((value) => Number.isFinite(value));
  if (points.length === 0) {
    return `<p class="chart-empty">No day-by-day figures yet — they appear as soon as steps are logged.</p>`;
  }

  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = height - PAD.top - PAD.bottom;

  const latest = points.at(-1);
  const ceiling = Math.max(latest, target ?? 0, 1);
  const gradientId = `fade-${(uid += 1)}`;

  const x = (dayIndex) => PAD.left + (dayIndex / (totalDays - 1)) * plotWidth;
  const y = (value) => PAD.top + plotHeight - (value / ceiling) * plotHeight;

  const line = points.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  // Close the path down to the baseline so the area beneath can be filled.
  const area = `${x(0).toFixed(1)},${y(0).toFixed(1)} ${line} ${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)}`;

  const paceLine = target
    ? `<line x1="${x(0)}" y1="${y(0)}" x2="${x(totalDays - 1)}" y2="${y(target)}"
             stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 4"
             class="chart-pace" />`
    : '';

  const ticks = [0, Math.floor((totalDays - 1) / 2), totalDays - 1]
    .map((dayIndex) => {
      const anchor = dayIndex === 0 ? 'start' : dayIndex === totalDays - 1 ? 'end' : 'middle';
      return `<text x="${x(dayIndex).toFixed(1)}" y="${height - 6}" text-anchor="${anchor}"
                    class="chart-tick">${dayIndex + 1} Sep</text>`;
    })
    .join('');

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img"
               style="aspect-ratio: ${width} / ${height}"
               aria-label="${escapeHtml(label)}">
    <defs>
      <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="${colour}" stop-opacity="0.32" />
        <stop offset="100%" stop-color="${colour}" stop-opacity="0" />
      </linearGradient>
    </defs>

    <line x1="${PAD.left}" y1="${y(0)}" x2="${width - PAD.right}" y2="${y(0)}"
          class="chart-axis" stroke-width="1" />
    ${paceLine}

    <polygon points="${area}" fill="url(#${gradientId})" />
    <polyline points="${line}" fill="none" stroke="${colour}" stroke-width="2.5"
              stroke-linejoin="round" stroke-linecap="round" />
    <circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(latest).toFixed(1)}" r="4"
            fill="${colour}" stroke="var(--surface)" stroke-width="2" />
    ${ticks}
  </svg>`;
}

/** The chart plus its heading and latest figure, as one card body. */
export function chartBlock({ title, values, totalDays, target, colour, label, note, wide = false }) {
  const latest = (values ?? []).at(-1) ?? 0;
  // A wider viewBox for the full-page chart: at the same 340x150 ratio a
  // 1200px-wide card would be over 500px tall. 3:1 keeps it a sensible height
  // on a desktop without flattening to a sliver on a phone.
  const size = wide ? { width: 900, height: 300 } : {};
  return `<div class="chart-block${wide ? ' wide' : ''}">
    <div class="chart-head">
      <span class="chart-title">${escapeHtml(title)}</span>
      <strong class="chart-latest">${formatNumber(latest)}</strong>
    </div>
    ${cumulativeChart({ values, totalDays, target, colour, label, ...size })}
    ${note ? `<p class="chart-note">${escapeHtml(note)}</p>` : ''}
  </div>`;
}
