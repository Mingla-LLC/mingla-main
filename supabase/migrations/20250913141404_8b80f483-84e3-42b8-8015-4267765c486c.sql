-- Add missing category data to experiences table
INSERT INTO experiences (title, category, category_slug, price_min, price_max, duration_min, image_url) VALUES
-- Take a Stroll experiences
('Scenic Waterfront Walk', 'Take a Stroll', 'stroll', 0, 0, 60, 'https://images.unsplash.com/photo-1544966503-7cc5ac882d5b'),
('Historic Neighborhood Tour', 'Take a Stroll', 'stroll', 0, 5, 90, 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000'),
('Urban Nature Trail', 'Take a Stroll', 'stroll', 0, 10, 120, 'https://images.unsplash.com/photo-1551632811-561732d1e306'),

-- Creative & Hands-On experiences  
('Pottery Workshop', 'Creative & Hands-On', 'creative', 45, 75, 180, 'https://images.unsplash.com/photo-1578662996442-48f60103fc96'),
('Art Gallery Paint & Sip', 'Creative & Hands-On', 'creative', 35, 55, 120, 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b'),
('Cooking Class Experience', 'Creative & Hands-On', 'creative', 65, 95, 150, 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136'),
('Photography Workshop', 'Creative & Hands-On', 'creative', 40, 60, 180, 'https://images.unsplash.com/photo-1606983340126-99ab4feaa64a'),

-- Dining Experience  
('Fine Dining Restaurant', 'Dining Experience', 'dining', 85, 150, 120, 'https://images.unsplash.com/photo-1551632811-561732d1e306'),
('Wine Tasting Experience', 'Dining Experience', 'dining', 45, 75, 90, 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3'),
('Chefs Table Special', 'Dining Experience', 'dining', 120, 200, 180, 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0'),
('Rooftop Brunch', 'Dining Experience', 'dining', 35, 65, 90, 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4');