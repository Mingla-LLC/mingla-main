-- Insert mock experiences for demo with correct category slugs
INSERT INTO experiences (id, title, category, category_slug, lat, lng, price_min, price_max, duration_min, image_url, place_id) VALUES 
('550e8400-e29b-41d4-a716-446655440001', 'Central Park Walking Tour', 'Stroll', 'stroll', 40.7829, -73.9654, 0, 25, 120, 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400', 'central_park_ny'),
('550e8400-e29b-41d4-a716-446655440002', 'Brooklyn Bridge Experience', 'Stroll', 'stroll', 40.7061, -73.9969, 0, 0, 90, 'https://images.unsplash.com/photo-1504893524553-b855bce32c67?w=400', 'brooklyn_bridge'),
('550e8400-e29b-41d4-a716-446655440003', 'Coffee Shop Discovery', 'Sip & Chill', 'sip', 40.7480, -73.9857, 5, 15, 60, 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=400', 'coffee_shop_ny'),
('550e8400-e29b-41d4-a716-446655440004', 'Art Museum Visit', 'Creative & Hands-On', 'creative', 40.7794, -73.9632, 15, 30, 180, 'https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=400', 'met_museum'),
('550e8400-e29b-41d4-a716-446655440005', 'Local Food Market', 'Casual Eats', 'casual_eats', 40.7505, -73.9934, 10, 40, 75, 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400', 'chelsea_market'),
('550e8400-e29b-41d4-a716-446655440006', 'Rooftop Bar Experience', 'Sip & Chill', 'sip', 40.7505, -73.9857, 20, 60, 120, 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400', 'rooftop_bar_ny'),
('550e8400-e29b-41d4-a716-446655440007', 'Live Music Venue', 'Screen & Relax', 'screen_relax', 40.7282, -74.0776, 25, 50, 150, 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400', 'music_venue_ny'),
('550e8400-e29b-41d4-a716-446655440008', 'Scenic River Walk', 'Stroll', 'stroll', 40.7589, -73.9851, 0, 0, 45, 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=400', 'hudson_river_park')
ON CONFLICT (id) DO NOTHING;

-- Insert mock demo user profiles
INSERT INTO profiles (id, username, first_name, last_name, avatar_url, currency, measurement_system, share_location, share_budget, share_categories, share_date_time) VALUES 
('550e8400-demo-user1-a716-446655440001', 'sarah_explorer', 'Sarah', 'Johnson', 'https://images.unsplash.com/photo-1494790108755-2616b612b647?w=100&h=100&fit=crop&crop=face', 'USD', 'metric', true, false, true, true),
('550e8400-demo-user2-a716-446655440002', 'mike_adventurer', 'Mike', 'Chen', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face', 'USD', 'metric', true, false, true, true),
('550e8400-demo-user3-a716-446655440003', 'emma_wanderer', 'Emma', 'Davis', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=face', 'USD', 'metric', true, false, true, true)
ON CONFLICT (id) DO NOTHING;

-- Insert demo boards with experiences
INSERT INTO boards (id, name, description, created_by, is_public, session_id, created_at, updated_at) VALUES 
('550e8400-demo-board1-a716-446655440001', 'Weekend NYC Adventure', 'Exploring the best of Manhattan with friends', '550e8400-demo-user1-a716-446655440001', false, null, now(), now()),
('550e8400-demo-board2-a716-446655440002', 'Coffee & Culture Tour', 'Perfect blend of caffeine and culture', '550e8400-demo-user2-a716-446655440002', false, null, now(), now()),
('550e8400-demo-board3-a716-446655440003', 'Date Night Ideas', 'Romantic spots around the city', '550e8400-demo-user3-a716-446655440003', true, null, now(), now())
ON CONFLICT (id) DO NOTHING;

-- Create saved experiences (cards) for the boards
INSERT INTO saves (profile_id, experience_id, status, created_at, scheduled_at) VALUES 
-- Board 1 saves
('550e8400-demo-user1-a716-446655440001', '550e8400-e29b-41d4-a716-446655440001', 'liked', now(), '2025-01-20 14:00:00'),
('550e8400-demo-user1-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002', 'liked', now(), '2025-01-20 16:30:00'),
('550e8400-demo-user1-a716-446655440001', '550e8400-e29b-41d4-a716-446655440004', 'finalized', now(), '2025-01-21 11:00:00'),
-- Board 2 saves
('550e8400-demo-user2-a716-446655440002', '550e8400-e29b-41d4-a716-446655440003', 'finalized', now(), '2025-01-22 09:30:00'),
('550e8400-demo-user2-a716-446655440002', '550e8400-e29b-41d4-a716-446655440004', 'liked', now(), '2025-01-22 14:00:00'),
-- Board 3 saves
('550e8400-demo-user3-a716-446655440003', '550e8400-e29b-41d4-a716-446655440006', 'finalized', now(), '2025-01-23 19:00:00'),
('550e8400-demo-user3-a716-446655440003', '550e8400-e29b-41d4-a716-446655440007', 'liked', now(), '2025-01-23 21:00:00')
ON CONFLICT (profile_id, experience_id) DO NOTHING;