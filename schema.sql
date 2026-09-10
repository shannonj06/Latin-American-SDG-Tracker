-- SDG 3 health indicators for Latin America. Matches indicators.csv / observations.csv
-- produced by fetch_sdg3.py. Public data: no row-level security.

CREATE TABLE indicators (
    series        text PRIMARY KEY,           -- UN SDG series code, e.g. SH_STA_MORT
    sdg_indicator text NOT NULL,              -- e.g. 3.1.1
    name          text NOT NULL,
    unit          text NOT NULL,
    target_2030   numeric,                    -- null unless target_type = 'absolute'
    target_type   text NOT NULL
        CHECK (target_type IN ('absolute', 'relative_to_baseline', 'directional', 'none')),
    direction     text NOT NULL
        CHECK (direction IN ('lower_is_better', 'higher_is_better'))
);

CREATE TABLE observations (
    id             bigserial PRIMARY KEY,
    series         text NOT NULL REFERENCES indicators (series),
    iso3           char(3) NOT NULL,
    country        text NOT NULL,
    year           integer NOT NULL,
    value          numeric,
    lower_bound    numeric,
    upper_bound    numeric,
    sex            text NOT NULL DEFAULT '_T',
    age            text NOT NULL DEFAULT '_T',
    reporting_type text NOT NULL DEFAULT '',
    nature         text NOT NULL DEFAULT '',
    unit_code      text NOT NULL DEFAULT '',
    source         text NOT NULL DEFAULT '',
    is_headline    boolean NOT NULL DEFAULT false,
    -- Re-running the fetch upserts on this key instead of duplicating rows.
    UNIQUE (series, iso3, year, sex, age, reporting_type)
);

COMMENT ON COLUMN observations.nature IS
    'UN "Nature" attribute: C = country-reported, M/E = agency-modelled or estimated.';
COMMENT ON COLUMN observations.is_headline IS
    'True for exactly one row per (series, iso3, year): the both-sexes / global-reporting row charts should use.';

-- Every chart query hits this: one series, one country, ordered by year, headline rows only.
CREATE INDEX observations_headline_idx
    ON observations (series, iso3, year)
    WHERE is_headline;
