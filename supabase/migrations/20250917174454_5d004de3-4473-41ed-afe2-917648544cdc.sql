-- Create simple demo experiences and saved dates for calendar
INSERT INTO public.experiences (id, title, category, category_slug, lat, lng, price_min, price_max, duration_min, image_url, meta) VALUES
('edemo111-1111-1111-1111-111111111111', 'Central Park Morning Walk', 'Stroll', 'stroll', 40.7829, -73.9654, 0, 0, 60, 'https://images.unsplash.com/photo-1566404791232-af9fe0ae8f8b?w=400', '{"description": "Peaceful morning walk"}'),
('edemo222-2222-2222-2222-222222222222', 'Artisan Coffee Experience', 'Sip & Chill', 'sip', 40.7614, -73.9776, 8, 15, 45, 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400', '{"description": "Premium coffee"}'),
('edemo333-3333-3333-3333-333333333333', 'Brooklyn Food Tour', 'Dining', 'dining', 40.7061, -73.9969, 35, 65, 120, 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400', '{"description": "Best food spots"}')
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title;