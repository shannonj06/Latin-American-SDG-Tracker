// Shared helpers and constants for the overview, detail and comparison views.

export const API = 'http://localhost:8000';

export const TREND_LABEL = {
  improving: 'Improving',
  stagnating: 'Stagnating',
  declining: 'Declining',
  insufficient_data: 'Insufficient data',
};

export const STATUS_LABEL = {
  target_achieved: 'Target met',
  on_track: 'On track',
  off_track: 'Off track',
  insufficient_data: 'Too little data',
  no_numeric_target: 'No numeric target',
};

// UN "Nature" attribute: how each value was produced.
export const NATURE_LABEL = {
  C: 'Country data',
  CA: 'Country data, adjusted',
  E: 'Estimated',
  M: 'Modelled',
  G: 'Global monitoring',
  N: 'Non-relevant',
};

// UN "Reporting Type" dimension.
export const REPORTING_LABEL = {
  G: 'Global (UN-harmonized figures)',
  N: 'National (as published by the country)',
};

// flagcdn.com serves flags by ISO 3166 alpha-2 code.
export const ISO2 = {
  ARG: 'ar', BOL: 'bo', BRA: 'br', CHL: 'cl', COL: 'co', CRI: 'cr', CUB: 'cu',
  DOM: 'do', ECU: 'ec', GTM: 'gt', HND: 'hn', MEX: 'mx', NIC: 'ni', PAN: 'pa',
  PER: 'pe', PRY: 'py', SLV: 'sv', URY: 'uy', VEN: 've',
};

// UN M49 area codes, which the UN SDG API uses (same list as fetch_sdg3.py).
export const M49 = {
  ARG: 32, BOL: 68, BRA: 76, CHL: 152, COL: 170, CRI: 188, CUB: 192, DOM: 214, ECU: 218, SLV: 222,
  GTM: 320, HND: 340, MEX: 484, NIC: 558, PAN: 591, PRY: 600, PER: 604, URY: 858, VEN: 862,
};

// Comparison colors are CSS variables (--c0..--c3) so dark mode gets its own steps.
export const MAX_COMPARE = 4;

export const fmt = (v, digits = 1) =>
  v == null ? '–' : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });
export const signed = (v, digits = 1) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), digits)}`);

export const UN_DATA_PORTAL = 'https://unstats.un.org/sdgs/dataportal';
export const UN_API = 'https://unstats.un.org/SDGAPI/v1/sdg';
export const rawDataUrl = (series, iso3) => `${UN_API}/Series/Data?seriesCode=${series}&areaCode=${M49[iso3]}&pageSize=1000`;
// "3.1.1" -> Metadata-03-01-01.pdf
export const metadataUrl = (sdg) =>
  `https://unstats.un.org/sdgs/metadata/files/Metadata-${sdg.split('.').map((p) => p.padStart(2, '0')).join('-')}.pdf`;

export function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let t = 0; t < max + step * 0.999; t += step) ticks.push(+t.toFixed(10));
  return ticks;
}
