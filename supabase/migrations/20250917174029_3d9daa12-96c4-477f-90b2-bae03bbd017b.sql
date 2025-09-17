-- Create demo users and populate with comprehensive demo data
-- First, let's create some demo profiles (these will represent other users)

-- Demo user profiles
INSERT INTO public.profiles (id, username, first_name, last_name, avatar_url) VALUES
('d1234567-1234-1234-1234-123456789012', 'alice_demo', 'Alice', 'Johnson', 'https://images.unsplash.com/photo-1494790108755-2616b612b194?w=150'),
('d2234567-1234-1234-1234-123456789012', 'bob_demo', 'Bob', 'Smith', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150'),
('d3234567-1234-1234-1234-123456789012', 'carol_demo', 'Carol', 'Davis', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150'),
('d4234567-1234-1234-1234-123456789012', 'david_demo', 'David', 'Wilson', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150')
ON CONFLICT (id) DO NOTHING;

-- Create demo experiences/cards with valid category slugs only
INSERT INTO public.experiences (id, title, category, category_slug, lat, lng, price_min, price_max, duration_min, image_url, meta) VALUES
('e1111111-1111-1111-1111-111111111111', 'Central Park Walk', 'Stroll', 'stroll', 40.7829, -73.9654, 0, 0, 60, 'https://images.unsplash.com/photo-1566404791232-af9fe0ae8f8b?w=400', '{"description": "Peaceful walk through Central Park with beautiful scenery"}'),
('e2222222-2222-2222-2222-222222222222', 'Coffee at Blue Bottle', 'Sip & Chill', 'sip', 40.7614, -73.9776, 5, 15, 45, 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400', '{"description": "Artisanal coffee in a cozy atmosphere"}'),
('e3333333-3333-3333-3333-333333333333', 'Museum of Modern Art', 'Culture', 'creative', 40.7614, -73.9776, 25, 25, 120, 'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=400', '{"description": "World-class modern art collection"}'),
('e4444444-4444-4444-4444-444444444444', 'Brooklyn Bridge Walk', 'Stroll', 'stroll', 40.7061, -73.9969, 0, 0, 90, 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400', '{"description": "Iconic bridge with stunning city views"}'),
('e5555555-5555-5555-5555-555555555555', 'Fine Dining Experience', 'Dining', 'dining', 40.7589, -73.9851, 80, 200, 180, 'https://images.unsplash.com/photo-1507924538820-ede94a04019d?w=400', '{"description": "Exquisite fine dining experience"}')
ON CONFLICT (id) DO NOTHING;

-- Create demo collaboration sessions
INSERT INTO public.collaboration_sessions (id, name, created_by, status, created_at) VALUES
('s1111111-1111-1111-1111-111111111111', 'NYC Weekend Adventure', 'd1234567-1234-1234-1234-123456789012', 'active', NOW() - INTERVAL '2 days'),
('s2222222-2222-2222-2222-222222222222', 'Coffee & Culture Tour', 'd2234567-1234-1234-1234-123456789012', 'active', NOW() - INTERVAL '1 day'),
('s3333333-3333-3333-3333-333333333333', 'Brooklyn Exploration', 'd3234567-1234-1234-1234-123456789012', 'pending', NOW() - INTERVAL '5 hours')
ON CONFLICT (id) DO NOTHING;

-- Create demo boards for the sessions
INSERT INTO public.boards (id, name, description, created_by, session_id, is_public, created_at) VALUES
('b1111111-1111-1111-1111-111111111111', 'NYC Weekend Adventure', 'Our exciting weekend plans in NYC', 'd1234567-1234-1234-1234-123456789012', 's1111111-1111-1111-1111-111111111111', false, NOW() - INTERVAL '2 days'),
('b2222222-2222-2222-2222-222222222222', 'Coffee & Culture Tour', 'Perfect day combining coffee and art', 'd2234567-1234-1234-1234-123456789012', 's2222222-2222-2222-2222-222222222222', false, NOW() - INTERVAL '1 day'),
('b3333333-3333-3333-3333-333333333333', 'Brooklyn Exploration', 'Discovering the best of Brooklyn', 'd3234567-1234-1234-1234-123456789012', 's3333333-3333-3333-3333-333333333333', false, NOW() - INTERVAL '5 hours')
ON CONFLICT (id) DO NOTHING;

-- Update sessions with board IDs
UPDATE public.collaboration_sessions SET board_id = 'b1111111-1111-1111-1111-111111111111' WHERE id = 's1111111-1111-1111-1111-111111111111';
UPDATE public.collaboration_sessions SET board_id = 'b2222222-2222-2222-2222-222222222222' WHERE id = 's2222222-2222-2222-2222-222222222222';
UPDATE public.collaboration_sessions SET board_id = 'b3333333-3333-3333-3333-333333333333' WHERE id = 's3333333-3333-3333-3333-333333333333';

-- Create session participants (multiple people in each session)
INSERT INTO public.session_participants (id, session_id, user_id, has_accepted, joined_at) VALUES
-- NYC Weekend Adventure participants
('p1111111-1111-1111-1111-111111111111', 's1111111-1111-1111-1111-111111111111', 'd1234567-1234-1234-1234-123456789012', true, NOW() - INTERVAL '2 days'),
('p1222222-1111-1111-1111-111111111111', 's1111111-1111-1111-1111-111111111111', 'd2234567-1234-1234-1234-123456789012', true, NOW() - INTERVAL '2 days'),
('p1333333-1111-1111-1111-111111111111', 's1111111-1111-1111-1111-111111111111', 'd3234567-1234-1234-1234-123456789012', true, NOW() - INTERVAL '1 day'),

-- Coffee & Culture Tour participants  
('p2111111-2222-2222-2222-222222222222', 's2222222-2222-2222-2222-222222222222', 'd2234567-1234-1234-1234-123456789012', true, NOW() - INTERVAL '1 day'),
('p2222222-2222-2222-2222-222222222222', 's2222222-2222-2222-2222-222222222222', 'd4234567-1234-1234-1234-123456789012', true, NOW() - INTERVAL '1 day'),

-- Brooklyn Exploration participants (pending)
('p3111111-3333-3333-3333-333333333333', 's3333333-3333-3333-3333-333333333333', 'd3234567-1234-1234-1234-123456789012', true, NOW() - INTERVAL '5 hours'),
('p3222222-3333-3333-3333-333333333333', 's3333333-3333-3333-3333-333333333333', 'd1234567-1234-1234-1234-123456789012', false, NULL)
ON CONFLICT (id) DO NOTHING;

-- Create board collaborators
INSERT INTO public.board_collaborators (id, board_id, user_id, role) VALUES
-- NYC Weekend Adventure collaborators
('c1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'd1234567-1234-1234-1234-123456789012', 'owner'),
('c1222222-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'd2234567-1234-1234-1234-123456789012', 'collaborator'),
('c1333333-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'd3234567-1234-1234-1234-123456789012', 'collaborator'),

-- Coffee & Culture Tour collaborators
('c2111111-2222-2222-2222-222222222222', 'b2222222-2222-2222-2222-222222222222', 'd2234567-1234-1234-1234-123456789012', 'owner'),
('c2222222-2222-2222-2222-222222222222', 'b2222222-2222-2222-2222-222222222222', 'd4234567-1234-1234-1234-123456789012', 'collaborator'),

-- Brooklyn Exploration collaborators
('c3111111-3333-3333-3333-333333333333', 'b3333333-3333-3333-3333-333333333333', 'd3234567-1234-1234-1234-123456789012', 'owner')
ON CONFLICT (id) DO NOTHING;

-- Create collaboration invites
INSERT INTO public.collaboration_invites (id, session_id, invited_user_id, invited_by, status, message, created_at) VALUES
('i1111111-1111-1111-1111-111111111111', 's1111111-1111-1111-1111-111111111111', 'd2234567-1234-1234-1234-123456789012', 'd1234567-1234-1234-1234-123456789012', 'accepted', 'Join me for an amazing NYC weekend!', NOW() - INTERVAL '2 days'),
('i2222222-1111-1111-1111-111111111111', 's1111111-1111-1111-1111-111111111111', 'd3234567-1234-1234-1234-123456789012', 'd1234567-1234-1234-1234-123456789012', 'accepted', 'Join me for an amazing NYC weekend!', NOW() - INTERVAL '2 days'),
('i3333333-2222-2222-2222-222222222222', 's2222222-2222-2222-2222-222222222222', 'd4234567-1234-1234-1234-123456789012', 'd2234567-1234-1234-1234-123456789012', 'accepted', 'Coffee and culture - perfect combo!', NOW() - INTERVAL '1 day'),
('i4444444-3333-3333-3333-333333333333', 's3333333-3333-3333-3333-333333333333', 'd1234567-1234-1234-1234-123456789012', 'd3234567-1234-1234-1234-123456789012', 'pending', 'Brooklyn adventure awaits!', NOW() - INTERVAL '5 hours')
ON CONFLICT (id) DO NOTHING;

-- Create demo conversations for messaging
INSERT INTO public.conversations (id, created_by, created_at) VALUES
('conv1111-1111-1111-1111-111111111111', 'd1234567-1234-1234-1234-123456789012', NOW() - INTERVAL '2 days'),
('conv2222-2222-2222-2222-222222222222', 'd2234567-1234-1234-1234-123456789012', NOW() - INTERVAL '1 day'),
('conv3333-3333-3333-3333-333333333333', 'd3234567-1234-1234-1234-123456789012', NOW() - INTERVAL '5 hours')
ON CONFLICT (id) DO NOTHING;

-- Create conversation participants
INSERT INTO public.conversation_participants (id, conversation_id, user_id, joined_at) VALUES
-- NYC Weekend conversation
('cp111111-1111-1111-1111-111111111111', 'conv1111-1111-1111-1111-111111111111', 'd1234567-1234-1234-1234-123456789012', NOW() - INTERVAL '2 days'),
('cp111222-1111-1111-1111-111111111111', 'conv1111-1111-1111-1111-111111111111', 'd2234567-1234-1234-1234-123456789012', NOW() - INTERVAL '2 days'),
('cp111333-1111-1111-1111-111111111111', 'conv1111-1111-1111-1111-111111111111', 'd3234567-1234-1234-1234-123456789012', NOW() - INTERVAL '1 day'),

-- Coffee & Culture conversation
('cp222111-2222-2222-2222-222222222222', 'conv2222-2222-2222-2222-222222222222', 'd2234567-1234-1234-1234-123456789012', NOW() - INTERVAL '1 day'),
('cp222222-2222-2222-2222-222222222222', 'conv2222-2222-2222-2222-222222222222', 'd4234567-1234-1234-1234-123456789012', NOW() - INTERVAL '1 day'),

-- Brooklyn conversation
('cp333111-3333-3333-3333-333333333333', 'conv3333-3333-3333-3333-333333333333', 'd3234567-1234-1234-1234-123456789012', NOW() - INTERVAL '5 hours'),
('cp333222-3333-3333-3333-333333333333', 'conv3333-3333-3333-3333-333333333333', 'd1234567-1234-1234-1234-123456789012', NOW() - INTERVAL '5 hours')
ON CONFLICT (id) DO NOTHING;

-- Create demo messages
INSERT INTO public.messages (id, conversation_id, sender_id, content, message_type, created_at) VALUES
-- NYC Weekend messages
('msg11111-1111-1111-1111-111111111111', 'conv1111-1111-1111-1111-111111111111', 'd1234567-1234-1234-1234-123456789012', 'Hey everyone! So excited for our NYC weekend! 🗽', 'text', NOW() - INTERVAL '2 days'),
('msg11222-1111-1111-1111-111111111111', 'conv1111-1111-1111-1111-111111111111', 'd2234567-1234-1234-1234-123456789012', 'This is going to be amazing! I love the Central Park idea 🌳', 'text', NOW() - INTERVAL '2 days' + INTERVAL '1 hour'),
('msg11333-1111-1111-1111-111111111111', 'conv1111-1111-1111-1111-111111111111', 'd3234567-1234-1234-1234-123456789012', 'Should we meet at the park entrance at 10am?', 'text', NOW() - INTERVAL '1 day'),
('msg11444-1111-1111-1111-111111111111', 'conv1111-1111-1111-1111-111111111111', 'd1234567-1234-1234-1234-123456789012', 'Perfect! See you all there ☀️', 'text', NOW() - INTERVAL '1 day' + INTERVAL '30 minutes'),

-- Coffee & Culture messages
('msg22111-2222-2222-2222-222222222222', 'conv2222-2222-2222-2222-222222222222', 'd2234567-1234-1234-1234-123456789012', 'Coffee at Blue Bottle then MoMA? Perfect day! ☕🎨', 'text', NOW() - INTERVAL '1 day'),
('msg22222-2222-2222-2222-222222222222', 'conv2222-2222-2222-2222-222222222222', 'd4234567-1234-1234-1234-123456789012', 'Love it! I heard they have a new exhibition', 'text', NOW() - INTERVAL '1 day' + INTERVAL '2 hours'),
('msg22333-2222-2222-2222-222222222222', 'conv2222-2222-2222-2222-222222222222', 'd2234567-1234-1234-1234-123456789012', 'Yes! The contemporary art section is incredible', 'text', NOW() - INTERVAL '20 hours'),

-- Brooklyn messages
('msg33111-3333-3333-3333-333333333333', 'conv3333-3333-3333-3333-333333333333', 'd3234567-1234-1234-1234-123456789012', 'Brooklyn Bridge walk anyone? 🌉', 'text', NOW() - INTERVAL '5 hours'),
('msg33222-3333-3333-3333-333333333333', 'conv3333-3333-3333-3333-333333333333', 'd1234567-1234-1234-1234-123456789012', 'Count me in! What time works for everyone?', 'text', NOW() - INTERVAL '4 hours')
ON CONFLICT (id) DO NOTHING;

-- Create saved experiences with scheduled dates (calendar entries)
INSERT INTO public.saves (experience_id, profile_id, status, scheduled_at, created_at) VALUES
-- Alice's saves
('e1111111-1111-1111-1111-111111111111', 'd1234567-1234-1234-1234-123456789012', 'scheduled', NOW() + INTERVAL '2 days' + INTERVAL '10 hours', NOW() - INTERVAL '2 days'),
('e2222222-2222-2222-2222-222222222222', 'd1234567-1234-1234-1234-123456789012', 'scheduled', NOW() + INTERVAL '2 days' + INTERVAL '14 hours', NOW() - INTERVAL '2 days'),
('e5555555-5555-5555-5555-555555555555', 'd1234567-1234-1234-1234-123456789012', 'scheduled', NOW() + INTERVAL '5 days' + INTERVAL '19 hours', NOW() - INTERVAL '1 day'),

-- Bob's saves
('e3333333-3333-3333-3333-333333333333', 'd2234567-1234-1234-1234-123456789012', 'scheduled', NOW() + INTERVAL '3 days' + INTERVAL '11 hours', NOW() - INTERVAL '1 day'),
('e2222222-2222-2222-2222-222222222222', 'd2234567-1234-1234-1234-123456789012', 'scheduled', NOW() + INTERVAL '3 days' + INTERVAL '15 hours', NOW() - INTERVAL '1 day'),

-- Carol's saves
('e4444444-4444-4444-4444-444444444444', 'd3234567-1234-1234-1234-123456789012', 'scheduled', NOW() + INTERVAL '1 day' + INTERVAL '9 hours', NOW() - INTERVAL '5 hours'),
('e1111111-1111-1111-1111-111111111111', 'd3234567-1234-1234-1234-123456789012', 'liked', NULL, NOW() - INTERVAL '3 hours'),

-- David's saves
('e5555555-5555-5555-5555-555555555555', 'd4234567-1234-1234-1234-123456789012', 'scheduled', NOW() + INTERVAL '7 days' + INTERVAL '20 hours', NOW() - INTERVAL '12 hours'),
('e3333333-3333-3333-3333-333333333333', 'd4234567-1234-1234-1234-123456789012', 'scheduled', NOW() + INTERVAL '4 days' + INTERVAL '13 hours', NOW() - INTERVAL '6 hours')
ON CONFLICT (experience_id, profile_id) DO NOTHING;