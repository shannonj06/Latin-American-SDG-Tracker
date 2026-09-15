import { useEffect, useState } from 'react';
import './home.css';

const API = 'http://localhost:8000';

const STATUS_LABEL = {
  target_achieved: '✓ Met',
  on_track: '✓ On track',
  off_track: '✗ Off track',
  no_numeric_target: '— No target',
  insufficient_data: '? Not enough data',
};

function HomePage() {
  const [countries, setCountries] = useState([]);
  const [indicators, setIndicators] = useState({});
  const [iso3, setIso3] = useState('');
  const [summary, setSummary] = useState([]);
  const [selected, setSelected] = useState(null);
  const [series, setSeries] = useState([]);

  // Load the dropdown options and indicator names once.
  useEffect(() => {
    fetch(`${API}/countries`)
      .then((r) => r.json())
      .then((d) => {
        setCountries(d.countries);
        if (d.countries.length) setIso3(d.countries[0].iso3);
      });
    fetch(`${API}/indicators`)
      .then((r) => r.json())
      .then(setIndicators);
  }, []);

  // Refetch the cards whenever the country changes.
  useEffect(() => {
    if (!iso3) return;
    fetch(`${API}/countries/${iso3}/summary`)
      .then((r) => r.json())
      .then((d) => {
        setSummary(d.summary);
        setSelected(d.summary[0]?.series ?? null);
      });
  }, [iso3]);

  // Refetch the chart whenever the selected card or country changes.
  useEffect(() => {
    if (!iso3 || !selected) return;
    fetch(`${API}/indicators/${selected}/series?iso3=${iso3}`)
      .then((r) => r.json())
      .then((d) => setSeries(d.data));
  }, [iso3, selected]);

  const selectedRow = summary.find((row) => row.series === selected);
  const selectedInfo = indicators[selected] ?? {};

  return (
    <div className="home">
      <h1>SDG Tracker</h1>
      <h3>Per Country Analytics</h3>

      <select value={iso3} onChange={(e) => setIso3(e.target.value)}>
        {countries.map((c) => (
          <option key={c.iso3} value={c.iso3}>{c.country}</option>
        ))}
      </select>

      <div className="cards">
        {summary.map((row) => (
          <Card
            key={row.series}
            row={row}
            info={indicators[row.series]}
            active={row.series === selected}
            onClick={() => setSelected(row.series)}
          />
        ))}
      </div>

      {selectedRow && (
        <div className="chart-box">
          <h4>{selectedInfo.name} <span className="unit">({selectedInfo.unit})</span></h4>
          <LineChart data={series} target={selectedRow.target_value} />
          {series[0]?.source && <p className="source">Source: {series[0].source}</p>}
        </div>
      )}
    </div>
  );
}

function Card({ row, info, active, onClick }) {
  return (
    <button type="button" className={`card${active ? ' active' : ''}`} onClick={onClick}>
      <div className="card-label">{info?.sdg_indicator} · {info?.name ?? row.series}</div>
      <div className="card-value">{row.last_value?.toFixed(1) ?? '–'}</div>
      <div className={`card-status ${row.status}`}>{STATUS_LABEL[row.status] ?? row.status}</div>
    </button>
  );
}

// Plain SVG line chart: observed values plus a dashed horizontal line at the 2030 target.
function LineChart({ data, target }) {
  const W = 600, H = 260, PAD = 40;
  const points = data.filter((d) => d.value != null);
  if (!points.length) return <p className="empty">No data</p>;

  const years = points.map((d) => d.year);
  const values = points.map((d) => d.value);
  const xMin = Math.min(...years);
  const xMax = Math.max(Math.max(...years), target != null ? 2030 : 0);
  const yMax = Math.max(...values, target ?? 0) * 1.1;

  const x = (year) => PAD + ((year - xMin) / (xMax - xMin)) * (W - 2 * PAD);
  const y = (v) => H - PAD - (v / yMax) * (H - 2 * PAD);

  const path = points.map((d) => `${x(d.year)},${y(d.value)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} className="axis" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} className="axis" />

      <polyline points={path} className="series" />

      {target != null && (
        <>
          <line x1={PAD} y1={y(target)} x2={W - PAD} y2={y(target)} className="target" />
          <text x={W - PAD} y={y(target) - 6} textAnchor="end" className="label">
            2030 target: {target}
          </text>
        </>
      )}

      <text x={PAD} y={H - PAD + 18} className="label">{xMin}</text>
      <text x={W - PAD} y={H - PAD + 18} textAnchor="end" className="label">{xMax}</text>
      <text x={PAD - 6} y={PAD + 4} textAnchor="end" className="label">{yMax.toFixed(0)}</text>
      <text x={PAD - 6} y={H - PAD + 4} textAnchor="end" className="label">0</text>
    </svg>
  );
}

export default HomePage;
