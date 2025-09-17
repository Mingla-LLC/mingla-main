-- Create demo users first
INSERT INTO public.profiles (id, username, first_name, last_name, avatar_url) VALUES
('11111111-1111-1111-1111-111111111111', 'alice_demo', 'Alice', 'Johnson', 'https://images.unsplash.com/photo-1494790108755-2616b612b194?w=150'),
('22222222-2222-2222-2222-222222222222', 'bob_demo', 'Bob', 'Smith', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150'),
('33333333-3333-3333-3333-333333333333', 'carol_demo', 'Carol', 'Davis', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150'),
('44444444-4444-4444-4444-444444444444', 'david_demo', 'David', 'Wilson', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150')
ON CONFLICT (id) DO NOTHING;

-- Create demo experiences with valid category slugs
INSERT INTO public.experiences (id, title, category, category_slug, lat, lng, price_min, price_max, duration_min, image_url, meta) VALUES
('a1111111-1111-1111-1111-111111111111', 'Central Park Walk', 'Stroll', 'stroll', 40.7829, -73.9654, 0, 0, 60, 'https://images.unsplash.com/photo-1566404791232-af9fe0ae8f8b?w=400', '{"description": "Peaceful walk through Central Park with beautiful scenery"}'),
('a2222222-2222-2222-2222-222222222222', 'Coffee at Blue Bottle', 'Sip & Chill', 'sip', 40.7614, -73.9776, 5, 15, 45, 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400', '{"description": "Artisanal coffee in a cozy atmosphere"}'),
('a3333333-3333-3333-3333-333333333333', 'Museum of Modern Art', 'Culture', 'creative', 40.7614, -73.9776, 25, 25, 120, 'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=400', '{"description": "World-class modern art collection"}'),
('a4444444-4444-4444-4444-444444444444', 'Brooklyn Bridge Walk', 'Stroll', 'stroll', 40.7061, -73.9969, 0, 0, 90, 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400', '{"description": "Iconic bridge with stunning city views"}'),
('a5555555-5555-5555-5555-555555555555', 'Fine Dining Experience', 'Dining', 'dining', 40.7589, -73.9851, 80, 200, 180, 'https://images.unsplash.com/photo-1507924538820-ede94a04019d?w=400', '{"description": "Exquisite fine dining experience"}')
ON CONFLICT (id) DO NOTHING;

-- Create demo collaboration sessions
INSERT INTO public.collaboration_sessions (id, name, created_by, status, created_at) VALUES
('c1111111-1111-1111-1111-111111111111', 'NYC Weekend Adventure', '11111111-1111-1111-1111-111111111111', 'active', NOW() - INTERVAL '2 days'),
('c2222222-2222-2222-2222-222222222222', 'Coffee & Culture Tour', '22222222-2222-2222-2222-222222222222', 'active', NOW() - INTERVAL '1 day'),
('c3333333-3333-3333-3333-333333333333', 'Brooklyn Exploration', '33333333-3333-3333-3333-333333333333', 'pending', NOW() - INTERVAL '5 hours')
ON CONFLICT (id) DO NOTHING;

-- Create demo boards for the sessions
INSERT INTO public.boards (id, name, description, created_by, session_id, is_public, created_at) VALUES
('b1111111-1111-1111-1111-111111111111', 'NYC Weekend Adventure', 'Our exciting weekend plans in NYC', '11111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', false, NOW() - INTERVAL '2 days'),
('b2222222-2222-2222-2222-222222222222', 'Coffee & Culture Tour', 'Perfect day combining coffee and art', '22222222-2222-2222-2222-222222222222', 'c2222222-2222-2222-2222-222222222222', false, NOW() - INTERVAL '1 day'),
('b3333333-3333-3333-3333-333333333333', 'Brooklyn Exploration', 'Discovering the best of Brooklyn', '33333333-3333-3333-3333-333333333333', 'c3333333-3333-3333-3333-333333333333', false, NOW() - INTERVAL '5 hours')
ON CONFLICT (id) DO NOTHING;

-- Update sessions with board IDs
UPDATE public.collaboration_sessions SET board_id = 'b1111111-1111-1111-1111-111111111111' WHERE id = 'c1111111-1111-1111-1111-111111111111';
UPDATE public.collaboration_sessions SET board_id = 'b2222222-2222-2222-2222-222222222222' WHERE id = 'c2222222-2222-2222-2222-222222222222';
UPDATE public.collaboration_sessions SET board_id = 'b3333333-3333-3333-3333-333333333333' WHERE id = 'c3333333-3333-3333-3333-333333333333';