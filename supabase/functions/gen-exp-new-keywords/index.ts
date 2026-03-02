import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Environment variables
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

// Category to Google Places type mapping
// Maps category IDs from preferences sheets to Google Places API types
// All keys are lowercase to support case-insensitive lookups
// Includes multiple format variations for each category
const CATEGORY_MAPPINGS: { [key: string]: string[] } = {
  // Sip & Chill variations
  "sip & chill": [
    "bar",
    "bar_and_grill",
    "pub",
    "wine_bar",
    "tea_house",
    "coffee_shop",
    "juice_shop",
  ],
  sip_and_chill: [
    "bar",
    "bar_and_grill",
    "pub",
    "wine_bar",
    "tea_house",
    "coffee_shop",
    "juice_shop",
  ],
  "sip-and-chill": [
    "bar",
    "bar_and_grill",
    "pub",
    "wine_bar",
    "tea_house",
    "coffee_shop",
    "juice_shop",
  ],
  "sip&chill": [
    "bar",
    "bar_and_grill",
    "pub",
    "wine_bar",
    "tea_house",
    "coffee_shop",
    "juice_shop",
  ],
  "sip_&_chill": [
    "bar",
    "bar_and_grill",
    "pub",
    "wine_bar",
    "tea_house",
    "coffee_shop",
    "juice_shop",
  ],
  "sip-&-chill": [
    "bar",
    "bar_and_grill",
    "pub",
    "wine_bar",
    "tea_house",
    "coffee_shop",
    "juice_shop",
  ],
  sipchill: [
    "bar",
    "bar_and_grill",
    "pub",
    "wine_bar",
    "tea_house",
    "coffee_shop",
    "juice_shop",
  ],
  // Stroll variations
  stroll: [
    "park",
    "garden",
    "plaza",
    "tourist_attraction",
    "botanical_garden",
    "hiking_area",
    "national_park",
    "state_park",
    "beach",
    "visitor_center",
    "observation_deck",
    "historical_landmark",
    "cultural_landmark",
    "historical_place",
    "monument",
    "museum",
    "zoo",
    "wildlife_park",
    "wildlife_refuge",
  ],
  "take a stroll": [
    "park",
    "garden",
    "plaza",
    "tourist_attraction",
    "botanical_garden",
    "hiking_area",
    "national_park",
    "state_park",
    "beach",
    "visitor_center",
    "observation_deck",
    "historical_landmark",
    "cultural_landmark",
    "historical_place",
    "monument",
    "museum",
    "zoo",
    "wildlife_park",
    "wildlife_refuge",
  ],
  "take-a-stroll": [
    "park",
    "garden",
    "plaza",
    "tourist_attraction",
    "botanical_garden",
    "hiking_area",
    "national_park",
    "state_park",
    "beach",
    "visitor_center",
    "observation_deck",
    "historical_landmark",
    "cultural_landmark",
    "historical_place",
    "monument",
    "museum",
    "zoo",
    "wildlife_park",
    "wildlife_refuge",
  ],
  take_a_stroll: [
    "park",
    "garden",
    "plaza",
    "tourist_attraction",
    "botanical_garden",
    "hiking_area",
    "national_park",
    "state_park",
    "beach",
    "visitor_center",
    "observation_deck",
    "historical_landmark",
    "cultural_landmark",
    "historical_place",
    "monument",
    "museum",
    "zoo",
    "wildlife_park",
    "wildlife_refuge",
  ],
  // Dining Experiences variations
  "dining experiences": [
    "fine_dining_restaurant",
    "steak_house",
    "sushi_restaurant",
    "buffet_restaurant",
  ],
  dining_experiences: [
    "fine_dining_restaurant",
    "steak_house",
    "sushi_restaurant",
    "buffet_restaurant",
  ],
  "dining-experiences": [
    "fine_dining_restaurant",
    "steak_house",
    "sushi_restaurant",
    "buffet_restaurant",
  ],
  dining: [
    "fine_dining_restaurant",
    "steak_house",
    "sushi_restaurant",
    "buffet_restaurant",
  ],
  // Screen & Relax variations
  "screen & relax": [
    "movie_theater",
    "performing_arts_theater",
    "opera_house",
    "comedy_club",
    "video_arcade",
  ],
  screen_relax: [
    "movie_theater",
    "performing_arts_theater",
    "opera_house",
    "comedy_club",
    "video_arcade",
  ],
  "screen-relax": [
    "movie_theater",
    "performing_arts_theater",
    "opera_house",
    "comedy_club",
    "video_arcade",
  ],
  screenrelax: [
    "movie_theater",
    "performing_arts_theater",
    "opera_house",
    "comedy_club",
    "video_arcade",
  ],
  screenRelax: [
    "movie_theater",
    "performing_arts_theater",
    "opera_house",
    "comedy_club",
    "video_arcade",
  ],
  // Creative & Hands-On variations
  "creative & hands-on": [
    "art_gallery",
    "art_studio",
    "museum",
    "planetarium",
    "cultural_center",
    "community_center",
    "karaoke",
  ],
  creative_and_hands_on: [
    "art_gallery",
    "art_studio",
    "museum",
    "planetarium",
    "cultural_center",
    "community_center",
    "karaoke",
  ],
  "creative-hands-on": [
    "art_gallery",
    "art_studio",
    "museum",
    "planetarium",
    "cultural_center",
    "community_center",
    "karaoke",
  ],
  "creative & hands on": [
    "art_gallery",
    "art_studio",
    "museum",
    "planetarium",
    "cultural_center",
    "community_center",
    "karaoke",
  ],

  creative: [
    "art_gallery",
    "art_studio",
    "museum",
    "planetarium",
    "cultural_center",
    "community_center",
    "karaoke",
  ],
  // Play & Move variations
  "play & move": [
    "bowling_alley",
    "amusement_park",
    "water_park",
    "skateboard_park",
    "planetarium",
    "video_arcade",
    "karaoke",
    "comedy_club",
    "casino",
    "roller_coaster",
    "ferris_wheel",
  ],
  play_and_move: [
    "bowling_alley",
    "amusement_park",
    "water_park",
    "skateboard_park",
    "planetarium",
    "video_arcade",
    "karaoke",
    "comedy_club",
    "casino",
    "roller_coaster",
    "ferris_wheel",
  ],
  "play-move": [
    "bowling_alley",
    "amusement_park",
    "water_park",
    "skateboard_park",
    "planetarium",
    "video_arcade",
    "karaoke",
    "comedy_club",
    "casino",
    "roller_coaster",
    "ferris_wheel",
  ],
  // Casual Eats variations
  "casual eats": [
    "afghani_restaurant",
    "african_restaurant",
    "american_restaurant",
    "asian_restaurant",
    "barbecue_restaurant",
    "brazilian_restaurant",
    "breakfast_restaurant",
    "brunch_restaurant",
    "buffet_restaurant",
    "chinese_restaurant",
    "diner",
    "fast_food_restaurant",
    "food_court",
    "french_restaurant",
    "greek_restaurant",
    "hamburger_restaurant",
    "indian_restaurant",
    "indonesian_restaurant",
    "italian_restaurant",
    "japanese_restaurant",
    "korean_restaurant",
    "lebanese_restaurant",
    "mediterranean_restaurant",
    "mexican_restaurant",
    "middle_eastern_restaurant",
    "pizza_restaurant",
    "ramen_restaurant",
    "restaurant",
    "sandwich_shop",
    "seafood_restaurant",
    "spanish_restaurant",
    "thai_restaurant",
    "turkish_restaurant",
    "vegan_restaurant",
    "vegetarian_restaurant",
    "vietnamese_restaurant",
  ],
  casual_eats: [
    "afghani_restaurant",
    "african_restaurant",
    "american_restaurant",
    "asian_restaurant",
    "barbecue_restaurant",
    "brazilian_restaurant",
    "breakfast_restaurant",
    "brunch_restaurant",
    "buffet_restaurant",
    "chinese_restaurant",
    "diner",
    "fast_food_restaurant",
    "food_court",
    "french_restaurant",
    "greek_restaurant",
    "hamburger_restaurant",
    "indian_restaurant",
    "indonesian_restaurant",
    "italian_restaurant",
    "japanese_restaurant",
    "korean_restaurant",
    "lebanese_restaurant",
    "mediterranean_restaurant",
    "mexican_restaurant",
    "middle_eastern_restaurant",
    "pizza_restaurant",
    "ramen_restaurant",
    "restaurant",
    "sandwich_shop",
    "seafood_restaurant",
    "spanish_restaurant",
    "thai_restaurant",
    "turkish_restaurant",
    "vegan_restaurant",
    "vegetarian_restaurant",
    "vietnamese_restaurant",
  ],
  "casual-eats": [
    "afghani_restaurant",
    "african_restaurant",
    "american_restaurant",
    "asian_restaurant",
    "barbecue_restaurant",
    "brazilian_restaurant",
    "breakfast_restaurant",
    "brunch_restaurant",
    "buffet_restaurant",
    "chinese_restaurant",
    "diner",
    "fast_food_restaurant",
    "food_court",
    "french_restaurant",
    "greek_restaurant",
    "hamburger_restaurant",
    "indian_restaurant",
    "indonesian_restaurant",
    "italian_restaurant",
    "japanese_restaurant",
    "korean_restaurant",
    "lebanese_restaurant",
    "mediterranean_restaurant",
    "mexican_restaurant",
    "middle_eastern_restaurant",
    "pizza_restaurant",
    "ramen_restaurant",
    "restaurant",
    "sandwich_shop",
    "seafood_restaurant",
    "spanish_restaurant",
    "thai_restaurant",
    "turkish_restaurant",
    "vegan_restaurant",
    "vegetarian_restaurant",
    "vietnamese_restaurant",
  ],
  "casual & eats": [
    "afghani_restaurant",
    "african_restaurant",
    "american_restaurant",
    "asian_restaurant",
    "barbecue_restaurant",
    "brazilian_restaurant",
    "breakfast_restaurant",
    "brunch_restaurant",
    "buffet_restaurant",
    "chinese_restaurant",
    "diner",
    "fast_food_restaurant",
    "food_court",
    "french_restaurant",
    "greek_restaurant",
    "hamburger_restaurant",
    "indian_restaurant",
    "indonesian_restaurant",
    "italian_restaurant",
    "japanese_restaurant",
    "korean_restaurant",
    "lebanese_restaurant",
    "mediterranean_restaurant",
    "mexican_restaurant",
    "middle_eastern_restaurant",
    "pizza_restaurant",
    "ramen_restaurant",
    "restaurant",
    "sandwich_shop",
    "seafood_restaurant",
    "spanish_restaurant",
    "thai_restaurant",
    "turkish_restaurant",
    "vegan_restaurant",
    "vegetarian_restaurant",
    "vietnamese_restaurant",
  ],
  // Picnics variations
  picnics: ["picnic_ground", "park", "beach", "garden"],
  picnic: ["picnic_ground", "park", "beach", "garden"],
  // Wellness Dates variations
  "wellness dates": ["spa", "massage", "sauna"],
  wellness_dates: ["spa", "massage", "sauna"],
  "wellness-dates": ["spa", "massage", "sauna"],
  wellness: ["spa", "sauna", "hot_spring", "massage"],
  // ── New PreferencesSheet category IDs ──
  nature: ["park", "botanical_garden", "hiking_area", "national_park", "state_park", "beach", "zoo", "wildlife_park"],
  first_meet: ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  "first-meet": ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  drink: ["bar", "pub", "wine_bar", "tea_house", "coffee_shop", "juice_shop"],
  casual_eats: [
    "buffet_restaurant", "brunch_restaurant", "diner", "fast_food_restaurant", "food_court",
    "hamburger_restaurant", "pizza_restaurant", "ramen_restaurant", "sandwich_shop", "sushi_restaurant",
    "afghani_restaurant", "african_restaurant", "american_restaurant", "asian_restaurant",
    "barbecue_restaurant", "brazilian_restaurant", "breakfast_restaurant", "indian_restaurant",
    "indonesian_restaurant", "japanese_restaurant", "korean_restaurant", "lebanese_restaurant",
    "mediterranean_restaurant", "mexican_restaurant", "middle_eastern_restaurant", "seafood_restaurant",
    "spanish_restaurant", "thai_restaurant", "turkish_restaurant", "vegan_restaurant",
    "vegetarian_restaurant", "vietnamese_restaurant", "chinese_restaurant",
  ],
  fine_dining: ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  "fine-dining": ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  watch: ["movie_theater", "comedy_club", "performing_arts_theater", "opera_house"],
  creative_arts: ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  "creative-arts": ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  play: [
    "bowling_alley", "amusement_park", "water_park", "video_arcade", "karaoke", "casino",
    "trampoline_park", "mini_golf_course", "ice_skating_rink", "skate_park", "escape_room", "adventure_park",
  ],
  // Freestyle variations
  freestyle: [
    "tourist_attraction",
    "performing_arts_theater",
    "opera_house",
    "planetarium",
    "roller_coaster",
    "wildlife_park",
    "night_club",
  ],
  "free style": [
    "tourist_attraction",
    "performing_arts_theater",
    "opera_house",
    "planetarium",
    "roller_coaster",
    "wildlife_park",
    "night_club",
  ],
};

