/**
 * Cumulative step charts, drawn as inline SVG — no charting library, no
 * external requests.
 *
 * The x axis always spans the whole of September, so the line shows progress
 * against the month rather than stretching to fill whatever has happened so
 * far. A dashed pace line marks the steady rate needed to reach the target by
 * the 30th, which is what makes a short early line readable.
 */

import { escapeHtml, formatMoney, formatNumber } from './format.js';

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
  // Keep the gap. A series that starts mid-month — fundraising, which has only
  // been recorded since this site began writing it down — must sit at its real
  // dates, so the leading unknown days are skipped by INDEX rather than
  // squeezed out. Filtering them away instead would slide the line back to the
  // 1st and quietly claim a history we do not have.
  const all = values ?? [];
  const from = all.findIndex((value) => Number.isFinite(value));
  const points = from === -1 ? [] : all.slice(from).filter((value) => Number.isFinite(value));
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
  /** Where the nth point of this series sits, given it may not start on day one. */
  const at = (index) => x(from + index);

  const line = points.map((value, index) => `${at(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  // Close the path down to the baseline so the area beneath can be filled.
  const area = `${at(0).toFixed(1)},${y(0).toFixed(1)} ${line} ${at(points.length - 1).toFixed(1)},${y(0).toFixed(1)}`;

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
    <circle cx="${at(points.length - 1).toFixed(1)}" cy="${y(latest).toFixed(1)}" r="4"
            fill="${colour}" stroke="var(--surface)" stroke-width="2" />
    ${ticks}

    <g class="chart-hits">${hitBands({ points, dates: dates?.slice(from), totalDays, x: at, y, height, offset: from })}</g>
    <circle class="chart-cursor" r="5" fill="${colour}" stroke="var(--surface)"
            stroke-width="2" opacity="0" />
  </svg>`;
}

/* ------------------------------------------------- the projected finish -- */

/**
 * What the end-of-September total looked like it would be, as of each day.
 *
 * The same pace arithmetic the stats and the tooltip already use — running
 * total over days elapsed, carried to the end of the month — read one day at a
 * time. A big day pushes the forecast up, a rest day drags it down, so the line
 * rises and falls the way a price does rather than only ever climbing.
 */
