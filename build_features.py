"""Build the training table for the "is this country on track for its SDG 3 target?" model.

One row per (indicator, country, as_of_year), for indicators with a numeric 2030 target.
Every feature uses only observations up to as_of_year, so each row is a snapshot of what
was knowable then. The label looks LABEL_HORIZON years ahead and asks whether the country
actually kept pace with the straight-line path from as_of_year to the 2030 target.

Rows with a label are training data; rows with is_latest = true are what the model scores
for the dashboard (their label is in the future, so it is NULL).

Usage: DATABASE_URL=postgres://... python build_features.py
       python build_features.py --csv      (read indicators.csv / observations.csv instead)
Writes ml_features.csv; load it into the ml_features table from ml_features_schema.sql.
"""
import os
import sys

import numpy as np
import pandas as pd

from analyze import RELATIVE_TARGET_FACTOR, TARGET_YEAR, WINDOW_START, meets

LABEL_HORIZON = 5         # Years ahead the label looks. 5 leaves labelled rows up to ~2019.
MIN_HISTORY = 5           # Observations needed up to as_of_year before a row is built.
SHORT_WINDOW, LONG_WINDOW = 5, 10   # Trend windows in years, ending at as_of_year.
MIN_FIT_POINTS = 3        # Fewer points than this in a window -> that slope is NULL.
MODELLED_NATURE = {"M", "E"}        # UN Nature codes for agency-modelled / estimated values.

OUTPUT_CSV = "ml_features.csv"


def load(use_csv):
    if use_csv:
        indicators = pd.read_csv("indicators.csv")
        observations = pd.read_csv("observations.csv", keep_default_na=False, na_values=[""])
        observations = observations[observations.is_headline.astype(str) == "True"]
    else:
        import psycopg2
        url = os.environ.get("DATABASE_URL")
        if not url:
            sys.exit("DATABASE_URL is not set (or pass --csv)")
        with psycopg2.connect(url) as conn, conn.cursor() as cur:
            cur.execute("SELECT series, target_2030, target_type, direction FROM indicators")
            indicators = pd.DataFrame(cur.fetchall(), columns=[d[0] for d in cur.description])
            cur.execute("SELECT series, iso3, year, value, lower_bound, upper_bound, nature "
                        "FROM observations WHERE is_headline")
            observations = pd.DataFrame(cur.fetchall(), columns=[d[0] for d in cur.description])
    for col in ["value", "lower_bound", "upper_bound"]:
        observations[col] = pd.to_numeric(observations[col])
    indicators["target_2030"] = pd.to_numeric(indicators["target_2030"])
    obs = observations.dropna(subset=["value"])[["series", "iso3", "year", "value", "lower_bound", "upper_bound", "nature"]]
    return indicators, obs.astype({"year": int})


def oriented_slope(sub, start, end, sign):
    """OLS slope over [start, end] as % of the window mean per year; positive = improving."""
    win = sub[(sub.year >= start) & (sub.year <= end)]
    if len(win) < MIN_FIT_POINTS or win.year.nunique() < 2:
        return None, None
    slope, intercept = np.polyfit(win.year, win.value, 1)
    fitted = slope * win.year + intercept
    ss_tot = ((win.value - win.value.mean()) ** 2).sum()
    r2 = 1 - ((win.value - fitted) ** 2).sum() / ss_tot if ss_tot else None
    mean = win.value.mean()
    return (sign * slope / mean * 100 if mean else None), (float(r2) if r2 is not None else None)


def target_for(ind, sub, as_of):
    """Target as it would have been known at as_of. Relative targets need the 2015 baseline to exist."""
    if ind.target_type == "absolute":
        return float(ind.target_2030)
    base = sub[sub.year >= WINDOW_START]
    if base.empty or base.year.iloc[0] > as_of:
        return None
    return float(base.value.iloc[0] * RELATIVE_TARGET_FACTOR)


def regional_snapshot(obs):
    """Median and per-country percentile (100 = best) for each (series, year)."""
    out = {}
    for (series, year), g in obs.groupby(["series", "year"]):
        out[(series, year)] = (float(g.value.median()), dict(zip(g.iso3, g.value)))
    return out


