-- Negative checks against real PostgreSQL, not mocked SQL execution.
CREATE FUNCTION pg_temp.id(number integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
    SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(number), 12, '0'))::uuid;
$$;
CREATE FUNCTION pg_temp.reject(query text, expected_state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE query;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = expected_state THEN
            RETURN;
        END IF;
        RAISE;
    END;
    RAISE EXCEPTION 'Expected SQLSTATE % for %', expected_state, query;
END;
$$;
BEGIN;
INSERT INTO catalog.worlds VALUES (pg_temp.id(1), 'Synthetic world',
    '{"source":"fixture:D08","attribution":"Synthetic","evidence":"synthetic"}');
INSERT INTO catalog.eras VALUES (pg_temp.id(2), pg_temp.id(1), 'Synthetic era');
INSERT INTO catalog.cities VALUES (pg_temp.id(3), pg_temp.id(2), 'City one',
    '{"source":"fixture:D08","attribution":"Synthetic","evidence":"synthetic"}'),
    (pg_temp.id(4), pg_temp.id(2), 'City two',
    '{"source":"fixture:D08","attribution":"Synthetic","evidence":"synthetic"}');
INSERT INTO catalog.districts VALUES (pg_temp.id(5), pg_temp.id(3), 'District one');
INSERT INTO catalog.places VALUES (pg_temp.id(6), pg_temp.id(3), pg_temp.id(5), 'Base name',
    '{"source":"fixture:D08","attribution":"Synthetic","evidence":"synthetic"}');
INSERT INTO catalog.maps VALUES (pg_temp.id(7));
INSERT INTO catalog.map_versions VALUES (pg_temp.id(8), pg_temp.id(7), pg_temp.id(3), 1, NULL,
    '{"source":"fixture:D08","attribution":"Synthetic","evidence":"synthetic"}');
INSERT INTO campaign.campaigns (id, owner_id, city_id, name, rules_edition, revision) VALUES
    (pg_temp.id(10), pg_temp.id(90), pg_temp.id(3), 'First', 'dnd_2014', 1),
    (pg_temp.id(11), pg_temp.id(91), pg_temp.id(3), 'Second', 'dnd_2024', 1);
INSERT INTO campaign.memberships VALUES
    (pg_temp.id(10), pg_temp.id(90), 'dm'), (pg_temp.id(11), pg_temp.id(91), 'dm');
SET CONSTRAINTS ALL IMMEDIATE;
INSERT INTO campaign.scenes VALUES
    (pg_temp.id(20), pg_temp.id(10), pg_temp.id(8), 'First scene', 1),
    (pg_temp.id(21), pg_temp.id(11), pg_temp.id(8), 'Second scene', 1);
INSERT INTO campaign.characters VALUES
    (pg_temp.id(30), pg_temp.id(10), pg_temp.id(90), 'Character', 'dnd_2014', 1);
INSERT INTO catalog.knowledge_entries VALUES (pg_temp.id(40), 1, 'dnd_2024', 'en',
    'Synthetic condition', 'No official rules',
    '{"source":"fixture:D08","attribution":"Synthetic","evidence":"synthetic"}');
INSERT INTO campaign.sessions VALUES (pg_temp.id(50), pg_temp.id(10), 'Session one', 1);
INSERT INTO campaign.place_overrides VALUES
    (pg_temp.id(60), pg_temp.id(10), pg_temp.id(6), 1, 'Campaign-only name');

SELECT pg_temp.reject($q$INSERT INTO campaign.memberships VALUES
    (pg_temp.id(10), pg_temp.id(90), 'player')$q$, '23505');
SELECT pg_temp.reject($q$DELETE FROM campaign.memberships
    WHERE campaign_id = pg_temp.id(10)$q$, '23503');
SELECT pg_temp.reject($q$UPDATE campaign.memberships SET role = 'player'
    WHERE campaign_id = pg_temp.id(10)$q$, '23503');
SELECT pg_temp.reject($q$INSERT INTO campaign.characters VALUES
    (pg_temp.id(31), pg_temp.id(11), NULL, 'Wrong edition', 'dnd_2014', 1)$q$, '23503');
SELECT pg_temp.reject($q$INSERT INTO campaign.characters VALUES
    (pg_temp.id(31), pg_temp.id(10), pg_temp.id(91), 'Wrong controller', 'dnd_2014', 1)$q$, '23503');
SELECT pg_temp.reject($q$INSERT INTO campaign.conditions VALUES
    (pg_temp.id(41), pg_temp.id(10), pg_temp.id(30), pg_temp.id(40), 'dnd_2014', 1, 1)$q$, '23503');
SELECT pg_temp.reject($q$INSERT INTO campaign.journal_entries VALUES
    (pg_temp.id(51), pg_temp.id(11), pg_temp.id(50), 'Wrong session', 'players', 1)$q$, '23503');
SELECT pg_temp.reject($q$INSERT INTO private.dm_secrets (id, campaign_id, scene_id, body, revision)
    VALUES (pg_temp.id(70), pg_temp.id(11), pg_temp.id(20), 'Wrong scene', 1)$q$, '23503');
SELECT pg_temp.reject($q$INSERT INTO private.dm_secrets (id, campaign_id, body, revision)
    VALUES (pg_temp.id(70), pg_temp.id(10), 'Missing subject', 1)$q$, '23514');
SELECT pg_temp.reject($q$INSERT INTO private.dm_secrets
    (id, campaign_id, scene_id, place_id, body, revision) VALUES
    (pg_temp.id(70), pg_temp.id(10), pg_temp.id(20), pg_temp.id(6), 'Ambiguous subject', 1)$q$, '23514');
SELECT pg_temp.reject($q$INSERT INTO catalog.places VALUES
    (pg_temp.id(9), pg_temp.id(4), pg_temp.id(5), 'Wrong district',
    '{"source":"test","attribution":"test","evidence":"synthetic"}')$q$, '23503');
SELECT pg_temp.reject($q$INSERT INTO catalog.place_anchors VALUES
    (pg_temp.id(6), pg_temp.id(8), pg_temp.id(4), 0, 0, 0,
    '{"source":"test","attribution":"test","evidence":"synthetic"}')$q$, '23503');
SELECT pg_temp.reject($q$INSERT INTO campaign.travels VALUES
    (pg_temp.id(80), pg_temp.id(10), pg_temp.id(21), pg_temp.id(30),
    0, 0, 0, 1, 0, 1, 1, 1, 1, 'planned', 1)$q$, '23503');
SELECT pg_temp.reject($q$INSERT INTO campaign.travels VALUES
    (pg_temp.id(80), pg_temp.id(10), pg_temp.id(20), pg_temp.id(30),
    0, 0, 0, 1, 0, 1, -1, 1, 1, 'planned', 1)$q$, '23514');
SELECT pg_temp.reject($q$INSERT INTO campaign.outbox
    (event_id, campaign_id, stream_revision, kind, scene_id) VALUES
    (pg_temp.id(100), pg_temp.id(11), 1, 'scene_changed', pg_temp.id(20))$q$, '23503');
SELECT pg_temp.reject($q$UPDATE campaign.campaigns SET revision = 0$q$, '23514');
SELECT pg_temp.reject($q$UPDATE campaign.campaigns SET revision = 4294967296$q$, '23514');
SELECT pg_temp.reject($q$SELECT 'NaN'::catalog.finite_number$q$, '23514');
SELECT pg_temp.reject($q$SELECT 'Infinity'::catalog.finite_number$q$, '23514');
SELECT pg_temp.reject($q$SELECT '-Infinity'::catalog.finite_number$q$, '23514');
SELECT pg_temp.reject($q$SELECT 0::catalog.revision$q$, '23514');
SELECT pg_temp.reject($q$SELECT 'other_edition'::catalog.edition$q$, '23514');
SELECT pg_temp.reject($q$SELECT 'public'::campaign.visibility$q$, '23514');
SELECT pg_temp.reject($q$SELECT '{"source":"test","attribution":"test","evidence":null}'
    ::catalog.provenance$q$, '23514');
SELECT pg_temp.reject($q$UPDATE catalog.map_versions SET calibration =
    '{"origin_px_x":0,"origin_px_y":0,"meters_per_pixel":0,"rotation_radians":0,
    "provenance":{"source":"test","attribution":"test","evidence":"synthetic"}}'$q$, '23514');
DO $$
BEGIN
    ASSERT (SELECT name = 'Base name' FROM catalog.places WHERE id = pg_temp.id(6));
    ASSERT NOT EXISTS (SELECT 1 FROM campaign.place_overrides WHERE campaign_id = pg_temp.id(11));
END;
$$;
ROLLBACK;
