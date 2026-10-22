INSERT INTO campaign.place_occupants VALUES
    (pg_temp.id(10), pg_temp.id(5), pg_temp.id(201), 'present', 'dm', 1),
    (pg_temp.id(10), pg_temp.id(5), pg_temp.id(202), 'present', 'players', 1);
DO $$ BEGIN
    ASSERT NOT EXISTS (SELECT 1 FROM campaign.encounters);
END $$;
UPDATE campaign.actor_state SET current_hp = 3, revision = 2 WHERE actor_id = pg_temp.id(201);
UPDATE campaign.place_occupants SET presence = 'away', revision = 2
    WHERE actor_id = pg_temp.id(201);
UPDATE campaign.place_occupants SET presence = 'present', revision = 3
    WHERE actor_id = pg_temp.id(201);
INSERT INTO campaign.scene_placements VALUES
    (pg_temp.id(10), pg_temp.id(300), pg_temp.id(201), 1, 0, 2, 'dm', 1);
INSERT INTO campaign.encounters VALUES
    (pg_temp.id(800), pg_temp.id(10), pg_temp.id(5), pg_temp.id(300), 'Synthetic', 'active', 1, 1);
INSERT INTO campaign.encounter_participants VALUES
    (pg_temp.id(10), pg_temp.id(800), pg_temp.id(201), -2);
DO $$ BEGIN
    ASSERT (SELECT current_hp = 3 FROM campaign.actor_state WHERE actor_id = pg_temp.id(201));
END $$;
SELECT pg_temp.reject($q$INSERT INTO campaign.place_occupants VALUES
    (pg_temp.id(11), pg_temp.id(5), pg_temp.id(201), 'present', 'dm', 1)$q$, '23503');
SELECT pg_temp.reject($q$UPDATE campaign.scene_placements SET scene_id = pg_temp.id(301)$q$,
    '23503');
SELECT pg_temp.reject($q$INSERT INTO campaign.encounter_participants VALUES
    (pg_temp.id(10), pg_temp.id(800), pg_temp.id(211), 10)$q$, '23503');
