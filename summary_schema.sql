-- One row per (indicator, country), produced by analyze.py and loaded from indicator_summary.csv.
-- Disposable: dropped and rebuilt on every run. No RLS, no triggers.

DROP TABLE IF EXISTS indicator_summary;

CREATE TABLE indicator_summary (
    series                 text NOT NULL REFERENCES indicators (series),
    iso3                   char(3) NOT NULL,

    -- trend: OLS of value on year, from 2015 to the latest headline observation
    window_start           integer,
    window_end             integer,
    first_value            numeric,
    last_value             numeric,
    abs_change             numeric,
    pct_change             numeric,
    annual_change          numeric,        -- slope, in the indicator's own units per year
    relative_annual_change numeric,        -- slope / mean(value), as % per year; comparable across indicators
    n_obs                  integer NOT NULL,
    r_squared              numeric,

    classification         text NOT NULL
        CHECK (classification IN ('improving', 'stagnating', 'declining', 'insufficient_data')),
    confidence             text NOT NULL
        CHECK (confidence IN ('high', 'medium', 'low')),

    -- cross-country comparison, all countries measured on the same year
    comparison_year        integer,
    rank                   integer,        -- 1 = best in region, per the indicator's direction
    of_n                   integer,        -- countries with a value in comparison_year
    percentile             numeric,        -- 100 = best, 0 = worst
    regional_median        numeric,
    gap_to_median          numeric,        -- value - regional_median

    -- 2030 target; NULL when the UN defined no numeric target
    target_value           numeric,
    target_source          text,
    projected_2030         numeric,
    required_annual_change numeric,
    gap_to_target          numeric,        -- last_value - target_value
    year_target_met        integer,
    status                 text NOT NULL
        CHECK (status IN ('no_numeric_target', 'insufficient_data', 'target_achieved', 'on_track', 'off_track')),

    rationale              text NOT NULL,
    computed_at            timestamptz NOT NULL,

    PRIMARY KEY (series, iso3)
);

COMMENT ON COLUMN indicator_summary.classification IS
    'Trend verdict since 2015. insufficient_data = fewer than 5 points; stagnating = |relative_annual_change| under the '
    'stagnation threshold; improving/declining = slope direction judged against indicators.direction.';
COMMENT ON COLUMN indicator_summary.comparison_year IS
    'Latest year in which at least 80% of countries have a headline value for this series. rank, of_n, percentile, '
    'regional_median and gap_to_median are all measured on this year so countries are compared like for like.';
COMMENT ON COLUMN indicator_summary.target_source IS
    'absolute = target_value copied from indicators.target_2030. computed_from_<year> = relative target derived as '
    'two-thirds of that country''s value in <year> (2015 unless missing). NULL = the UN defined no numeric target.';
COMMENT ON COLUMN indicator_summary.rationale IS
    'Plain-English sentence generated from the numbers in this row. Safe for an assistant to quote verbatim: the '
    'arithmetic is done here, not by the model.';
