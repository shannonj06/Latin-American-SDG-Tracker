"""Compute one summary row per (indicator, country) from the SDG 3 observations.

Reads `indicators` and `observations` from Postgres (DATABASE_URL), writes
indicator_summary.csv. Trend is a straight OLS line of value on year since 2015.
Usage: DATABASE_URL=postgres://... python analyze.py
"""
import math
import os
import sys
from datetime import datetime, timezone

import pandas as pd
import psycopg2
from scipy.stats import linregress

WINDOW_START = 2015           # SDGs were adopted in 2015: the official baseline for "progress".
TARGET_YEAR = 2030            # The year every SDG target is set against.
PROJECTION_HORIZON = 2100     # Past this we say the projection never crosses the target.
MIN_OBS = 5                   # Fewer points than this in the window -> insufficient_data.
STAGNATION_THRESHOLD = 0.5    # % per year. A judgement call, not a fact: slower than this is "stagnating".
COMPARISON_COVERAGE = 0.8     # Share of countries that must have a value for a year to be the comparison year.
HIGH_CONF_OBS, HIGH_CONF_R2 = 8, 0.8    # high confidence: at least this many points AND this good a fit.
LOW_CONF_R2 = 0.5                       # low confidence: fit worse than this (or n_obs < MIN_OBS).
RELATIVE_TARGET_FACTOR = 2 / 3          # SDG 3.4.1: cut NCD mortality by one third from the 2015 baseline.

OUTPUT_CSV = "indicator_summary.csv"


def load_data(conn):
    def read(sql):
        with conn.cursor() as cur:
            cur.execute(sql)
            return pd.DataFrame(cur.fetchall(), columns=[d[0] for d in cur.description])

    indicators = read("SELECT series, sdg_indicator, name, unit, target_2030, target_type, direction FROM indicators")
    # Only headline rows: one per country-indicator-year, sex/age splits already resolved.
    observations = read("SELECT series, iso3, country, year, value FROM observations WHERE is_headline")
    indicators["target_2030"] = pd.to_numeric(indicators["target_2030"])
    observations["value"] = pd.to_numeric(observations["value"])
    return indicators, observations


def meets(value, target, direction):
    if value is None or target is None or pd.isna(value) or pd.isna(target):
        return False
    return value <= target if direction == "lower_is_better" else value >= target


def fit_trend(sub):
    """OLS of value on year for one (series, iso3). `sub` is already windowed and sorted."""
    n = len(sub)
    out = {"window_start": None, "window_end": None, "first_value": None, "last_value": None,
           "abs_change": None, "pct_change": None, "annual_change": None,
           "relative_annual_change": None, "n_obs": n, "r_squared": None}
    if n == 0:
        return out
    first, last = sub.iloc[0], sub.iloc[-1]
    out.update(window_start=int(first.year), window_end=int(last.year),
               first_value=float(first.value), last_value=float(last.value),
               abs_change=float(last.value - first.value),
               pct_change=float((last.value - first.value) / first.value * 100) if first.value else None)
    if n >= 2 and sub.year.nunique() >= 2:
        fit = linregress(sub.year.astype(float), sub.value.astype(float))
        mean = sub.value.mean()
        out.update(annual_change=float(fit.slope), r_squared=float(fit.rvalue ** 2),
                   relative_annual_change=float(fit.slope / mean * 100) if mean else None)
    return out


def classify(trend, direction):
    if trend["n_obs"] < MIN_OBS or trend["relative_annual_change"] is None:
        return "insufficient_data"
    if abs(trend["relative_annual_change"]) < STAGNATION_THRESHOLD:
        return "stagnating"
    good = trend["annual_change"] < 0 if direction == "lower_is_better" else trend["annual_change"] > 0
    return "improving" if good else "declining"


def confidence(trend):
    n, r2 = trend["n_obs"], trend["r_squared"]
    if n < MIN_OBS or r2 is None or r2 < LOW_CONF_R2:
        return "low"
    if n >= HIGH_CONF_OBS and r2 >= HIGH_CONF_R2:
        return "high"
    return "medium"


def comparison_table(obs, direction, n_countries):
    """Pick the latest year with >= COMPARISON_COVERAGE of countries reporting; rank everyone on it."""
    counts = obs.dropna(subset=["value"]).groupby("year").iso3.nunique()
    eligible = counts[counts >= COMPARISON_COVERAGE * n_countries]
    if eligible.empty:
        return None, {}
    year = int(eligible.index.max())
    snap = obs[(obs.year == year)].dropna(subset=["value"]).copy()
    snap["rank"] = snap.value.rank(method="min", ascending=(direction == "lower_is_better")).astype(int)
    of_n, median = len(snap), float(snap.value.median())
    rows = {}
    for r in snap.itertuples():
        # percentile: 100 = best in region, 0 = worst.
        pct = 100.0 if of_n == 1 else (of_n - r.rank) / (of_n - 1) * 100
        rows[r.iso3] = {"comparison_year": year, "rank": int(r.rank), "of_n": of_n,
                        "percentile": round(pct, 1), "regional_median": median,
                        "gap_to_median": float(r.value - median)}
    return year, rows


