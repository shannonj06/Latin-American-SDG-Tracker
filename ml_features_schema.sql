-- Training / scoring table for the on-track model, produced by build_features.py and loaded from ml_features.csv.
-- One row per (indicator, country, as_of_year), numeric-target indicators only. Disposable: rebuilt on every run.
-- Every feature uses only observations up to as_of_year. "Oriented" values are signed so positive = toward the target.

DROP TABLE IF EXISTS ml_features;

CREATE TABLE ml_features (
    series               text    NOT NULL REFERENCES indicators (series),
    iso3                 char(3) NOT NULL,
    as_of_year           integer NOT NULL,

    -- context (categorical; one-hot these in the model)
    direction            text    NOT NULL CHECK (direction IN ('lower_is_better', 'higher_is_better')),
    target_type          text    NOT NULL CHECK (target_type IN ('absolute', 'relative_to_baseline')),

    -- where the country stands
    years_to_2030        integer NOT NULL,
    last_value           numeric NOT NULL,
    target_value         numeric NOT NULL,
    gap_pct              numeric NOT NULL,   -- oriented distance to target, % of target; <= 0 = already met
    already_met          boolean NOT NULL,
    required_annual_pct  numeric,            -- oriented change per year needed to hit the target by 2030, % of last_value

    -- how it has been moving
    slope_5y_pct         numeric,            -- oriented OLS slope over the last 5 years, % of window mean per year
    slope_10y_pct        numeric,            -- same over the last 10 years
    r2_10y               numeric,            -- fit quality of the 10-year slope
    acceleration_pct     numeric,            -- slope_5y_pct minus the slope of the 5 years before that
    pace_ratio           numeric,            -- slope_10y_pct / required_annual_pct; NULL when nothing is required
    projected_gap_pct    numeric,            -- oriented gap left in 2030 if the 10-year pace continues
    volatility_pct       numeric,            -- std of year-over-year % changes, last 10 years

    -- data coverage
    n_obs_10y            integer NOT NULL,
    years_since_prev_obs integer,

    -- regional position in as_of_year
    regional_gap_pct     numeric,            -- oriented distance from the regional median, %; > 0 = better
    regional_percentile  numeric,            -- 100 = best in region

    -- data quality
    uncertainty_pct      numeric,            -- (upper_bound - lower_bound) / value; NULL if no bounds
    is_modelled          boolean NOT NULL,   -- value is agency-modelled/estimated (UN Nature M or E)

    -- label
    label_year           integer NOT NULL,   -- as_of_year + 5
    label_path_value     numeric NOT NULL,   -- where the straight path to the target says it should be by label_year
    label_value          numeric,            -- what was actually observed in label_year; NULL if not yet known
    on_track             smallint CHECK (on_track IN (0, 1)),   -- 1 = label_value met label_path_value; NULL = to be predicted

    is_latest            boolean NOT NULL,   -- the country's most recent snapshot: the rows the model scores

    PRIMARY KEY (series, iso3, as_of_year)
);

COMMENT ON COLUMN ml_features.on_track IS
    'Training label. Looks 5 years past as_of_year: 1 if the observed value was at or better than the straight line '
    'from as_of_year''s value to the 2030 target (or still met the target, if already met). NULL when that year has no data yet.';

-- Train on labelled rows, score the latest ones.
CREATE INDEX ml_features_latest_idx ON ml_features (series, iso3) WHERE is_latest;