def build_rows(indicators, obs):
    regional = regional_snapshot(obs)
    rows = []
    for ind in indicators[indicators.target_type.isin(["absolute", "relative_to_baseline"])].itertuples():
        s = -1 if ind.direction == "lower_is_better" else 1   # sign that turns "change" into "progress"
        series_obs = obs[obs.series == ind.series]
        for iso3, sub in series_obs.groupby("iso3"):
            sub = sub.sort_values("year").reset_index(drop=True)
            latest_year = int(sub.year.max())
            for i, cur in sub.iterrows():
                as_of = int(cur.year)
                hist = sub[sub.year <= as_of]
                if len(hist) < MIN_HISTORY or as_of >= TARGET_YEAR:
                    continue
                target = target_for(ind, sub, as_of)
                if target is None:
                    continue

                last = float(cur.value)
                years_left = TARGET_YEAR - as_of
                gap_pct = s * (target - last) / abs(target) * 100   # > 0: still short of target
                already_met = meets(last, target, ind.direction)
                required_pct = (s * (target - last) / years_left) / last * 100 if last else None

                slope_short, _ = oriented_slope(hist, as_of - SHORT_WINDOW + 1, as_of, s)
                slope_long, r2_long = oriented_slope(hist, as_of - LONG_WINDOW + 1, as_of, s)
                slope_prev, _ = oriented_slope(hist, as_of - LONG_WINDOW + 1, as_of - SHORT_WINDOW, s)

                # Projection: carry the long-window pace (in units/yr) forward to 2030.
                projected_gap_pct = None
                if slope_long is not None:
                    win_mean = hist[hist.year > as_of - LONG_WINDOW].value.mean()
                    slope_units = s * slope_long / 100 * win_mean
                    projected = last + slope_units * years_left
                    projected_gap_pct = s * (target - projected) / abs(target) * 100

                recent = hist[hist.year > as_of - LONG_WINDOW].sort_values("year")
                yoy = recent.value.pct_change().dropna() * 100
                median, by_country = regional[(ind.series, as_of)]
                peers = pd.Series(by_country)
                n_peers = len(peers)
                better = (peers > last).sum() if s < 0 else (peers < last).sum()   # peers this country beats
                prev_year = int(hist.year.iloc[-2]) if len(hist) >= 2 else None

                # Label: did the country keep pace with the straight path to the target?
                label_year = as_of + LABEL_HORIZON
                future = sub[sub.year == label_year]
                label_value = float(future.value.iloc[0]) if len(future) else None
                if already_met:
                    path_value = target
                else:
                    path_value = last + (target - last) * LABEL_HORIZON / years_left
                on_track = None if label_value is None else int(meets(label_value, path_value, ind.direction))

                rows.append({
                    "series": ind.series, "iso3": iso3, "as_of_year": as_of,
                    "direction": ind.direction, "target_type": ind.target_type,
                    "years_to_2030": years_left,
                    "last_value": last, "target_value": target,
                    "gap_pct": gap_pct, "already_met": already_met,
                    "required_annual_pct": required_pct,
                    "slope_5y_pct": slope_short, "slope_10y_pct": slope_long, "r2_10y": r2_long,
                    "acceleration_pct": (slope_short - slope_prev) if slope_short is not None and slope_prev is not None else None,
                    "pace_ratio": (slope_long / required_pct) if slope_long is not None and required_pct and required_pct > 0 else None,
                    "projected_gap_pct": projected_gap_pct,
                    "volatility_pct": float(yoy.std()) if len(yoy) >= 2 else None,
                    "n_obs_10y": len(recent),
                    "years_since_prev_obs": as_of - prev_year if prev_year else None,
                    "regional_gap_pct": s * (last - median) / median * 100 if median else None,   # > 0: better than median
                    "regional_percentile": round(better / (n_peers - 1) * 100, 1) if n_peers > 1 else None,
                    "uncertainty_pct": ((cur.upper_bound - cur.lower_bound) / last * 100
                                        if pd.notna(cur.lower_bound) and pd.notna(cur.upper_bound) and last else None),
                    "is_modelled": cur.nature in MODELLED_NATURE,
                    "label_year": label_year, "label_path_value": path_value, "label_value": label_value,
                    "on_track": on_track,
                    "is_latest": as_of == latest_year,
                })
    return pd.DataFrame(rows)


def print_report(df):
    labelled = df[df.on_track.notna()]
    print(f"\n{len(labelled)} labelled rows (as_of {labelled.as_of_year.min()}–{labelled.as_of_year.max()}), "
          f"{int(df.is_latest.sum())} rows to score")
    print("\non_track by indicator (labelled rows):")
    print(labelled.groupby("series").on_track.agg(["count", "mean"]).rename(columns={"mean": "share_on_track"}).round(2).to_string())
    print("\nalready_met vs on_track:")
    print(pd.crosstab(labelled.already_met, labelled.on_track).to_string())


def main():
    indicators, obs = load("--csv" in sys.argv)
    df = build_rows(indicators, obs)
    for col in ["label_year", "years_since_prev_obs", "on_track"]:
        df[col] = df[col].astype("Int64")
    df.to_csv(OUTPUT_CSV, index=False)
    print(f"wrote {len(df)} rows to {OUTPUT_CSV}")
    print_report(df)


if __name__ == "__main__":
    main()
