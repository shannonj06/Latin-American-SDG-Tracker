from statistics import median

from fastapi import FastAPI
from supabase_client import supabase

app = FastAPI()

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PAGE = 1000  # Supabase caps each request at 1000 rows.


def fetch_all(build_query):
    """Page through a query. build_query() must return a fresh, ordered query each call."""
    rows, start = [], 0
    while True:
        batch = build_query().range(start, start + PAGE - 1).execute().data
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        start += PAGE


@app.get("/")
def home():
    return {"message": "Welcome to the Latin American SDG Tracker"}

@app.get("/countries")
def countries():
    rows = fetch_all(lambda: supabase.table("observations").select('iso3', 'country').order('id'))
    unique_countries = {row["iso3"]: row["country"] for row in rows}

    countries = [{"iso3": iso3, "country": name} for iso3, name in unique_countries.items()]
    countries.sort(key=lambda c: c["country"])
    return {"countries": countries}

@app.get("/indicators")
def indicators():
    response = supabase.table("indicators").select('series', 'sdg_indicator', 'name', 'unit', 'target_2030', 'target_type', 'direction').execute()
    output = {}
    for row in response.data:
        output[row["series"]] = {
            'sdg_indicator': row["sdg_indicator"],
            'name': row["name"],
            'unit': row["unit"],
            'target_2030': row["target_2030"],
            'target_type': row["target_type"],
            'direction': row["direction"],
        }
    return output

@app.get('/countries/{iso3}/summary')
def summary(iso3):
    response = supabase.table("indicator_summary").select('*').eq('iso3', iso3.upper()).execute()
    return {"iso3": iso3.upper(), "summary": response.data}

@app.get('/indicators/{series}/series')
def series(series, iso3):
    response = (
        supabase.table("observations")
        .select('year', 'value', 'lower_bound', 'upper_bound', 'nature', 'reporting_type', 'unit_code', 'source')
        .eq('series', series)
        .eq('iso3', iso3.upper())
        .eq('is_headline', True)
        .order('year')
        .execute()
    )
    return {"series": series, "iso3": iso3.upper(), "data": response.data}

@app.get('/indicators/{series}/comparison')
def comparison(series):
    response = (
        supabase.table("indicator_summary")
        .select('iso3', 'rank', 'of_n', 'percentile', 'last_value', 'comparison_year', 'regional_median', 'gap_to_median', 'classification', 'status')
        .eq('series', series)
        .order('rank')
        .execute()
    )
    return {"series": series, "countries": response.data}


@app.get('/indicators/{series}/compare')
def compare(series):
    """Everything the comparison view needs for one indicator, all countries, in one call."""
    summary = (
        supabase.table("indicator_summary")
        .select('iso3', 'rank', 'of_n', 'percentile', 'comparison_year', 'regional_median', 'gap_to_median',
                'last_value', 'window_end', 'n_obs', 'classification', 'confidence', 'status', 'target_value',
                'computed_at')
        .eq('series', series)
        .execute()
        .data
    )
    for row in summary:
        # Value in the shared comparison year, so every country is compared on the same year.
        has_cmp = row["regional_median"] is not None and row["gap_to_median"] is not None
        row["comparison_value"] = row["regional_median"] + row["gap_to_median"] if has_cmp else None

    observations = fetch_all(lambda: (
        supabase.table("observations")
        .select('iso3', 'year', 'value', 'nature', 'reporting_type', 'source')
        .eq('series', series)
        .eq('is_headline', True)
        .order('iso3')
        .order('year')
    ))

    by_year = {}
    for obs in observations:
        if obs["value"] is not None:
            by_year.setdefault(obs["year"], []).append(obs["value"])
    medians = [{"year": y, "median": median(v), "n_countries": len(v)} for y, v in sorted(by_year.items())]

    return {"series": series, "summary": summary, "observations": observations, "regional_median": medians}
