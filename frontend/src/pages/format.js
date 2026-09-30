// Shared between the overview cards and the indicator detail view.

export const TREND_LABEL = {
  improving: 'Improving',
  stagnating: 'Stagnating',
  declining: 'Declining',
  insufficient_data: 'Insufficient data',
};

export const fmt = (v, digits = 1) =>
  v == null ? '–' : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });
export const signed = (v, digits = 1) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), digits)}`);
