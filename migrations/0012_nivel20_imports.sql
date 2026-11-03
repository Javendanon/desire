-- Nivel20 imports are read-only snapshots; the external service is never written.
CREATE TABLE campaign.nivel20_campaigns (
    campaign_id uuid PRIMARY KEY REFERENCES campaign.campaigns,
    external_id bigint NOT NULL CHECK (external_id > 0),
    source_path text NOT NULL
        CHECK (source_path LIKE '/games/dnd-5/campaigns/%'),
    external_updated_at text,
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    imported_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (external_id)
);
