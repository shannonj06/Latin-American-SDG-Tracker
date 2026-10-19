// Where the user is in the app, kept in the URL so refresh, the Back button and shared links
// all land on the same view. Example: ?view=compare&country=MEX&indicator=SH_STA_MORT&countries=MEX,,BRA
import { MAX_COMPARE } from './format.js';

// picks is indexed by color slot (null = free slot), so a country keeps its color when others are removed.
// picks === null means the user has not opened the comparison yet.
export function readRoute() {
  const p = new URLSearchParams(window.location.search);
  const list = p.get('countries');
  return {
    view: p.get('view') === 'compare' ? 'compare' : 'overview',
    country: (p.get('country') ?? '').toUpperCase(),
    indicator: p.get('indicator') || null,
    picks: list == null ? null : list.split(',').slice(0, MAX_COMPARE).map((c) => c.toUpperCase() || null),
  };
}

export function routeUrl(route) {
  const parts = [];
  const add = (key, value) => value && parts.push(`${key}=${encodeURIComponent(value).replace(/%2C/g, ',')}`);
  if (route.view === 'compare') add('view', 'compare');
  add('country', route.country);
  add('indicator', route.indicator);
  if (route.view === 'compare' && route.picks) add('countries', trimPicks(route.picks).map((c) => c ?? '').join(','));
  return parts.length ? `?${parts.join('&')}` : window.location.pathname;
}

export function trimPicks(picks) {
  const out = [...picks];
  while (out.length && out.at(-1) == null) out.pop();
  return out;
}

// The home country plus two well-known neighbours, so the comparison opens with something to compare.
export function defaultPicks(home) {
  return [home, ...['BRA', 'MEX', 'CHL'].filter((c) => c !== home)].filter(Boolean).slice(0, 3);
}
