import { RouteStep, PurchaseOption, ImageGalleryItem } from './types';

export const isMultiStopCategory = (categories: string[]): boolean => {
  const multiStopCategories = ['stroll', 'picnics', 'freestyle'];
  return categories.some(cat => multiStopCategories.includes(cat));
};

export const calculateTotalDuration = (routeSteps: RouteStep[]): number => {
  return routeSteps.reduce((total, step) => total + (step.isPassThrough ? 0 : step.dwellTime), 0);
};

export const validateCardForm = (
  cardName: string,
  imageGallery: ImageGalleryItem[],
  selectedCategories: string[],
  selectedTypes: string[],
  description: string,
  purchaseOptions: PurchaseOption[],
  routeSteps: RouteStep[]
): string[] => {
  const errors: string[] = [];

  // Required fields
  if (!cardName || cardName.length < 3 || cardName.length > 80) {
    errors.push('Name must be 3-80 characters');
  }
  if (imageGallery.length === 0) {
    errors.push('At least 1 image required');
  }
  if (selectedCategories.length === 0) {
    errors.push('At least 1 category required');
  }
  if (selectedTypes.length === 0) {
    errors.push('At least 1 experience type required');
  }
  if (!description || description.trim().length < 20) {
    errors.push('Description must be at least 20 characters');
  }
  
  // Packages validation
  const validPackages = purchaseOptions.filter(opt => opt.title && opt.price);
  if (validPackages.length === 0) {
    errors.push('At least 1 package required with name and price');
  }

  // Route validation
  if (routeSteps.length < 3) {
    errors.push('At least 3 route steps required');
  }
  routeSteps.forEach((step, index) => {
    if (!step.name || !step.address || !step.description || step.description.length < 20) {
      errors.push(`Route step ${index + 1}: Missing or incomplete information`);
    }
  });

  return errors;
};

export const calculatePriceRange = (purchaseOptions: PurchaseOption[], priceMin?: string, priceMax?: string): {
  min: number;
  max: number | null;
  range: string;
} => {
  const validOptions = purchaseOptions.filter(opt => opt.price);
  
  if (validOptions.length > 0) {
    const prices = validOptions.map(opt => parseFloat(opt.price) || 0);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return {
      min,
      max,
      range: `${min}-${max}`
    };
  }
  
  return {
    min: parseFloat(priceMin || '0') || 0,
    max: priceMax ? parseFloat(priceMax) : null,
    range: priceMax ? `${priceMin}-${priceMax}` : `${priceMin}+`
  };
};

export const formatCardDataForSave = (
  cardName: string,
  selectedCategories: string[],
  selectedTypes: string[],
  description: string,
  imageGallery: ImageGalleryItem[],
  purchaseOptions: PurchaseOption[],
  routeSteps: RouteStep[],
  currency: string,
  generalAvailability: any,
  cancellationPolicy: string,
  weatherPolicy: string,
  ageRestriction: string,
  selectedBusinessId: string,
  selectedBusinessName: string,
  genericPriceRangeCategory: string,
  existingCard?: any
) => {
  const heroImage = imageGallery.find(img => img.isHero);
  const allImages = imageGallery.map(img => img.url);

  const formattedPurchaseOptions = purchaseOptions
    .filter(opt => opt.title && opt.price)
    .map(opt => ({
      id: opt.id,
      title: opt.title,
      description: opt.description,
      price: parseFloat(opt.price) || 0,
      currency: currency,
      includes: opt.includes.filter(item => item.trim() !== ''),
      duration: opt.duration,
      popular: opt.popular,
      savings: opt.savings,
      availability: opt.availability,
      capacity: opt.capacity
    }));

  const priceRange = calculatePriceRange(formattedPurchaseOptions);

  return {
    id: existingCard?.id || `card-${Date.now()}`,
    title: cardName,
    categories: selectedCategories,
    category: selectedCategories[0] || '',
    experienceTypes: selectedTypes,
    description: description,
    fullDescription: description,
    image: heroImage?.url || allImages[0],
    images: allImages,
    priceMin: priceRange.min,
    priceMax: priceRange.max,
    priceRange: priceRange.range,
    genericPriceRangeCategory: genericPriceRangeCategory || undefined,
    currency,
    generalAvailability,
    purchaseOptions: formattedPurchaseOptions.length > 0 ? formattedPurchaseOptions : undefined,
    routeSteps,
    totalDuration: calculateTotalDuration(routeSteps),
    cancellationPolicy,
    weatherPolicy,
    ageRestriction,
    status: 'draft',
    createdAt: existingCard?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    matchScore: 0,
    socialStats: existingCard?.socialStats || {
      views: 0,
      likes: 0,
      saves: 0,
      shares: 0
    },
    businessId: selectedBusinessId ? selectedBusinessId : undefined,
    businessName: selectedBusinessId ? selectedBusinessName : undefined
  };
};

export const createNewRouteStep = (order: number): RouteStep => ({
  id: `${Date.now()}`,
  order,
  name: '',
  address: '',
  description: '',
  dwellTime: 30,
  notes: '',
  isPassThrough: false
});

export const createNewPurchaseOption = (): PurchaseOption => ({
  id: `option-${Date.now()}`,
  title: '',
  description: '',
  price: '',
  includes: [''],
  duration: '',
  popular: false,
  savings: '',
  availability: {
    type: 'always-available' as const
  }
});
