-- Insert mock users/profiles for boards
INSERT INTO public.profiles (id, username, first_name, last_name, avatar_url) VALUES
('u1111111-1111-1111-1111-111111111111', 'sarah_explorer', 'Sarah', 'Johnson', 'https://images.unsplash.com/photo-1494790108755-2616b612b547?w=100'),
('u2222222-2222-2222-2222-222222222222', 'mike_adventures', 'Mike', 'Chen', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100'),
('u3333333-3333-3333-3333-333333333333', 'emma_foodie', 'Emma', 'Davis', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100'),
('u4444444-4444-4444-4444-444444444444', 'alex_culture', 'Alex', 'Rodriguez', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100'),
('u5555555-5555-5555-5555-555555555555', 'lisa_nature', 'Lisa', 'Wilson', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100')
ON CONFLICT (id) DO UPDATE SET 
  username = EXCLUDED.username,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  avatar_url = EXCLUDED.avatar_url;

-- Insert mock boards
INSERT INTO public.boards (id, name, description, created_by, is_public, created_at, updated_at) VALUES
('b1111111-1111-1111-1111-111111111111', 'NYC Weekend Adventures', 'Exploring the best spots in Manhattan with friends', 'u1111111-1111-1111-1111-111111111111', false, '2025-09-10 14:30:00', '2025-09-16 16:45:00'),
('b2222222-2222-2222-2222-222222222222', 'Brooklyn Food Tour', 'Discovering amazing eats across Brooklyn boroughs', 'u2222222-2222-2222-2222-222222222222', false, '2025-09-12 10:15:00', '2025-09-17 09:20:00'),
('b3333333-3333-3333-3333-333333333333', 'Art & Culture Crawl', 'Museums, galleries and creative spaces in the city', 'u3333333-3333-3333-3333-333333333333', true, '2025-09-08 11:00:00', '2025-09-15 13:30:00'),
('b4444444-4444-4444-4444-444444444444', 'Central Park & Chill', 'Relaxed outdoor activities and cafe hopping', 'u4444444-4444-4444-4444-444444444444', false, '2025-09-14 16:20:00', '2025-09-17 08:15:00')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = EXCLUDED.updated_at;

-- Insert board collaborators
INSERT INTO public.board_collaborators (board_id, user_id, role) VALUES
-- NYC Weekend Adventures collaborators
('b1111111-1111-1111-1111-111111111111', 'u1111111-1111-1111-1111-111111111111', 'owner'),
('b1111111-1111-1111-1111-111111111111', 'u2222222-2222-2222-2222-222222222222', 'collaborator'),
('b1111111-1111-1111-1111-111111111111', 'u3333333-3333-3333-3333-333333333333', 'collaborator'),
-- Brooklyn Food Tour collaborators  
('b2222222-2222-2222-2222-222222222222', 'u2222222-2222-2222-2222-222222222222', 'owner'),
('b2222222-2222-2222-2222-222222222222', 'u4444444-4444-4444-4444-444444444444', 'collaborator'),
('b2222222-2222-2222-2222-222222222222', 'u5555555-5555-5555-5555-555555555555', 'collaborator'),
-- Art & Culture Crawl collaborators
('b3333333-3333-3333-3333-333333333333', 'u3333333-3333-3333-3333-333333333333', 'owner'),
('b3333333-3333-3333-3333-333333333333', 'u1111111-1111-1111-1111-111111111111', 'collaborator'),
-- Central Park & Chill collaborators
('b4444444-4444-4444-4444-444444444444', 'u4444444-4444-4444-4444-444444444444', 'owner'),
('b4444444-4444-4444-4444-444444444444', 'u5555555-5555-5555-5555-555555555555', 'collaborator')
ON CONFLICT (board_id, user_id) DO UPDATE SET role = EXCLUDED.role;

-- Insert mock saves with scheduled dates (1 per week for calendar)
-- Using the current user (first profile) for the saves
INSERT INTO public.saves (profile_id, experience_id, status, scheduled_at, created_at) VALUES
-- Week 1: September 23, 2025 (Monday)
('u1111111-1111-1111-1111-111111111111', 'e1234567-1234-1234-1234-123456789abc', 'scheduled', '2025-09-23 14:00:00', '2025-09-17 10:00:00'),
-- Week 2: September 30, 2025 (Tuesday) 
('u1111111-1111-1111-1111-111111111111', 'e2234567-1234-1234-1234-123456789abc', 'scheduled', '2025-09-30 16:30:00', '2025-09-17 10:15:00'),
-- Week 3: October 7, 2025 (Wednesday)
('u1111111-1111-1111-1111-111111111111', 'e3234567-1234-1234-1234-123456789abc', 'scheduled', '2025-10-07 18:00:00', '2025-09-17 10:30:00'),
-- Week 4: October 14, 2025 (Thursday)
('u1111111-1111-1111-1111-111111111111', 'e1234567-1234-1234-1234-123456789abc', 'scheduled', '2025-10-14 15:30:00', '2025-09-17 10:45:00'),
-- Week 5: October 21, 2025 (Friday)
('u1111111-1111-1111-1111-111111111111', 'e2234567-1234-1234-1234-123456789abc', 'scheduled', '2025-10-21 17:00:00', '2025-09-17 11:00:00'),
-- Week 6: October 28, 2025 (Saturday)  
('u1111111-1111-1111-1111-111111111111', 'e3234567-1234-1234-1234-123456789abc', 'scheduled', '2025-10-28 13:00:00', '2025-09-17 11:15:00')
ON CONFLICT (profile_id, experience_id) DO UPDATE SET 
  status = EXCLUDED.status,
  scheduled_at = EXCLUDED.scheduled_at;