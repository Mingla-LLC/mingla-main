-- Insert mock experiences for demo with correct category slugs  
INSERT INTO experiences (id, title, category, category_slug, lat, lng, price_min, price_max, duration_min, image_url, place_id) VALUES 
(gen_random_uuid(), 'Central Park Walking Tour', 'Stroll', 'stroll', 40.7829, -73.9654, 0, 25, 120, 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400', 'central_park_ny'),
(gen_random_uuid(), 'Brooklyn Bridge Experience', 'Stroll', 'stroll', 40.7061, -73.9969, 0, 0, 90, 'https://images.unsplash.com/photo-1504893524553-b855bce32c67?w=400', 'brooklyn_bridge'),
(gen_random_uuid(), 'Coffee Shop Discovery', 'Sip & Chill', 'sip', 40.7480, -73.9857, 5, 15, 60, 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=400', 'coffee_shop_ny'),
(gen_random_uuid(), 'Art Museum Visit', 'Creative & Hands-On', 'creative', 40.7794, -73.9632, 15, 30, 180, 'https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=400', 'met_museum'),
(gen_random_uuid(), 'Local Food Market', 'Casual Eats', 'casual_eats', 40.7505, -73.9934, 10, 40, 75, 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400', 'chelsea_market'),
(gen_random_uuid(), 'Rooftop Bar Experience', 'Sip & Chill', 'sip', 40.7505, -73.9857, 20, 60, 120, 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400', 'rooftop_bar_ny'),
(gen_random_uuid(), 'Live Music Venue', 'Screen & Relax', 'screen_relax', 40.7282, -74.0776, 25, 50, 150, 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400', 'music_venue_ny'),
(gen_random_uuid(), 'Scenic River Walk', 'Stroll', 'stroll', 40.7589, -73.9851, 0, 0, 45, 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=400', 'hudson_river_park');