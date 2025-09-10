-- Add user preference columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN currency TEXT DEFAULT 'USD',
ADD COLUMN measurement_system TEXT DEFAULT 'metric';