-- Public outbox stores only normalized public event references, never note/secret bodies.
CREATE TABLE campaign.streams (
    campaign_id uuid PRIMARY KEY REFERENCES campaign.campaigns,
    revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 4294967295)
);
CREATE TABLE campaign.outbox (
    event_id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES campaign.campaigns,
    stream_revision catalog.revision NOT NULL,
    kind text NOT NULL CHECK (kind IN ('scene_changed', 'travel_updated')),
    scene_id uuid,
    travel_id uuid,
    published_at timestamptz,
    UNIQUE (campaign_id, stream_revision),
    UNIQUE (campaign_id, event_id),
    CHECK ((kind = 'scene_changed' AND scene_id IS NOT NULL AND travel_id IS NULL)
        OR (kind = 'travel_updated' AND travel_id IS NOT NULL AND scene_id IS NULL)),
    FOREIGN KEY (campaign_id, scene_id) REFERENCES campaign.scenes (campaign_id, id),
    FOREIGN KEY (campaign_id, travel_id) REFERENCES campaign.travels (campaign_id, id)
);
CREATE INDEX outbox_pending ON campaign.outbox (campaign_id, stream_revision)
    WHERE published_at IS NULL;
CREATE INDEX outbox_scene ON campaign.outbox (campaign_id, scene_id);
CREATE INDEX outbox_travel ON campaign.outbox (campaign_id, travel_id);
CREATE TABLE campaign.idempotency_keys (
    campaign_id uuid NOT NULL REFERENCES campaign.campaigns,
    key uuid NOT NULL,
    event_id uuid NOT NULL,
    request jsonb NOT NULL,
    PRIMARY KEY (campaign_id, key),
    FOREIGN KEY (campaign_id, event_id) REFERENCES campaign.outbox (campaign_id, event_id)
);
CREATE INDEX idempotency_event ON campaign.idempotency_keys (campaign_id, event_id);
