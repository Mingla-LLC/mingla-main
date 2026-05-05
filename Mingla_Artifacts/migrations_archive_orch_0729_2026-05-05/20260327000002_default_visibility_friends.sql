-- Update existing user_map_settings rows from 'off' to 'friends'
-- to match the intended default. New rows already default to 'friends'.
UPDATE public.user_map_settings SET visibility_level = 'friends' WHERE visibility_level = 'off';
