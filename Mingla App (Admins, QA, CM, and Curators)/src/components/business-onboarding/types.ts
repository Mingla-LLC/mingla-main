export interface OperatingHours {
  monday: { isOpen: boolean; open: string; close: string };
  tuesday: { isOpen: boolean; open: string; close: string };
  wednesday: { isOpen: boolean; open: string; close: string };
  thursday: { isOpen: boolean; open: string; close: string };
  friday: { isOpen: boolean; open: string; close: string };
  saturday: { isOpen: boolean; open: string; close: string };
  sunday: { isOpen: boolean; open: string; close: string };
}

export interface BusinessOnboardingData {
  // Owner info
  ownerFirstName: string;
  ownerLastName: string;
  email: string;
  
  // Business info
  businessName: string;
  businessType: 'individual' | 'llc' | 'corporation' | 'partnership' | 'nonprofit' | '';
  businessCategory: string;
  description: string;
  foundingYear: string;
  teamSize: string;
  
  // Contact info
  phone: string;
  website: string;
  socialMedia: {
    instagram: string;
    facebook: string;
    twitter: string;
  };
  
  // Location info
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  operatingHours: OperatingHours;
  
  // Media
  photos: string[];
  logo: string;
  coverImage: string;
  
  // Verification
  termsAccepted: boolean;
  marketingConsent: boolean;
  
  // Experience creation
  firstExperienceCreated: boolean;
  firstExperienceId: string;
}

export interface BusinessOnboardingFlowProps {
  onComplete: (data: BusinessOnboardingData) => void;
  onBackToSignIn?: () => void;
}

export interface BusinessOnboardingStepProps {
  data: BusinessOnboardingData;
  onUpdate: (updates: Partial<BusinessOnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}
