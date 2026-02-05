import { Coffee, Utensils, Monitor, Palette, Dumbbell, TreePine, Sparkles, Star, Heart, Users, Target, PartyPopper } from 'lucide-react';

export const CATEGORIES = [
  { id: 'sipChill', label: 'Sip & Chill', icon: Coffee, description: 'Bars, cafés, wine bars, lounges', multiStop: false },
  { id: 'casualEats', label: 'Casual Eats', icon: Utensils, description: 'Casual restaurants, diners, food trucks', multiStop: false },
  { id: 'screenRelax', label: 'Screen & Relax', icon: Monitor, description: 'Movies, theaters, comedy shows', multiStop: false },
  { id: 'creative', label: 'Creative & Hands-On', icon: Palette, description: 'Classes, workshops, arts & crafts', multiStop: false },
  { id: 'playMove', label: 'Play & Move', icon: Dumbbell, description: 'Bowling, mini golf, sports, kayaking', multiStop: false },
  { id: 'diningExp', label: 'Dining Experiences', icon: Utensils, description: 'Upscale or chef-led restaurants', multiStop: false },
  { id: 'wellness', label: 'Wellness Dates', icon: TreePine, description: 'Yoga, spas, sound baths, healthy dining', multiStop: false },
  { id: 'parties', label: 'Events, Parties, and Festivals', icon: PartyPopper, description: 'Birthday parties, celebrations, festivals, events', multiStop: false },
];

export const EXPERIENCE_TYPES = [
  { id: 'soloAdventure', label: 'Solo Adventure', icon: Star },
  { id: 'firstDate', label: 'First Date', icon: Heart },
  { id: 'romantic', label: 'Romantic', icon: Heart },
  { id: 'friendly', label: 'Friendly', icon: Users },
  { id: 'groupFun', label: 'Group Fun', icon: Users },
  { id: 'business', label: 'Business', icon: Target }
];

// Party-specific options
export const PARTY_TYPES = [
  { id: 'birthday', label: 'Birthday Party' },
  { id: 'rooftop', label: 'Rooftop Party' },
  { id: 'club', label: 'Club Night' },
  { id: 'house', label: 'House Party' },
  { id: 'warehouse', label: 'Warehouse Party' },
  { id: 'beach', label: 'Beach Party' },
  { id: 'pool', label: 'Pool Party' },
  { id: 'boat', label: 'Boat Party' },
  { id: 'themed', label: 'Themed Party' },
  { id: 'corporate', label: 'Corporate Event' },
  { id: 'graduation', label: 'Graduation Party' },
  { id: 'holiday', label: 'Holiday Party' },
  { id: 'networking', label: 'Networking Event' },
  { id: 'rave', label: 'Rave' },
  { id: 'festival', label: 'Festival' },
];

export const VIBE_TAGS = [
  { id: 'energetic', label: 'Energetic', emoji: '⚡' },
  { id: 'chill', label: 'Chill', emoji: '😌' },
  { id: 'intimate', label: 'Intimate', emoji: '🕯️' },
  { id: 'wild', label: 'Wild', emoji: '🎉' },
  { id: 'classy', label: 'Classy', emoji: '🥂' },
  { id: 'casual', label: 'Casual', emoji: '👕' },
  { id: 'upscale', label: 'Upscale', emoji: '💎' },
  { id: 'underground', label: 'Underground', emoji: '🔒' },
  { id: 'mainstream', label: 'Mainstream', emoji: '🌟' },
  { id: 'artsy', label: 'Artsy', emoji: '🎨' },
  { id: 'social', label: 'Social', emoji: '🤝' },
  { id: 'exclusive', label: 'Exclusive', emoji: '👑' },
  { id: 'laidback', label: 'Laid-back', emoji: '🌴' },
  { id: 'vibrant', label: 'Vibrant', emoji: '🌈' },
  { id: 'retro', label: 'Retro', emoji: '📻' },
  { id: 'futuristic', label: 'Futuristic', emoji: '🚀' },
];

