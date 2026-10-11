import { useEffect, useState } from 'react';
import banner from '../assets/health-banner.jpg';
import Compare from './Compare.jsx';
import IndicatorDetail from './IndicatorDetail.jsx';
import { API, ISO2, TREND_LABEL, fmt } from './format.js';
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
  const [iso3, setIso3] = useState('');
  const [summary, setSummary] = useState([]);
  const [selected, setSelected] = useState(null);
  // Tagged with the country+indicator it belongs to, so a stale chart is never shown as current.
  const [series, setSeries] = useState({ key: null, data: [] });
  const [error, setError] = useState(null);
  const [view, setView] = useState('overview');

  // Load the dropdown options and indicator names once.
  useEffect(() => {
    fetch(`${API}/countries`)
      .then((r) => r.json())
      .then((d) => {
        setError(null);
        setCountries(d.countries);
        // Only default the country if none is picked yet; a late response must not undo the user's choice.
        if (d.countries.length) setIso3((prev) => prev || d.countries[0].iso3);
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
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setSummary(d.summary);
        // Keep the same indicator open when switching countries.
        setSelected((prev) => (d.summary.some((r) => r.series === prev) ? prev : null));
      });
    return () => {
      cancelled = true;
    };
  }, [iso3]);

  // Rows in SDG order (3.1.1, 3.1.2, ...); the first one is open by default.
  const sdgOrder = (row) => indicators[row.series]?.sdg_indicator ?? row.series;
  const ordered = [...summary].sort((a, b) => sdgOrder(a).localeCompare(sdgOrder(b), undefined, { numeric: true }));
  const current = selected ?? ordered[0]?.series ?? null;

  // Refetch the chart whenever the selected card or country changes.
  useEffect(() => {
    if (!iso3 || !current) return;
    let cancelled = false;
    fetch(`${API}/indicators/${current}/series?iso3=${iso3}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setSeries({ key: `${iso3}/${current}`, data: d.data }));
    return () => {
      cancelled = true;
    };
  }, [iso3, current]);

  const selectedRow = summary.find((row) => row.series === current);
  const selectedInfo = indicators[current] ?? {};
  const country = countries.find((c) => c.iso3 === iso3);

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
          <button type="button" role="tab" aria-selected={view === 'overview'} onClick={() => setView('overview')}>
            Country overview
          </button>
          <button type="button" role="tab" aria-selected={view === 'compare'} onClick={() => setView('compare')}>
            Compare countries
          </button>
        </div>
        <div className="country-pick" hidden={view !== 'overview'}>
          <label htmlFor="country" className="visually-hidden">Country</label>
          <select id="country" value={iso3} onChange={(e) => setIso3(e.target.value)}>
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
          <Compare indicators={indicators} countries={countries} initialSeries={current} homeIso3={iso3} />
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
                onSelect={() => setSelected(row.series)}
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
            onCompare={() => setView('compare')}
          />
        )}
        </>
        )}
      </main>

      <footer className="credit">Data: UN SDG Global Database · Photo: Unsplash</footer>
    </div>
  );
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
