import { useEffect, useState } from 'react';
import Sources from './Sources.jsx';
import { API, ISO2, MAX_COMPARE, NATURE_LABEL, STATUS_LABEL, TREND_LABEL, fmt, niceTicks, signed } from './format.js';
import { trimPicks } from './route.js';
import './Compare.css';

const WINDOW_START = 2015;
const TARGET_YEAR = 2030;

const color = (slot) => `var(--c${slot})`;

// The chosen indicator and countries live in the page's URL state (see route.js), so they
// survive switching tabs, refreshing and the Back button.
function Compare({ indicators, countries, series, picks, onSeries, onPicks, onOpenCountry }) {
  // Each pick keeps its color slot until it is removed: color follows the country, never its position.
  const picked = picks.flatMap((iso3, slot) => (iso3 ? [{ iso3, slot }] : []));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!series) return;
    let cancelled = false;
    fetch(`${API}/indicators/${series}/compare`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch(() => !cancelled && setError(`Could not load comparison data from the API at ${API}.`));
    return () => {
      cancelled = true;
    };
  }, [series]);

  const toggle = (iso3) => {
    const next = [...picks];
    const at = next.indexOf(iso3);
    if (at >= 0) next[at] = null;
    else if (picked.length >= MAX_COMPARE) return;
    else {
      const free = next.indexOf(null);
      if (free >= 0) next[free] = iso3;
      else next.push(iso3);
    }
    onPicks(trimPicks(next));
  };

  const info = indicators[series] ?? {};
  const nameOf = Object.fromEntries(countries.map((c) => [c.iso3, c.country]));
  const ordered = Object.entries(indicators).sort((a, b) =>
    a[1].sdg_indicator.localeCompare(b[1].sdg_indicator, undefined, { numeric: true }),
  );
  const ready = data && data.series === series && info.name;

  return (
    <section className="compare">
      <div className="panel compare-controls">
        <div className="control">
          <label htmlFor="cmp-indicator" className="stat-label">Indicator</label>
          <select id="cmp-indicator" value={series ?? ''} onChange={(e) => onSeries(e.target.value)}>
            {ordered.map(([code, ind]) => (
              <option key={code} value={code}>{ind.sdg_indicator} · {ind.name}</option>
            ))}
          </select>
        </div>
        <div className="control">
          <span className="stat-label">
            Countries <span className="muted">· {picked.length} of {MAX_COMPARE} selected</span>
          </span>
          <div className="chips" role="group" aria-label="Countries to compare">
            {countries.map((c) => {
              const pick = picked.find((p) => p.iso3 === c.iso3);
              const full = !pick && picked.length >= MAX_COMPARE;
              return (
                <button
                  key={c.iso3}
                  type="button"
                  className={`chip${pick ? ' on' : ''}`}
                  aria-pressed={!!pick}
                  disabled={full}
                  title={full ? `Remove a country first (max ${MAX_COMPARE})` : undefined}
                  onClick={() => toggle(c.iso3)}
                >
                  {pick && <i className="swatch" style={{ background: color(pick.slot) }} />}
                  {c.country}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!ready && !error && <p className="muted loading-note">Loading comparison…</p>}

      {ready && (
        <CompareBody
          data={data}
          info={info}
          series={series}
          picked={picked}
          nameOf={nameOf}
          onOpenCountry={onOpenCountry}
        />
      )}
    </section>
  );
}

function CompareBody({ data, info, series, picked, nameOf, onOpenCountry }) {
  const summaryBy = Object.fromEntries(data.summary.map((r) => [r.iso3, r]));
  const obsBy = {};
  for (const o of data.observations) if (o.value != null) (obsBy[o.iso3] ??= []).push(o);

  const anyRow = data.summary.find((r) => r.comparison_year != null);
  const cmpYear = anyRow?.comparison_year ?? null;
  const cmpMedian = anyRow?.regional_median ?? null;
  const better = info.direction === 'lower_is_better' ? 'Lower is better' : 'Higher is better';
  const pickedObs = picked.flatMap((p) => obsBy[p.iso3] ?? []);

  return (
    <>
      <div className="panel">
        <header className="detail-head">
          <h2>{info.name}</h2>
          <p className="detail-sub">
            SDG {info.sdg_indicator} · {info.unit} · {better}
            {cmpYear && ` · countries compared on ${cmpYear}, the latest year at least 80% of them report`}
          </p>
        </header>
      </div>

      {picked.length === 0 ? (
        <p className="muted">Select at least one country above.</p>
      ) : (
        <>
          <div className="panel">
            <h3 className="panel-title">Historical trends</h3>
            <TrendLines picked={picked} obsBy={obsBy} medians={data.regional_median} info={info} nameOf={nameOf}
              nCountries={data.summary.length} />
          </div>

          <div className="panel">
            <h3 className="panel-title">Latest comparable values</h3>
            <ValuesTable picked={picked} summaryBy={summaryBy} obsBy={obsBy} nameOf={nameOf} cmpYear={cmpYear}
              cmpMedian={cmpMedian} info={info} onOpenCountry={onOpenCountry} />
            <p className="rank-note muted">Click a country name to open its full overview.</p>
          </div>
        </>
      )}

      <div className="compare-cols">
        <div className="panel">
          <h3 className="panel-title">Regional ranking{cmpYear ? ` (${cmpYear})` : ''}</h3>
          <Ranking summary={data.summary} picked={picked} nameOf={nameOf} median={cmpMedian} info={info}
            onOpenCountry={onOpenCountry} />
        </div>
        {picked.length > 0 && (
          <div className="panel">
            <h3 className="panel-title">Data availability</h3>
            <Availability picked={picked} obsBy={obsBy} nameOf={nameOf} />
          </div>
        )}
      </div>

      {picked.length > 0 && (
        <Sources
          series={series}
          info={info}
          observations={pickedObs}
          countries={picked.map((p) => ({ iso3: p.iso3, country: nameOf[p.iso3] }))}
          computedAt={anyRow?.computed_at}
        />
      )}
    </>
  );
}

function TrendLines({ picked, obsBy, medians, info, nameOf, nCountries }) {
  const [hoverYear, setHoverYear] = useState(null);
  // Only draw the median where at least half the region reports, so it isn't the median of two countries.
  const medianPts = medians.filter((m) => m.n_countries >= nCountries / 2);
  const lines = picked.map((p) => ({ ...p, pts: obsBy[p.iso3] ?? [] }));
  const all = lines.flatMap((l) => l.pts);
  if (!all.length) return <p className="empty">No data for the selected countries.</p>;

  // A single regional line only makes sense for an absolute target; relative targets differ by country.
  const target = info.target_type === 'absolute' ? info.target_2030 : null;
  const years = [...all.map((o) => o.year), ...medianPts.map((m) => m.year)];
  const xMin = Math.min(...years);
  const xMax = Math.max(...years);
  const yTicks = niceTicks(Math.max(...all.map((o) => o.value), ...medianPts.map((m) => m.median), target ?? 0), 5);
  const yMax = yTicks.at(-1);

  const W = 720, H = 300, L = 48, R = 56, T = 16, B = 28;
  const x = (yr) => L + ((yr - xMin) / (xMax - xMin || 1)) * (W - L - R);
  const y = (v) => H - B - (Math.max(v, 0) / yMax) * (H - T - B);
  const path = (pts, key = 'value') => pts.map((o) => `${x(o.year)},${y(o[key])}`).join(' ');
  const xTicks = [];
  for (let yr = Math.ceil(xMin / 5) * 5; yr <= xMax; yr += 5) xTicks.push(yr);

  const pick = (e) => {
    const rect = e.currentTarget.ownerSVGElement.getBoundingClientRect();
    const yr = Math.round(xMin + (((e.clientX - rect.left) / rect.width) * W - L) / (W - L - R) * (xMax - xMin));
    setHoverYear(Math.min(xMax, Math.max(xMin, yr)));
  };
  const onKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = hoverYear ?? xMax;
    setHoverYear(Math.min(xMax, Math.max(xMin, cur + (e.key === 'ArrowRight' ? 1 : -1))));
  };
  const medianAt = medianPts.find((m) => m.year === hoverYear);

  return (
    <div className="trend">
      <ul className="legend">
        {lines.map((l) => (
          <li key={l.iso3}><i className="key" style={{ height: 2, background: color(l.slot) }} /> {nameOf[l.iso3]}</li>
        ))}
        <li><i className="key key-median" /> Regional median</li>
        {target != null && <li><i className="key key-target" /> 2030 target ({fmt(target)})</li>}
      </ul>
      <div className="plot">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" tabIndex={0} onKeyDown={onKey}
          onBlur={() => setHoverYear(null)}
          aria-label={`${info.name}: ${lines.map((l) => nameOf[l.iso3]).join(', ')} and the regional median, ${xMin} to ${xMax}. Use arrow keys to read values.`}>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
              <text x={L - 8} y={y(t) + 4} textAnchor="end" className="tick">{fmt(t)}</text>
            </g>
          ))}
          {xTicks.map((yr) => (
            <text key={yr} x={x(yr)} y={H - B + 18} textAnchor="middle" className="tick">{yr}</text>
          ))}
          {xMin < WINDOW_START && WINDOW_START < xMax && (
            <line x1={x(WINDOW_START)} x2={x(WINDOW_START)} y1={T} y2={H - B} className="baseline" />
          )}
          {target != null && (
            <>
              <line x1={L} x2={W - R} y1={y(target)} y2={y(target)} className="target" />
              <text x={W - R + 4} y={y(target) + 4} className="tick">{TARGET_YEAR}</text>
            </>
          )}
          {medianPts.length > 1 && <polyline points={path(medianPts, 'median')} className="median" />}
          {lines.map((l) => (
            <g key={l.iso3}>
              <polyline points={path(l.pts)} fill="none" stroke={color(l.slot)} strokeWidth="2" strokeLinejoin="round" />
              {l.pts.length <= 15 && l.pts.map((o) => (
                <circle key={o.year} cx={x(o.year)} cy={y(o.value)} r="3.5" className="dot-ring" style={{ fill: color(l.slot) }} />
              ))}
            </g>
          ))}
          {hoverYear != null && (
            <>
              <line x1={x(hoverYear)} x2={x(hoverYear)} y1={T} y2={H - B} className="crosshair" />
              {lines.map((l) => {
                const o = l.pts.find((p) => p.year === hoverYear);
                return o && <circle key={l.iso3} cx={x(o.year)} cy={y(o.value)} r="5" className="dot-ring" style={{ fill: color(l.slot) }} />;
              })}
            </>
          )}
          <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" onPointerMove={pick}
            onPointerLeave={() => setHoverYear(null)} />
        </svg>
        {hoverYear != null && (
          <div className={`tooltip${x(hoverYear) > W * 0.6 ? ' flip' : ''}`} style={{ left: `${(x(hoverYear) / W) * 100}%`, top: '35%' }}>
            <div className="tt-year">{hoverYear}</div>
            {lines.map((l) => {
              const o = l.pts.find((p) => p.year === hoverYear);
              return (
                <div key={l.iso3} className="tt-row">
                  <i className="tt-key" style={{ background: color(l.slot) }} />
                  <strong>{o ? fmt(o.value, 1) : '–'}</strong> <span className="muted">{nameOf[l.iso3]}</span>
                </div>
              );
            })}
            <div className="tt-row">
              <i className="tt-key tt-median" />
              <strong>{medianAt ? fmt(medianAt.median, 1) : '–'}</strong> <span className="muted">Regional median</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ValuesTable({ picked, summaryBy, obsBy, nameOf, cmpYear, cmpMedian, info, onOpenCountry }) {
  const lowerBetter = info.direction === 'lower_is_better';
  return (
    <div className="table-scroll">
      <table className="cmp-table">
        <thead>
          <tr>
            <th>Country</th>
            <th className="num">Value in {cmpYear ?? '–'}</th>
            <th className="num">Rank</th>
            <th className="num">vs. median ({fmt(cmpMedian)})</th>
            <th className="num">Latest value</th>
            <th>Trend since 2015</th>
            <th>2030 target</th>
          </tr>
        </thead>
        <tbody>
          {picked.map((p) => {
            const r = summaryBy[p.iso3] ?? {};
            const gap = r.gap_to_median;
            const isBetter = gap != null && (lowerBetter ? gap < 0 : gap > 0);
            const latest = obsBy[p.iso3]?.at(-1);
            return (
              <tr key={p.iso3}>
                <td>
                  <span className="country-cell">
                    <i className="swatch" style={{ background: color(p.slot) }} />
                    {ISO2[p.iso3] && <img src={`https://flagcdn.com/w40/${ISO2[p.iso3]}.png`} alt="" width="18" height="12" />}
                    <CountryLink iso3={p.iso3} nameOf={nameOf} onOpen={onOpenCountry} />
                  </span>
                </td>
                <td className="num strong">{fmt(r.comparison_value)}</td>
                <td className="num">{r.rank ? `${r.rank} of ${r.of_n}` : '–'}</td>
                <td className="num">
                  {gap == null ? '–' : signed(gap)}
                  {gap != null && gap !== 0 && <span className={`cmp-note ${isBetter ? 'good' : 'bad'}`}>{isBetter ? 'better' : 'worse'}</span>}
                </td>
                <td className="num">
                  {latest ? fmt(latest.value) : '–'}
                  {latest && <span className="cmp-note">{latest.year}</span>}
                </td>
                <td><span className={`status ${r.classification}`}>{TREND_LABEL[r.classification] ?? '–'}</span></td>
                <td>
                  {r.target_value == null
                    ? <span className="muted">No numeric target</span>
                    : <span className={`status ${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Ranking({ summary, picked, nameOf, median, info, onOpenCountry }) {
  const ranked = summary.filter((r) => r.rank != null).sort((a, b) => a.rank - b.rank);
  const unranked = summary.filter((r) => r.rank == null);
  if (!ranked.length) return <p className="empty">Not enough countries report a common year to rank them.</p>;
  const max = Math.max(...ranked.map((r) => r.comparison_value), median ?? 0) * 1.05;
  const slotOf = Object.fromEntries(picked.map((p) => [p.iso3, p.slot]));

  return (
    <>
      <p className="rank-note muted">
        1 = best. {info.direction === 'lower_is_better' ? 'Lower values rank higher.' : 'Higher values rank higher.'}
        {median != null && ' The vertical line is the regional median.'}
      </p>
      <ol className="ranking">
        {ranked.map((r) => {
          const slot = slotOf[r.iso3];
          return (
            <li key={r.iso3} className={slot != null ? 'picked' : ''} title={`${nameOf[r.iso3]}: ${fmt(r.comparison_value, 2)} ${info.unit}`}>
              <span className="rank-no">{r.rank}</span>
              <span className="rank-name"><CountryLink iso3={r.iso3} nameOf={nameOf} onOpen={onOpenCountry} /></span>
              <span className="rank-track">
                <span className="rank-bar" style={{ width: `${(r.comparison_value / max) * 100}%`, background: slot != null ? color(slot) : undefined }} />
                {median != null && <span className="rank-median" style={{ left: `${(median / max) * 100}%` }} />}
              </span>
              <span className="rank-value">{fmt(r.comparison_value)}</span>
            </li>
          );
        })}
      </ol>
      {unranked.length > 0 && (
        <p className="rank-note muted">No value in the comparison year: {unranked.map((r) => nameOf[r.iso3]).join(', ')}.</p>
      )}
    </>
  );
}

function CountryLink({ iso3, nameOf, onOpen }) {
  return (
    <button type="button" className="link-button" onClick={() => onOpen(iso3)} title={`Open ${nameOf[iso3]}'s overview`}>
      {nameOf[iso3]}
    </button>
  );
}

function Availability({ picked, obsBy, nameOf }) {
  const all = picked.flatMap((p) => obsBy[p.iso3] ?? []);
  if (!all.length) return <p className="empty">No data.</p>;
  const from = Math.min(...all.map((o) => o.year));
  const to = Math.max(...all.map((o) => o.year));
  const years = Array.from({ length: to - from + 1 }, (_, i) => from + i);

  return (
    <>
      <div className="avail" style={{ '--cols': years.length }}>
        <span />
        <span className="avail-years">
          <span>{from}</span>
          <span>{to}</span>
        </span>
        <span className="stat-label avail-count">Since 2015</span>
        {picked.map((p) => {
          const byYear = Object.fromEntries((obsBy[p.iso3] ?? []).map((o) => [o.year, o]));
          const recent = years.filter((y) => y >= WINDOW_START);
          const haveRecent = recent.filter((y) => byYear[y]).length;
          return (
            <div key={p.iso3} className="avail-row">
              <span className="avail-name">{nameOf[p.iso3]}</span>
              <span className="avail-cells">
                {years.map((y) => {
                  const o = byYear[y];
                  return (
                    <i
                      key={y}
                      className={o ? 'has' : ''}
                      style={o ? { background: color(p.slot) } : undefined}
                      title={o ? `${nameOf[p.iso3]} ${y}: ${fmt(o.value, 2)} (${NATURE_LABEL[o.nature] ?? o.nature ?? 'unknown type'})` : `${nameOf[p.iso3]} ${y}: no data`}
                    />
                  );
                })}
              </span>
              <span className="avail-count">{haveRecent} of {recent.length} yrs</span>
            </div>
          );
        })}
      </div>
      <p className="rank-note muted">Each square is one year. Filled = a value exists; empty = no data. Hover a square for its value and type.</p>
    </>
  );
}

export default Compare;