def target_block(ind, sub, trend, direction):
    out = {"target_value": None, "target_source": None, "projected_2030": None,
           "required_annual_change": None, "gap_to_target": None, "year_target_met": None, "status": None}
    if ind.target_type == "absolute":
        out.update(target_value=float(ind.target_2030), target_source="absolute")
    elif ind.target_type == "relative_to_baseline" and len(sub):
        # "Reduce by one third from 2015". Fall back to the earliest windowed year if 2015 is missing.
        base = sub[sub.year == WINDOW_START]
        base = base.iloc[0] if len(base) else sub.iloc[0]
        out.update(target_value=float(base.value * RELATIVE_TARGET_FACTOR), target_source=f"computed_from_{int(base.year)}")
    else:
        out["status"] = "no_numeric_target"
        return out
    if trend["n_obs"] < MIN_OBS or trend["annual_change"] is None:
        out["status"] = "insufficient_data"
        return out

    target, last, slope, end = out["target_value"], trend["last_value"], trend["annual_change"], trend["window_end"]
    years_left = TARGET_YEAR - end
    projected = last + slope * years_left
    out.update(projected_2030=projected, gap_to_target=last - target,
               required_annual_change=(target - last) / years_left if years_left > 0 else None)
    if meets(last, target, direction):
        out["status"] = "target_achieved"
        out["year_target_met"] = int(sub[sub.apply(lambda r: meets(r.value, target, direction), axis=1)].year.min())
    else:
        out["status"] = "on_track" if meets(projected, target, direction) else "off_track"
        if slope != 0:
            crossing = end + (target - last) / slope
            if end < crossing <= PROJECTION_HORIZON:
                out["year_target_met"] = math.ceil(crossing)
    return out


def rationale(country, ind, trend, cls, comp, tgt, direction):
    name = ind.name.lower().replace("ncd", "NCD")
    if cls == "insufficient_data":
        return (f"{country} has only {trend['n_obs']} headline observation(s) for {name} since "
                f"{WINDOW_START}, too few to assess a trend.")
    # Endpoints and fitted slope can disagree (e.g. a COVID spike mid-window), so state both explicitly.
    verb = "fell" if trend["abs_change"] < 0 else "rose"
    text = (f"{country}'s {name} {verb} from {trend['first_value']:.1f} in {trend['window_start']} to "
            f"{trend['last_value']:.1f} in {trend['window_end']}; the fitted trend since {WINDOW_START} is "
            f"{trend['annual_change']:+.2f} per year, classified as {cls}.")
    status, target = tgt["status"], tgt["target_value"]
    side = "below" if direction == "lower_is_better" else "above"
    if status == "target_achieved":
        text += f" It is already {side} the SDG target of {target:.1f} {ind.unit}."
    elif status == "on_track":
        text += f" At this pace it is projected to reach {tgt['projected_2030']:.1f} by {TARGET_YEAR}, meeting the target of {target:.1f} {ind.unit}."
    elif status == "off_track":
        text += (f" At this pace it would reach {tgt['projected_2030']:.1f} by {TARGET_YEAR}, missing the target of "
                 f"{target:.1f} {ind.unit}; meeting it would require {tgt['required_annual_change']:+.2f} per year.")
    elif comp:
        rel = "above" if comp["gap_to_median"] > 0 else "below"
        text += (f" The UN sets no numeric {TARGET_YEAR} target for this indicator; in {comp['comparison_year']} it ranked "
                 f"{comp['rank']} of {comp['of_n']} countries in the region, {rel} the regional median of {comp['regional_median']:.1f}.")
    else:
        text += f" The UN sets no numeric {TARGET_YEAR} target for this indicator."
    return text


def build_summary(indicators, observations):
    obs = observations.dropna(subset=["value"])
    obs = obs[obs.year >= WINDOW_START]
    countries = sorted(observations.iso3.unique())
    computed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = []
    for ind in indicators.itertuples():
        series_obs = obs[obs.series == ind.series]
        _, comparison = comparison_table(series_obs, ind.direction, len(countries))
        for iso3 in countries:
            sub = series_obs[series_obs.iso3 == iso3].sort_values("year")
            country = observations.loc[observations.iso3 == iso3, "country"].iloc[0]
            trend = fit_trend(sub)
            cls = classify(trend, ind.direction)
            comp = comparison.get(iso3, {})
            tgt = target_block(ind, sub, trend, ind.direction)
            row = {"series": ind.series, "iso3": iso3, **trend, "classification": cls, "confidence": confidence(trend),
                   "comparison_year": None, "rank": None, "of_n": None, "percentile": None,
                   "regional_median": None, "gap_to_median": None, **comp, **tgt,
                   "rationale": rationale(country, ind, trend, cls, comp, tgt, ind.direction), "computed_at": computed_at}
            rows.append(row)
    summary = pd.DataFrame(rows)
    for col in ["window_start", "window_end", "comparison_year", "rank", "of_n", "year_target_met"]:
        summary[col] = summary[col].astype("Int64")  # nullable int, so the CSV says 2023 not 2023.0
    return summary


def print_report(summary):
    print("\nclassification:")
    print(summary.classification.value_counts().to_string())
    print("\nstatus:")
    print(summary.status.value_counts().to_string())
    sparse = summary[summary.classification == "insufficient_data"]
    if len(sparse):
        print(f"\ninsufficient_data ({len(sparse)} pairs):")
        for series, group in sparse.groupby("series"):
            print(f"  {series}: {' '.join(group.iso3)}")


def main():
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set")
    with psycopg2.connect(url) as conn:
        indicators, observations = load_data(conn)
    summary = build_summary(indicators, observations)
    summary.to_csv(OUTPUT_CSV, index=False)
    print(f"wrote {len(summary)} rows to {OUTPUT_CSV}")
    print_report(summary)


if __name__ == "__main__":
    main()
