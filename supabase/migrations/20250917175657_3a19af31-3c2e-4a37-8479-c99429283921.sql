-- Insert mock users/profiles for boards (using proper UUIDs)
INSERT INTO public.profiles (id, username, first_name, last_name, avatar_url) VALUES
('a1234567-8901-2345-6789-012345678901', 'sarah_explorer', 'Sarah', 'Johnson', 'https://images.unsplash.com/photo-1494790108755-2616b612b547?w=100'),
('a2345678-9012-3456-7890-123456789012', 'mike_adventures', 'Mike', 'Chen', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100'),
('a3456789-0123-4567-8901-234567890123', 'emma_foodie', 'Emma', 'Davis', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100'),
('a4567890-1234-5678-9012-345678901234', 'alex_culture', 'Alex', 'Rodriguez', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100'),
('a5678901-2345-6789-0123-456789012345', 'lisa_nature', 'Lisa', 'Wilson', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100')
ON CONFLICT (id) DO UPDATE SET 
  username = EXCLUDED.username,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  avatar_url = EXCLUDED.avatar_url;

-- Insert mock boards  
INSERT INTO public.boards (id, name, description, created_by, is_public, created_at, updated_at) VALUES
('b1234567-8901-2345-6789-012345678901', 'NYC Weekend Adventures', 'Exploring the best spots in Manhattan with friends', 'a1234567-8901-2345-6789-012345678901', false, '2025-09-10 14:30:00', '2025-09-16 16:45:00'),
('b2345678-9012-3456-7890-123456789012', 'Brooklyn Food Tour', 'Discovering amazing eats across Brooklyn boroughs', 'a2345678-9012-3456-7890-123456789012', false, '2025-09-12 10:15:00', '2025-09-17 09:20:00'),
('b3456789-0123-4567-8901-234567890123', 'Art & Culture Crawl', 'Museums, galleries and creative spaces in the city', 'a3456789-0123-4567-8901-234567890123', true, '2025-09-08 11:00:00', '2025-09-15 13:30:00'),
('b4567890-1234-5678-9012-345678901234', 'Central Park & Chill', 'Relaxed outdoor activities and cafe hopping', 'a4567890-1234-5678-9012-345678901234', false, '2025-09-14 16:20:00', '2025-09-17 08:15:00')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = EXCLUDED.updated_at;

-- Insert board collaborators
INSERT INTO public.board_collaborators (board_id, user_id, role) VALUES
-- NYC Weekend Adventures collaborators
('b1234567-8901-2345-6789-012345678901', 'a1234567-8901-2345-6789-012345678901', 'owner'),
('b1234567-8901-2345-6789-012345678901', 'a2345678-9012-3456-7890-123456789012', 'collaborator'),
('b1234567-8901-2345-6789-012345678901', 'a3456789-0123-4567-8901-234567890123', 'collaborator'),
-- Brooklyn Food Tour collaborators  
('b2345678-9012-3456-7890-123456789012', 'a2345678-9012-3456-7890-123456789012', 'owner'),
('b2345678-9012-3456-7890-123456789012', 'a4567890-1234-5678-9012-345678901234', 'collaborator'),
('b2345678-9012-3456-7890-123456789012', 'a5678901-2345-6789-0123-456789012345', 'collaborator'),
-- Art & Culture Crawl collaborators
('b3456789-0123-4567-8901-234567890123', 'a3456789-0123-4567-8901-234567890123', 'owner'),
('b3456789-0123-4567-8901-234567890123', 'a1234567-8901-2345-6789-012345678901', 'collaborator'),
-- Central Park & Chill collaborators
('b4567890-1234-5678-9012-345678901234', 'a4567890-1234-5678-9012-345678901234', 'owner'),
('b4567890-1234-5678-9012-345678901234', 'a5678901-2345-6789-0123-456789012345', 'collaborator')
ON CONFLICT (board_id, user_id) DO UPDATE SET role = EXCLUDED.role;

-- Insert mock saves with scheduled dates (1 per week for calendar) 
-- Using the first mock user for the saves so they appear in the demo
INSERT INTO public.saves (profile_id, experience_id, status, scheduled_at, created_at) VALUES
-- Week 1: September 23, 2025 (Monday)
('a1234567-8901-2345-6789-012345678901', 'e1234567-1234-1234-1234-123456789abc', 'scheduled', '2025-09-23 14:00:00', '2025-09-17 10:00:00'),
-- Week 2: September 30, 2025 (Tuesday) 
('a1234567-8901-2345-6789-012345678901', 'e2234567-1234-1234-1234-123456789abc', 'scheduled', '2025-09-30 16:30:00', '2025-09-17 10:15:00'),
-- Week 3: October 7, 2025 (Wednesday)
('a1234567-8901-2345-6789-012345678901', 'e3234567-1234-1234-1234-123456789abc', 'scheduled', '2025-10-07 18:00:00', '2025-09-17 10:30:00'),
-- Week 4: October 14, 2025 (Thursday)
('a1234567-8901-2345-6789-012345678901', 'e1234567-1234-1234-1234-123456789abc', 'scheduled', '2025-10-14 15:30:00', '2025-09-17 10:45:00'),
-- Week 5: October 21, 2025 (Friday)
('a1234567-8901-2345-6789-012345678901', 'e2234567-1234-1234-1234-123456789abc', 'scheduled', '2025-10-21 17:00:00', '2025-09-17 11:00:00'),
-- Week 6: October 28, 2025 (Saturday)  
('a1234567-8901-2345-6789-012345678901', 'e3234567-1234-1234-1234-123456789abc', 'scheduled', '2025-10-28 13:00:00', '2025-09-17 11:15:00')
ON CONFLICT (profile_id, experience_id) DO UPDATE SET 
  status = EXCLUDED.status,
  scheduled_at = EXCLUDED.scheduled_at;