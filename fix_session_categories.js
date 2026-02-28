const fs = require('fs');
const path = 'c:/Users/user/Desktop/Repo/Mingla/supabase/functions/generate-session-experiences/index.ts';
let content = fs.readFileSync(path, 'utf8');

const catStart = content.indexOf('const CATEGORY_MAPPINGS: { [key: string]: string[] } = {');
const interfaceMarker = 'interface UserPreferences {';
const interfaceIdx = content.indexOf(interfaceMarker);

const before = content.substring(0, catStart);
const after = content.substring(interfaceIdx);

const newBlock = `const CATEGORY_MAPPINGS: { [key: string]: string[] } = {
  // Nature
  nature: ["park", "botanical_garden", "hiking_area", "national_park", "state_park", "beach", "zoo", "wildlife_park"],
  "nature-outdoor": ["park", "botanical_garden", "hiking_area", "national_park", "state_park", "beach", "zoo", "wildlife_park"],
  // First Meet
  first_meet: ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  "first meet": ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  "First Meet": ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  "first-meet": ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  firstmeet: ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  // Picnic
  picnic: ["picnic_ground", "park", "beach", "botanical_garden"],
  Picnic: ["picnic_ground", "park", "beach", "botanical_garden"],
  // Drink
  drink: ["bar", "pub", "wine_bar", "tea_house", "coffee_shop"],
  Drink: ["bar", "pub", "wine_bar", "tea_house", "coffee_shop"],
  // Casual Eats
  casual_eats: ["sandwich_shop", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "ramen_restaurant", "noodle_restaurant", "sushi_restaurant", "american_restaurant", "mexican_restaurant", "chinese_restaurant", "japanese_restaurant", "korean_restaurant", "thai_restaurant", "vietnamese_restaurant", "indian_restaurant", "diner", "food_court"],
  "casual eats": ["sandwich_shop", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "ramen_restaurant", "noodle_restaurant", "sushi_restaurant", "american_restaurant", "mexican_restaurant", "chinese_restaurant", "japanese_restaurant", "korean_restaurant", "thai_restaurant", "vietnamese_restaurant", "indian_restaurant", "diner", "food_court"],
  "Casual Eats": ["sandwich_shop", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "ramen_restaurant", "noodle_restaurant", "sushi_restaurant", "american_restaurant", "mexican_restaurant", "chinese_restaurant", "japanese_restaurant", "korean_restaurant", "thai_restaurant", "vietnamese_restaurant", "indian_restaurant", "diner", "food_court"],
  "casual-eats": ["sandwich_shop", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "ramen_restaurant", "noodle_restaurant", "sushi_restaurant", "american_restaurant", "mexican_restaurant", "chinese_restaurant", "japanese_restaurant", "korean_restaurant", "thai_restaurant", "vietnamese_restaurant", "indian_restaurant", "diner", "food_court"],
  casualeats: ["sandwich_shop", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "ramen_restaurant", "noodle_restaurant", "sushi_restaurant", "american_restaurant", "mexican_restaurant", "chinese_restaurant", "japanese_restaurant", "korean_restaurant", "thai_restaurant", "vietnamese_restaurant", "indian_restaurant", "diner", "food_court"],
  // Fine Dining
  fine_dining: ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  "fine dining": ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  "Fine Dining": ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  "fine-dining": ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  finedining: ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  // Watch
  watch: ["movie_theater", "comedy_club"],
  Watch: ["movie_theater", "comedy_club"],
  // Creative & Arts
  creative_arts: ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  "creative & arts": ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  "Creative & Arts": ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  "creative-arts": ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  creativearts: ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  "creative arts": ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  // Play
  play: ["bowling_alley", "amusement_park", "water_park", "video_arcade", "karaoke", "casino", "trampoline_park", "mini_golf_course", "ice_skating_rink", "skate_park", "escape_room", "adventure_park"],
  Play: ["bowling_alley", "amusement_park", "water_park", "video_arcade", "karaoke", "casino", "trampoline_park", "mini_golf_course", "ice_skating_rink", "skate_park", "escape_room", "adventure_park"],
  // Wellness
  wellness: ["spa", "sauna", "hot_spring"],
  Wellness: ["spa", "sauna", "hot_spring"],
};

// Excluded types for specific categories
const EXCLUDED_TYPES: { [key: string]: string[] } = {
  nature: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "bus_stop", "bus_station", "bar", "night_club", "casino", "movie_theater", "video_arcade", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
  first_meet: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "gas_station", "car_wash", "car_repair", "parking", "atm", "bank", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "bus_station", "train_station", "transit_station"],
  picnic: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "bus_stop", "bus_station", "bar", "night_club", "casino", "movie_theater", "video_arcade", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
  drink: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "gas_station", "car_wash", "car_repair", "parking", "atm", "bank", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "bus_station", "train_station", "transit_station"],
  casual_eats: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "bus_stop", "bus_station", "bar", "night_club", "casino", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
  fine_dining: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "bus_stop", "bus_station", "bar", "night_club", "casino", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "diner", "food_court", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
  watch: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "bus_stop", "bus_station", "bar", "night_club", "casino", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
  creative_arts: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "bus_stop", "bus_station", "bar", "night_club", "casino", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
  play: ["dog_park", "cycling_park", "park_and_ride", "bus_stop", "bus_station", "bar", "night_club", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
  wellness: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "bus_stop", "bus_station", "bar", "night_club", "casino", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
};

`;

const newContent = before + newBlock + after;
fs.writeFileSync(path, newContent, 'utf8');
console.log('Done. New file length:', newContent.length, 'chars');
