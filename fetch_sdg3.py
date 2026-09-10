"""Pull SDG 3 (health) indicators for Latin America from the UN SDG API.

Writes indicators.csv and observations.csv into the current directory.
Usage: python fetch_sdg3.py
"""
import csv
import sys
import time
from collections import Counter

import requests

BASE_URL = "https://unstats.un.org/SDGAPI/v1/sdg"
PAGE_SIZE = 1000
SLEEP_SECONDS = 0.5
TIMEOUT_SECONDS = 60

# (series, sdg_indicator, name, unit, target_2030, target_type, direction)
INDICATORS = [
    ("SH_STA_MORT", "3.1.1", "Maternal mortality ratio", "per 100,000 live births", 70, "absolute", "lower_is_better"),
    ("SH_STA_BRTC", "3.1.2", "Skilled birth attendance", "% of births", None, "none", "higher_is_better"),
    ("SH_DYN_MORT", "3.2.1", "Under-five mortality rate", "per 1,000 live births", 25, "absolute", "lower_is_better"),
    ("SH_DYN_NMRT", "3.2.2", "Neonatal mortality rate", "per 1,000 live births", 12, "absolute", "lower_is_better"),
    ("SH_TBS_INCD", "3.3.2", "Tuberculosis incidence", "per 100,000 population", None, "directional", "lower_is_better"),
    ("SH_DTH_NCOM", "3.4.1", "NCD mortality (30-70)", "probability, %", None, "relative_to_baseline", "lower_is_better"),
    ("SP_DYN_ADKL", "3.7.2", "Adolescent birth rate", "per 1,000 women", None, "none", "lower_is_better"),
]

# (m49_code, iso3, name) -- M49 is what the API wants, ISO3 is the join key.
COUNTRIES = [
    ("32", "ARG", "Argentina"),
    ("68", "BOL", "Bolivia"),
    ("76", "BRA", "Brazil"),
    ("152", "CHL", "Chile"),
    ("170", "COL", "Colombia"),
    ("188", "CRI", "Costa Rica"),
    ("192", "CUB", "Cuba"),
    ("214", "DOM", "Dominican Republic"),
    ("218", "ECU", "Ecuador"),
    ("222", "SLV", "El Salvador"),
    ("320", "GTM", "Guatemala"),
    ("340", "HND", "Honduras"),
    ("484", "MEX", "Mexico"),
    ("558", "NIC", "Nicaragua"),
    ("591", "PAN", "Panama"),
    ("600", "PRY", "Paraguay"),
    ("604", "PER", "Peru"),
    ("858", "URY", "Uruguay"),
    ("862", "VEN", "Venezuela"),
]

INDICATOR_COLUMNS = ["series", "sdg_indicator", "name", "unit", "target_2030", "target_type", "direction"]
OBSERVATION_COLUMNS = [
    "series", "iso3", "country", "year", "value", "lower_bound", "upper_bound",
    "sex", "age", "reporting_type", "nature", "unit_code", "source", "is_headline",
]
DEDUP_KEY = ("series", "iso3", "year", "sex", "age", "reporting_type")
BOTH_SEXES = ("BOTHSEX", "_T", "ALLSEX")


def warn(msg):
    print(f"WARNING: {msg}", file=sys.stderr)


def to_float(raw):
    # Gotcha 3: value/upperBound/lowerBound arrive as strings and may be "" or null.
    if raw is None or str(raw).strip() == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def to_int(raw):
    # Gotcha 3: timePeriodStart is a float like 2000.0.
    f = to_float(raw)
    return int(f) if f is not None else None