// Excluded types for specific categories
const EXCLUDED_TYPES: { [key: string]: string[] } = {
  picnic: [
    "dog_park",
    "cycling_park",
    "amusement_park",
    "park_and_ride",
    "water_park",
    "bus_stop",
    "bus_station",
    "bar",
    "night_club",
    "casino",
    "movie_theater",
    "video_arcade",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "train_station",
    "transit_station",
  ],
  picnics: [
    "dog_park",
    "cycling_park",
    "amusement_park",
    "park_and_ride",
    "water_park",
    "bus_stop",
    "bus_station",
    "bar",
    "night_club",
    "casino",
    "movie_theater",
    "video_arcade",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "train_station",
    "transit_station",
  ],
  stroll: [
    "bar",
    "night_club",
    "casino",
    "movie_theater",
    "video_arcade",
    "bowling_alley",
    "amusement_park",
    "water_park",
    "roller_coaster",
    "ferris_wheel",
    "dog_park",
    "pub",
    "wine_bar",
    "fine_dining_restaurant",
    "steak_house",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "take a stroll": [
    "bar",
    "night_club",
    "casino",
    "movie_theater",
    "video_arcade",
    "bowling_alley",
    "amusement_park",
    "water_park",
    "roller_coaster",
    "ferris_wheel",
    "dog_park",
    "pub",
    "wine_bar",
    "fine_dining_restaurant",
    "steak_house",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "take-a-stroll": [
    "bar",
    "night_club",
    "casino",
    "movie_theater",
    "video_arcade",
    "bowling_alley",
    "amusement_park",
    "water_park",
    "roller_coaster",
    "ferris_wheel",
    "dog_park",
    "pub",
    "wine_bar",
    "fine_dining_restaurant",
    "steak_house",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  take_a_stroll: [
    "bar",
    "night_club",
    "casino",
    "movie_theater",
    "video_arcade",
    "bowling_alley",
    "amusement_park",
    "water_park",
    "roller_coaster",
    "ferris_wheel",
    "dog_park",
    "pub",
    "wine_bar",
    "fine_dining_restaurant",
    "steak_house",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "sip & chill": [
    "fine_dining_restaurant",
    "steak_house",
    "buffet_restaurant",
    "night_club",
    "casino",
    "amusement_park",
    "water_park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  sip_and_chill: [
    "fine_dining_restaurant",
    "steak_house",
    "buffet_restaurant",
    "night_club",
    "casino",
    "amusement_park",
    "water_park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "sip-and-chill": [
    "fine_dining_restaurant",
    "steak_house",
    "buffet_restaurant",
    "night_club",
    "casino",
    "amusement_park",
    "water_park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "sip&chill": [
    "fine_dining_restaurant",
    "steak_house",
    "buffet_restaurant",
    "night_club",
    "casino",
    "amusement_park",
    "water_park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "sip_&_chill": [
    "fine_dining_restaurant",
    "steak_house",
    "buffet_restaurant",
    "night_club",
    "casino",
    "amusement_park",
    "water_park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "sip-&-chill": [
    "fine_dining_restaurant",
    "steak_house",
    "buffet_restaurant",
    "night_club",
    "casino",
    "amusement_park",
    "water_park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  sipchill: [
    "fine_dining_restaurant",
    "steak_house",
    "buffet_restaurant",
    "night_club",
    "casino",
    "amusement_park",
    "water_park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "casual eats": [
    "night_club",
    "casino",
    "movie_theater",
    "video_arcade",
    "bowling_alley",
    "park",
    "tourist_attraction",
    "museum",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  casual_eats: [
    "night_club",
    "casino",
    "movie_theater",
    "video_arcade",
    "bowling_alley",
    "park",
    "tourist_attraction",
    "museum",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "casual-eats": [
    "night_club",
    "casino",
    "movie_theater",
    "video_arcade",
    "bowling_alley",
    "park",
    "tourist_attraction",
    "museum",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "casual & eats": [
    "night_club",
    "casino",
    "movie_theater",
    "video_arcade",
    "bowling_alley",
    "park",
    "tourist_attraction",
    "museum",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "screen & relax": [
    "restaurant",
    "fast_food_restaurant",
    "night_club",
    "casino",
    "park",
    "hiking_area",
    "national_park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  screen_relax: [
    "restaurant",
    "fast_food_restaurant",
    "night_club",
    "casino",
    "park",
    "hiking_area",
    "national_park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "screen-relax": [
    "restaurant",
    "fast_food_restaurant",
    "night_club",
    "casino",
    "park",
    "hiking_area",
    "national_park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  screenrelax: [
    "restaurant",
    "fast_food_restaurant",
    "night_club",
    "casino",
    "park",
    "hiking_area",
    "national_park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  screenRelax: [
    "restaurant",
    "fast_food_restaurant",
    "night_club",
    "casino",
    "park",
    "hiking_area",
    "national_park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "creative & hands-on": [
    "movie_theater",
    "performing_arts_theater",
    "opera_house",
    "night_club",
    "bar",
    "casino",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  creative_and_hands_on: [
    "movie_theater",
    "performing_arts_theater",
    "opera_house",
    "night_club",
    "bar",
    "casino",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "creative-hands-on": [
    "movie_theater",
    "performing_arts_theater",
    "opera_house",
    "night_club",
    "bar",
    "casino",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "creative & hands on": [
    "movie_theater",
    "performing_arts_theater",
    "opera_house",
    "night_club",
    "bar",
    "casino",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  creative: [
    "movie_theater",
    "performing_arts_theater",
    "opera_house",
    "night_club",
    "bar",
    "casino",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "play & move": [
    "fine_dining_restaurant",
    "steak_house",
    "museum",
    "park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  play_and_move: [
    "fine_dining_restaurant",
    "steak_house",
    "museum",
    "park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "play-move": [
    "fine_dining_restaurant",
    "steak_house",
    "museum",
    "park",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "dining experiences": [
    "fast_food_restaurant",
    "food_court",
    "bar",
    "pub",
    "night_club",
    "movie_theater",
    "video_arcade",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  dining_experiences: [
    "fast_food_restaurant",
    "food_court",
    "bar",
    "pub",
    "night_club",
    "movie_theater",
    "video_arcade",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "dining-experiences": [
    "fast_food_restaurant",
    "food_court",
    "bar",
    "pub",
    "night_club",
    "movie_theater",
    "video_arcade",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  dining: [
    "fast_food_restaurant",
    "food_court",
    "bar",
    "pub",
    "night_club",
    "movie_theater",
    "video_arcade",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "wellness dates": [
    "gym",
    "fitness_center",
    "bar",
    "night_club",
    "casino",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  wellness_dates: [
    "gym",
    "fitness_center",
    "bar",
    "night_club",
    "casino",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "wellness-dates": [
    "gym",
    "fitness_center",
    "bar",
    "night_club",
    "casino",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  wellness: [
    "gym",
    "fitness_center",
    "bar",
    "night_club",
    "casino",
    "atm",
    "bank",
    "accounting",
    "storage",
    "post_office",
    "government_office",
    "courthouse",
    "police",
    "fire_station",
    "city_hall",
    "gas_station",
    "car_wash",
    "car_repair",
    "car_dealer",
    "parking",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  // ── New PreferencesSheet excluded types ──
  nature: [
    "bar", "night_club", "casino", "movie_theater", "video_arcade",
    "bowling_alley", "fine_dining_restaurant", "fast_food_restaurant",
    "food_court", "atm", "bank", "parking", "gas_station", "airport",
    "car_repair", "car_dealer", "storage", "post_office", "government_office",
    "courthouse", "police", "fire_station", "city_hall",
    "apartment_building", "housing_complex",
  ],
  first_meet: [
    "amusement_park", "water_park", "bowling_alley", "spa", "sauna",
    "fine_dining_restaurant", "fast_food_restaurant", "food_court",
    "night_club", "casino", "parking", "atm", "bank", "gas_station",
    "airport", "bus_station", "train_station", "transit_station",
  ],
  drink: [
    "fine_dining_restaurant", "spa", "sauna", "amusement_park",
    "water_park", "bowling_alley", "atm", "bank", "parking", "gas_station",
    "airport", "car_repair",
  ],
  fine_dining: [
    "fast_food_restaurant", "food_court", "bar", "bowling_alley",
    "amusement_park", "water_park", "video_arcade", "night_club",
    "atm", "bank", "parking", "gas_station", "car_repair",
  ],
  watch: [
    "spa", "sauna", "botanical_garden", "park", "beach", "restaurant",
    "atm", "bank", "parking", "gas_station", "government_office",
  ],
  creative_arts: [
    "fast_food_restaurant", "food_court", "bar", "bowling_alley",
    "amusement_park", "water_park", "spa", "sauna", "night_club",
    "atm", "bank", "parking", "gas_station", "government_office",
  ],
  play: [
    "spa", "sauna", "botanical_garden", "fine_dining_restaurant",
    "atm", "bank", "parking", "gas_station", "airport", "car_repair",
    "government_office", "courthouse", "police", "fire_station", "city_hall",
  ],
  freestyle: [
    "gas_station",
    "parking",
    "car_wash",
    "car_repair",
    "atm",
    "bank",
    "lodging",
    "government_office",
    "post_office",
    "police",
    "courthouse",
    "city_hall",
    "accounting",
    "storage",
    "fire_station",
    "car_dealer",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
  "free style": [
    "gas_station",
    "parking",
    "car_wash",
    "car_repair",
    "atm",
    "bank",
    "lodging",
    "government_office",
    "post_office",
    "police",
    "courthouse",
    "city_hall",
    "accounting",
    "storage",
    "fire_station",
    "car_dealer",
    "electric_vehicle_charging_station",
    "moving_company",
    "courier_service",
    "locksmith",
    "plumber",
    "electrician",
    "roofing_contractor",
    "apartment_building",
    "housing_complex",
    "condominium_complex",
    "airport",
    "bus_station",
    "train_station",
    "transit_station",
  ],
};

interface UserPreferences {
  mode: string;
  budget_min: number;
  budget_max: number;
  people_count: number;
  categories: string[];
  travel_mode: string;
  travel_constraint_type: string;
  travel_constraint_value: number;
  datetime_pref: string;
}

interface GenerationRequest {
  user_id: string;
  preferences: UserPreferences;
  location?: { lat: number; lng: number };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let request: GenerationRequest;
    try {
      request = await req.json();
    } catch (jsonError) {
      console.error("Error parsing JSON request:", jsonError);
      return new Response(
        JSON.stringify({
          error: "Invalid JSON in request body",
          cards: [],
          meta: { totalResults: 0 },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { preferences, location } = request;

    if (!preferences) {
      console.error("Preferences are required");
      return new Response(
        JSON.stringify({
          error: "Preferences are required",
          cards: [],
          meta: { totalResults: 0 },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!location) {
      console.error("Location is required");
      return new Response(
        JSON.stringify({
          error: "Location is required",
          cards: [],
          meta: { totalResults: 0 },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch places from Google Places API
    let places: any[] = [];
    try {
      places = await fetchGooglePlaces(preferences, location);
    } catch (error) {
      console.error("Error fetching Google Places:", error);
      // Return empty result instead of crashing
      return new Response(
        JSON.stringify({
          cards: [],
          meta: {
            totalResults: 0,
            error: "Failed to fetch places from Google",
            message: "No places found matching your preferences",
          },
        }),
        {
          status: 200, // Return 200 with empty results instead of error
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (places.length === 0) {
      return new Response(
        JSON.stringify({
          cards: [],
          meta: {
            totalResults: 0,
            message: "No places found matching your preferences",
          },
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Calculate travel times and distances
    let placesWithTravel: any[] = [];
    try {
      placesWithTravel = await annotateWithTravel(
        places,
        location,
        preferences.travel_mode
      );
    } catch (error) {
      console.error(
        "Error annotating with travel, using places without travel info:",
        error
      );
      // Continue with places without travel info
      placesWithTravel = places.map((p) => ({
        ...p,
        distance: "Unknown",
        travelTime: "Unknown",
        distanceKm: 0,
        travelTimeMin: 0,
      }));
    }

    // Filter by constraints
    const filtered = filterByConstraints(placesWithTravel, preferences);

    // Calculate match scores
    const withMatchScores = filtered.map((place) => ({
      ...place,
      matchScore: calculateMatchScore(place, preferences, location),
      matchFactors: calculateMatchFactors(place, preferences, location),
    }));

    // Sort by match score
    const sorted = withMatchScores.sort((a, b) => b.matchScore - a.matchScore);

    // Generate AI content for top results
    const topResults = sorted.slice(0, 20);
    let enriched: any[] = [];
    try {
      enriched = await enrichWithAI(topResults, preferences);
    } catch (error) {
      console.error("Error enriching with AI, using fallback content:", error);
      // Use places with fallback descriptions
      enriched = topResults.map((place) => ({
        ...place,
        description: generateFallbackDescription(place),
        highlights: generateFallbackHighlights(place),
      }));
    }

    // Convert to card format
    const cards = enriched.map((place) => convertToCard(place, preferences));

    return new Response(
      JSON.stringify({
        cards,
        meta: {
          totalResults: cards.length,
          processingTimeMs: Date.now(),
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error generating experiences:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    return new Response(
      JSON.stringify({
        error: errorMessage,
        cards: [],
        meta: {
          totalResults: 0,
          error: errorMessage,
        },
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function fetchGooglePlaces(
  preferences: UserPreferences,
  location: { lat: number; lng: number }
): Promise<any[]> {
  if (!GOOGLE_API_KEY) {
    console.error("Google API key not available - check environment variables");
    throw new Error(
      "Google Maps API key is not configured. Please set GOOGLE_MAPS_API_KEY in Supabase Edge Functions secrets."
    );
  }

  const allPlaces: any[] = [];
  const radius =
    preferences.travel_constraint_type === "distance"
      ? Math.min((preferences.travel_constraint_value || 5) * 1000, 50000)
      : 10000; // Default 10km

  // Places API (New) base URL
  const baseUrl = "https://places.googleapis.com/v1/places:searchNearby";

  for (const category of preferences.categories || []) {
    // Convert category to lowercase for case-insensitive lookup
    const categoryKey = category.toLowerCase();
    const placeTypes = CATEGORY_MAPPINGS[categoryKey] || ["tourist_attraction"];

    // For picnic categories, iterate through 7 types; otherwise use 3
    const isPicnicCategory =
      categoryKey === "picnic" || categoryKey === "picnics";
    const maxTypes = isPicnicCategory ? 8 : 3;

    for (const placeType of placeTypes.slice(0, maxTypes)) {
      try {
        // Convert legacy place type to new API format (e.g., "restaurant" -> "restaurant")
        // Most types remain the same, but we need to ensure proper format
        const includedType = placeType;

        // Field mask for Places API (New) - specify which fields we need
        // Note: Use places.id (not places.placeId) for the place identifier
        const fieldMask =
          "places.id,places.displayName,places.location,places.formattedAddress,places.priceLevel,places.rating,places.userRatingCount,places.photos,places.types,places.regularOpeningHours";

        // Check if this category has excluded types (e.g., picnic)
        const excludedTypes = EXCLUDED_TYPES[categoryKey] || null;

        const requestBody: any = {
          includedTypes: [includedType],
          maxResultCount: 10,
          locationRestriction: {
            circle: {
              center: {
                latitude: location.lat,
                longitude: location.lng,
              },
              radius: radius,
            },
          },
        };

        // Add excludedTypes if this is a picnic category
        if (excludedTypes && excludedTypes.length > 0) {
          requestBody.excludedTypes = excludedTypes;
        }

        const response = await fetch(baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_API_KEY,
            "X-Goog-FieldMask": fieldMask,
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(
            `Google Places API error for ${placeType}:`,
            response.status,
            response.statusText,
            errorText
          );
          continue;
        }

        const data = await response.json();

        if (data.places?.length) {
          const places = data.places.map((place: any) => {
            // Extract photo reference from new API format
            // Photo name format: "places/{place_id}/photos/{photo_id}"
            const primaryPhoto = place.photos?.[0];
            const imageUrl = primaryPhoto?.name
              ? `https://places.googleapis.com/v1/${primaryPhoto.name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}`
              : null;

            const images =
              place.photos
                ?.slice(0, 5)
                .map((photo: any) => {
                  return photo.name
                    ? `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}`
                    : null;
                })
                .filter((img: string | null) => img !== null) || [];

            // Convert price level (0-4) to dollar ranges
            // 0 = Free, 1 = $, 2 = $$, 3 = $$$, 4 = $$$$
            const priceLevel = place.priceLevel || 0;
            const price_min =
              priceLevel === 0
                ? 0
                : priceLevel === 1
                ? 0
                : priceLevel === 2
                ? 15
                : priceLevel === 3
                ? 50
                : 100;
            const price_max =
              priceLevel === 0
                ? 0
                : priceLevel === 1
                ? 25
                : priceLevel === 2
                ? 75
                : priceLevel === 3
                ? 150
                : 500;

            return {
              id: place.id,
              name: place.displayName?.text || "Unknown Place",
              category,
              location: {
                lat: place.location?.latitude || location.lat,
                lng: place.location?.longitude || location.lng,
              },
              address: place.formattedAddress || "",
              priceLevel: priceLevel,
              rating: place.rating || 0,
              reviewCount: place.userRatingCount || 0,
              imageUrl: imageUrl,
              images: images.filter((img: string | null) => img !== null),
              placeId: place.id, // In new API, place.id is the identifier
              openingHours: place.regularOpeningHours
                ? {
                    open_now: place.regularOpeningHours.openNow || false,
                    weekday_text:
                      place.regularOpeningHours.weekdayDescriptions || [],
                  }
                : null,
              placeTypes: place.types || [],
              price_min,
              price_max,
            };
          });

          allPlaces.push(...places);
        }
      } catch (error) {
        console.error(`Error fetching ${placeType}:`, error);
      }
    }
  }

  return allPlaces;
}

async function annotateWithTravel(
  places: any[],
  origin: { lat: number; lng: number },
  travelMode: string
): Promise<any[]> {
  if (!GOOGLE_API_KEY) {
    return places.map((p) => ({
      ...p,
      distance: "Unknown",
      travelTime: "Unknown",
      distanceKm: 0,
      travelTimeMin: 0,
    }));
  }

  // Distance Matrix API has a limit of 25 destinations per request
  // Split into batches if needed
  const BATCH_SIZE = 25;
  const batches: any[][] = [];
  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    batches.push(places.slice(i, i + BATCH_SIZE));
  }

  const mode =
    travelMode === "walking"
      ? "walking"
      : travelMode === "driving"
      ? "driving"
      : "transit";

  const annotatedPlaces: any[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    try {
      const destinations = batch
        .map((p) => `${p.location.lat},${p.location.lng}`)
        .join("|");

      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.lat},${origin.lng}&destinations=${destinations}&mode=${mode}&key=${GOOGLE_API_KEY}`;

      const response = await fetch(url);
      if (!response.ok) {
        console.error(
          `Distance Matrix API error (batch ${batchIndex + 1}):`,
          response.status
        );
        // Add places without travel info
        annotatedPlaces.push(
          ...batch.map((p) => ({
            ...p,
            distance: "Unknown",
            travelTime: "Unknown",
            distanceKm: 0,
            travelTimeMin: 0,
          }))
        );
        continue;
      }

      const data = await response.json();

      if (data.status && data.status !== "OK") {
        console.error(
          `Distance Matrix API returned error status: ${data.status}`,
          data.error_message
        );
        // Add places without travel info
        annotatedPlaces.push(
          ...batch.map((p) => ({
            ...p,
            distance: "Unknown",
            travelTime: "Unknown",
            distanceKm: 0,
            travelTimeMin: 0,
          }))
        );
        continue;
      }

      const batchAnnotated = batch.map((place, index) => {
        const element = data.rows[0]?.elements[index];
        if (element?.status === "OK") {
          const distanceKm = element.distance.value / 1000;
          const travelTimeMin = Math.round(element.duration.value / 60);

          return {
            ...place,
            distance: `${distanceKm.toFixed(1)} km`,
            travelTime: `${travelTimeMin} min`,
            distanceKm,
            travelTimeMin,
          };
        }
        // If status is not OK, return place without travel info
        return {
          ...place,
          distance: "Unknown",
          travelTime: "Unknown",
          distanceKm: 0,
          travelTimeMin: 0,
        };
      });

      annotatedPlaces.push(...batchAnnotated);
    } catch (error) {
      console.error(
        `Error getting travel times for batch ${batchIndex + 1}:`,
        error
      );
      // Add places without travel info on error
      annotatedPlaces.push(
        ...batch.map((p) => ({
          ...p,
          distance: "Unknown",
          travelTime: "Unknown",
          distanceKm: 0,
          travelTimeMin: 0,
        }))
      );
    }
  }

  return annotatedPlaces;
}

function filterByConstraints(
  places: any[],
  preferences: UserPreferences
): any[] {
  let remaining = places;

  // Stage 1: Filter by travel constraint
  remaining = remaining.filter((place) => {
    if (preferences.travel_constraint_type === "time" && place.travelTimeMin) {
      if (place.travelTimeMin > preferences.travel_constraint_value) {
        return false;
      }
    } else if (
      preferences.travel_constraint_type === "distance" &&
      place.distanceKm
    ) {
      if (place.distanceKm > preferences.travel_constraint_value) {
        return false;
      }
    }
    return true;
  });

  // Stage 2: Filter by budget (skip for stroll cards)
  remaining = remaining.filter((place) => {
    // Check if this is a stroll card - skip budget filtering for stroll cards
    const categoryKey = place.category?.toLowerCase() || "";
    const isStrollCard =
      categoryKey.includes("stroll") ||
      categoryKey === "take a stroll" ||
      categoryKey === "take-a-stroll" ||
      categoryKey === "take_a_stroll";

    // Skip budget filtering for stroll cards
    if (isStrollCard) {
      return true;
    }

    // Apply budget filter for non-stroll cards
    if (
      place.price_min > preferences.budget_max ||
      place.price_max < preferences.budget_min
    ) {
      return false;
    }

    return true;
  });

  // Stage 3: Filter by category
  remaining = remaining.filter((place) => {
    if (!preferences.categories.includes(place.category)) {
      return false;
    }
    return true;
  });

  // Stage 3.5: Hard filter for stroll cards - must have valid anchor
  remaining = remaining.filter((place) => {
    const categoryKey = place.category?.toLowerCase() || "";
    const isStrollCard =
      categoryKey.includes("stroll") ||
      categoryKey === "take a stroll" ||
      categoryKey === "take-a-stroll" ||
      categoryKey === "take_a_stroll";

    if (isStrollCard) {
      // Hard filter: Stroll cards must have valid anchor (park, trail, scenic area)
      const validAnchorTypes = [
        "park",
        "tourist_attraction",
        "point_of_interest",
        "natural_feature",
        "zoo",
        "aquarium",
        "botanical_garden",
        "hiking_area",
        "scenic_viewpoint",
      ];
      const hasValidAnchor = place.placeTypes?.some((type: string) =>
        validAnchorTypes.includes(type)
      );

      if (!hasValidAnchor) {
        return false;
      }
    }
    return true;
  });

  return remaining;
}

function calculateMatchScore(
  place: any,
  preferences: UserPreferences,
  userLocation: { lat: number; lng: number }
): number {
  const locationScore = calculateLocationScore(
    place,
    preferences,
    userLocation
  );
  const budgetScore = calculateBudgetScore(place, preferences);
  const categoryScore = calculateCategoryScore(place, preferences);
  const timeScore = calculateTimeScore(place, preferences);
  const popularityScore = calculatePopularityScore(place);

  const matchScore =
    (locationScore * 0.25 +
      budgetScore * 0.2 +
      categoryScore * 0.2 +
      timeScore * 0.2 +
      popularityScore * 0.15) *
    100;

  return Math.round(Math.max(0, Math.min(100, matchScore)));
}

function calculateMatchFactors(
  place: any,
  preferences: UserPreferences,
  userLocation: { lat: number; lng: number }
) {
  return {
    location: Math.round(
      calculateLocationScore(place, preferences, userLocation) * 100
    ),
    budget: Math.round(calculateBudgetScore(place, preferences) * 100),
    category: Math.round(calculateCategoryScore(place, preferences) * 100),
    time: Math.round(calculateTimeScore(place, preferences) * 100),
    popularity: Math.round(calculatePopularityScore(place) * 100),
  };
}

function calculateLocationScore(
  place: any,
  preferences: UserPreferences,
  userLocation: { lat: number; lng: number }
): number {
  if (!place.distanceKm || !place.travelTimeMin) return 0.5;

  const distance = place.distanceKm;
  const travelTime = place.travelTimeMin;

  let locationScore = 0;

  if (preferences.travel_constraint_type === "time") {
    const constraintValue = preferences.travel_constraint_value || 30;
    if (travelTime <= 5) {
      locationScore = 1.0;
    } else if (travelTime >= constraintValue) {
      locationScore = 0.0;
    } else {
      const range = constraintValue - 5;
      const excess = travelTime - 5;
      locationScore = 1.0 - excess / range;
    }
  } else if (preferences.travel_constraint_type === "distance") {
    const maxDistance = preferences.travel_constraint_value || 5;
    if (distance <= 0.5) {
      locationScore = 1.0;
    } else if (distance >= maxDistance) {
      locationScore = 0.0;
    } else {
      const range = maxDistance - 0.5;
      const excess = distance - 0.5;
      locationScore = 1.0 - excess / range;
    }
  }

  if (distance < 1.0 && travelTime < 10) {
    locationScore = Math.min(1.0, locationScore * 1.1);
  }

  return Math.max(0, Math.min(1, locationScore));
}

function calculateBudgetScore(
  place: any,
  preferences: UserPreferences
): number {
  const expPriceMin = place.price_min ?? 0;
  const expPriceMax = place.price_max ?? 0;
  const userBudgetMin = preferences.budget_min || 0;
  const userBudgetMax = preferences.budget_max || 1000;

  if (expPriceMin >= userBudgetMin && expPriceMax <= userBudgetMax) {
    return 1.0;
  }

  const overlapStart = Math.max(userBudgetMin, expPriceMin);
  const overlapEnd = Math.min(userBudgetMax, expPriceMax);
  const overlap = Math.max(0, overlapEnd - overlapStart);

  if (overlap > 0) {
    const experienceRange = expPriceMax - expPriceMin;
    const overlapRatio = overlap / experienceRange;
    if (expPriceMin < userBudgetMin) {
      return overlapRatio * 0.7;
    } else if (expPriceMax > userBudgetMax) {
      return overlapRatio * 0.8;
    }
    return overlapRatio;
  }

  if (expPriceMax < userBudgetMin) {
    const gap = userBudgetMin - expPriceMax;
    const budgetRange = userBudgetMax - userBudgetMin;
    return Math.max(0, 0.3 - (gap / budgetRange) * 0.3);
  } else {
    const gap = expPriceMin - userBudgetMax;
    const budgetRange = userBudgetMax - userBudgetMin;
    return Math.max(0, 0.2 - (gap / budgetRange) * 0.2);
  }
}

function calculateCategoryScore(
  place: any,
  preferences: UserPreferences
): number {
  const userCategories = preferences.categories || [];
  if (userCategories.includes(place.category)) {
    return 1.0;
  }
  return 0.0;
}

function calculateTimeScore(place: any, preferences: UserPreferences): number {
  let timeScore = 0;
  const isOpenNow = place.openingHours?.open_now || false;

  if (isOpenNow) {
    timeScore += 0.6;
  }

  // Duration alignment (simplified)
  timeScore += 0.3;

  return Math.max(0, Math.min(1, timeScore));
}

function calculatePopularityScore(place: any): number {
  const rating = place.rating || 0;
  const reviewCount = place.reviewCount || 0;

  let ratingScore = 0;
  if (rating >= 4.5) {
    ratingScore = 1.0;
  } else if (rating >= 4.0) {
    ratingScore = 0.8;
  } else if (rating >= 3.5) {
    ratingScore = 0.6;
  } else if (rating >= 3.0) {
    ratingScore = 0.4;
  } else {
    ratingScore = rating / 5.0;
  }

  let reviewScore = 0;
  if (reviewCount >= 1000) {
    reviewScore = 1.0;
  } else if (reviewCount >= 500) {
    reviewScore = 0.9;
  } else if (reviewCount >= 100) {
    reviewScore = 0.7;
  } else if (reviewCount >= 50) {
    reviewScore = 0.5;
  } else if (reviewCount >= 10) {
    reviewScore = 0.3;
  } else if (reviewCount > 0) {
    reviewScore = 0.1;
  }

  const popularityScore = ratingScore * 0.6 + reviewScore * 0.4;

  if (rating >= 4.5 && reviewCount >= 500) {
    return Math.min(1.0, popularityScore * 1.1);
  }

  return popularityScore;
}

async function enrichWithAI(
  places: any[],
  preferences: UserPreferences
): Promise<any[]> {
  if (!OPENAI_API_KEY) {
    // Fallback descriptions
    return places.map((place) => ({
      ...place,
      description: generateFallbackDescription(place),
      highlights: generateFallbackHighlights(place),
    }));
  }

  // Generate descriptions and highlights using OpenAI
  const enriched = await Promise.all(
    places.map(async (place) => {
      try {
        const description = await generateDescription(place);
        const highlights = await generateHighlights(place);
        return {
          ...place,
          description,
          highlights,
        };
      } catch (error) {
        console.error(`Error enriching ${place.name}:`, error);
        return {
          ...place,
          description: generateFallbackDescription(place),
          highlights: generateFallbackHighlights(place),
        };
      }
    })
  );

  return enriched;
}

async function generateDescription(place: any): Promise<string> {
  if (!OPENAI_API_KEY) return generateFallbackDescription(place);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a travel experience writer. Write engaging, concise descriptions (max 2 lines, 150 characters) for places and experiences.",
          },
          {
            role: "user",
            content: `Write a 2-line engaging description for "${place.name}", a ${place.category} experience. Include what makes it special. Keep it under 150 characters total.`,
          },
        ],
        max_tokens: 100,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    return (
      data.choices[0]?.message?.content || generateFallbackDescription(place)
    );
  } catch (error) {
    console.error("OpenAI error:", error);
    return generateFallbackDescription(place);
  }
}

async function generateHighlights(place: any): Promise<string[]> {
  if (!OPENAI_API_KEY) return generateFallbackHighlights(place);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Extract the top 2 most compelling highlights for a place. Return only 2 short phrases (max 3 words each), separated by commas.",
          },
          {
            role: "user",
            content: `Extract top 2 highlights for "${place.name}" (${place.category}). Rating: ${place.rating}, Reviews: ${place.reviewCount}. Return only 2 short phrases, comma-separated.`,
          },
        ],
        max_tokens: 30,
        temperature: 0.5,
      }),
    });

    const data = await response.json();
    const highlights =
      data.choices[0]?.message?.content
        ?.split(",")
        .map((h: string) => h.trim())
        .slice(0, 2) || [];
    return highlights.length > 0
      ? highlights
      : generateFallbackHighlights(place);
  } catch (error) {
    console.error("OpenAI error:", error);
    return generateFallbackHighlights(place);
  }
}

function generateFallbackDescription(place: any): string {
  const descriptions: { [key: string]: string[] } = {
    "Sip & Chill": [
      "Experience an exquisite selection of local and imported wines while enjoying breathtaking sunset views from our rooftop terrace.",
      "Perfect spot for coffee and conversation in a cozy atmosphere.",
    ],
    Stroll: [
      "Scenic walking adventure through beautiful natural surroundings.",
      "Peaceful stroll in a serene environment perfect for relaxation.",
    ],
    Dining: [
      "Exceptional culinary journey with outstanding service and fine cuisine.",
      "Memorable gastronomic experience in an elegant atmosphere.",
    ],
    nature: ["Enjoy the beauty of the outdoors surrounded by nature."],
    first_meet: ["A relaxed and welcoming spot perfect for meeting someone new."],
    drink: ["Unwind with a perfectly crafted drink in a vibrant atmosphere."],
    casual_eats: ["Delicious, laid-back food to satisfy any craving."],
    fine_dining: ["Exceptional culinary journey with outstanding service and fine cuisine."],
    watch: ["Sit back and enjoy a great show or film."],
    creative_arts: ["Explore your creative side in an inspiring setting."],
    play: ["Fun and active experience for all ages."],
    wellness: ["Relax, recharge and take care of yourself."],
    picnic: ["A perfect open-air spot for a laid-back picnic."],
  };

  const categoryDescriptions = descriptions[place.category] || [
    "An amazing experience waiting for you.",
  ];
  return categoryDescriptions[0];
}

function generateFallbackHighlights(place: any): string[] {
  const highlights: { [key: string]: string[] } = {
    "Sip & Chill": ["Expert Sommeliers", "Sunset Views"],
    Stroll: ["Scenic Views", "Nature Trail"],
    Dining: ["Fine Cuisine", "Excellent Service"],
    nature: ["Scenic Views", "Nature Trail"],
    first_meet: ["Cozy Atmosphere", "Great Conversation Spot"],
    drink: ["Craft Drinks", "Relaxing Vibe"],
    casual_eats: ["Tasty Eats", "Friendly Atmosphere"],
    fine_dining: ["Fine Cuisine", "Excellent Service"],
    watch: ["Great Entertainment", "Comfortable Seating"],
    creative_arts: ["Artistic Experience", "Inspiring Setting"],
    play: ["Fun Activities", "Active Fun"],
    wellness: ["Deep Relaxation", "Self Care"],
    picnic: ["Outdoor Bliss", "Scenic Spot"],
  };

  return highlights[place.category] || ["Great Experience", "Highly Rated"];
}

function convertToCard(place: any, preferences: UserPreferences): any {
  return {
    id: place.id,
    title: place.name,
    category: place.category,
    matchScore: place.matchScore,
    image:
      place.imageUrl ||
      "https://images.unsplash.com/photo-1441986300917-64674bd600d8",
    images: place.images || [place.imageUrl] || [],
    rating: place.rating || 4.0,
    reviewCount: place.reviewCount || 0,
    travelTime: place.travelTime || "15 min",
    distance: place.distance || "3 km",
    priceRange: formatPriceRange(place.price_min, place.price_max),
    description: place.description || generateFallbackDescription(place),
    highlights: place.highlights || generateFallbackHighlights(place),
    address: place.address || "",
    lat: place.location.lat,
    lng: place.location.lng,
    placeId: place.placeId,
    matchFactors: place.matchFactors || {},
    openingHours: place.openingHours || null,
  };
}

function formatPriceRange(min: number, max: number): string {
  if (min === 0 && max === 0) return "Free";
  if (min === max) return `$${min}`;
  return `$${min}-$${max}`;
}
