import { useState } from 'react';
import { TREND_LABEL, fmt, signed } from './format.js';
import './IndicatorDetail.css';

// UN "Nature" attribute on each observation.
const NATURE_LABEL = {
  C: 'Country data',
  CA: 'Country data, adjusted',
  E: 'Estimated',
  M: 'Modelled',
  G: 'Global monitoring',
  N: 'Non-relevant',
};

const TARGET_YEAR = 2030;
const WINDOW_START = 2015;

function targetText(info, row) {
  switch (info.target_type) {
    case 'absolute':
      return `${fmt(row.target_value ?? info.target_2030)} by ${TARGET_YEAR}`;
    case 'relative_to_baseline': {
      const base = row.target_source?.replace('computed_from_', '') ?? WINDOW_START;
      return row.target_value != null
        ? `Cut by one third from ${base}: ${fmt(row.target_value)} by ${TARGET_YEAR}`
        : `Cut by one third from ${WINDOW_START}`;
    }
    case 'directional':
      return info.direction === 'lower_is_better' ? 'Reduce (no numeric target)' : 'Increase (no numeric target)';
    default:
      return 'No numeric UN target';
  }
}

// Straight OLS of value on year, same as analyze.py, so the drawn line matches the classification.
function fitLine(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p.year, 0) / n;
  const my = points.reduce((s, p) => s + p.value, 0) / n;
  let sxy = 0, sxx = 0;
  for (const p of points) {
    sxy += (p.year - mx) * (p.value - my);
    sxx += (p.year - mx) ** 2;
  }
  if (!sxx) return null;
  const slope = sxy / sxx;
  return (year) => my + slope * (year - mx);
}

function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let t = 0; t < max + step * 0.999; t += step) ticks.push(+t.toFixed(10));
  return ticks;
}

function IndicatorDetail({ row, info, country, data, loading }) {
  const points = data.filter((d) => d.value != null);
  const windowPts = points.filter((d) => d.year >= (row.window_start ?? WINDOW_START));
  const hasTarget = row.target_value != null;

  // Data availability: which years since 2015 are missing, and what kind of data it is.
  const lastYear = row.window_end ?? points.at(-1)?.year;
  const haveYears = new Set(windowPts.map((d) => d.year));
  const missing = [];
  for (let y = WINDOW_START; lastYear && y <= lastYear; y++) if (!haveYears.has(y)) missing.push(y);
  const natures = [...new Set(points.map((d) => d.nature).filter(Boolean))];
  const source = points.find((d) => d.source)?.source;

  const betterWhen = info.direction === 'lower_is_better' ? 'Lower is better' : 'Higher is better';

  return (
    <section className={`detail${loading ? ' loading' : ''}`} aria-live="polite">
      <div className="panel">
      <header className="detail-head">
        <h2>{info.name}</h2>
        <p className="detail-sub">SDG {info.sdg_indicator} · {country} · {info.unit}</p>
      </header>

      <div className="stats">
        <Stat label={`Latest value (${row.window_end ?? '–'})`}>
          <span className="stat-value">{fmt(row.last_value)}</span>
          <span className="stat-note">{info.unit}</span>
        </Stat>
        <Stat label={`Change since ${row.window_start ?? WINDOW_START}`}>
          <span className="stat-value">{signed(row.abs_change)}</span>
          <span className="stat-note">
            {row.pct_change != null ? `${signed(row.pct_change, 0)}% · from ${fmt(row.first_value)}` : 'No 2015+ data'}
          </span>
        </Stat>
        <Stat label="Trend since 2015">
          <span className={`stat-value status ${row.classification}`}>{TREND_LABEL[row.classification]}</span>
          <span className="stat-note">
            {row.classification === 'insufficient_data' || row.annual_change == null
              ? `Needs 5+ data points, has ${row.n_obs}`
              : `${signed(row.annual_change, 2)} per year (fitted)`}
          </span>
        </Stat>
        <Stat label="Confidence">
          <span className="stat-value">{row.confidence[0].toUpperCase() + row.confidence.slice(1)}</span>
          <span className="stat-note">
            {row.n_obs} points since 2015{row.r_squared != null ? ` · fit R² ${fmt(row.r_squared, 2)}` : ''}
          </span>
        </Stat>
        <Stat label={`Regional rank${row.comparison_year ? ` (${row.comparison_year})` : ''}`}>
          <span className="stat-value">{row.rank ? `#${row.rank} of ${row.of_n}` : '–'}</span>
          <span className="stat-note">
            {row.regional_median != null ? `Regional median ${fmt(row.regional_median)}` : 'Not enough regional data'}
          </span>
        </Stat>
      </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">History and trend</h3>
        <TrendChart points={points} windowPts={windowPts} row={row} info={info} />
        <p className="rationale">{row.rationale}</p>
      </div>

      <div className="detail-cols">
        <div className="panel">
          <h3 className="panel-title">About this indicator</h3>
          <dl className="meta">
            <dt>Indicator</dt><dd>SDG {info.sdg_indicator} · {info.name}</dd>
            <dt>Unit</dt><dd>{info.unit}</dd>
            <dt>Direction</dt><dd>{betterWhen}</dd>
            <dt>2030 target</dt><dd>{targetText(info, row)}</dd>
            {hasTarget && (
              <>
                <dt>Target status</dt>
                <dd>{row.status.replaceAll('_', ' ')}{row.year_target_met ? ` · met ${row.year_target_met <= lastYear ? 'in' : 'projected by'} ${row.year_target_met}` : ''}</dd>
              </>
            )}
            <dt>Series code</dt><dd><code>{row.series}</code></dd>
          </dl>
        </div>
        <div className="panel">
          <h3 className="panel-title">Data availability</h3>
          <dl className="meta">
            <dt>History</dt>
            <dd>{points.length ? `${points.length} years, ${points[0].year}–${points.at(-1).year}` : 'No data'}</dd>
            <dt>Since 2015</dt>
            <dd>
              {row.n_obs} of {lastYear ? lastYear - WINDOW_START + 1 : 0} years
              {missing.length > 0 && <span className="muted"> · missing {missing.join(', ')}</span>}
            </dd>
            <dt>Data type</dt><dd>{natures.map((n) => NATURE_LABEL[n] ?? n).join(', ') || '–'}</dd>
            <dt>Source</dt><dd className="source-text">{source ?? '–'}</dd>
          </dl>
          {row.confidence === 'low' && (
            <p className="caveat">
              {row.classification === 'insufficient_data'
                ? 'Too few recent data points to classify a trend.'
                : 'Low confidence: the data points scatter widely around the fitted trend, so the classification is tentative.'}
            </p>
          )}
          <DataTable points={points} />
        </div>
      </div>
    </section>
  );
}

