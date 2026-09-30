import { useEffect, useState } from 'react';
import banner from '../assets/health-banner.jpg';
import IndicatorDetail from './IndicatorDetail.jsx';
import { TREND_LABEL, fmt } from './format.js';
import './home.css';

const API = 'http://localhost:8000';

// flagcdn.com serves flags by ISO 3166 alpha-2 code.
const ISO2 = {
  ARG: 'ar', BOL: 'bo', BRA: 'br', CHL: 'cl', COL: 'co', CRI: 'cr', CUB: 'cu',
  DOM: 'do', ECU: 'ec', GTM: 'gt', HND: 'hn', MEX: 'mx', NIC: 'ni', PAN: 'pa',
  PER: 'pe', PRY: 'py', SLV: 'sv', URY: 'uy', VEN: 've',
};

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

  // Load the dropdown options and indicator names once.
  useEffect(() => {
    fetch(`${API}/countries`)
      .then((r) => r.json())
      .then((d) => {
        setError(null);
        setCountries(d.countries);
        if (d.countries.length) setIso3(d.countries[0].iso3);
      })
      .catch(() => setError(`Could not reach the API at ${API}. Is the backend running?`));
    fetch(`${API}/indicators`)
      .then((r) => r.json())
      .then(setIndicators)
      .catch(() => {});
  }, []);

  // Refetch the ordered whenever the country changes.
  useEffect(() => {
    if (!iso3) return;
    fetch(`${API}/countries/${iso3}/summary`)
      .then((r) => r.json())
      .then((d) => {
        setSummary(d.summary);
        // Keep the same indicator open when switching countries.
        setSelected((prev) => (d.summary.some((r) => r.series === prev) ? prev : null));
      });
  }, [iso3]);

  // Rows in SDG order (3.1.1, 3.1.2, ...); the first one is open by default.
  const sdgOrder = (row) => indicators[row.series]?.sdg_indicator ?? row.series;
  const ordered = [...summary].sort((a, b) => sdgOrder(a).localeCompare(sdgOrder(b), undefined, { numeric: true }));
  const current = selected ?? ordered[0]?.series ?? null;

  // Refetch the chart whenever the selected card or country changes.
  useEffect(() => {
    if (!iso3 || !current) return;
    fetch(`${API}/indicators/${current}/series?iso3=${iso3}`)
      .then((r) => r.json())
      .then((d) => setSeries({ key: `${iso3}/${current}`, data: d.data }));
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
        <div className="country-pick">
          <label htmlFor="country" className="visually-hidden">Country</label>
          <select id="country" value={iso3} onChange={(e) => setIso3(e.target.value)}>
            {countries.map((c) => (
              <option key={c.iso3} value={c.iso3}>{c.country}</option>
            ))}
          </select>
        </div>
      </nav>

      <header className="banner" style={{ backgroundImage: `url(${banner})` }}>
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
      </header>

      <main className="layout">
        {error && <p className="error">{error}</p>}

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
            data={series.data}
            loading={series.key !== `${iso3}/${current}`}
          />
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
            {hasTarget ? `${STATUS_LABEL[row.status] ?? row.status} · target ${fmt(row.target_value)}` : info?.sdg_indicator}
          </span>
        </span>
      </button>
    </li>
  );
}

export default HomePage;
