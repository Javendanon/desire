-- Campaign actors are persistent instances; catalog templates are immutable editorial data.
CREATE FUNCTION catalog.valid_abilities(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE WHEN jsonb_typeof(value) = 'object' THEN
        value ?& ARRAY['strength', 'dexterity', 'constitution',
                       'intelligence', 'wisdom', 'charisma']
        AND (SELECT count(*) = 6 AND bool_and(CASE
            WHEN score::text ~ '^[0-9]+$' THEN score::text::numeric BETWEEN 1 AND 30
            ELSE false END) FROM jsonb_each(value) AS scores(key, score))
        ELSE false END;
$$;
CREATE TABLE catalog.creature_templates (
    id uuid PRIMARY KEY,
    rules_edition catalog.edition NOT NULL,
    revision catalog.revision NOT NULL,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    creature_type text NOT NULL,
    size text NOT NULL,
    abilities jsonb NOT NULL CHECK (catalog.valid_abilities(abilities)),
    armor_class integer NOT NULL CHECK (armor_class >= 0),
    max_hp integer NOT NULL CHECK (max_hp >= 0),
    speed_m catalog.finite_number NOT NULL CHECK (speed_m >= 0),
    description text NOT NULL,
    provenance catalog.provenance NOT NULL,
    UNIQUE (id, rules_edition)
);
CREATE TABLE catalog.creature_actions (
    id uuid PRIMARY KEY,
    template_id uuid NOT NULL REFERENCES catalog.creature_templates,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    kind text NOT NULL CHECK (kind IN ('action', 'bonus_action', 'reaction', 'passive')),
    description text NOT NULL
);
CREATE INDEX creature_actions_template ON catalog.creature_actions (template_id);
CREATE TABLE campaign.actors (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL,
    rules_edition catalog.edition NOT NULL,
    character_id uuid,
    template_id uuid,
    kind text NOT NULL CHECK (kind IN ('character', 'npc', 'monster')),
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    visibility campaign.visibility NOT NULL DEFAULT 'dm',
    disposition text NOT NULL DEFAULT 'neutral'
        CHECK (disposition IN ('friendly', 'neutral', 'hostile')),
    revision catalog.revision NOT NULL,
    CHECK (character_id IS NULL OR character_id = id),
    UNIQUE (campaign_id, id),
    UNIQUE (campaign_id, id, rules_edition),
    FOREIGN KEY (campaign_id, rules_edition) REFERENCES campaign.campaigns (id, rules_edition),
    FOREIGN KEY (campaign_id, character_id, rules_edition)
        REFERENCES campaign.characters (campaign_id, id, rules_edition),
    FOREIGN KEY (template_id, rules_edition)
        REFERENCES catalog.creature_templates (id, rules_edition)
);
CREATE INDEX actors_template ON campaign.actors (template_id, rules_edition);
CREATE TABLE campaign.actor_stats (
    campaign_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    abilities jsonb NOT NULL CHECK (catalog.valid_abilities(abilities)),
    armor_class integer NOT NULL CHECK (armor_class >= 0),
    speed_m catalog.finite_number NOT NULL CHECK (speed_m >= 0),
    revision catalog.revision NOT NULL,
    PRIMARY KEY (campaign_id, actor_id),
    FOREIGN KEY (campaign_id, actor_id) REFERENCES campaign.actors (campaign_id, id)
);
CREATE TABLE campaign.actor_state (
    campaign_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    max_hp integer NOT NULL CHECK (max_hp >= 0),
    current_hp integer NOT NULL CHECK (current_hp BETWEEN 0 AND max_hp),
    temporary_hp integer NOT NULL DEFAULT 0 CHECK (temporary_hp >= 0),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dead', 'removed')),
    revision catalog.revision NOT NULL,
    PRIMARY KEY (campaign_id, actor_id),
    FOREIGN KEY (campaign_id, actor_id) REFERENCES campaign.actors (campaign_id, id)
);
-- Preserve existing identities without inventing ability scores or hit points.
INSERT INTO campaign.actors
    (id, campaign_id, rules_edition, character_id, kind, name, visibility, revision)
SELECT id, campaign_id, rules_edition, id,
    CASE WHEN controller_id IS NULL THEN 'npc' ELSE 'character' END,
    name, CASE WHEN controller_id IS NULL THEN 'dm' ELSE 'players' END, revision
    FROM campaign.characters;
CREATE FUNCTION campaign.register_character_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO campaign.actors
        (id, campaign_id, rules_edition, character_id, kind, name, visibility, revision)
    VALUES (NEW.id, NEW.campaign_id, NEW.rules_edition, NEW.id,
        CASE WHEN NEW.controller_id IS NULL THEN 'npc' ELSE 'character' END,
        NEW.name, CASE WHEN NEW.controller_id IS NULL THEN 'dm' ELSE 'players' END, NEW.revision);
    RETURN NEW;
END;
$$;
CREATE TRIGGER character_actor AFTER INSERT ON campaign.characters
    FOR EACH ROW EXECUTE FUNCTION campaign.register_character_actor();
-- Legacy conditions remain readable; actor_id extends them to monsters and NPCs.
ALTER TABLE campaign.conditions ADD COLUMN actor_id uuid;
UPDATE campaign.conditions SET actor_id = character_id;
ALTER TABLE campaign.conditions ALTER COLUMN actor_id SET NOT NULL,
    ALTER COLUMN character_id DROP NOT NULL,
    ADD FOREIGN KEY (campaign_id, actor_id, rules_edition)
        REFERENCES campaign.actors (campaign_id, id, rules_edition);
CREATE FUNCTION campaign.condition_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.actor_id := coalesce(NEW.actor_id, NEW.character_id);
    IF NEW.character_id IS NOT NULL AND NEW.character_id <> NEW.actor_id THEN
        RAISE EXCEPTION 'condition character and actor differ' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER condition_actor BEFORE INSERT OR UPDATE ON campaign.conditions
    FOR EACH ROW EXECUTE FUNCTION campaign.condition_actor();
CREATE INDEX conditions_actor ON campaign.conditions (campaign_id, actor_id);
