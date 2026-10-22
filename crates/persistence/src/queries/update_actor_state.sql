UPDATE campaign.actor_state
SET max_hp = ($1::jsonb->>'max_hp')::integer,
    current_hp = ($1::jsonb->>'current_hp')::integer,
    temporary_hp = ($1::jsonb->>'temporary_hp')::integer,
    status = $1::jsonb->>'status',
    revision = revision + 1
WHERE campaign_id = ($1::jsonb->>'campaign_id')::uuid
    AND actor_id = ($1::jsonb->>'actor_id')::uuid
    AND revision = $2
