-- Character extensions: base scores, mutable resources and descriptions remain distinct.
CREATE TABLE campaign.character_sheets (
    campaign_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    ancestry text NOT NULL,
    background text NOT NULL,
    experience integer NOT NULL CHECK (experience >= 0),
    biography text NOT NULL,
    revision catalog.revision NOT NULL,
    PRIMARY KEY (campaign_id, actor_id),
    FOREIGN KEY (campaign_id, actor_id) REFERENCES campaign.actors (campaign_id, id)
);
CREATE TABLE campaign.character_classes (
    campaign_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    class_entry_id uuid NOT NULL,
    rules_edition catalog.edition NOT NULL,
    level integer NOT NULL CHECK (level BETWEEN 1 AND 20),
    PRIMARY KEY (campaign_id, actor_id, class_entry_id),
    FOREIGN KEY (campaign_id, actor_id)
        REFERENCES campaign.character_sheets (campaign_id, actor_id),
    FOREIGN KEY (campaign_id, actor_id, rules_edition)
        REFERENCES campaign.actors (campaign_id, id, rules_edition),
    FOREIGN KEY (class_entry_id, rules_edition)
        REFERENCES catalog.knowledge_entries (id, rules_edition)
);
CREATE TABLE campaign.character_proficiencies (
    campaign_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    category text NOT NULL CHECK (category IN ('skill', 'saving_throw', 'tool', 'weapon', 'armor')),
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    training text NOT NULL CHECK (training IN ('untrained', 'half', 'proficient', 'expertise')),
    PRIMARY KEY (campaign_id, actor_id, category, name),
    FOREIGN KEY (campaign_id, actor_id) REFERENCES campaign.character_sheets (campaign_id, actor_id)
);
CREATE TABLE campaign.character_equipment (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    quantity integer NOT NULL CHECK (quantity >= 0),
    equipped boolean NOT NULL,
    attuned boolean NOT NULL,
    description text NOT NULL,
    revision catalog.revision NOT NULL,
    FOREIGN KEY (campaign_id, actor_id) REFERENCES campaign.character_sheets (campaign_id, actor_id)
);
CREATE INDEX equipment_actor ON campaign.character_equipment (campaign_id, actor_id);
CREATE TABLE campaign.character_spells (
    campaign_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    knowledge_entry_id uuid NOT NULL,
    rules_edition catalog.edition NOT NULL,
    prepared boolean NOT NULL,
    PRIMARY KEY (campaign_id, actor_id, knowledge_entry_id),
    FOREIGN KEY (campaign_id, actor_id)
        REFERENCES campaign.character_sheets (campaign_id, actor_id),
    FOREIGN KEY (campaign_id, actor_id, rules_edition)
        REFERENCES campaign.actors (campaign_id, id, rules_edition),
    FOREIGN KEY (knowledge_entry_id, rules_edition)
        REFERENCES catalog.knowledge_entries (id, rules_edition)
);
CREATE TABLE campaign.actor_resources (
    campaign_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    maximum integer NOT NULL CHECK (maximum >= 0),
    remaining integer NOT NULL CHECK (remaining BETWEEN 0 AND maximum),
    recovery text NOT NULL CHECK (recovery IN ('manual', 'short_rest', 'long_rest')),
    revision catalog.revision NOT NULL,
    PRIMARY KEY (campaign_id, actor_id, name),
    FOREIGN KEY (campaign_id, actor_id) REFERENCES campaign.actors (campaign_id, id)
);
CREATE TABLE campaign.actor_concentration (
    campaign_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    knowledge_entry_id uuid NOT NULL,
    rules_edition catalog.edition NOT NULL,
    revision catalog.revision NOT NULL,
    PRIMARY KEY (campaign_id, actor_id),
    FOREIGN KEY (campaign_id, actor_id, rules_edition)
        REFERENCES campaign.actors (campaign_id, id, rules_edition),
    FOREIGN KEY (knowledge_entry_id, rules_edition)
        REFERENCES catalog.knowledge_entries (id, rules_edition)
);