export const MUSIC_GENRES = [
  { id: 'electronic', label: 'Electronic/EDM', subgenres: ['House', 'Techno', 'Trance', 'Dubstep'] },
  { id: 'hiphop', label: 'Hip-Hop/Rap', subgenres: ['Trap', 'R&B', 'Drill'] },
  { id: 'pop', label: 'Pop', subgenres: ['Top 40', 'Dance Pop', 'K-Pop'] },
  { id: 'rock', label: 'Rock', subgenres: ['Indie Rock', 'Alternative', 'Classic Rock'] },
  { id: 'latin', label: 'Latin', subgenres: ['Reggaeton', 'Bachata', 'Salsa'] },
  { id: 'afrobeats', label: 'Afrobeats', subgenres: ['Afropop', 'Amapiano'] },
  { id: 'rnb', label: 'R&B/Soul', subgenres: ['Neo-Soul', 'Contemporary R&B'] },
  { id: 'disco', label: 'Disco/Funk', subgenres: ['Nu-Disco', 'Boogie'] },
  { id: 'reggae', label: 'Reggae/Dancehall', subgenres: ['Dub', 'Ska'] },
  { id: 'indie', label: 'Indie', subgenres: ['Indie Pop', 'Dream Pop'] },
  { id: 'country', label: 'Country', subgenres: ['Country Pop', 'Bluegrass'] },
  { id: 'jazz', label: 'Jazz', subgenres: ['Smooth Jazz', 'Bebop'] },
  { id: 'classical', label: 'Classical', subgenres: ['Orchestra', 'Chamber Music'] },
  { id: 'mixed', label: 'Mixed/Variety', subgenres: [] },
];

export const PRICING_MODELS = [
  { id: 'per-person', label: 'Per Person' },
  { id: 'per-group', label: 'Per Group' },
  { id: 'tiered', label: 'Tiered (Standard/Premium/VIP)' },
  { id: 'free-rsvp', label: 'Free with RSVP' },
  { id: 'deposit-only', label: 'Deposit Only' },
  { id: 'dynamic', label: 'Dynamic Pricing' }
];

