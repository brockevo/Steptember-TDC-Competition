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
  dates,
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

    <g class="chart-hits">${hitBands({ points, dates, totalDays, x, y, height })}</g>
    <circle class="chart-cursor" r="5" fill="${colour}" stroke="var(--surface)"
            stroke-width="2" opacity="0" />
  </svg>`;
}

/**
 * One transparent full-height band per day with data, carrying that day's
 * figures so the tooltip is a lookup rather than a re-derivation.
 */
function hitBands({ points, dates, totalDays, x, y, height }) {
  const slot = (x(1) - x(0)) || 8;

  return points
    .map((total, index) => {
      const previous = index > 0 ? points[index - 1] : 0;
      const stepsToday = total - previous;

      // What that day added to the running total. Day one has nothing before
      // it, so there is no "increase" to state.
      const added = index > 0 && previous > 0 ? (stepsToday / previous) * 100 : null;

      // Projections both come from the same pace arithmetic the stats use:
      // running total over days elapsed, carried to the end of the month.
      const projection = (total / (index + 1)) * totalDays;
      const before = index > 0 ? (previous / index) * totalDays : null;
      const shift = before ? ((projection - before) / before) * 100 : null;

      return `<rect x="${(x(index) - slot / 2).toFixed(1)}" y="0"
                    width="${slot.toFixed(1)}" height="${height}"
                    fill="transparent"
                    data-date="${escapeHtml(dates?.[index] ?? '')}"
                    data-steps="${Math.round(stepsToday)}"
                    data-total="${Math.round(total)}"
                    data-added="${added === null ? '' : added.toFixed(1)}"
                    data-projection="${Math.round(projection)}"
                    data-shift="${shift === null ? '' : shift.toFixed(1)}"
                    data-cx="${x(index).toFixed(1)}"
                    data-cy="${y(total).toFixed(1)}" />`;
    })
    .join('');
}

/** The chart plus its heading and latest figure, as one card body. */
export function chartBlock({
  title,
  values,
  dates,
  totalDays,
  target,
  colour,
  label,
  note,
  wide = false,
}) {
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
    ${cumulativeChart({ values, dates, totalDays, target, colour, label, ...size })}
    <div class="chart-tip" hidden></div>
    ${note ? `<p class="chart-note">${escapeHtml(note)}</p>` : ''}
  </div>`;
}

/**
 * Wires every chart on the page for hover and tap. Delegated from the document
 * so charts rendered later need no extra setup.
 */
export function initChartTooltips() {
  /**
   * A touch tooltip stays put until dismissed, so it has to be cleared on
   * scroll. A mouse one is already tied to the cursor and clears itself on
   * leave — hiding that on scroll would make it vanish whenever the page moved
   * under a steady pointer.
   */
  let pinned = false;

  const show = (band) => {
    const block = band.closest('.chart-block');
    const svg = band.closest('svg');
    const tip = block?.querySelector('.chart-tip');
    if (!tip || !svg) return;

    const { date, steps, added, projection, shift } = band.dataset;
    const when = date
      ? new Date(`${date}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
      : '';

    const rise = added ? ` · <span class="tip-up">+${added}%</span> on the total` : '';
    const forecast = shift
      ? `Projected finish ${Number(shift) >= 0 ? 'up' : 'down'} <strong>${Math.abs(Number(shift)).toFixed(1)}%</strong> to ${formatNumber(projection)}`
      : `First day — no earlier projection to compare`;

    tip.innerHTML = `<span class="tip-day">${escapeHtml(when)}</span>
      <span><strong>${formatNumber(steps)}</strong> steps${rise}</span>
      <span class="tip-forecast">${forecast}</span>`;
    tip.hidden = false;

    // The band's coordinates are in viewBox units. Scale them to the rendered
    // size, then shift by where the chart sits inside the card — the tooltip is
    // positioned against the card, not the chart.
    const chart = svg.getBoundingClientRect();
    const card = block.getBoundingClientRect();
    const scale = chart.width / svg.viewBox.baseVal.width;
    const offsetX = chart.left - card.left;
    const offsetY = chart.top - card.top;

    const wanted = offsetX + Number(band.dataset.cx) * scale;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.max(half + 4, Math.min(wanted, card.width - half - 4))}px`;
    tip.style.top = `${offsetY + Number(band.dataset.cy) * scale}px`;

    const cursor = svg.querySelector('.chart-cursor');
    if (cursor) {
      cursor.setAttribute('cx', band.dataset.cx);
      cursor.setAttribute('cy', band.dataset.cy);
      cursor.setAttribute('opacity', '1');
    }
  };

  const hide = (block) => {
    block.querySelector('.chart-tip').hidden = true;
    block.querySelector('.chart-cursor')?.setAttribute('opacity', '0');
  };

  const hideAll = () => {
    for (const block of document.querySelectorAll('.chart-block')) hide(block);
    pinned = false;
  };

  document.addEventListener('pointerover', (event) => {
    const band = event.target.closest?.('.chart-hits rect');
    if (!band) return;
    if (event.pointerType === 'mouse') pinned = false;
    show(band);
  });

  // Taps don't produce a hover, so drive it from the press as well. Pressing
  // anywhere that isn't a day dismisses whatever is open.
  document.addEventListener('pointerdown', (event) => {
    const band = event.target.closest?.('.chart-hits rect');
    if (!band) {
      hideAll();
      return;
    }
    pinned = event.pointerType !== 'mouse';
    show(band);
  });

  // A tooltip is pinned to a point on a chart, so it has no meaning once that
  // chart has moved. Without this a tap leaves it on screen indefinitely,
  // drifting over the rest of the page as a stray panel.
  window.addEventListener('scroll', () => { if (pinned) hideAll(); }, { passive: true });
  window.addEventListener('resize', hideAll);
  // Switching view swaps the page under it.
  window.addEventListener('hashchange', hideAll);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideAll();
  });

  document.addEventListener('pointerout', (event) => {
    // A touch pointer stops existing the moment the finger lifts, firing this
    // straight after the tap — which would hide the tooltip before it was read.
    // Touch dismisses by tapping elsewhere instead, handled above.
    if (event.pointerType !== 'mouse') return;
    const block = event.target.closest?.('.chart-block');
    if (block && !block.contains(event.relatedTarget)) hide(block);
  });
}
