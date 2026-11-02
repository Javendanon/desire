-- Class progression beyond a level integer, and the miniature's worn look.
ALTER TABLE campaign.character_classes
    ADD COLUMN subclass_entry_id uuid,
    ADD COLUMN hit_die smallint NOT NULL DEFAULT 8,
    ADD CHECK (hit_die IN (6, 8, 10, 12)),
    ADD FOREIGN KEY (subclass_entry_id, rules_edition)
        REFERENCES catalog.knowledge_entries (id, rules_edition);

CREATE TABLE campaign.class_features (
    campaign_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    class_entry_id uuid NOT NULL,
    feature_entry_id uuid NOT NULL,
    rules_edition catalog.edition NOT NULL,
    PRIMARY KEY (campaign_id, actor_id, class_entry_id, feature_entry_id),
    FOREIGN KEY (campaign_id, actor_id, class_entry_id)
        REFERENCES campaign.character_classes (campaign_id, actor_id, class_entry_id),
    FOREIGN KEY (campaign_id, actor_id, rules_edition)
        REFERENCES campaign.actors (campaign_id, id, rules_edition),
    FOREIGN KEY (feature_entry_id, rules_edition)
        REFERENCES catalog.knowledge_entries (id, rules_edition)
);

CREATE TABLE campaign.actor_visuals (
    campaign_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    slot text NOT NULL CHECK (slot IN (
        'body', 'head', 'cloak', 'main_hand', 'off_hand', 'feet')),
    asset_uri text NOT NULL CHECK (length(btrim(asset_uri)) > 0),
    equipment_id uuid,
    PRIMARY KEY (campaign_id, actor_id, slot),
    FOREIGN KEY (campaign_id, actor_id) REFERENCES campaign.actors (campaign_id, id),
    FOREIGN KEY (equipment_id) REFERENCES campaign.character_equipment (id)
);
