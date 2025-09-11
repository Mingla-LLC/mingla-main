-- Insert sample experiences (safe mock data)
INSERT INTO public.experiences (title, category, place_id, lat, lng, price_min, price_max, duration_min, image_url, opening_hours, meta) VALUES
  -- Stroll
  ('Central Park Walk', 'Stroll', 'park_001', 40.7829, -73.9654, 0, 0, 60, 'https://images.unsplash.com/photo-1566073771259-6a8506099945', '{"monday": "06:00-22:00", "tuesday": "06:00-22:00", "wednesday": "06:00-22:00", "thursday": "06:00-22:00", "friday": "06:00-22:00", "saturday": "06:00-22:00", "sunday": "06:00-22:00"}', '{"rating": 4.7, "reviews": 12500}'),
  ('Riverside Promenade', 'Stroll', 'walk_002', 40.7505, -73.9934, 0, 0, 45, 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000', '{"monday": "24/7", "tuesday": "24/7", "wednesday": "24/7", "thursday": "24/7", "friday": "24/7", "saturday": "24/7", "sunday": "24/7"}', '{"rating": 4.3, "reviews": 890}'),
  
  -- Sip & Chill
  ('Blue Bottle Coffee', 'Sip & Chill', 'cafe_001', 40.7614, -73.9776, 5, 15, 90, 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb', '{"monday": "07:00-19:00", "tuesday": "07:00-19:00", "wednesday": "07:00-19:00", "thursday": "07:00-19:00", "friday": "07:00-20:00", "saturday": "08:00-20:00", "sunday": "08:00-19:00"}', '{"rating": 4.4, "reviews": 2340}'),
  ('Rooftop Bar Views', 'Sip & Chill', 'bar_001', 40.7505, -73.9857, 12, 25, 120, 'https://images.unsplash.com/photo-1514933651103-005eec06c04b', '{"monday": "17:00-01:00", "tuesday": "17:00-01:00", "wednesday": "17:00-01:00", "thursday": "17:00-02:00", "friday": "17:00-02:00", "saturday": "17:00-02:00", "sunday": "17:00-24:00"}', '{"rating": 4.6, "reviews": 1560}'),
  
  -- Casual Eats
  ('Corner Bistro', 'Casual Eats', 'restaurant_001', 40.7357, -74.0036, 15, 35, 75, 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4', '{"monday": "11:00-22:00", "tuesday": "11:00-22:00", "wednesday": "11:00-22:00", "thursday": "11:00-22:00", "friday": "11:00-23:00", "saturday": "11:00-23:00", "sunday": "11:00-21:00"}', '{"rating": 4.2, "reviews": 980}'),
  ('Food Truck Plaza', 'Casual Eats', 'food_001', 40.7549, -73.9840, 8, 18, 30, 'https://images.unsplash.com/photo-1565299624946-b28f40a0ca4b', '{"monday": "11:00-21:00", "tuesday": "11:00-21:00", "wednesday": "11:00-21:00", "thursday": "11:00-21:00", "friday": "11:00-22:00", "saturday": "11:00-22:00", "sunday": "12:00-20:00"}', '{"rating": 4.0, "reviews": 456}'),
  
  -- Screen & Relax
  ('AMC Theater', 'Screen & Relax', 'cinema_001', 40.7580, -73.9855, 12, 18, 150, 'https://images.unsplash.com/photo-1489185078525-20980c5859d8', '{"monday": "10:00-23:00", "tuesday": "10:00-23:00", "wednesday": "10:00-23:00", "thursday": "10:00-23:00", "friday": "10:00-24:00", "saturday": "10:00-24:00", "sunday": "10:00-22:00"}', '{"rating": 4.1, "reviews": 3200}'),
  
  -- Creative
  ('Modern Art Gallery', 'Creative', 'gallery_001', 40.7614, -73.9776, 20, 25, 90, 'https://images.unsplash.com/photo-1544967882-6abcd0847e50', '{"monday": "10:00-18:00", "tuesday": "10:00-18:00", "wednesday": "10:00-18:00", "thursday": "10:00-20:00", "friday": "10:00-20:00", "saturday": "10:00-20:00", "sunday": "10:00-18:00"}', '{"rating": 4.5, "reviews": 1890}'),
  ('Interactive Museum', 'Creative', 'museum_001', 40.7829, -73.9654, 15, 30, 120, 'https://images.unsplash.com/photo-1578662996442-48f60103fc96', '{"monday": "09:00-17:00", "tuesday": "09:00-17:00", "wednesday": "09:00-17:00", "thursday": "09:00-20:00", "friday": "09:00-20:00", "saturday": "09:00-20:00", "sunday": "09:00-17:00"}', '{"rating": 4.3, "reviews": 2760}'),
  
  -- Play & Move
  ('Bowling Alley', 'Play & Move', 'bowling_001', 40.7505, -73.9934, 20, 40, 120, 'https://images.unsplash.com/photo-1578662996442-48f60103fc96', '{"monday": "12:00-24:00", "tuesday": "12:00-24:00", "wednesday": "12:00-24:00", "thursday": "12:00-02:00", "friday": "12:00-02:00", "saturday": "10:00-02:00", "sunday": "10:00-24:00"}', '{"rating": 4.2, "reviews": 1340}'),
  ('Fitness Studio', 'Play & Move', 'gym_001', 40.7357, -74.0036, 25, 35, 60, 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b', '{"monday": "06:00-22:00", "tuesday": "06:00-22:00", "wednesday": "06:00-22:00", "thursday": "06:00-22:00", "friday": "06:00-21:00", "saturday": "08:00-20:00", "sunday": "08:00-20:00"}', '{"rating": 4.4, "reviews": 890}'),
  
  -- Dining experience
  ('Fine Dining Restaurant', 'Dining experience', 'fine_dining_001', 40.7549, -73.9840, 60, 120, 120, 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0', '{"monday": "17:00-22:00", "tuesday": "17:00-22:00", "wednesday": "17:00-22:00", "thursday": "17:00-22:00", "friday": "17:00-23:00", "saturday": "17:00-23:00", "sunday": "17:00-21:00"}', '{"rating": 4.7, "reviews": 2890}'),
  
  -- Freestyle
  ('Pop-up Market', 'Freestyle', 'market_001', 40.7580, -73.9855, 0, 50, 90, 'https://images.unsplash.com/photo-1441986300917-64674bd600d8', '{"monday": "closed", "tuesday": "closed", "wednesday": "10:00-18:00", "thursday": "10:00-18:00", "friday": "10:00-20:00", "saturday": "09:00-20:00", "sunday": "10:00-18:00"}', '{"rating": 4.3, "reviews": 670}');