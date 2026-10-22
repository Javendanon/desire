INSERT INTO campaign.parties VALUES
    (pg_temp.id(400), pg_temp.id(10), 'First party', 1),
    (pg_temp.id(401), pg_temp.id(11), 'Other party', 1);
INSERT INTO campaign.party_members VALUES
    (pg_temp.id(10), pg_temp.id(400), pg_temp.id(201)),
    (pg_temp.id(10), pg_temp.id(400), pg_temp.id(202));
BEGIN;
INSERT INTO campaign.travels (id, campaign_id, scene_id, x_m, y_m, z_m,
    destination_x_m, destination_y_m, destination_z_m, distance_m, narrative_seconds,
    visual_seconds, status, revision, party_id) VALUES
    (pg_temp.id(500), pg_temp.id(10), pg_temp.id(300), 0, 0, 0, 10, 0, 0,
    10, 10, 1, 'planned', 1, pg_temp.id(400));
INSERT INTO campaign.travel_participants
    SELECT campaign_id, pg_temp.id(500), actor_id FROM campaign.party_members
    WHERE party_id = pg_temp.id(400);
COMMIT;
DELETE FROM campaign.party_members WHERE actor_id = pg_temp.id(202);
DO $$ BEGIN
    ASSERT (SELECT count(*) = 2 FROM campaign.travel_participants
    WHERE travel_id = pg_temp.id(500));
END $$;
SELECT pg_temp.reject($q$INSERT INTO campaign.travel_participants VALUES
    (pg_temp.id(10), pg_temp.id(500), pg_temp.id(211))$q$, '23503');
SELECT pg_temp.reject($q$UPDATE campaign.travels SET party_id = pg_temp.id(401)
    WHERE id = pg_temp.id(500)$q$, '23503');
BEGIN;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.reject($q$DELETE FROM campaign.travel_participants
    WHERE travel_id = pg_temp.id(500)$q$, '23514');
ROLLBACK;
