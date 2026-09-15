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

@app.get("/")
def home():
    return {"message": "Welcome to the Latin American SDG Tracker"}

@app.get("/countries")
def countries():
    response = supabase.table("observations").select('iso3', 'country').execute()
    unique_countries = {row["iso3"]: row["country"] for row in response.data}

    countries = [{"iso3": iso3, "country": name} for iso3, name in unique_countries.items()]
    countries.sort(key=lambda c: c["country"])
    return {"countries": countries}

@app.get("/indicators")
def indicators():
    response = supabase.table("indicators").select('series', 'sdg_indicator', 'name', 'unit', 'target_2030').execute()
    output = {}
    for row in response.data:
        output[row["series"]] = {
            'sdg_indicator': row["sdg_indicator"],
            'name': row["name"],
            'unit': row["unit"],
            'target_2030': row["target_2030"],
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
        .select('year', 'value', 'lower_bound', 'upper_bound', 'source')
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
