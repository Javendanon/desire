CREATE DOMAIN campaign.visibility AS text CHECK (VALUE IN ('players', 'dm'));
CREATE TABLE campaign.sessions (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES campaign.campaigns,
    title text NOT NULL CHECK (length(btrim(title)) > 0),
    revision catalog.revision NOT NULL,
    UNIQUE (campaign_id, id)
);
CREATE TABLE campaign.journal_entries (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES campaign.campaigns,
    session_id uuid NOT NULL,
    body text NOT NULL,
    visibility campaign.visibility NOT NULL,
    revision catalog.revision NOT NULL,
    UNIQUE (campaign_id, id),
    FOREIGN KEY (campaign_id, session_id) REFERENCES campaign.sessions (campaign_id, id)
);
CREATE INDEX journal_session ON campaign.journal_entries (campaign_id, session_id);
CREATE INDEX journal_players ON campaign.journal_entries (campaign_id, id)
    WHERE visibility = 'players';
CREATE TABLE campaign.knowledge (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES campaign.campaigns,
    title text NOT NULL CHECK (length(btrim(title)) > 0),
    body text NOT NULL,
    visibility campaign.visibility NOT NULL,
    revision catalog.revision NOT NULL,
    provenance catalog.provenance NOT NULL,
    UNIQUE (campaign_id, id)
);
CREATE INDEX knowledge_players ON campaign.knowledge (campaign_id, id)
    WHERE visibility = 'players';
CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
-- Exactly one normalized subject, with composite FKs for campaign-owned subjects.
CREATE TABLE private.dm_secrets (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES campaign.campaigns,
    place_id uuid REFERENCES catalog.places,
    scene_id uuid,
    character_id uuid,
    session_id uuid,
    journal_entry_id uuid,
    campaign_knowledge_id uuid,
    travel_id uuid,
    place_override_id uuid,
    condition_id uuid,
    body text NOT NULL,
    revision catalog.revision NOT NULL,
    subject_id uuid GENERATED ALWAYS AS (coalesce(place_id, scene_id, character_id,
        session_id, journal_entry_id, campaign_knowledge_id, travel_id,
        place_override_id, condition_id)) STORED,
    subject_kind text GENERATED ALWAYS AS (CASE
        WHEN place_id IS NOT NULL THEN 'place'
        WHEN scene_id IS NOT NULL THEN 'scene'
        WHEN character_id IS NOT NULL THEN 'character'
        WHEN session_id IS NOT NULL THEN 'session'
        WHEN journal_entry_id IS NOT NULL THEN 'journal_entry'
        WHEN campaign_knowledge_id IS NOT NULL THEN 'campaign_knowledge'
        WHEN travel_id IS NOT NULL THEN 'travel'
        WHEN place_override_id IS NOT NULL THEN 'place_override'
        WHEN condition_id IS NOT NULL THEN 'condition' END) STORED,
    CHECK (num_nonnulls(place_id, scene_id, character_id, session_id, journal_entry_id,
        campaign_knowledge_id, travel_id, place_override_id, condition_id) = 1),
    UNIQUE (campaign_id, id),
    FOREIGN KEY (campaign_id, scene_id) REFERENCES campaign.scenes (campaign_id, id),
    FOREIGN KEY (campaign_id, character_id) REFERENCES campaign.characters (campaign_id, id),
    FOREIGN KEY (campaign_id, session_id) REFERENCES campaign.sessions (campaign_id, id),
    FOREIGN KEY (campaign_id, journal_entry_id)
        REFERENCES campaign.journal_entries (campaign_id, id),
    FOREIGN KEY (campaign_id, campaign_knowledge_id)
        REFERENCES campaign.knowledge (campaign_id, id),
    FOREIGN KEY (campaign_id, travel_id) REFERENCES campaign.travels (campaign_id, id),
    FOREIGN KEY (campaign_id, place_override_id)
        REFERENCES campaign.place_overrides (campaign_id, id),
    FOREIGN KEY (campaign_id, condition_id) REFERENCES campaign.conditions (campaign_id, id)
);
CREATE INDEX secrets_subject ON private.dm_secrets (campaign_id, subject_kind, subject_id);
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC;
