SELECT (to_jsonb(t) - ARRAY['character_id', 'x_m', 'y_m', 'z_m',
    'destination_x_m', 'destination_y_m', 'destination_z_m']) || jsonb_build_object(
    'protocol_version', 2,
    'position', jsonb_build_object('x_m', t.x_m, 'y_m', t.y_m, 'z_m', t.z_m),
    'destination', jsonb_build_object(
        'x_m', t.destination_x_m, 'y_m', t.destination_y_m, 'z_m', t.destination_z_m),
    'participants', (SELECT jsonb_agg(actor_id ORDER BY actor_id)
        FROM campaign.travel_participants p
    WHERE p.campaign_id = t.campaign_id AND p.travel_id = t.id)
)
FROM campaign.travels t
WHERE t.campaign_id = $1::text::uuid AND t.id = $2::text::uuid
