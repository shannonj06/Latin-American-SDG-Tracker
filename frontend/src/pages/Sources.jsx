import { useState } from 'react';
import { NATURE_LABEL, REPORTING_LABEL, UN_API, UN_DATA_PORTAL, metadataUrl, rawDataUrl } from './format.js';
import './Sources.css';

// Group observations by their original `source` string, with the years each one covers.
function groupSources(observations) {
  const groups = new Map();
  for (const o of observations) {
    if (!o.source) continue;
    const g = groups.get(o.source) ?? { source: o.source, years: [] };
    g.years.push(o.year);
    groups.set(o.source, g);
  }
  return [...groups.values()].map((g) => ({ ...g, from: Math.min(...g.years), to: Math.max(...g.years), n: g.years.length }));
}

function countBy(observations, key) {
  const counts = {};
  for (const o of observations) if (o[key]) counts[o[key]] = (counts[o[key]] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

// Render URLs inside the UN's free-text source field as links.
function Linkified({ text }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : p,
  );
}

// Some series (e.g. 3.1.2) cite a separate survey record per year; past this many, collapse the list.
const MAX_SOURCES_SHOWN = 3;

function SourceLine({ s, many }) {
  return (
    <span className="source-line">
      <Linkified text={s.source} />
      {many && <span className="muted"> ({s.from === s.to ? s.from : `${s.from}–${s.to}`}, {s.n} {s.n === 1 ? 'value' : 'values'})</span>}
    </span>
  );
}

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null;

/**
 * Where the numbers on screen come from.
 * observations: rows with year, source, nature, reporting_type (one country or several).
 * countries: [{ iso3, country }] the observations belong to.
 */
function Sources({ series, info, observations, countries, computedAt }) {
  const [copied, setCopied] = useState(false);
  const values = observations.filter((o) => o.value != null);
  const sources = groupSources(values);
  const natures = countBy(values, 'nature');
  const reporting = countBy(values, 'reporting_type');
  const latest = values.length ? Math.max(...values.map((o) => o.year)) : null;
  const processed = formatDate(computedAt);
  const names = countries.map((c) => c.country).join(', ');

  const citation =
    `United Nations Statistics Division. SDG Global Database: ${info.name} (SDG indicator ${info.sdg_indicator}, ` +
    `series ${series}), ${names}` +
    (latest ? `, data to ${latest}` : '') +
    `. ${UN_DATA_PORTAL}` +
    (sources.length === 1 ? `. Original source: ${sources[0].source}` : '') +
    (processed ? `. Retrieved via the UN SDG API; processed ${processed}.` : '.');

  const copy = () => {
    navigator.clipboard?.writeText(citation).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="panel sources">
      <h3 className="panel-title">Source and citation</h3>

      <dl className="meta">
        <dt>Indicator</dt>
        <dd>
          SDG {info.sdg_indicator} · {info.name}{' '}
          <a href={metadataUrl(info.sdg_indicator)} target="_blank" rel="noreferrer">UN metadata (PDF)</a>
        </dd>
        <dt>Unit</dt><dd>{info.unit}</dd>
        <dt>Series code</dt><dd><code>{series}</code></dd>
        <dt>Latest year</dt><dd>{latest ?? '–'}</dd>
        <dt>Database</dt>
        <dd>
          <a href={UN_DATA_PORTAL} target="_blank" rel="noreferrer">UN SDG Global Database</a>, United Nations
          Statistics Division, via the <code>{UN_API.replace('https://', '')}</code> API
        </dd>
        <dt>Original source</dt>
        <dd>
          {sources.length === 0 && '–'}
          {sources.slice(0, MAX_SOURCES_SHOWN).map((s) => <SourceLine key={s.source} s={s} many={sources.length > 1} />)}
          {sources.length > MAX_SOURCES_SHOWN && (
            <details className="more-sources">
              <summary>Show all {sources.length} source records</summary>
              {sources.slice(MAX_SOURCES_SHOWN).map((s) => <SourceLine key={s.source} s={s} many />)}
            </details>
          )}
        </dd>
        <dt>Data type</dt>
        <dd>{natures.map(([k, n]) => `${NATURE_LABEL[k] ?? k} (${n})`).join(', ') || '–'}</dd>
        {reporting.length > 0 && (
          <>
            <dt>Reporting</dt>
            <dd>{reporting.map(([k]) => REPORTING_LABEL[k] ?? k).join(', ')}</dd>
          </>
        )}
        <dt>Raw data</dt>
        <dd className="raw-links">
          {countries.map((c) => (
            <a key={c.iso3} href={rawDataUrl(series, c.iso3)} target="_blank" rel="noreferrer">{c.country}</a>
          ))}
        </dd>
        {processed && (
          <>
            <dt>Processed</dt><dd>{processed}</dd>
          </>
        )}
      </dl>

      <div className="citation">
        <div className="citation-head">
          <span className="stat-label">Cite as</span>
          <button type="button" className="text-button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <p>{citation}</p>
      </div>
    </div>
  );
}

export default Sources;
