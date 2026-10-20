-- Shared editorial content is not owned by any campaign.
CREATE SCHEMA catalog;
CREATE DOMAIN catalog.revision AS bigint CHECK (VALUE BETWEEN 1 AND 4294967295);
CREATE DOMAIN catalog.edition AS text CHECK (VALUE IN ('dnd_2014', 'dnd_2024'));
CREATE DOMAIN catalog.finite_number AS double precision
    CHECK (VALUE > '-Infinity'::float8 AND VALUE < 'Infinity'::float8);
CREATE DOMAIN catalog.provenance AS jsonb CHECK (
    jsonb_typeof(VALUE) = 'object'
    AND VALUE ?& ARRAY['source', 'attribution', 'evidence']
    AND jsonb_typeof(VALUE->'source') = 'string'
    AND jsonb_typeof(VALUE->'attribution') = 'string'
    AND jsonb_typeof(VALUE->'evidence') = 'string'
    AND VALUE->>'evidence' IN ('verified', 'interpretation', 'synthetic')
);
CREATE TABLE catalog.worlds (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    provenance catalog.provenance NOT NULL
);
CREATE TABLE catalog.eras (
    id uuid PRIMARY KEY,
    world_id uuid NOT NULL REFERENCES catalog.worlds,
    name text NOT NULL CHECK (length(btrim(name)) > 0)
);
CREATE INDEX eras_world ON catalog.eras (world_id);
CREATE TABLE catalog.cities (
    id uuid PRIMARY KEY,
    era_id uuid NOT NULL REFERENCES catalog.eras,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    provenance catalog.provenance NOT NULL
);
CREATE INDEX cities_era ON catalog.cities (era_id);
CREATE TABLE catalog.districts (
    id uuid PRIMARY KEY,
    city_id uuid NOT NULL REFERENCES catalog.cities,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    UNIQUE (city_id, id)
);
CREATE TABLE catalog.places (
    id uuid PRIMARY KEY,
    city_id uuid NOT NULL REFERENCES catalog.cities,
    district_id uuid,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    provenance catalog.provenance NOT NULL,
    UNIQUE (city_id, id),
    FOREIGN KEY (city_id, district_id) REFERENCES catalog.districts (city_id, id)
);
CREATE INDEX places_district ON catalog.places (city_id, district_id);
CREATE TABLE catalog.maps (id uuid PRIMARY KEY);
CREATE FUNCTION catalog.valid_calibration(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT jsonb_typeof(value) = 'object'
        AND value ?& ARRAY['origin_px_x', 'origin_px_y', 'meters_per_pixel',
                          'rotation_radians', 'provenance']
        AND jsonb_typeof(value->'origin_px_x') = 'number'
        AND jsonb_typeof(value->'origin_px_y') = 'number'
        AND jsonb_typeof(value->'meters_per_pixel') = 'number'
        AND jsonb_typeof(value->'rotation_radians') = 'number'
        AND (value->>'origin_px_x')::catalog.finite_number IS NOT NULL
        AND (value->>'origin_px_y')::catalog.finite_number IS NOT NULL
        AND (value->>'rotation_radians')::catalog.finite_number IS NOT NULL
        AND (value->>'meters_per_pixel')::catalog.finite_number > 0
        AND (value->'provenance')::catalog.provenance IS NOT NULL;
$$;
CREATE TABLE catalog.map_versions (
    id uuid PRIMARY KEY,
    map_id uuid NOT NULL REFERENCES catalog.maps,
    city_id uuid REFERENCES catalog.cities,
    revision catalog.revision NOT NULL,
    calibration jsonb CHECK (calibration IS NULL OR catalog.valid_calibration(calibration)),
    provenance catalog.provenance NOT NULL,
    UNIQUE (map_id, revision),
    UNIQUE (city_id, id)
);
CREATE TABLE catalog.place_anchors (
    place_id uuid NOT NULL,
    map_version_id uuid NOT NULL,
    city_id uuid NOT NULL,
    x_m catalog.finite_number NOT NULL,
    y_m catalog.finite_number NOT NULL,
    z_m catalog.finite_number NOT NULL,
    provenance catalog.provenance NOT NULL,
    PRIMARY KEY (place_id, map_version_id),
    FOREIGN KEY (city_id, place_id) REFERENCES catalog.places (city_id, id),
    FOREIGN KEY (city_id, map_version_id) REFERENCES catalog.map_versions (city_id, id)
);
CREATE INDEX anchors_map ON catalog.place_anchors (city_id, map_version_id);
CREATE TABLE catalog.chunks (
    id uuid PRIMARY KEY,
    map_version_id uuid NOT NULL REFERENCES catalog.map_versions,
    x_m catalog.finite_number NOT NULL,
    y_m catalog.finite_number NOT NULL,
    z_m catalog.finite_number NOT NULL,
    size_m catalog.finite_number NOT NULL CHECK (size_m > 0),
    asset_uri text NOT NULL CHECK (length(btrim(asset_uri)) > 0)
);
CREATE INDEX chunks_map ON catalog.chunks (map_version_id);
CREATE TABLE catalog.knowledge_entries (
    id uuid PRIMARY KEY,
    revision catalog.revision NOT NULL,
    rules_edition catalog.edition NOT NULL,
    language text NOT NULL CHECK (length(btrim(language)) > 0),
    title text NOT NULL CHECK (length(btrim(title)) > 0),
    body text NOT NULL,
    provenance catalog.provenance NOT NULL,
    UNIQUE (id, rules_edition)
);
