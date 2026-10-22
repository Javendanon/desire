DO $$ BEGIN
    ASSERT EXISTS (SELECT 1 FROM campaign.actors
        WHERE character_id = '00000000-0000-4000-8000-000000000020');
    ASSERT EXISTS (SELECT 1 FROM campaign.travel_participants
        WHERE actor_id = '00000000-0000-4000-8000-000000000020');
    ASSERT EXISTS (SELECT 1 FROM campaign.conditions
        WHERE actor_id = character_id AND actor_id = '00000000-0000-4000-8000-000000000020');
    ASSERT (SELECT count(*) = 1 FROM campaign.travels);
END $$;
