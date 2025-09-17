-- Create demo data for current user without conflicts

-- Create demo experiences for the user to see
INSERT INTO public.experiences (id, title, category, category_slug, lat, lng, price_min, price_max, duration_min, image_url, meta) VALUES
('edemo111-1111-1111-1111-111111111111', 'Central Park Morning Walk', 'Stroll', 'stroll', 40.7829, -73.9654, 0, 0, 60, 'https://images.unsplash.com/photo-1566404791232-af9fe0ae8f8b?w=400', '{"description": "Peaceful morning walk through Central Park"}'),
('edemo222-2222-2222-2222-222222222222', 'Artisan Coffee Experience', 'Sip & Chill', 'sip', 40.7614, -73.9776, 8, 15, 45, 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400', '{"description": "Premium coffee tasting experience"}'),
('edemo333-3333-3333-3333-333333333333', 'Brooklyn Food Tour', 'Dining', 'dining', 40.7061, -73.9969, 35, 65, 120, 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400', '{"description": "Explore Brooklyn\'s best food spots"}'),
('edemo444-4444-4444-4444-444444444444', 'Weekend Gaming', 'Play & Move', 'play_move', 40.7505, -73.9934, 20, 40, 180, 'https://images.unsplash.com/photo-1556075798-4825dfaaf498?w=400', '{"description": "Fun gaming session with friends"}'),
('edemo555-5555-5555-5555-555555555555', 'Movie Night', 'Screen & Relax', 'screen_relax', 40.7614, -73.9776, 15, 25, 150, 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=400', '{"description": "Cozy movie night at local cinema"}')
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title;

-- Create saved experiences with scheduled dates for the current user's calendar
INSERT INTO public.saves (experience_id, profile_id, status, scheduled_at, created_at) VALUES
('edemo111-1111-1111-1111-111111111111', (SELECT auth.uid()), 'scheduled', DATE_TRUNC('hour', NOW() + INTERVAL '2 days') + INTERVAL '10 hours', NOW()),
('edemo222-2222-2222-2222-222222222222', (SELECT auth.uid()), 'scheduled', DATE_TRUNC('hour', NOW() + INTERVAL '2 days') + INTERVAL '14 hours', NOW()),
('edemo333-3333-3333-3333-333333333333', (SELECT auth.uid()), 'scheduled', DATE_TRUNC('hour', NOW() + INTERVAL '5 days') + INTERVAL '18 hours', NOW()),
('edemo444-4444-4444-4444-444444444444', (SELECT auth.uid()), 'scheduled', DATE_TRUNC('hour', NOW() + INTERVAL '3 days') + INTERVAL '16 hours', NOW()),
('edemo555-5555-5555-5555-555555555555', (SELECT auth.uid()), 'liked', NULL, NOW())
ON CONFLICT (experience_id, profile_id) DO UPDATE SET status = EXCLUDED.status, scheduled_at = EXCLUDED.scheduled_at;