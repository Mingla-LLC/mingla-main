import { BusinessOnboardingData } from './types';

export const saveBusinessOnboardingData = async (data: BusinessOnboardingData) => {
  try {
    // Create business object
    const business = {
      id: `business-${Date.now()}`,
      ownerName: `${data.ownerFirstName} ${data.ownerLastName}`,
      ownerEmail: data.email,
      name: data.businessName,
      legalName: data.businessName,
      type: data.businessType,
      category: data.businessCategory,
      description: data.description,
      foundingYear: data.foundingYear,
      teamSize: data.teamSize,
      
      contactInfo: {
        phone: data.phone,
        email: data.email,
        website: data.website,
        socialMedia: data.socialMedia
      },
      
      location: {
        address: data.address,
        city: data.city,
        state: data.state,
        zipCode: data.zipCode,
        country: data.country
      },
      
      operatingHours: data.operatingHours,
      
      media: {
        logo: data.logo,
        coverImage: data.coverImage,
        photos: data.photos
      },
      
      verification: {
        status: 'pending',
        termsAccepted: data.termsAccepted,
        termsAcceptedDate: new Date().toISOString()
      },
      
      onboarding: {
        completed: true,
        completedDate: new Date().toISOString(),
        firstExperienceCreated: data.firstExperienceCreated,
        firstExperienceId: data.firstExperienceId
      },
      
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save to localStorage
    const businesses = JSON.parse(localStorage.getItem('businesses') || '[]');
    businesses.push(business);
    localStorage.setItem('businesses', JSON.stringify(businesses));

    // Save current user business association
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    currentUser.businessId = business.id;
    currentUser.business = business;
    currentUser.onboardingCompleted = true;
    localStorage.setItem('currentUser', JSON.stringify(currentUser));

    return business;
  } catch (error) {
    console.error('Error saving business onboarding data:', error);
    throw error;
  }
};

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validatePhone = (phone: string): boolean => {
  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');
  // Check if it has 10 digits (US format)
  return digitsOnly.length >= 10;
};

export const formatPhoneNumber = (phone: string): string => {
  const digitsOnly = phone.replace(/\D/g, '');
  
  if (digitsOnly.length === 10) {
    return `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
  }
  
  return phone;
};

export const generateBusinessSlug = (businessName: string): string => {
  return businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};
