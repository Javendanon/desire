-- User IDs are an identity bridge; authentication belongs to D10.
CREATE SCHEMA campaign;
CREATE TABLE campaign.campaigns (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL,
    city_id uuid REFERENCES catalog.cities,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    rules_edition catalog.edition NOT NULL,
    revision catalog.revision NOT NULL,
    owner_role text NOT NULL DEFAULT 'dm' CHECK (owner_role = 'dm'),
    UNIQUE (id, rules_edition)
);
CREATE INDEX campaigns_city ON campaign.campaigns (city_id);
CREATE INDEX campaigns_owner ON campaign.campaigns (owner_id);
CREATE TABLE campaign.memberships (
    campaign_id uuid NOT NULL REFERENCES campaign.campaigns,
    user_id uuid NOT NULL,
    role text NOT NULL CHECK (role IN ('dm', 'player')),
    PRIMARY KEY (campaign_id, user_id),
    UNIQUE (campaign_id, user_id, role)
);
CREATE INDEX memberships_user ON campaign.memberships (user_id, campaign_id);
-- Deferred circular FK allows atomic creation, but never an owner without DM membership.
ALTER TABLE campaign.campaigns ADD CONSTRAINT campaign_owner_membership
    FOREIGN KEY (id, owner_id, owner_role)
    REFERENCES campaign.memberships (campaign_id, user_id, role)
    DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE campaign.scenes (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES campaign.campaigns,
    map_version_id uuid NOT NULL REFERENCES catalog.map_versions,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    revision catalog.revision NOT NULL,
    UNIQUE (campaign_id, id)
);
CREATE INDEX scenes_map ON campaign.scenes (map_version_id);
CREATE TABLE campaign.characters (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL,
    controller_id uuid,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    rules_edition catalog.edition NOT NULL,
    revision catalog.revision NOT NULL,
    UNIQUE (campaign_id, id),
    UNIQUE (campaign_id, id, rules_edition),
    FOREIGN KEY (campaign_id, rules_edition) REFERENCES campaign.campaigns (id, rules_edition),
    FOREIGN KEY (campaign_id, controller_id)
        REFERENCES campaign.memberships (campaign_id, user_id)
);
CREATE INDEX characters_controller ON campaign.characters (campaign_id, controller_id);
CREATE TABLE campaign.place_overrides (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES campaign.campaigns,
    place_id uuid NOT NULL REFERENCES catalog.places,
    revision catalog.revision NOT NULL,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    UNIQUE (campaign_id, id),
    UNIQUE (campaign_id, place_id)
);
CREATE INDEX overrides_place ON campaign.place_overrides (place_id);
CREATE TABLE campaign.conditions (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL,
    character_id uuid NOT NULL,
    knowledge_entry_id uuid NOT NULL,
    rules_edition catalog.edition NOT NULL,
    remaining_rounds catalog.revision,
    revision catalog.revision NOT NULL,
    UNIQUE (campaign_id, id),
    FOREIGN KEY (campaign_id, character_id, rules_edition)
        REFERENCES campaign.characters (campaign_id, id, rules_edition),
    FOREIGN KEY (knowledge_entry_id, rules_edition)
        REFERENCES catalog.knowledge_entries (id, rules_edition)
);
CREATE INDEX conditions_character ON campaign.conditions (campaign_id, character_id);
CREATE INDEX conditions_knowledge ON campaign.conditions (knowledge_entry_id, rules_edition);
CREATE TABLE campaign.travels (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES campaign.campaigns,
    scene_id uuid NOT NULL,
    character_id uuid NOT NULL,
    x_m catalog.finite_number NOT NULL,
    y_m catalog.finite_number NOT NULL,
    z_m catalog.finite_number NOT NULL,
    destination_x_m catalog.finite_number NOT NULL,
    destination_y_m catalog.finite_number NOT NULL,
    destination_z_m catalog.finite_number NOT NULL,
    distance_m catalog.finite_number NOT NULL CHECK (distance_m >= 0),
    narrative_seconds catalog.finite_number NOT NULL CHECK (narrative_seconds >= 0),
    visual_seconds catalog.finite_number NOT NULL CHECK (visual_seconds >= 0),
    status text NOT NULL CHECK (status IN ('planned', 'moving', 'completed', 'cancelled')),
    revision catalog.revision NOT NULL,
    UNIQUE (campaign_id, id),
    FOREIGN KEY (campaign_id, scene_id) REFERENCES campaign.scenes (campaign_id, id),
    FOREIGN KEY (campaign_id, character_id) REFERENCES campaign.characters (campaign_id, id)
);
CREATE INDEX travels_scene ON campaign.travels (campaign_id, scene_id);
CREATE INDEX travels_character ON campaign.travels (campaign_id, character_id);