export function projectionSeries(values, totalDays) {
  // Index is preserved rather than compacted: the divisor is "days elapsed", so
  // a series that starts on the 12th must divide by 12, not by 1. Filtering the
  // leading gap away first would forecast money from a single day's total.
  return (values ?? []).map((total, index) =>
    Number.isFinite(total) ? (total / (index + 1)) * totalDays : null,
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "11 Sep" from an ISO date, falling back to the day's position in September.
 *
 * Spelled out rather than left to `toLocaleDateString`, which abbreviates
 * September as "Sept" in every English locale — so a date formatted that way
 * sat next to the hardcoded "1 Sep" on the cumulative axis and disagreed with
 * it. One list, one spelling, every axis and tooltip.
 */
function shortDate(iso, dayIndex) {
  const date = iso ? new Date(`${iso}T00:00:00`) : null;
  if (!date || Number.isNaN(date.getTime())) return `${dayIndex + 1} Sep`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** Short money-less figures for the value axis: 538,732 -> "539k". */
function compact(value) {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}m`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}k`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

/**
 * The projected finish over time.
 *
 * Deliberately a different chart from the cumulative one, not the same chart
 * with different numbers:
 *
 * - **The value axis does not start at zero.** A forecast that moves a few per
 *   cent a day would be a flat line against a zero baseline, which would hide
 *   the entire subject. Both ends of the scale are printed so the crop is
 *   stated rather than smuggled.
 * - **No area fill.** Filling down to an axis that isn't zero would shade a
 *   quantity that means nothing.
 * - **The target is a horizontal line**, because a projection either clears it
 *   or it doesn't. It is only drawn when it falls inside the range on show —
 *   forcing a distant target into the scale would flatten the series to hide
 *   it, so the note carries the figure instead.
 */
export function projectionChart({
  values,
  dates,
  totalDays,
  target,
  colour,
  label,
  width = 340,
  height = 150,
}) {
  const series = projectionSeries(values, totalDays);
  const from = series.findIndex((value) => Number.isFinite(value));
  const points = from === -1 ? [] : series.slice(from).filter((value) => Number.isFinite(value));
  if (points.length === 0) {
    return `<p class="chart-empty">No day-by-day figures yet — the forecast appears once steps are logged.</p>`;
  }

  // Room on the left for the value labels this chart needs and the cumulative
  // one doesn't.
  const pad = { top: 12, right: 10, bottom: 20, left: width > 500 ? 46 : 34 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  const low = Math.min(...points);
  const high = Math.max(...points);
  // A flat series would otherwise divide by zero; give it a band to sit in.
  const span = high - low || Math.max(high * 0.1, 1);
  const floor = Math.max(0, low - span * 0.18);
  const ceiling = high + span * 0.18;
  const range = ceiling - floor || 1;

  // Unlike the cumulative chart, this one spans only the days that have a
  // reading. There is no forecast for a day that hasn't happened, so holding
  // the axis open to the 30th would spend two thirds of the width on nothing
  // and squeeze the line — on a phone, into an unreadable corner.
  const lastDay = Math.max(points.length - 1, 1);
  const x = (dayIndex) => pad.left + (dayIndex / lastDay) * plotWidth;
  const y = (value) => pad.top + plotHeight - ((value - floor) / range) * plotHeight;

  const line = points.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const latest = points.at(-1);

  // Only when it would actually land on the chart.
  const targetInView = target && target >= floor && target <= ceiling;
  const targetLine = targetInView
    ? `<line x1="${pad.left}" y1="${y(target).toFixed(1)}" x2="${width - pad.right}" y2="${y(target).toFixed(1)}"
             stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 4" class="chart-pace" />
       <text x="${width - pad.right}" y="${(y(target) - 4).toFixed(1)}" text-anchor="end"
             class="chart-tick">target ${compact(target)}</text>`
    : '';

  // Dates rather than day numbers, because this axis stops at the last reading
  // rather than at the 30th — "11 Sep" at the right edge says so, where a bare
  // tick could be mistaken for the end of the month.
  const ticks = [...new Set([0, Math.floor(lastDay / 2), lastDay])]
    .map((dayIndex) => {
      const anchor = dayIndex === 0 ? 'start' : dayIndex === lastDay ? 'end' : 'middle';
      return `<text x="${x(dayIndex).toFixed(1)}" y="${height - 6}" text-anchor="${anchor}"
                    class="chart-tick">${escapeHtml(shortDate(dates?.[from + dayIndex], from + dayIndex))}</text>`;
    })
    .join('');

  // Both ends of the cropped scale, so nobody reads the bottom as zero.
  const scale = [
    [ceiling, pad.top + 4],
    [floor, pad.top + plotHeight],
  ]
    .map(
      ([value, at]) =>
        `<text x="${pad.left - 6}" y="${at.toFixed(1)}" text-anchor="end"
               class="chart-tick">${compact(value)}</text>`,
    )
    .join('');

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img"
               style="aspect-ratio: ${width} / ${height}"
               aria-label="${escapeHtml(label)}">
    <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotHeight}"
          class="chart-axis" stroke-width="1" />
    <line x1="${pad.left}" y1="${pad.top + plotHeight}" x2="${width - pad.right}" y2="${pad.top + plotHeight}"
          class="chart-axis" stroke-width="1" />
    ${targetLine}
    ${scale}

    <polyline points="${line}" fill="none" stroke="${colour}" stroke-width="2.5"
              stroke-linejoin="round" stroke-linecap="round" />
    <circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(latest).toFixed(1)}" r="4"
            fill="${colour}" stroke="var(--surface)" stroke-width="2" />
    ${ticks}

    <g class="chart-hits">${projectionBands({ points, dates: dates?.slice(from), totalDays, x, y, height })}</g>
    <circle class="chart-cursor" r="5" fill="${colour}" stroke="var(--surface)"
            stroke-width="2" opacity="0" />
  </svg>`;
}

/** Hit bands for the forecast line — the same lookup idea, different figures. */
function projectionBands({ points, dates, totalDays, x, y, height }) {
  const slot = (x(1) - x(0)) || 8;

  return points
    .map((projection, index) => {
      const before = index > 0 ? points[index - 1] : null;
      const shift = before ? ((projection - before) / before) * 100 : null;

      return `<rect x="${(x(index) - slot / 2).toFixed(1)}" y="0"
                    width="${slot.toFixed(1)}" height="${height}"
                    fill="transparent" data-kind="projection"
                    data-date="${escapeHtml(dates?.[index] ?? '')}"
                    data-projection="${Math.round(projection)}"
                    data-moved="${before === null ? '' : Math.round(projection - before)}"
                    data-shift="${shift === null ? '' : shift.toFixed(1)}"
                    data-cx="${x(index).toFixed(1)}"
                    data-cy="${y(projection).toFixed(1)}" />`;
    })
    .join('');
}

/**
 * One transparent full-height band per day with data, carrying that day's
 * figures so the tooltip is a lookup rather than a re-derivation.
 */
function hitBands({ points, dates, totalDays, x, y, height, offset = 0 }) {
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
      // Days elapsed, counted from 1 September rather than from the first
      // reading — a series that starts on the 12th has 12 days behind it.
      const elapsed = offset + index + 1;
      const projection = (total / elapsed) * totalDays;
      const before = index > 0 ? (previous / (elapsed - 1)) * totalDays : null;
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

/** One chart card: heading, latest figure, the plot, its tooltip and note. */
function panel({ title, latest, svg, note, wide, format = formatNumber }) {
  return `<div class="chart-block${wide ? ' wide' : ''}">
    <div class="chart-head">
      <span class="chart-title">${escapeHtml(title)}</span>
      <strong class="chart-latest">${escapeHtml(format(latest))}</strong>
    </div>
    ${svg}
    <div class="chart-tip" hidden></div>
    ${note ? `<p class="chart-note">${escapeHtml(note)}</p>` : ''}
  </div>`;
}

/**
 * The chart card — as a deck of two: what has happened, and where it is
 * heading.
 *
 * Both are built from the one `values` series, so every place a chart already
 * appears gains the forecast without its caller assembling a second set of
 * figures. Where there is nothing to forecast from, the deck collapses to the
 * single cumulative card it has always been.
 *
 * @param subject  who or what the line is about, for the forecast's label
 */
export function chartBlock({
  title,
  values,
  dates,
  totalDays,
  target,
  colour,
  label,
  note,
  subject,
  /** How to render a figure — money charts need dollars, not bare counts. */
  format = formatNumber,
  wide = false,
}) {
  const points = (values ?? []).filter((value) => Number.isFinite(value));
  // A wider viewBox for the full-page chart: at the same 340x150 ratio a
  // 1200px-wide card would be over 500px tall. 3:1 keeps it a sensible height
  // on a desktop without flattening to a sliver on a phone.
  const size = wide ? { width: 900, height: 300 } : {};

  const cumulative = panel({
    title,
    latest: points.at(-1) ?? 0,
    format,
    svg: cumulativeChart({ values, dates, totalDays, target, colour, label, ...size }),
    note,
    wide,
  });

  // One reading is a dot, not a trend, and the forecast from a single day is
  // just that day times thirty. Below two days there is nothing to show.
  if (points.length < 2) return `<div class="chart-deck is-single">${cumulative}</div>`;

  const forecast = projectionSeries(values, totalDays).filter((value) => Number.isFinite(value));
  const finish = forecast.at(-1);

  // The swing across the whole line, rather than a comparison against the first
  // day: a forecast made from one day's steps is that day times thirty, which
  // is the noisiest reading in the series and the worst thing to anchor to.
  const low = Math.min(...forecast);
  const high = Math.max(...forecast);

  const projected = panel({
    title: 'Projected finish',
    latest: finish,
    format,
    svg: projectionChart({ values, dates, totalDays, target, colour, ...size,
      label: `Projected end-of-September total for ${subject ?? 'this line'} as it stood on each day, now ${format(finish)}`,
    }),
    note: `Where 30 September was heading, read fresh each day — between ${format(low)} and ${format(high)} so far.${
      target ? ` Target is ${format(target)}.` : ''
    }`,
    wide,
  });

  return `<div class="chart-deck" data-deck>
    <div class="deck-viewport">
      <div class="deck-track" data-deck-track>
        <div class="deck-slide" data-deck-slide="0">${cumulative}</div>
        <div class="deck-slide" data-deck-slide="1" aria-hidden="true">${projected}</div>
      </div>
    </div>
    <div class="deck-nav" role="tablist" aria-label="Which view of this line to show">
      <button type="button" class="deck-tab is-active" role="tab"
              aria-selected="true" tabindex="0" data-deck-to="0">So far</button>
      <button type="button" class="deck-tab" role="tab"
              aria-selected="false" tabindex="-1" data-deck-to="1">Projected finish</button>
    </div>
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

    const { kind, date, steps, added, projection, moved, shift } = band.dataset;
    const when = date ? shortDate(date, 0) : '';

    if (kind === 'projection') {
      // The forecast chart's subject is the forecast itself, so it leads with
      // the figure and says what moved it, rather than the other way round.
      const change = shift
        ? `<span class="${Number(shift) >= 0 ? 'tip-up' : 'tip-down'}">${
            Number(shift) >= 0 ? '+' : '−'
          }${Math.abs(Number(shift)).toFixed(1)}%</span> · ${Number(moved) >= 0 ? '+' : '−'}${formatNumber(
            Math.abs(Number(moved)),
          )} steps on the day before`
        : 'First day — no earlier forecast to compare';

      tip.innerHTML = `<span class="tip-day">${escapeHtml(when)}</span>
        <span>Heading for <strong>${formatNumber(projection)}</strong></span>
        <span class="tip-forecast">${change}</span>`;
      tip.hidden = false;
    } else {
      const rise = added ? ` · <span class="tip-up">+${added}%</span> on the total` : '';
      const forecast = shift
        ? `Projected finish ${Number(shift) >= 0 ? 'up' : 'down'} <strong>${Math.abs(Number(shift)).toFixed(1)}%</strong> to ${formatNumber(projection)}`
        : `First day — no earlier projection to compare`;

      tip.innerHTML = `<span class="tip-day">${escapeHtml(when)}</span>
        <span><strong>${formatNumber(steps)}</strong> steps${rise}</span>
        <span class="tip-forecast">${forecast}</span>`;
      tip.hidden = false;
    }

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

/**
 * The fundraising deck: the same two panels, in dollars.
 *
 * Returns nothing until there are two days to draw, which is the honest answer
 * for a record that only began when this site started keeping one. Steptember
 * serves a dated activity report for steps and nothing equivalent for money —
 * the donations on a team page carry an amount and a donor but no date — so
 * there is no earlier history to recover and the note says as much rather than
 * letting a line that starts mid-month imply a quiet first fortnight.
 */
export function moneyBlock({
  values,
  dates,
  totalDays,
  target,
  colour,
  subject,
  currency,
  startsOn,
  wide = false,
}) {
  const known = (values ?? []).filter((value) => Number.isFinite(value));
  if (known.length < 2) return '';

  return chartBlock({
    title: 'Money raised',
    values,
    dates,
    totalDays,
    target,
    colour,
    subject,
    wide,
    // Whole dollars on a chart. A projection is a computed float, so the exact
    // figure would trail a stray "$1,047.5"; the cents-accurate total is on the
    // stat tiles and the fundraising lane, where it belongs.
    format: (value) => formatMoney(Math.round(value), currency),
    label: `Money raised by ${subject ?? 'this line'} through September, currently ${formatMoney(known.at(-1), currency)}`,
    note: startsOn
      ? `Tracked from ${shortDate(startsOn, 0)} — Steptember publishes no dated donation history, so there is nothing earlier to show.`
      : null,
  });
}
