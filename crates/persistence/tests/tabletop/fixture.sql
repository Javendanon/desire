-- Synthetic data only: these scores are not an official stat block.
CREATE FUNCTION pg_temp.id(value integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
    SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(value), 12, '0'))::uuid;
$$;
CREATE FUNCTION pg_temp.reject(query text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE query;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = expected THEN RETURN; END IF;
        RAISE;
    END;
    RAISE EXCEPTION 'Expected SQLSTATE % for %', expected, query;
END;
$$;
INSERT INTO campaign.campaigns (id, owner_id, name, rules_edition, revision) VALUES
    (pg_temp.id(10), pg_temp.id(90), 'First', 'dnd_2014', 1),
    (pg_temp.id(11), pg_temp.id(91), 'Second', 'dnd_2014', 1);
INSERT INTO campaign.memberships VALUES
    (pg_temp.id(10), pg_temp.id(90), 'dm'), (pg_temp.id(11), pg_temp.id(91), 'dm');
INSERT INTO catalog.creature_templates VALUES
    (pg_temp.id(200), 'dnd_2014', 1, 'Synthetic sentry', 'synthetic', 'medium',
    '{"strength":10,"dexterity":10,"constitution":10,"intelligence":10,"wisdom":10,"charisma":10}',
    12, 10, 9, 'Not official rules',
    '{"source":"fixture:tabletop","attribution":"Synthetic","evidence":"synthetic"}');
CREATE FUNCTION pg_temp.actor(value integer, scope integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO campaign.actors VALUES (pg_temp.id(value), pg_temp.id(scope), 'dnd_2014',
        NULL, pg_temp.id(200), 'monster', 'Synthetic sentry', 'dm', 'hostile', 1);
    INSERT INTO campaign.actor_stats SELECT pg_temp.id(scope), pg_temp.id(value),
        abilities, armor_class, speed_m, 1 FROM catalog.creature_templates
    WHERE id = pg_temp.id(200);
    INSERT INTO campaign.actor_state VALUES
        (pg_temp.id(scope), pg_temp.id(value), 10, 10, 0, 'active', 1);
END;
$$;
SELECT pg_temp.actor(201, 10), pg_temp.actor(202, 10), pg_temp.actor(211, 11);
INSERT INTO campaign.scenes VALUES
    (pg_temp.id(300), pg_temp.id(10), pg_temp.id(6), 'First scene', 1),
    (pg_temp.id(301), pg_temp.id(11), pg_temp.id(6), 'Second scene', 1);
INSERT INTO campaign.characters VALUES
    (pg_temp.id(203), pg_temp.id(10), pg_temp.id(90), 'Synthetic player', 'dnd_2014', 1);
