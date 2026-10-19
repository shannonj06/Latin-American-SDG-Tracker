import { useEffect, useState } from 'react';
import banner from '../assets/health-banner.jpg';
import Compare from './Compare.jsx';
import IndicatorDetail from './IndicatorDetail.jsx';
import { API, ISO2, TREND_LABEL, fmt } from './format.js';
import { defaultPicks, readRoute, routeUrl } from './route.js';
import './home.css';

// no_numeric_target is never shown: the table leaves the target cell blank instead.
const STATUS_LABEL = {
  target_achieved: 'Met',
  on_track: 'On track',
  off_track: 'Off track',
  insufficient_data: 'Too little data',
};

function HomePage() {
  const [countries, setCountries] = useState([]);
  const [indicators, setIndicators] = useState({});
  const [summary, setSummary] = useState([]);
  // Tagged with the country+indicator it belongs to, so a stale chart is never shown as current.
  const [series, setSeries] = useState({ key: null, data: [] });
  const [error, setError] = useState(null);
  // View, country, indicator and compared countries; mirrored in the URL (see route.js).
  const [route, setRoute] = useState(readRoute);
  const { view } = route;

  // Back/forward restore the view the user was on.
  useEffect(() => {
    const onPop = (e) => setRoute(e.state ?? readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // An unknown or missing country in the URL falls back to the first one in the list.
  const iso3 = countries.some((c) => c.iso3 === route.country) ? route.country : (countries[0]?.iso3 ?? '');

  // Load the dropdown options and indicator names once.
  useEffect(() => {
    fetch(`${API}/countries`)
      .then((r) => r.json())
      .then((d) => {
        setError(null);
        setCountries(d.countries);
      })
      .catch(() => setError(`Could not reach the API at ${API}. Is the backend running?`));
    fetch(`${API}/indicators`)
      .then((r) => r.json())
      .then(setIndicators)
      .catch(() => {});
  }, []);

  // Refetch the indicator list whenever the country changes.
  useEffect(() => {
    if (!iso3) return;
    let cancelled = false; // ignore a slow response for a country the user already left
    fetch(`${API}/countries/${iso3}/summary`)
      .then(okJson)
      .then((d) => {
        if (cancelled) return;
        setSummary(d.summary);
        setError(null);
      })
      .catch(() => !cancelled && setError("Could not load this country's indicators. Check that the backend is running, then refresh."));
    return () => {
      cancelled = true;
    };
  }, [iso3]);

  // Rows in SDG order (3.1.1, 3.1.2, ...); the first one is open by default.
  // The chosen indicator stays open when switching countries, as long as the new country reports it.
  const sdgOrder = (row) => indicators[row.series]?.sdg_indicator ?? row.series;
  const ordered = [...summary].sort((a, b) => sdgOrder(a).localeCompare(sdgOrder(b), undefined, { numeric: true }));
  const current = summary.some((r) => r.series === route.indicator) ? route.indicator : (ordered[0]?.series ?? null);

  // Refetch the chart whenever the selected card or country changes.
  useEffect(() => {
    if (!iso3 || !current) return;
    let cancelled = false;
    fetch(`${API}/indicators/${current}/series?iso3=${iso3}`)
      .then(okJson)
      .then((d) => !cancelled && setSeries({ key: `${iso3}/${current}`, data: d.data }))
      .catch(() => !cancelled && setError('Could not load the chart for this indicator. Check that the backend is running, then refresh.'));
    return () => {
      cancelled = true;
    };
  }, [iso3, current]);

  // Moves the app to a new view and records it in the URL. replace: true updates the current
  // history entry instead of adding one (used for country chips, so Back skips over each click).
  const navigate = (patch, { replace = false } = {}) => {
    const next = { ...route, country: iso3, ...patch };
    if (JSON.stringify(next) === JSON.stringify(route)) return;
    window.history[replace ? 'replaceState' : 'pushState'](next, '', routeUrl(next));
    setRoute(next);
    if (!replace) window.scrollTo(0, 0);
  };
  const openCompare = () => navigate({ view: 'compare', indicator: current, picks: route.picks ?? defaultPicks(iso3) });

  const selectedRow = summary.find((row) => row.series === current);
  const selectedInfo = indicators[current] ?? {};
  const country = countries.find((c) => c.iso3 === iso3);

  // Names each Back/forward history entry after what it shows.
  useEffect(() => {
    const place = view === 'compare' ? 'Compare countries' : country?.country;
    document.title = place ? `${place} · SDG Tracker` : 'SDG Tracker';
  }, [view, country]);

  const counts = summary.reduce((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="home">
      <nav className="topbar">
        <span className="brand">
          SDG Tracker <span className="brand-sub">Latin America · Health</span>
        </span>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'overview'} onClick={() => navigate({ view: 'overview' })}>
            Country overview
          </button>
          <button type="button" role="tab" aria-selected={view === 'compare'} onClick={openCompare}>
            Compare countries
          </button>
        </div>
        <div className="country-pick" hidden={view !== 'overview'}>
          <label htmlFor="country" className="visually-hidden">Country</label>
          <select id="country" value={iso3} onChange={(e) => navigate({ country: e.target.value })}>
            {countries.map((c) => (
              <option key={c.iso3} value={c.iso3}>{c.country}</option>
            ))}
          </select>
        </div>
      </nav>

      <header className="banner" style={{ backgroundImage: `url(${banner})` }}>
        {view === 'compare' ? (
          <div className="banner-inner">
            <h1>Compare countries</h1>
            <p>Put up to four countries side by side on one SDG 3 indicator, against the regional median.</p>
          </div>
        ) : (
        <div className="banner-inner">
          <h1>
            {ISO2[iso3] && (
              <img className="flag" src={`https://flagcdn.com/w80/${ISO2[iso3]}.png`} alt="" width="36" height="24" />
            )}
            {country?.country ?? 'Latin America'}
          </h1>
          <p>Progress on SDG 3, Good Health and Well-being, toward the 2030 targets.</p>
          {summary.length > 0 && (
            <ul className="tally">
              {Object.keys(TREND_LABEL).map((k) => (
                <li key={k} className={k}>
                  <strong>{counts[k] ?? 0}</strong> {TREND_LABEL[k].toLowerCase()}
                </li>
              ))}
            </ul>
          )}
        </div>
        )}
      </header>

      <main className="layout">
        {error && <p className="error">{error}</p>}

        {view === 'compare' && countries.length > 0 && Object.keys(indicators).length > 0 && (
          <Compare
            indicators={indicators}
            countries={countries}
            series={indicators[route.indicator] ? route.indicator : current}
            picks={route.picks ?? defaultPicks(iso3)}
            onSeries={(s) => navigate({ indicator: s })}
            onPicks={(picks) => navigate({ picks }, { replace: true })}
            onOpenCountry={(c) => navigate({ view: 'overview', country: c })}
          />
        )}

        {view === 'overview' && (
        <>
        <aside className="panel ind-list">
          <h2 className="panel-title">Indicators</h2>
          <ul>
            {ordered.map((row) => (
              <Item
                key={row.series}
                row={row}
                info={indicators[row.series]}
                active={row.series === current}
                onSelect={() => navigate({ indicator: row.series })}
              />
            ))}
          </ul>
        </aside>

        {selectedRow && selectedInfo.name && (
          <IndicatorDetail
            row={selectedRow}
            info={selectedInfo}
            country={country?.country}
            iso3={iso3}
            data={series.data}
            loading={series.key !== `${iso3}/${current}`}
            onCompare={openCompare}
          />
        )}
        </>
        )}
      </main>

      <footer className="credit">Data: UN SDG Global Database · Photo: Unsplash</footer>
    </div>
  );
}

function okJson(r) {
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

function Item({ row, info, active, onSelect }) {
  const hasTarget = row.target_value != null;
  return (
    <li>
      <button type="button" className={`item${active ? ' active' : ''}`} onClick={onSelect} aria-pressed={active}>
        <span className="item-top">
          <span className="item-name">{info?.name ?? row.series}</span>
          <span className="item-value">{fmt(row.last_value)}</span>
        </span>
        <span className="item-bottom">
          <span className={`status ${row.classification}`}>{TREND_LABEL[row.classification] ?? row.classification}</span>
          <span className="item-meta">
            {hasTarget ? `${STATUS_LABEL[row.status] ?? row.status} · target ${fmt(row.target_value)}` : 'No 2030 target'}
          </span>
        </span>
      </button>
    </li>
  );
}

export default HomePage;