function Stat({ label, children }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      {children}
    </div>
  );
}

function TrendChart({ points, windowPts, row, info }) {
  const [hover, setHover] = useState(null);
  if (!points.length) return <p className="empty">No historical data for this indicator.</p>;

  const W = 720, H = 300, L = 48, R = 56, T = 16, B = 28;
  const hasTarget = row.target_value != null;
  const showFit = row.classification !== 'insufficient_data';
  const fit = showFit ? fitLine(windowPts) : null;
  const projected = hasTarget && row.projected_2030 != null && row.window_end < TARGET_YEAR;
  const hasBand = points.some((d) => d.lower_bound != null && d.upper_bound != null);

  const xMin = points[0].year;
  const xMax = Math.max(points.at(-1).year, hasTarget ? TARGET_YEAR : 0);
  const yTop = Math.max(
    ...points.map((d) => d.upper_bound ?? d.value),
    hasTarget ? row.target_value : 0,
    projected ? row.projected_2030 : 0,
  );
  const yTicks = niceTicks(yTop * 1.05);
  const yMax = yTicks.at(-1);

  const x = (year) => L + ((year - xMin) / (xMax - xMin || 1)) * (W - L - R);
  const y = (v) => H - B - (Math.max(v, 0) / yMax) * (H - T - B);

  const xTicks = [];
  for (let yr = Math.ceil(xMin / 5) * 5; yr <= xMax; yr += 5) xTicks.push(yr);

  const line = points.map((d) => `${x(d.year)},${y(d.value)}`).join(' ');
  const band = hasBand
    ? (() => {
        const b = points.filter((d) => d.lower_bound != null && d.upper_bound != null);
        return [...b.map((d) => `${x(d.year)},${y(d.upper_bound)}`), ...b.reverse().map((d) => `${x(d.year)},${y(d.lower_bound)}`)].join(' ');
      })()
    : null;
  const last = points.at(-1);

  const pick = (clientX, rect) => {
    const svgX = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((d, i) => {
      if (Math.abs(x(d.year) - svgX) < Math.abs(x(points[best].year) - svgX)) best = i;
    });
    setHover(best);
  };
  const onKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const start = hover ?? points.length - 1;
    setHover(Math.min(points.length - 1, Math.max(0, start + (e.key === 'ArrowRight' ? 1 : -1))));
  };
  const h = hover != null ? points[hover] : null;

  return (
    <div className="trend">
      <ul className="legend">
        <li><i className="key key-line" /> Observed</li>
        {hasBand && <li><i className="key key-band" /> Uncertainty range</li>}
        {fit && <li><i className="key key-fit" /> Trend since 2015</li>}
        {projected && <li><i className="key key-proj" /> Projection to 2030</li>}
        {hasTarget && <li><i className="key key-target" /> 2030 target</li>}
      </ul>

      <div className="plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="chart"
          role="img"
          aria-label={`${info.name} from ${xMin} to ${last.year}. Use left and right arrow keys to read values.`}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
              <text x={L - 8} y={y(t) + 4} textAnchor="end" className="tick">{fmt(t)}</text>
            </g>
          ))}
          {xTicks.map((yr) => (
            <text key={yr} x={x(yr)} y={H - B + 18} textAnchor="middle" className="tick">{yr}</text>
          ))}

          {xMin < WINDOW_START && (
            <>
              <line x1={x(WINDOW_START)} x2={x(WINDOW_START)} y1={T} y2={H - B} className="baseline" />
              <text x={x(WINDOW_START) + 4} y={T + 10} className="tick">SDG baseline</text>
            </>
          )}

          {band && <polygon points={band} className="band" />}

          {hasTarget && (
            <>
              <line x1={L} x2={W - R} y1={y(row.target_value)} y2={y(row.target_value)} className="target" />
              <text x={W - R + 4} y={y(row.target_value) + 4} className="tick">{fmt(row.target_value)}</text>
            </>
          )}

          {fit && (
            <line
              x1={x(row.window_start)} y1={y(fit(row.window_start))}
              x2={x(row.window_end)} y2={y(fit(row.window_end))}
              className="fit"
            />
          )}
          {projected && (
            <line
              x1={x(row.window_end)} y1={y(row.last_value)}
              x2={x(TARGET_YEAR)} y2={y(row.projected_2030)}
              className="proj"
            />
          )}

          <polyline points={line} className="series" />
          {/* Sparse series: mark each observation so gaps between years are visible. */}
          {points.length <= 15 &&
            points.map((d) => <circle key={d.year} cx={x(d.year)} cy={y(d.value)} r="4" className="dot" />)}
          <circle cx={x(last.year)} cy={y(last.value)} r="5" className="dot" />
          {!projected && (
            <text x={x(last.year) + 9} y={y(last.value) + 4} className="end-label">{fmt(last.value)}</text>
          )}

          {h && (
            <>
              <line x1={x(h.year)} x2={x(h.year)} y1={T} y2={H - B} className="crosshair" />
              <circle cx={x(h.year)} cy={y(h.value)} r="5" className="dot" />
            </>
          )}

          <rect
            x={L} y={T} width={W - L - R} height={H - T - B}
            fill="transparent"
            onPointerMove={(e) => pick(e.clientX, e.currentTarget.ownerSVGElement.getBoundingClientRect())}
            onPointerLeave={() => setHover(null)}
          />
        </svg>

        {h && (
          <div
            className={`tooltip${x(h.year) > W * 0.65 ? ' flip' : ''}`}
            style={{ left: `${(x(h.year) / W) * 100}%`, top: `${(y(h.value) / H) * 100}%` }}
          >
            <strong>{fmt(h.value, 2)}</strong> <span className="muted">{info.unit}</span>
            <div>{h.year}</div>
            {h.lower_bound != null && <div className="muted">Range {fmt(h.lower_bound)}–{fmt(h.upper_bound)}</div>}
            {h.nature && <div className="muted">{NATURE_LABEL[h.nature] ?? h.nature}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function DataTable({ points }) {
  const hasBand = points.some((d) => d.lower_bound != null);
  return (
    <details className="data-table">
      <summary>Show all {points.length} values</summary>
      <table>
        <thead>
          <tr>
            <th>Year</th>
            <th>Value</th>
            {hasBand && <th>Lower</th>}
            {hasBand && <th>Upper</th>}
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          {[...points].reverse().map((d) => (
            <tr key={d.year}>
              <td>{d.year}</td>
              <td>{fmt(d.value, 2)}</td>
              {hasBand && <td>{fmt(d.lower_bound, 2)}</td>}
              {hasBand && <td>{fmt(d.upper_bound, 2)}</td>}
              <td>{NATURE_LABEL[d.nature] ?? d.nature ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export default IndicatorDetail;
