-- Presence is independent of combat, hostility and disclosure to players.
CREATE TABLE campaign.place_occupants (
    campaign_id uuid NOT NULL,
    place_id uuid NOT NULL REFERENCES catalog.places,
    actor_id uuid NOT NULL,
    presence text NOT NULL CHECK (presence IN ('present', 'away')),
    visibility campaign.visibility NOT NULL,
    revision catalog.revision NOT NULL,
    PRIMARY KEY (campaign_id, place_id, actor_id),
    FOREIGN KEY (campaign_id, actor_id) REFERENCES campaign.actors (campaign_id, id)
);
CREATE UNIQUE INDEX actor_current_place ON campaign.place_occupants (campaign_id, actor_id)
    WHERE presence = 'present';
CREATE TABLE campaign.scene_placements (
    campaign_id uuid NOT NULL,
    scene_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    x_m catalog.finite_number NOT NULL,
    y_m catalog.finite_number NOT NULL,
    z_m catalog.finite_number NOT NULL,
    visibility campaign.visibility NOT NULL,
    revision catalog.revision NOT NULL,
    PRIMARY KEY (campaign_id, scene_id, actor_id),
    FOREIGN KEY (campaign_id, scene_id) REFERENCES campaign.scenes (campaign_id, id),
    FOREIGN KEY (campaign_id, actor_id) REFERENCES campaign.actors (campaign_id, id)
);
CREATE TABLE campaign.place_population_rules (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL,
    place_id uuid NOT NULL REFERENCES catalog.places,
    template_id uuid NOT NULL,
    rules_edition catalog.edition NOT NULL,
    quantity_min integer NOT NULL CHECK (quantity_min > 0),
    quantity_max integer NOT NULL CHECK (quantity_max >= quantity_min),
    visibility campaign.visibility NOT NULL,
    disposition text NOT NULL CHECK (disposition IN ('friendly', 'neutral', 'hostile')),
    revision catalog.revision NOT NULL,
    UNIQUE (campaign_id, id),
    FOREIGN KEY (campaign_id, rules_edition) REFERENCES campaign.campaigns (id, rules_edition),
    FOREIGN KEY (template_id, rules_edition)
        REFERENCES catalog.creature_templates (id, rules_edition)
);
-- One activation per rule. Revisits do not roll again or reset damaged/dead instances.
CREATE TABLE campaign.population_runs (
    campaign_id uuid NOT NULL,
    rule_id uuid NOT NULL,
    PRIMARY KEY (campaign_id, rule_id),
    FOREIGN KEY (campaign_id, rule_id) REFERENCES campaign.place_population_rules (campaign_id, id)
);
CREATE TABLE campaign.population_spawned_actors (
    campaign_id uuid NOT NULL,
    rule_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    PRIMARY KEY (campaign_id, rule_id, actor_id),
    FOREIGN KEY (campaign_id, rule_id) REFERENCES campaign.population_runs (campaign_id, rule_id),
    FOREIGN KEY (campaign_id, actor_id) REFERENCES campaign.actors (campaign_id, id)
);
CREATE INDEX population_spawned_actor ON campaign.population_spawned_actors (campaign_id, actor_id);
