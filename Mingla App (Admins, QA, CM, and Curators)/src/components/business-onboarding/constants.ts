import { BusinessOnboardingData, OperatingHours } from './types';

export const TOTAL_BUSINESS_STEPS = 8;

export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  monday: { isOpen: true, open: '09:00', close: '17:00' },
  tuesday: { isOpen: true, open: '09:00', close: '17:00' },
  wednesday: { isOpen: true, open: '09:00', close: '17:00' },
  thursday: { isOpen: true, open: '09:00', close: '17:00' },
  friday: { isOpen: true, open: '09:00', close: '17:00' },
  saturday: { isOpen: false, open: '09:00', close: '17:00' },
  sunday: { isOpen: false, open: '09:00', close: '17:00' }
};

export const DEFAULT_BUSINESS_ONBOARDING_DATA: BusinessOnboardingData = {
  ownerFirstName: '',
  ownerLastName: '',
  email: '',
  
  businessName: '',
  businessType: '',
  businessCategory: '',
  description: '',
  foundingYear: '',
  teamSize: '',
  
  phone: '',
  website: '',
  socialMedia: {
    instagram: '',
    facebook: '',
    twitter: ''
  },
  
  address: '',
  city: '',
  state: '',
  zipCode: '',
  country: 'United States',
  operatingHours: DEFAULT_OPERATING_HOURS,
  
  photos: [],
  logo: '',
  coverImage: '',
  
  termsAccepted: false,
  marketingConsent: false,
  
  firstExperienceCreated: false,
  firstExperienceId: ''
};

export const BUSINESS_TYPES = [
  { value: 'individual', label: 'Individual/Sole Proprietor' },
  { value: 'llc', label: 'LLC' },
  { value: 'corporation', label: 'Corporation' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'nonprofit', label: 'Nonprofit Organization' }
];

export const BUSINESS_CATEGORIES = [
  { value: 'restaurant', label: '🍽️ Restaurant & Dining' },
  { value: 'cafe', label: '☕ Café & Coffee Shop' },
  { value: 'bar', label: '🍸 Bar & Nightlife' },
  { value: 'tours', label: '🗺️ Tours & Activities' },
  { value: 'wellness', label: '🧘 Wellness & Spa' },
  { value: 'entertainment', label: '🎭 Entertainment & Arts' },
  { value: 'adventure', label: '⛰️ Adventure & Outdoor' },
  { value: 'workshop', label: '🎨 Workshop & Classes' },
  { value: 'retail', label: '🛍️ Retail & Shopping' },
  { value: 'other', label: '📦 Other' }
];

export const TEAM_SIZES = [
  { value: '1', label: 'Just me' },
  { value: '2-5', label: '2-5 employees' },
  { value: '6-10', label: '6-10 employees' },
  { value: '11-25', label: '11-25 employees' },
  { value: '26-50', label: '26-50 employees' },
  { value: '50+', label: '50+ employees' }
];