def fetch_series_for_country(series, m49):
    """Return all raw API records for one series and one country, following pagination."""
    # Gotcha 1: only one areaCode per request -- extra areaCode params are silently dropped.
    # Gotcha 2: no time filters -- timePeriod / timePeriodStart / timePeriodEnd are unreliable,
    #           so we pull the whole series and keep everything.
    records = []
    page = 1
    while True:
        params = {"seriesCode": series, "areaCode": m49, "pageSize": PAGE_SIZE, "pageNumber": page}
        resp = requests.get(f"{BASE_URL}/Series/Data", params=params, timeout=TIMEOUT_SECONDS)
        resp.raise_for_status()
        body = resp.json()
        records.extend(body.get("data") or [])
        if page >= int(body.get("totalPages") or 0):
            break
        page += 1
        time.sleep(SLEEP_SECONDS)
    # Gotcha 1 guard: if the API ignored our areaCode we would silently get another
    # country's numbers for every country. Fail loudly instead.
    for rec in records:
        if str(rec.get("geoAreaCode")) != m49:
            raise ValueError(f"requested areaCode {m49} but got {rec.get('geoAreaCode')} for {series}")
    return records


def parse_record(rec, series, iso3, country):
    dims = rec.get("dimensions") or {}
    attrs = rec.get("attributes") or {}
    return {
        "series": series,
        "iso3": iso3,
        "country": country,
        "year": to_int(rec.get("timePeriodStart")),
        "value": to_float(rec.get("value")),
        "lower_bound": to_float(rec.get("lowerBound")),
        "upper_bound": to_float(rec.get("upperBound")),
        "sex": dims.get("Sex") or "_T",
        "age": dims.get("Age") or "_T",
        "reporting_type": dims.get("Reporting Type") or "",
        "nature": attrs.get("Nature") or "",
        "unit_code": attrs.get("Units") or "",
        "source": rec.get("source") or "",
        "is_headline": False,
    }


def headline_rank(row):
    """Lower is better. Prefer global-reporting rows, then both-sexes rows."""
    reporting_ok = 0 if row["reporting_type"] in ("G", "") else 1
    sex_ok = 0 if row["sex"] in BOTH_SEXES else 1
    return (reporting_ok, sex_ok)


def mark_headlines(rows):
    """Flag exactly one row per (series, iso3, year) as the chart row."""
    groups = {}
    for row in rows:
        groups.setdefault((row["series"], row["iso3"], row["year"]), []).append(row)
    for group in groups.values():
        # If there's no both-sexes row (e.g. maternal mortality is FEMALE only),
        # min() still picks one row, so every group gets a headline.
        min(group, key=headline_rank)["is_headline"] = True


def write_csv(path, columns, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def main():
    rows = []
    failures = []
    rows_per_country = Counter()

    for series, *_ in INDICATORS:
        series_count = 0
        for m49, iso3, country in COUNTRIES:
            try:
                records = fetch_series_for_country(series, m49)
            except Exception as exc:  # one bad country shouldn't kill the run
                failures.append((series, iso3, str(exc)))
                warn(f"{series} {iso3} failed: {exc}")
                continue
            parsed = [parse_record(r, series, iso3, country) for r in records]
            rows.extend(parsed)
            series_count += len(parsed)
            rows_per_country[iso3] += len(parsed)
            time.sleep(SLEEP_SECONDS)
        print(f"{series}: {series_count} rows")

    mark_headlines(rows)

    write_csv("indicators.csv", INDICATOR_COLUMNS, [dict(zip(INDICATOR_COLUMNS, ind)) for ind in INDICATORS])
    write_csv("observations.csv", OBSERVATION_COLUMNS, rows)
    print(f"wrote {len(INDICATORS)} indicators and {len(rows)} observations")

    # End-of-run checks: warn, don't crash.
    for _, iso3, country in COUNTRIES:
        if rows_per_country[iso3] == 0:
            warn(f"{country} ({iso3}) has zero rows")
    dupes = Counter(tuple(row[k] for k in DEDUP_KEY) for row in rows)
    for key, n in dupes.items():
        if n > 1:
            warn(f"duplicate key {key} appears {n} times")
    if failures:
        warn(f"{len(failures)} failed requests")
        for series, iso3, err in failures:
            print(f"  {series} {iso3}: {err}", file=sys.stderr)


if __name__ == "__main__":
    main()
