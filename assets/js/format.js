/** Shared formatting helpers. Australian locale throughout — these are AU teams. */

const LOCALE = 'en-AU';

export function formatNumber(value) {
  return Math.round(value ?? 0).toLocaleString(LOCALE);
}

export function formatMoney(value, currency = 'AUD') {
  return (value ?? 0).toLocaleString(LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    // Whole dollars unless there really are cents.
    maximumFractionDigits: Number.isInteger(value ?? 0) ? 0 : 2,
  });
}

export function formatPercent(fraction, decimals = 0) {
  return `${((fraction ?? 0) * 100).toFixed(decimals)}%`;
}

export function formatDateTime(iso) {
  if (!iso) return 'not yet updated';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'not yet updated';
  return date.toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ordinal(n) {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

/** Up to two initials for an avatar, e.g. "Dionne Marks" -> "DM". */
export function initials(name) {
  return String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

/** Escapes text before it goes into a template literal that becomes innerHTML. */
export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}
