-- First, clean up any duplicate demo data to avoid conflicts
DELETE FROM public.saves WHERE profile_id IN (SELECT id FROM profiles WHERE username LIKE '%_demo');
DELETE FROM public.board_collaborators WHERE user_id IN (SELECT id FROM profiles WHERE username LIKE '%_demo');
DELETE FROM public.session_participants WHERE user_id IN (SELECT id FROM profiles WHERE username LIKE '%_demo');
DELETE FROM public.collaboration_invites WHERE invited_user_id IN (SELECT id FROM profiles WHERE username LIKE '%_demo');
DELETE FROM public.conversation_participants WHERE user_id IN (SELECT id FROM profiles WHERE username LIKE '%_demo');
DELETE FROM public.messages WHERE sender_id IN (SELECT id FROM profiles WHERE username LIKE '%_demo');
DELETE FROM public.conversations WHERE created_by IN (SELECT id FROM profiles WHERE username LIKE '%_demo');
DELETE FROM public.boards WHERE created_by IN (SELECT id FROM profiles WHERE username LIKE '%_demo');
DELETE FROM public.collaboration_sessions WHERE created_by IN (SELECT id FROM profiles WHERE username LIKE '%_demo');
DELETE FROM public.profiles WHERE username LIKE '%_demo';

-- Now create fresh demo data
-- Demo user profiles
INSERT INTO public.profiles (id, username, first_name, last_name, avatar_url) VALUES
('d1234567-1234-1234-1234-123456789012', 'alice_demo', 'Alice', 'Johnson', 'https://images.unsplash.com/photo-1494790108755-2616b612b194?w=150'),
('d2234567-1234-1234-1234-123456789012', 'bob_demo', 'Bob', 'Smith', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150'),
('d3234567-1234-1234-1234-123456789012', 'carol_demo', 'Carol', 'Davis', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150');

-- Create demo experiences with valid category slugs
INSERT INTO public.experiences (id, title, category, category_slug, lat, lng, price_min, price_max, duration_min, image_url, meta) VALUES
('e1111111-1111-1111-1111-111111111111', 'Central Park Walk', 'Stroll', 'stroll', 40.7829, -73.9654, 0, 0, 60, 'https://images.unsplash.com/photo-1566404791232-af9fe0ae8f8b?w=400', '{"description": "Peaceful walk through Central Park"}'),
('e2222222-2222-2222-2222-222222222222', 'Coffee & Art', 'Sip & Chill', 'sip', 40.7614, -73.9776, 5, 15, 45, 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400', '{"description": "Great coffee spot"}'),
('e3333333-3333-3333-3333-333333333333', 'Fine Dining', 'Dining', 'dining', 40.7614, -73.9776, 50, 100, 120, 'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=400', '{"description": "Amazing restaurant"}')
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title;

-- Create active demo collaboration session with current user
INSERT INTO public.collaboration_sessions (id, name, created_by, status, created_at) VALUES
('s1111111-1111-1111-1111-111111111111', 'Weekend Plans Demo', (SELECT auth.uid()), 'active', NOW() - INTERVAL '1 hour')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Create demo board for the session
INSERT INTO public.boards (id, name, description, created_by, session_id, is_public, created_at) VALUES
('b1111111-1111-1111-1111-111111111111', 'Weekend Plans Demo', 'Demo collaboration board', (SELECT auth.uid()), 's1111111-1111-1111-1111-111111111111', false, NOW() - INTERVAL '1 hour')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Update session with board ID
UPDATE public.collaboration_sessions SET board_id = 'b1111111-1111-1111-1111-111111111111' WHERE id = 's1111111-1111-1111-1111-111111111111';

-- Add current user and demo users as participants
INSERT INTO public.session_participants (id, session_id, user_id, has_accepted, joined_at) VALUES
('p1111111-1111-1111-1111-111111111111', 's1111111-1111-1111-1111-111111111111', (SELECT auth.uid()), true, NOW() - INTERVAL '1 hour'),
('p2222222-1111-1111-1111-111111111111', 's1111111-1111-1111-1111-111111111111', 'd1234567-1234-1234-1234-123456789012', true, NOW() - INTERVAL '1 hour'),
('p3333333-1111-1111-1111-111111111111', 's1111111-1111-1111-1111-111111111111', 'd2234567-1234-1234-1234-123456789012', true, NOW() - INTERVAL '45 minutes')
ON CONFLICT (id) DO NOTHING;

-- Add board collaborators
INSERT INTO public.board_collaborators (id, board_id, user_id, role) VALUES
('c1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', (SELECT auth.uid()), 'owner'),
('c2222222-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'd1234567-1234-1234-1234-123456789012', 'collaborator'),
('c3333333-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'd2234567-1234-1234-1234-123456789012', 'collaborator')
ON CONFLICT (id) DO NOTHING;

-- Create demo conversation
INSERT INTO public.conversations (id, created_by, created_at) VALUES
('conv1111-1111-1111-1111-111111111111', (SELECT auth.uid()), NOW() - INTERVAL '1 hour')
ON CONFLICT (id) DO NOTHING;

-- Add conversation participants
INSERT INTO public.conversation_participants (id, conversation_id, user_id, joined_at) VALUES
('cp111111-1111-1111-1111-111111111111', 'conv1111-1111-1111-1111-111111111111', (SELECT auth.uid()), NOW() - INTERVAL '1 hour'),
('cp222222-1111-1111-1111-111111111111', 'conv1111-1111-1111-1111-111111111111', 'd1234567-1234-1234-1234-123456789012', NOW() - INTERVAL '1 hour'),
('cp333333-1111-1111-1111-111111111111', 'conv1111-1111-1111-1111-111111111111', 'd2234567-1234-1234-1234-123456789012', NOW() - INTERVAL '45 minutes')
ON CONFLICT (id) DO NOTHING;

-- Create demo messages
INSERT INTO public.messages (id, conversation_id, sender_id, content, message_type, created_at) VALUES
('msg11111-1111-1111-1111-111111111111', 'conv1111-1111-1111-1111-111111111111', (SELECT auth.uid()), 'Hey team! Ready for our weekend plans? 🎉', 'text', NOW() - INTERVAL '1 hour'),
('msg22222-1111-1111-1111-111111111111', 'conv1111-1111-1111-1111-111111111111', 'd1234567-1234-1234-1234-123456789012', 'Absolutely! The Central Park walk looks perfect 🌳', 'text', NOW() - INTERVAL '50 minutes'),
('msg33333-1111-1111-1111-111111111111', 'conv1111-1111-1111-1111-111111111111', 'd2234567-1234-1234-1234-123456789012', 'And the coffee spot is one of my favorites! ☕', 'text', NOW() - INTERVAL '40 minutes')
ON CONFLICT (id) DO NOTHING;

-- Create saved experiences with scheduled dates (calendar entries) for current user
INSERT INTO public.saves (experience_id, profile_id, status, scheduled_at, created_at) VALUES
('e1111111-1111-1111-1111-111111111111', (SELECT auth.uid()), 'scheduled', NOW() + INTERVAL '2 days' + INTERVAL '10 hours', NOW() - INTERVAL '1 hour'),
('e2222222-2222-2222-2222-222222222222', (SELECT auth.uid()), 'scheduled', NOW() + INTERVAL '2 days' + INTERVAL '14 hours', NOW() - INTERVAL '1 hour'),
('e3333333-3333-3333-3333-333333333333', (SELECT auth.uid()), 'scheduled', NOW() + INTERVAL '5 days' + INTERVAL '19 hours', NOW() - INTERVAL '30 minutes')
ON CONFLICT (experience_id, profile_id) DO NOTHING;