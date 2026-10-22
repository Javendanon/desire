-- A journey snapshots its participants; later party changes cannot rewrite its history.
CREATE TABLE campaign.parties (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES campaign.campaigns,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    revision catalog.revision NOT NULL,
    UNIQUE (campaign_id, id)
);
CREATE TABLE campaign.party_members (
    campaign_id uuid NOT NULL,
    party_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    PRIMARY KEY (campaign_id, party_id, actor_id),
    FOREIGN KEY (campaign_id, party_id) REFERENCES campaign.parties (campaign_id, id),
    FOREIGN KEY (campaign_id, actor_id) REFERENCES campaign.actors (campaign_id, id)
);
CREATE INDEX party_members_actor ON campaign.party_members (campaign_id, actor_id);
ALTER TABLE campaign.travels ADD COLUMN party_id uuid,
    ALTER COLUMN character_id DROP NOT NULL,
    ADD FOREIGN KEY (campaign_id, party_id) REFERENCES campaign.parties (campaign_id, id);
CREATE TABLE campaign.travel_participants (
    campaign_id uuid NOT NULL,
    travel_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    PRIMARY KEY (campaign_id, travel_id, actor_id),
    FOREIGN KEY (campaign_id, travel_id) REFERENCES campaign.travels (campaign_id, id),
    FOREIGN KEY (campaign_id, actor_id) REFERENCES campaign.actors (campaign_id, id)
);
CREATE INDEX travel_participants_actor ON campaign.travel_participants (campaign_id, actor_id);
INSERT INTO campaign.travel_participants SELECT campaign_id, id, character_id FROM campaign.travels;
CREATE FUNCTION campaign.legacy_travel_participant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.character_id IS NOT NULL THEN
        INSERT INTO campaign.travel_participants VALUES (NEW.campaign_id, NEW.id, NEW.character_id)
            ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER legacy_travel_participant AFTER INSERT ON campaign.travels
    FOR EACH ROW EXECUTE FUNCTION campaign.legacy_travel_participant();
CREATE FUNCTION campaign.require_travel_participant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    journey uuid;
    scope uuid;
BEGIN
    IF TG_TABLE_NAME = 'travels' THEN
        journey := NEW.id;
        scope := NEW.campaign_id;
    ELSE
        journey := OLD.travel_id;
        scope := OLD.campaign_id;
    END IF;
    -- A real row version prevents snapshot write skew in REPEATABLE READ too.
    UPDATE campaign.travels SET revision = revision WHERE campaign_id = scope AND id = journey;
    IF FOUND AND NOT EXISTS (SELECT 1 FROM campaign.travel_participants
        WHERE campaign_id = scope AND travel_id = journey) THEN
        RAISE EXCEPTION 'travel requires a participant' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER travel_has_participant AFTER INSERT ON campaign.travels
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION campaign.require_travel_participant();
CREATE CONSTRAINT TRIGGER retain_travel_participant
    AFTER DELETE OR UPDATE ON campaign.travel_participants
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION campaign.require_travel_participant();
CREATE TABLE campaign.encounters (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES campaign.campaigns,
    place_id uuid REFERENCES catalog.places,
    scene_id uuid,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    status text NOT NULL CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
    round_number integer NOT NULL DEFAULT 0 CHECK (round_number >= 0),
    revision catalog.revision NOT NULL,
    CHECK (place_id IS NOT NULL OR scene_id IS NOT NULL),
    UNIQUE (campaign_id, id),
    FOREIGN KEY (campaign_id, scene_id) REFERENCES campaign.scenes (campaign_id, id)
);
CREATE TABLE campaign.encounter_participants (
    campaign_id uuid NOT NULL,
    encounter_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    initiative integer,
    PRIMARY KEY (campaign_id, encounter_id, actor_id),
    FOREIGN KEY (campaign_id, encounter_id) REFERENCES campaign.encounters (campaign_id, id),
    FOREIGN KEY (campaign_id, actor_id) REFERENCES campaign.actors (campaign_id, id)
);
CREATE INDEX encounter_participants_actor
    ON campaign.encounter_participants (campaign_id, actor_id);
