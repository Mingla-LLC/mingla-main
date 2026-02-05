import React, { useState, useRef } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/button';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner@2.0.3';
import { BasicInfoStep } from './card-creator/BasicInfoStep';
import { LocationVenueStep } from './card-creator/LocationVenueStep';
import { PackagesAvailabilityStep } from './card-creator/PackagesAvailabilityStep';
import { PoliciesStep } from './card-creator/PoliciesStep';
import { RouteTimelineStep } from './card-creator/RouteTimelineStep';
import { ImageGalleryItem, PurchaseOption, RouteStep } from './card-creator/types';
import { calculateTotalDuration, createNewRouteStep } from './card-creator/helpers';
import { AvailabilityData } from './AvailabilityBuilder';

interface CardCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (cardData: any) => void;
  userRole?: string;
  createdBy?: string;
  businessId?: string;
  businessName?: string;
  existingCard?: any;
}

// Helper function to generate unique IDs
const generateId = () => `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

export default function CardCreatorModal({
  isOpen,
  onClose,
  onSave,
  userRole = 'business',
  createdBy = '',
  businessId = '',
  businessName = '',
  existingCard
}: CardCreatorModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['basic']));
  
  // Basic Info State
  const [cardName, setCardName] = useState(existingCard?.title || '');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(existingCard?.categories || []);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(existingCard?.types || []);
  const [description, setDescription] = useState(existingCard?.description || '');
  const [selectedBusinessId, setSelectedBusinessId] = useState(businessId);
  const [selectedBusinessName, setSelectedBusinessName] = useState(businessName);
  const [imageGallery, setImageGallery] = useState<ImageGalleryItem[]>(
    existingCard?.imageGallery?.map((url: string) => ({
      id: generateId(),
      url,
      file: undefined,
      isHero: url === existingCard?.heroImage
    })) || []
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Party-specific state
  const [partyType, setPartyType] = useState(existingCard?.partyType || '');
  const [vibeTags, setVibeTags] = useState<string[]>(existingCard?.vibeTags || []);
  const [musicGenres, setMusicGenres] = useState<string[]>(existingCard?.musicGenres || []);

  // Location/Venue State (NEW - Step 2)
  const [venueName, setVenueName] = useState(existingCard?.venueName || '');
  const [venueAddress, setVenueAddress] = useState(existingCard?.venueAddress || '');
  const [venueCity, setVenueCity] = useState(existingCard?.venueCity || '');
  const [venueState, setVenueState] = useState(existingCard?.venueState || '');
  const [venueZipCode, setVenueZipCode] = useState(existingCard?.venueZipCode || '');
  const [venueCountry, setVenueCountry] = useState(existingCard?.venueCountry || '');
  const [venueLatitude, setVenueLatitude] = useState<number | undefined>(existingCard?.venueLatitude);
  const [venueLongitude, setVenueLongitude] = useState<number | undefined>(existingCard?.venueLongitude);
  const [venuePhone, setVenuePhone] = useState(existingCard?.venuePhone || '');
  const [venueWebsite, setVenueWebsite] = useState(existingCard?.venueWebsite || '');
  const [venueNotes, setVenueNotes] = useState(existingCard?.venueNotes || '');

  // Packages & Availability State (moved to Step 3)
  const [isMultiStopExperience, setIsMultiStopExperience] = useState(existingCard?.isMultiStop || false);
  const [purchaseOptions, setPurchaseOptions] = useState<PurchaseOption[]>(existingCard?.purchaseOptions || []);
  const [generalAvailability, setGeneralAvailability] = useState<AvailabilityData>(
    existingCard?.generalAvailability || { type: 'always-available' }
  );
  const [currency, setCurrency] = useState(existingCard?.currency || 'USD');
  const [genericPriceRangeCategory, setGenericPriceRangeCategory] = useState(existingCard?.genericPriceRangeCategory || '');

  // Route/Timeline State
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>(existingCard?.routeSteps || []);

  // Policies State
  const [cancellationPolicy, setCancellationPolicy] = useState(existingCard?.cancellationPolicy || '');
  const [additionalPolicies, setAdditionalPolicies] = useState(existingCard?.additionalPolicies || '');
  const [requirements, setRequirements] = useState(existingCard?.requirements || '');
  const [accessibilityInfo, setAccessibilityInfo] = useState(existingCard?.accessibilityInfo || '');

  const businesses = JSON.parse(localStorage.getItem('businesses') || '[]');

  // Check if "parties" category is selected
  const isPartiesSelected = selectedCategories.includes('parties');
  
  // Categories that don't need route/timeline step (single-location experiences)
  const singleLocationCategories = ['sipChill', 'casualEats', 'screenRelax', 'creative', 'playMove', 'diningExp', 'wellness', 'parties'];
  const shouldHideRouteStep = selectedCategories.some(cat => singleLocationCategories.includes(cat));

  // Define steps based on whether parties is selected
  const allSteps = [
    { id: 'basic', label: 'Basic Info', component: BasicInfoStep },
    { id: 'location', label: 'Location/Venue', component: LocationVenueStep },
    { id: 'packages', label: isPartiesSelected ? 'Ticket Options' : 'Packages', component: PackagesAvailabilityStep },
    { id: 'route', label: 'Route/Timeline', component: RouteTimelineStep },
    { id: 'policies', label: 'Policies', component: PoliciesStep }
  ];

  // Filter out route step if single-location category is selected
  const steps = shouldHideRouteStep 
    ? allSteps.filter(step => step.id !== 'route')
    : allSteps;

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(section)) {
        newSet.delete(section);
      } else {
        newSet.add(section);
      }
      return newSet;
    });
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageGallery(prev => [
          ...prev,
          {
            id: generateId(),
            url: reader.result as string,
            file,
            isHero: prev.length === 0
          }
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImageFromGallery = (imageId: string) => {
    setImageGallery(prev => {
      const filtered = prev.filter(img => img.id !== imageId);
      if (filtered.length > 0 && !filtered.some(img => img.isHero)) {
        filtered[0].isHero = true;
      }
      return filtered;
    });
  };

  const setImageAsHero = (imageId: string) => {
    setImageGallery(prev =>
      prev.map(img => ({
        ...img,
        isHero: img.id === imageId
      }))
    );
  };

  // Purchase Option Handlers
  const addPurchaseOption = () => {
    const newOption: PurchaseOption = {
      id: generateId(),
      title: '',
      description: '',
      price: '',
      duration: '',
      savings: '',
      includes: [''],
      popular: false,
      availability: { type: 'same-as-experience' }
    };
    setPurchaseOptions(prev => [...prev, newOption]);
  };

  const removePurchaseOption = (id: string) => {
    setPurchaseOptions(prev => prev.filter(opt => opt.id !== id));
  };

  const updatePurchaseOption = (id: string, field: string, value: any) => {
    setPurchaseOptions(prev =>
      prev.map(opt =>
        opt.id === id ? { ...opt, [field]: value } : opt
      )
    );
  };

  const addIncludedItem = (optionId: string) => {
    setPurchaseOptions(prev =>
      prev.map(opt =>
        opt.id === optionId
          ? { ...opt, includes: [...opt.includes, ''] }
          : opt
      )
    );
  };

  const removeIncludedItem = (optionId: string, index: number) => {
    setPurchaseOptions(prev =>
      prev.map(opt =>
        opt.id === optionId
          ? { ...opt, includes: opt.includes.filter((_, i) => i !== index) }
          : opt
      )
    );
  };

  const updateIncludedItem = (optionId: string, index: number, value: string) => {
    setPurchaseOptions(prev =>
      prev.map(opt =>
        opt.id === optionId
          ? {
              ...opt,
              includes: opt.includes.map((item, i) => (i === index ? value : item))
            }
          : opt
      )
    );
  };

  const handlePackageAvailabilityChange = (optionId: string, newAvailability: AvailabilityData) => {
    setPurchaseOptions(prev =>
      prev.map(opt =>
        opt.id === optionId
          ? { ...opt, availability: newAvailability }
          : opt
      )
    );
  };

  // Route Step Handlers
  const addRouteStep = () => {
    const newStep = createNewRouteStep(routeSteps.length);
    setRouteSteps(prev => [...prev, newStep]);
  };

  const removeRouteStep = (stepId: string) => {
    setRouteSteps(prev => prev.filter(step => step.id !== stepId));
  };

  const updateRouteStep = (stepId: string, field: keyof RouteStep, value: any) => {
    setRouteSteps(prev =>
      prev.map(step =>
        step.id === stepId ? { ...step, [field]: value } : step
      )
    );
  };

  const validateCurrentStep = () => {
    const step = steps[currentStep];
    
    if (step.id === 'basic') {
      if (!cardName.trim()) {
        toast.error('Please enter an experience name');
        return false;
      }
      if (selectedCategories.length === 0) {
        toast.error('Please select at least one category');
        return false;
      }
      if (!description.trim()) {
        toast.error('Please enter a description');
        return false;
      }
      if (!selectedBusinessId) {
        toast.error('Please select a business');
        return false;
      }
      if (imageGallery.length === 0) {
        toast.error('Please add at least one image');
        return false;
      }
    }
    
    if (step.id === 'packages') {
      if (purchaseOptions.length === 0) {
        toast.error('Please add at least one package');
        return false;
      }
    }
    
    if (step.id === 'route' && isMultiStopExperience) {
      if (routeSteps.length < 2) {
        toast.error('Multi-stop experiences must have at least 2 stops');
        return false;
      }
    }
    
    return true;
  };

  const handleNext = () => {
    // Validation disabled for demo purposes
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
      setExpandedSections(new Set([steps[currentStep + 1].id]));
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      setExpandedSections(new Set([steps[currentStep - 1].id]));
    }
  };

  const handleSave = () => {
    if (!validateCurrentStep()) return;

    const heroImage = imageGallery.find(img => img.isHero);
    const duration = calculateTotalDuration(routeSteps);

    const cardData = {
      id: existingCard?.id || generateId(),
      title: cardName,
      category: selectedCategories[0],
      categories: selectedCategories,
      types: selectedTypes,
      description,
      businessId: selectedBusinessId,
      businessName: selectedBusinessName,
      createdBy,
      userRole,
      heroImage: heroImage?.url || '',
      imageGallery: imageGallery.map(img => img.url),
      purchaseOptions,
      isMultiStop: isMultiStopExperience,
      routeSteps,
      duration,
      cancellationPolicy,
      additionalPolicies,
      requirements,
      accessibilityInfo,
      // Party-specific fields
      ...(isPartiesSelected && {
        partyType,
        vibeTags,
        musicGenres
      }),
      // Location/Venue fields
      venueName,
      venueAddress,
      venueCity,
      venueState,
      venueZipCode,
      venueCountry,
      venueLatitude,
      venueLongitude,
      venuePhone,
      venueWebsite,
      venueNotes,
      status: 'draft',
      createdAt: new Date().toISOString(),
      likes: 0,
      views: 0,
      reviews: []
    };

    onSave(cardData);
    onClose();
  };

  if (!isOpen) return null;

  const CurrentStepComponent = steps[currentStep].component;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl text-gray-900">Create Experience</h2>
            <p className="text-sm text-gray-500 mt-1">
              Step {currentStep + 1} of {steps.length}: {steps[currentStep].label}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="px-6 pt-4">
          <div className="flex gap-2">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={`flex-1 h-2 rounded-full transition-all ${
                  index <= currentStep
                    ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f]'
                    : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {currentStep === 0 && (
                <BasicInfoStep
                  cardName={cardName}
                  setCardName={setCardName}
                  selectedCategories={selectedCategories}
                  setSelectedCategories={setSelectedCategories}
                  selectedTypes={selectedTypes}
                  setSelectedTypes={setSelectedTypes}
                  description={description}
                  setDescription={setDescription}
                  selectedBusinessId={selectedBusinessId}
                  setSelectedBusinessId={setSelectedBusinessId}
                  selectedBusinessName={selectedBusinessName}
                  setSelectedBusinessName={setSelectedBusinessName}
                  businesses={businesses}
                  imageGallery={imageGallery}
                  fileInputRef={fileInputRef}
                  handleFileSelect={handleFileSelect}
                  removeImageFromGallery={removeImageFromGallery}
                  setImageAsHero={setImageAsHero}
                  isPartiesSelected={isPartiesSelected}
                  partyType={partyType}
                  setPartyType={setPartyType}
                  vibeTags={vibeTags}
                  setVibeTags={setVibeTags}
                  musicGenres={musicGenres}
                  setMusicGenres={setMusicGenres}
                />
              )}
              
              {steps[currentStep]?.id === 'location' && (
                <LocationVenueStep
                  venueName={venueName}
                  setVenueName={setVenueName}
                  venueAddress={venueAddress}
                  setVenueAddress={setVenueAddress}
                  venueCity={venueCity}
                  setVenueCity={setVenueCity}
                  venueState={venueState}
                  setVenueState={setVenueState}
                  venueZipCode={venueZipCode}
                  setVenueZipCode={setVenueZipCode}
                  venueCountry={venueCountry}
                  setVenueCountry={setVenueCountry}
                  venueLatitude={venueLatitude}
                  setVenueLatitude={setVenueLatitude}
                  venueLongitude={venueLongitude}
                  setVenueLongitude={setVenueLongitude}
                  venuePhone={venuePhone}
                  setVenuePhone={setVenuePhone}
                  venueWebsite={venueWebsite}
                  setVenueWebsite={setVenueWebsite}
                  venueNotes={venueNotes}
                  setVenueNotes={setVenueNotes}
                />
              )}
              
              {steps[currentStep]?.id === 'packages' && (
                <PackagesAvailabilityStep
                  isMultiStopExperience={isMultiStopExperience}
                  setIsMultiStopExperience={setIsMultiStopExperience}
                  purchaseOptions={purchaseOptions}
                  setPurchaseOptions={setPurchaseOptions}
                  expandedSections={expandedSections}
                  toggleSection={toggleSection}
                  generalAvailability={generalAvailability}
                  setGeneralAvailability={setGeneralAvailability}
                  currency={currency}
                  setCurrency={setCurrency}
                  genericPriceRangeCategory={genericPriceRangeCategory}
                  setGenericPriceRangeCategory={setGenericPriceRangeCategory}
                  addPurchaseOption={addPurchaseOption}
                  removePurchaseOption={removePurchaseOption}
                  updatePurchaseOption={updatePurchaseOption}
                  addIncludedItem={addIncludedItem}
                  removeIncludedItem={removeIncludedItem}
                  updateIncludedItem={updateIncludedItem}
                  handlePackageAvailabilityChange={handlePackageAvailabilityChange}
                  isPartiesSelected={isPartiesSelected}
                />
              )}
              
              {steps[currentStep]?.id === 'route' && (
                <RouteTimelineStep
                  isMultiStopExperience={isMultiStopExperience}
                  routeSteps={routeSteps}
                  calculateTotalDuration={() => calculateTotalDuration(routeSteps)}
                  addRouteStep={addRouteStep}
                  removeRouteStep={removeRouteStep}
                  updateRouteStep={updateRouteStep}
                  purchaseOptions={purchaseOptions}
                />
              )}
              
              {steps[currentStep]?.id === 'policies' && (
                <PoliciesStep
                  cancellationPolicy={cancellationPolicy}
                  setCancellationPolicy={setCancellationPolicy}
                  additionalPolicies={additionalPolicies}
                  setAdditionalPolicies={setAdditionalPolicies}
                  requirements={requirements}
                  setRequirements={setRequirements}
                  accessibilityInfo={accessibilityInfo}
                  setAccessibilityInfo={setAccessibilityInfo}
                  expandedSections={expandedSections}
                  toggleSection={toggleSection}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentStep === 0}
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Previous
          </Button>
          
          {currentStep === steps.length - 1 ? (
            <Button
              onClick={handleSave}
              className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] hover:from-[#d6691f] hover:to-[#eb7825] text-white"
            >
              Create Experience
            </Button>
          ) : (
            <Button
              onClick={handleNext}
              className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] hover:from-[#d6691f] hover:to-[#eb7825] text-white"
            >
              Next
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}