-- Six fixed scores. The wire DTO still nests them; adapters expand and nest at the boundary.
ALTER TABLE catalog.creature_templates
    ADD COLUMN strength smallint,
    ADD COLUMN dexterity smallint,
    ADD COLUMN constitution smallint,
    ADD COLUMN intelligence smallint,
    ADD COLUMN wisdom smallint,
    ADD COLUMN charisma smallint;
UPDATE catalog.creature_templates SET
    strength = (abilities->>'strength')::smallint,
    dexterity = (abilities->>'dexterity')::smallint,
    constitution = (abilities->>'constitution')::smallint,
    intelligence = (abilities->>'intelligence')::smallint,
    wisdom = (abilities->>'wisdom')::smallint,
    charisma = (abilities->>'charisma')::smallint;
ALTER TABLE catalog.creature_templates
    DROP COLUMN abilities,
    ALTER COLUMN strength SET NOT NULL,
    ALTER COLUMN dexterity SET NOT NULL,
    ALTER COLUMN constitution SET NOT NULL,
    ALTER COLUMN intelligence SET NOT NULL,
    ALTER COLUMN wisdom SET NOT NULL,
    ALTER COLUMN charisma SET NOT NULL,
    ADD CHECK (strength BETWEEN 1 AND 30),
    ADD CHECK (dexterity BETWEEN 1 AND 30),
    ADD CHECK (constitution BETWEEN 1 AND 30),
    ADD CHECK (intelligence BETWEEN 1 AND 30),
    ADD CHECK (wisdom BETWEEN 1 AND 30),
    ADD CHECK (charisma BETWEEN 1 AND 30);

ALTER TABLE campaign.actor_stats
    ADD COLUMN strength smallint,
    ADD COLUMN dexterity smallint,
    ADD COLUMN constitution smallint,
    ADD COLUMN intelligence smallint,
    ADD COLUMN wisdom smallint,
    ADD COLUMN charisma smallint;
UPDATE campaign.actor_stats SET
    strength = (abilities->>'strength')::smallint,
    dexterity = (abilities->>'dexterity')::smallint,
    constitution = (abilities->>'constitution')::smallint,
    intelligence = (abilities->>'intelligence')::smallint,
    wisdom = (abilities->>'wisdom')::smallint,
    charisma = (abilities->>'charisma')::smallint;
ALTER TABLE campaign.actor_stats
    DROP COLUMN abilities,
    ALTER COLUMN strength SET NOT NULL,
    ALTER COLUMN dexterity SET NOT NULL,
    ALTER COLUMN constitution SET NOT NULL,
    ALTER COLUMN intelligence SET NOT NULL,
    ALTER COLUMN wisdom SET NOT NULL,
    ALTER COLUMN charisma SET NOT NULL,
    ADD CHECK (strength BETWEEN 1 AND 30),
    ADD CHECK (dexterity BETWEEN 1 AND 30),
    ADD CHECK (constitution BETWEEN 1 AND 30),
    ADD CHECK (intelligence BETWEEN 1 AND 30),
    ADD CHECK (wisdom BETWEEN 1 AND 30),
    ADD CHECK (charisma BETWEEN 1 AND 30);

DROP FUNCTION catalog.valid_abilities(jsonb);
