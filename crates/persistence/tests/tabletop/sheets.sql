INSERT INTO campaign.character_sheets VALUES
    (pg_temp.id(10), pg_temp.id(203), 'Synthetic ancestry', 'Synthetic background', 0, '', 1);
INSERT INTO campaign.character_classes (
    campaign_id, actor_id, class_entry_id, rules_edition, level, hit_die
) VALUES (pg_temp.id(10), pg_temp.id(203), pg_temp.id(50), 'dnd_2014', 2, 8);
INSERT INTO campaign.class_features VALUES
    (pg_temp.id(10), pg_temp.id(203), pg_temp.id(50), pg_temp.id(50), 'dnd_2014');
INSERT INTO campaign.actor_visuals VALUES
    (pg_temp.id(10), pg_temp.id(203), 'body', 'synthetic://body', NULL);
INSERT INTO campaign.character_proficiencies VALUES
    (pg_temp.id(10), pg_temp.id(203), 'skill', 'Synthetic skill', 'expertise');
INSERT INTO campaign.character_equipment VALUES
    (pg_temp.id(700), pg_temp.id(10), pg_temp.id(203), 'Synthetic staff', 1, true, false, '', 1);
INSERT INTO campaign.actor_visuals VALUES
    (pg_temp.id(10), pg_temp.id(203), 'main_hand', 'synthetic://staff', pg_temp.id(700));
INSERT INTO campaign.character_spells VALUES
    (pg_temp.id(10), pg_temp.id(203), pg_temp.id(50), 'dnd_2014', true);
INSERT INTO campaign.actor_resources VALUES
    (pg_temp.id(10), pg_temp.id(203), 'slot:1', 3, 2, 'long_rest', 1);
INSERT INTO campaign.actor_concentration VALUES
    (pg_temp.id(10), pg_temp.id(203), pg_temp.id(50), 'dnd_2014', 1);
DO $$ BEGIN
    ASSERT (SELECT sum(level) = 2 FROM campaign.character_classes WHERE actor_id = pg_temp.id(203));
END $$;
SELECT pg_temp.reject($q$UPDATE campaign.character_classes SET level = 0$q$, '23514');
SELECT pg_temp.reject($q$UPDATE campaign.character_classes SET hit_die = 7$q$, '23514');
SELECT pg_temp.reject($q$INSERT INTO campaign.actor_visuals VALUES
    (pg_temp.id(10), pg_temp.id(203), 'wings', 'synthetic://wings', NULL)$q$, '23514');
SELECT pg_temp.reject($q$INSERT INTO campaign.actor_visuals VALUES
    (pg_temp.id(11), pg_temp.id(211), 'body', 'synthetic://body', pg_temp.id(700))$q$, '23503');
SELECT pg_temp.reject($q$UPDATE campaign.actor_resources SET remaining = 4$q$, '23514');
SELECT pg_temp.reject($q$UPDATE campaign.character_equipment SET campaign_id = pg_temp.id(11)$q$,
    '23503');
SELECT pg_temp.reject($q$UPDATE campaign.character_spells SET rules_edition = 'dnd_2024'$q$,
    '23503');
