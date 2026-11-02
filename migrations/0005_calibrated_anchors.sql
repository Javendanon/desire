-- Anchors require a calibrated map, including when calibration is later cleared.
-- Validate existing rows atomically: invalid legacy anchors require editorial repair.
ALTER TABLE catalog.map_versions
    ADD COLUMN calibrated boolean GENERATED ALWAYS AS (calibration IS NOT NULL) STORED,
    ADD CONSTRAINT map_versions_calibrated_identity UNIQUE (city_id, id, calibrated);

ALTER TABLE catalog.place_anchors
    ADD COLUMN calibrated boolean NOT NULL DEFAULT true CHECK (calibrated),
    ADD CONSTRAINT anchors_calibrated_map
        FOREIGN KEY (city_id, map_version_id, calibrated)
        REFERENCES catalog.map_versions (city_id, id, calibrated);