export const WORLD_CURRENCIES = [
  // Popular currencies
  { code: 'USD', name: 'US Dollar', symbol: '$', region: 'Popular' },
  { code: 'EUR', name: 'Euro', symbol: '€', region: 'Popular' },
  { code: 'GBP', name: 'British Pound', symbol: '£', region: 'Popular' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', region: 'Popular' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', region: 'Popular' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', region: 'Popular' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', region: 'Popular' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', region: 'Popular' },
  
  // North America
  { code: 'MXN', name: 'Mexican Peso', symbol: '$', region: 'North America' },
  { code: 'GTQ', name: 'Guatemalan Quetzal', symbol: 'Q', region: 'North America' },
  { code: 'BZD', name: 'Belize Dollar', symbol: 'BZ$', region: 'North America' },
  { code: 'HNL', name: 'Honduran Lempira', symbol: 'L', region: 'North America' },
  { code: 'NIO', name: 'Nicaraguan Córdoba', symbol: 'C$', region: 'North America' },
  { code: 'CRC', name: 'Costa Rican Colón', symbol: '₡', region: 'North America' },
  { code: 'PAB', name: 'Panamanian Balboa', symbol: 'B/.', region: 'North America' },
  { code: 'CUP', name: 'Cuban Peso', symbol: '₱', region: 'North America' },
  { code: 'JMD', name: 'Jamaican Dollar', symbol: 'J$', region: 'North America' },
  { code: 'HTG', name: 'Haitian Gourde', symbol: 'G', region: 'North America' },
  { code: 'DOP', name: 'Dominican Peso', symbol: 'RD$', region: 'North America' },
  { code: 'BSD', name: 'Bahamian Dollar', symbol: 'B$', region: 'North America' },
  { code: 'TTD', name: 'Trinidad & Tobago Dollar', symbol: 'TT$', region: 'North America' },
  { code: 'BBD', name: 'Barbadian Dollar', symbol: 'Bds$', region: 'North America' },
  { code: 'XCD', name: 'East Caribbean Dollar', symbol: 'EC$', region: 'North America' },
  
  // South America
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', region: 'South America' },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$', region: 'South America' },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$', region: 'South America' },
  { code: 'COP', name: 'Colombian Peso', symbol: '$', region: 'South America' },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', region: 'South America' },
  { code: 'VES', name: 'Venezuelan Bolívar', symbol: 'Bs.', region: 'South America' },
  { code: 'BOB', name: 'Bolivian Boliviano', symbol: 'Bs.', region: 'South America' },
  { code: 'PYG', name: 'Paraguayan Guaraní', symbol: '₲', region: 'South America' },
  { code: 'UYU', name: 'Uruguayan Peso', symbol: '$U', region: 'South America' },
  { code: 'GYD', name: 'Guyanese Dollar', symbol: 'G$', region: 'South America' },
  { code: 'SRD', name: 'Surinamese Dollar', symbol: 'Sr$', region: 'South America' },
  
  // Europe
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', region: 'Europe' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', region: 'Europe' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', region: 'Europe' },
  { code: 'ISK', name: 'Icelandic Króna', symbol: 'kr', region: 'Europe' },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł', region: 'Europe' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč', region: 'Europe' },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', region: 'Europe' },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei', region: 'Europe' },
  { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв', region: 'Europe' },
  { code: 'HRK', name: 'Croatian Kuna', symbol: 'kn', region: 'Europe' },
  { code: 'RSD', name: 'Serbian Dinar', symbol: 'дин', region: 'Europe' },
  { code: 'BAM', name: 'Bosnia-Herzegovina Mark', symbol: 'KM', region: 'Europe' },
  { code: 'MKD', name: 'Macedonian Denar', symbol: 'ден', region: 'Europe' },
  { code: 'ALL', name: 'Albanian Lek', symbol: 'L', region: 'Europe' },
  { code: 'MDL', name: 'Moldovan Leu', symbol: 'L', region: 'Europe' },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴', region: 'Europe' },
  { code: 'BYN', name: 'Belarusian Ruble', symbol: 'Br', region: 'Europe' },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', region: 'Europe' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', region: 'Europe' },
  { code: 'GEL', name: 'Georgian Lari', symbol: '₾', region: 'Europe' },
  { code: 'AMD', name: 'Armenian Dram', symbol: '֏', region: 'Europe' },
  { code: 'AZN', name: 'Azerbaijani Manat', symbol: '₼', region: 'Europe' },
  
  // Africa - North
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', region: 'Africa' },
  { code: 'LYD', name: 'Libyan Dinar', symbol: 'LD', region: 'Africa' },
  { code: 'TND', name: 'Tunisian Dinar', symbol: 'DT', region: 'Africa' },
  { code: 'DZD', name: 'Algerian Dinar', symbol: 'DA', region: 'Africa' },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'DH', region: 'Africa' },
  { code: 'SDG', name: 'Sudanese Pound', symbol: 'SDG', region: 'Africa' },
  { code: 'SSP', name: 'South Sudanese Pound', symbol: 'SS£', region: 'Africa' },
  
  // Africa - West
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', region: 'Africa' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵', region: 'Africa' },
  { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA', region: 'Africa' },
  { code: 'GNF', name: 'Guinean Franc', symbol: 'FG', region: 'Africa' },
  { code: 'SLL', name: 'Sierra Leonean Leone', symbol: 'Le', region: 'Africa' },
  { code: 'LRD', name: 'Liberian Dollar', symbol: 'L$', region: 'Africa' },
  { code: 'MRU', name: 'Mauritanian Ouguiya', symbol: 'UM', region: 'Africa' },
  { code: 'GMD', name: 'Gambian Dalasi', symbol: 'D', region: 'Africa' },
  { code: 'CVE', name: 'Cape Verdean Escudo', symbol: '$', region: 'Africa' },
  
  // Africa - Central
  { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA', region: 'Africa' },
  { code: 'CDF', name: 'Congolese Franc', symbol: 'FC', region: 'Africa' },
  { code: 'STN', name: 'São Tomé Dobra', symbol: 'Db', region: 'Africa' },
  
  // Africa - East
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', region: 'Africa' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', region: 'Africa' },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', region: 'Africa' },
  { code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw', region: 'Africa' },
  { code: 'BIF', name: 'Burundian Franc', symbol: 'FBu', region: 'Africa' },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br', region: 'Africa' },
  { code: 'ERN', name: 'Eritrean Nakfa', symbol: 'Nfk', region: 'Africa' },
  { code: 'DJF', name: 'Djiboutian Franc', symbol: 'Fdj', region: 'Africa' },
  { code: 'SOS', name: 'Somali Shilling', symbol: 'Sh', region: 'Africa' },
  { code: 'SCR', name: 'Seychellois Rupee', symbol: 'SR', region: 'Africa' },
  { code: 'MUR', name: 'Mauritian Rupee', symbol: 'Rs', region: 'Africa' },
  { code: 'KMF', name: 'Comoros Franc', symbol: 'CF', region: 'Africa' },
  { code: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar', region: 'Africa' },
  
  // Africa - Southern
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', region: 'Africa' },
  { code: 'BWP', name: 'Botswana Pula', symbol: 'P', region: 'Africa' },
  { code: 'NAD', name: 'Namibian Dollar', symbol: 'N$', region: 'Africa' },
  { code: 'ZWL', name: 'Zimbabwean Dollar', symbol: 'Z$', region: 'Africa' },
  { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK', region: 'Africa' },
  { code: 'MWK', name: 'Malawian Kwacha', symbol: 'MK', region: 'Africa' },
  { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT', region: 'Africa' },
  { code: 'AOA', name: 'Angolan Kwanza', symbol: 'Kz', region: 'Africa' },
  { code: 'LSL', name: 'Lesotho Loti', symbol: 'L', region: 'Africa' },
  { code: 'SZL', name: 'Eswatini Lilangeni', symbol: 'E', region: 'Africa' },
  
  // Asia-Pacific
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', region: 'Asia-Pacific' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', region: 'Asia-Pacific' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', region: 'Asia-Pacific' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', region: 'Asia-Pacific' },
  { code: 'TWD', name: 'Taiwan Dollar', symbol: 'NT$', region: 'Asia-Pacific' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', region: 'Asia-Pacific' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', region: 'Asia-Pacific' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', region: 'Asia-Pacific' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', region: 'Asia-Pacific' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', region: 'Asia-Pacific' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', region: 'Asia-Pacific' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', region: 'Asia-Pacific' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', region: 'Asia-Pacific' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs', region: 'Asia-Pacific' },
  
  // Middle East
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', region: 'Middle East' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', region: 'Middle East' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق', region: 'Middle East' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك', region: 'Middle East' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: 'د.ب', region: 'Middle East' },
  { code: 'OMR', name: 'Omani Rial', symbol: 'ر.ع.', region: 'Middle East' },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'د.ا', region: 'Middle East' },
  { code: 'ILS', name: 'Israeli Shekel', symbol: '₪', region: 'Middle East' },
];

export const PRICE_RANGE_CATEGORIES = [
  { id: 'budget', label: 'Budget-Friendly', min: 0, max: 25, description: '<$25' },
  { id: 'affordable', label: 'Affordable', min: 25, max: 50, description: '$25-$50' },
  { id: 'moderate', label: 'Moderate', min: 50, max: 100, description: '$50-$100' },
  { id: 'premium', label: 'Premium', min: 100, max: null, description: '$100+' },
];

export const FORM_STEPS = [
  { id: 1, label: 'Basic Info', icon: '📝', shortLabel: 'Basics' },
  { id: 2, label: 'Route & Timeline', icon: '🗺️', shortLabel: 'Route' },
  { id: 3, label: 'Packages & Availability', icon: '💰', shortLabel: 'Pricing' },
  { id: 4, label: 'Policies', icon: '📋', shortLabel: 'Policies' }
];