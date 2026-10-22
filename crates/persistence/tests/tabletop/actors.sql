UPDATE campaign.actor_state SET current_hp = 3, revision = 2 WHERE actor_id = pg_temp.id(201);
DO $$ BEGIN
    ASSERT (SELECT current_hp = 10 FROM campaign.actor_state WHERE actor_id = pg_temp.id(202));
    ASSERT (SELECT max_hp = 10 FROM catalog.creature_templates WHERE id = pg_temp.id(200));
    ASSERT EXISTS (SELECT 1 FROM campaign.actors WHERE id = pg_temp.id(203));
    ASSERT NOT EXISTS (SELECT 1 FROM campaign.actor_state WHERE actor_id = pg_temp.id(203));
END $$;
SELECT pg_temp.reject($q$UPDATE campaign.actor_state SET current_hp = 11$q$, '23514');
SELECT pg_temp.reject($q$UPDATE campaign.actor_state SET temporary_hp = -1$q$, '23514');
SELECT pg_temp.reject($q$UPDATE campaign.actor_stats SET abilities = '{}'$q$, '23514');
SELECT pg_temp.reject($q$UPDATE campaign.actor_stats SET abilities =
    '{"strength":0,"dexterity":10,"constitution":10,"intelligence":10,"wisdom":10,"charisma":10}'
    $q$, '23514');
SELECT pg_temp.reject($q$INSERT INTO campaign.actor_state VALUES
    (pg_temp.id(11), pg_temp.id(201), 10, 10, 0, 'active', 1)$q$, '23503');
INSERT INTO campaign.conditions (id, campaign_id, actor_id, knowledge_entry_id,
    rules_edition, remaining_rounds, revision) VALUES
    (pg_temp.id(600), pg_temp.id(10), pg_temp.id(201), pg_temp.id(50), 'dnd_2014', 2, 1);
SELECT pg_temp.reject($q$UPDATE campaign.conditions SET actor_id = pg_temp.id(211)$q$, '23503');
SELECT pg_temp.reject($q$UPDATE campaign.actors SET rules_edition = 'dnd_2024'
    WHERE id = pg_temp.id(202)$q$, '23503');
