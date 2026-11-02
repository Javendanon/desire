-- Rows installed on migration 0009, while ability scores are still one jsonb column.
INSERT INTO campaign.campaigns (id, owner_id, name, rules_edition, revision) VALUES
    ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000ab',
     'Upgrade', 'dnd_2014', 1);
INSERT INTO campaign.memberships VALUES
    ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000ab', 'dm');
INSERT INTO catalog.creature_templates (
    id, rules_edition, revision, name, creature_type, size, abilities,
    armor_class, max_hp, speed_m, description, provenance
) VALUES (
    '00000000-0000-4000-8000-0000000000ac', 'dnd_2014', 1, 'Upgrade sentry', 'synthetic', 'medium',
    '{"strength":16,"dexterity":8,"constitution":14,"intelligence":10,"wisdom":12,"charisma":6}',
    12, 10, 9, 'Not official',
    '{"source":"fixture:upgrade","attribution":"Synthetic","evidence":"synthetic"}'
);
INSERT INTO campaign.actors VALUES (
    '00000000-0000-4000-8000-0000000000ad', '00000000-0000-4000-8000-0000000000aa', 'dnd_2014',
    NULL, '00000000-0000-4000-8000-0000000000ac', 'monster', 'Upgrade sentry', 'dm', 'hostile', 1
);
INSERT INTO campaign.actor_stats (campaign_id, actor_id, abilities, armor_class, speed_m, revision)
SELECT '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000ad',
    abilities, armor_class, speed_m, 1
FROM catalog.creature_templates
WHERE id = '00000000-0000-4000-8000-0000000000ac';
