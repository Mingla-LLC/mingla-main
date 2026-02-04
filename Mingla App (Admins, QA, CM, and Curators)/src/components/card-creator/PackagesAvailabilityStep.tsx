import React from 'react';
import { DollarSign, Plus, Trash2, X, Calendar, AlertCircle, TrendingUp, Camera, Upload, Sparkles, Image as ImageIcon } from 'lucide-react';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import { motion } from 'motion/react';
import AvailabilityBuilder, { AvailabilityData } from '../AvailabilityBuilder';
import { PurchaseOption } from './types';
import { WORLD_CURRENCIES, PRICE_RANGE_CATEGORIES } from './constants';

interface PackagesAvailabilityStepProps {
  generalAvailability: AvailabilityData;
  setGeneralAvailability: (value: AvailabilityData) => void;
  currency: string;
  setCurrency: (value: string) => void;
  genericPriceRangeCategory: string;
  setGenericPriceRangeCategory: (value: string) => void;
  purchaseOptions: PurchaseOption[];
  addPurchaseOption: () => void;
  removePurchaseOption: (id: string) => void;
  updatePurchaseOption: (id: string, field: string, value: any) => void;
  addIncludedItem: (optionId: string) => void;
  removeIncludedItem: (optionId: string, index: number) => void;
  updateIncludedItem: (optionId: string, index: number, value: string) => void;
  handlePackageAvailabilityChange: (optionId: string, newAvailability: AvailabilityData) => void;
  isPartiesSelected?: boolean;
}

export function PackagesAvailabilityStep({
  generalAvailability,
  setGeneralAvailability,
  currency,
  setCurrency,
  genericPriceRangeCategory,
  setGenericPriceRangeCategory,
  purchaseOptions,
  addPurchaseOption,
  removePurchaseOption,
  updatePurchaseOption,
  addIncludedItem,
  removeIncludedItem,
  updateIncludedItem,
  handlePackageAvailabilityChange,
  isPartiesSelected,
}: PackagesAvailabilityStepProps) {
  const [isGeneratingFromImage, setIsGeneratingFromImage] = React.useState(false);
  const [uploadedImage, setUploadedImage] = React.useState<string | null>(null);
  const menuImageInputRef = React.useRef<HTMLInputElement>(null);
  const cameraInputRef = React.useRef<HTMLInputElement>(null);

  // Group currencies by region
  const currenciesByRegion = WORLD_CURRENCIES.reduce((acc, curr) => {
    const region = curr.region || 'Other';
    if (!acc[region]) acc[region] = [];
    acc[region].push(curr);
    return acc;
  }, {} as Record<string, typeof WORLD_CURRENCIES>);

  // AI Image Analysis to Generate Packages
  const generatePackagesFromImage = (imageDataUrl: string) => {
    setIsGeneratingFromImage(true);
    setUploadedImage(imageDataUrl);
    
    // Simulate AI image analysis with a delay
    setTimeout(() => {
      // Mock AI extraction - in production, this would use actual AI/OCR
      const mockPackages = [
        {
          title: 'Basic Experience',
          price: '49',
          description: 'Perfect introduction to our signature experience with essential features and personalized attention.',
          duration: '1 hour',
          savings: '',
          includes: ['Welcome drink', 'Introduction session', 'Basic materials'],
          popular: false
        },
        {
          title: 'Premium Package',
          price: '89',
          description: 'Enhanced experience with additional perks, extended time, and exclusive access to premium features.',
          duration: '2 hours',
          savings: 'Save $20',
          includes: ['Welcome drink', 'Premium materials', 'Souvenir photo', 'Take-home gift'],
          popular: true
        },
        {
          title: 'VIP Ultimate',
          price: '149',
          description: 'The complete luxury experience with everything included, private attention, and exclusive benefits.',
          duration: '3 hours',
          savings: 'Save $40',
          includes: ['Champagne welcome', 'Private session', 'Premium materials', 'Professional photos', 'Gift package', 'Certificate'],
          popular: false
        },
        {
          title: 'Group Special',
          price: '199',
          description: 'Designed for groups of 4-6 people, includes shared experiences and team activities with group discounts.',
          duration: '2.5 hours',
          savings: 'Save $50 per group',
          includes: ['Group welcome drinks', 'Shared materials', 'Team activity', 'Group photo', 'Snacks included'],
          popular: false
        }
      ];

      // Add each generated package
      mockPackages.forEach((pkg, index) => {
        // Small delay between each package to show progressive generation
        setTimeout(() => {
          addPurchaseOption();
          // Get the last added package's ID (this is a simplification)
          // In a real scenario, you'd need to track the new package ID from addPurchaseOption
          setTimeout(() => {
            const newPackageIndex = purchaseOptions.length + index;
            const allPackages = [...purchaseOptions];
            
            if (allPackages.length > newPackageIndex) {
              const newPackageId = allPackages[newPackageIndex]?.id;
              if (newPackageId) {
                updatePurchaseOption(newPackageId, 'title', pkg.title);
                updatePurchaseOption(newPackageId, 'price', pkg.price);
                updatePurchaseOption(newPackageId, 'description', pkg.description);
                updatePurchaseOption(newPackageId, 'duration', pkg.duration);
                updatePurchaseOption(newPackageId, 'savings', pkg.savings);
                updatePurchaseOption(newPackageId, 'popular', pkg.popular);
                
                // Update includes
                pkg.includes.forEach((item, itemIdx) => {
                  if (itemIdx === 0) {
                    updateIncludedItem(newPackageId, 0, item);
                  } else {
                    addIncludedItem(newPackageId);
                    setTimeout(() => {
                      updateIncludedItem(newPackageId, itemIdx, item);
                    }, 100);
                  }
                });
              }
            }
          }, 200);
        }, index * 300);
      });

      setTimeout(() => {
        setIsGeneratingFromImage(false);
        setUploadedImage(null);
      }, mockPackages.length * 300 + 500);
    }, 2000);
  };

  // Handle file upload from device
  const handleMenuImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const imageDataUrl = event.target?.result as string;
        generatePackagesFromImage(imageDataUrl);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle camera capture
  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const imageDataUrl = event.target?.result as string;
        generatePackagesFromImage(imageDataUrl);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-6"
    >
      {/* General Experience Availability */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <div className="mb-4">
          <h3 className="text-gray-900 mb-2 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-[#eb7825]" />
            General Experience Availability
          </h3>
          <p className="text-sm text-gray-600">
            This determines when your experience appears to explorers in their feed. Set the master schedule here.
          </p>
        </div>
        
        <AvailabilityBuilder
          value={generalAvailability}
          onChange={setGeneralAvailability}
          label=""
        />
        
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-xs text-blue-700">
            💡 <strong>Tip:</strong> This availability is what explorers see. Packages can match or be more restrictive than this schedule.
          </p>
        </div>
      </div>

      {/* Generic Price Range Category for Recommendation Engine */}
      <div className="border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-gray-900 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#eb7825]" />
            Price Range Per Person (Optional)
          </h3>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          {PRICE_RANGE_CATEGORIES.map((category) => {
            const isSelected = genericPriceRangeCategory === category.id;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setGenericPriceRangeCategory(category.id)}
                className={`p-2 rounded-lg border transition-all duration-200 ${
                  isSelected
                    ? 'border-[#eb7825] bg-[#eb7825]/5 text-[#eb7825]'
                    : 'border-gray-200 bg-white hover:border-[#eb7825]/30'
                }`}
              >
                <div className="text-sm font-medium text-center">{category.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Purchase Packages */}
      <div className="border-t pt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-gray-900 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-[#eb7825]" />
              {isPartiesSelected ? 'Ticket Options' : 'Packages & Products'} <span className="text-red-500">*</span>
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              {isPartiesSelected 
                ? 'Create ticket tiers for your party. Each ticket type is a standalone product with its own pricing and availability.'
                : 'Create purchasable packages. Each package is a standalone product with its own pricing and availability.'}
            </p>
          </div>
        </div>

        {/* AI Image Upload Section */}
        {!isPartiesSelected && (
          <motion.div 
            className="mb-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-5"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {isGeneratingFromImage ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-6"
              >
                {uploadedImage && (
                  <img 
                    src={uploadedImage} 
                    alt="Uploaded menu" 
                    className="w-24 h-24 object-cover rounded-lg mx-auto mb-4 border border-gray-200"
                  />
                )}
                <div className="flex items-center justify-center gap-2 text-gray-900 mb-3">
                  <Sparkles className="w-5 h-5 text-[#eb7825] animate-pulse" />
                  <span className="text-sm">Generating packages...</span>
                </div>
                <div className="w-full max-w-xs mx-auto bg-gray-100 rounded-full h-1 overflow-hidden">
                  <motion.div 
                    className="h-full bg-[#eb7825]"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 2, ease: "easeInOut" }}
                  />
                </div>
              </motion.div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-5 h-5 text-[#eb7825]" />
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-sm font-medium text-gray-900">AI Package Generator</p>
                    <p className="text-xs text-gray-500">Upload your menu to auto-create packages</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    variant="outline"
                    className="flex-1 sm:flex-none rounded-lg h-10 px-4 border-gray-300 hover:bg-gray-50"
                    disabled={isGeneratingFromImage}
                  >
                    <Camera className="w-4 h-4 sm:mr-0 mr-2" />
                    <span className="sm:hidden">Camera</span>
                  </Button>
                  
                  <Button
                    type="button"
                    onClick={() => menuImageInputRef.current?.click()}
                    className="flex-1 sm:flex-none rounded-lg h-10 px-4 bg-[#eb7825] text-white hover:bg-[#d6691f]"
                    disabled={isGeneratingFromImage}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Upload
                  </Button>
                </div>
              </div>
            )}
            
            {/* Hidden file inputs */}
            <input
              type="file"
              ref={menuImageInputRef}
              onChange={handleMenuImageUpload}
              accept="image/*"
              className="hidden"
            />
            <input
              type="file"
              ref={cameraInputRef}
              onChange={handleCameraCapture}
              accept="image/*"
              capture="environment"
              className="hidden"
            />
          </motion.div>
        )}

        {purchaseOptions.length > 0 && (
          <div className="space-y-4 mb-4">
            {purchaseOptions.map((option, index) => (
              <div key={option.id} className="bg-white border-2 border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-gray-700 flex items-center gap-2">
                    Package {index + 1}
                    {option.popular && (
                      <span className="text-xs bg-[#eb7825] text-white px-2 py-1 rounded-full">
                        Popular
                      </span>
                    )}
                  </h4>
                  <button
                    onClick={() => removePurchaseOption(option.id)}
                    className="text-red-600 hover:text-red-700 p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      value={option.title}
                      onChange={(e) => updatePurchaseOption(option.id, 'title', e.target.value)}
                      placeholder={isPartiesSelected ? "Ticket name (e.g., 'General Admission')" : "Package name (e.g., 'Couples Special')"}
                      className="rounded-xl"
                    />
                    <Input
                      type="number"
                      value={option.price}
                      onChange={(e) => updatePurchaseOption(option.id, 'price', e.target.value)}
                      placeholder="Price"
                      min="0"
                      className="rounded-xl"
                    />
                  </div>

                  <Textarea
                    value={option.description}
                    onChange={(e) => updatePurchaseOption(option.id, 'description', e.target.value)}
                    placeholder={isPartiesSelected ? "Brief description of this ticket tier" : "Brief description of this package"}
                    rows={2}
                    className="rounded-xl"
                  />

                  {!isPartiesSelected && (
                    <>
                      {/* Package Availability */}
                      <div className="bg-gray-50 rounded-lg p-3 mt-4">
                        <AvailabilityBuilder
                          value={option.availability}
                          onChange={(newAvail) => handlePackageAvailabilityChange(option.id, newAvail)}
                          label="Package Availability"
                          description="Set when this specific package is available"
                          isPackageLevel={true}
                          generalAvailability={generalAvailability}
                          experienceAvailability={generalAvailability}
                        />
                      </div>

                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={option.popular}
                          onChange={(e) => updatePurchaseOption(option.id, 'popular', e.target.checked)}
                        />
                        <span>Mark as Popular</span>
                      </label>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <Button
          onClick={addPurchaseOption}
          variant="outline"
          className="w-full rounded-xl border-dashed border-2 border-[#eb7825] text-[#eb7825] hover:bg-[#eb7825]/5"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Package
        </Button>
        
        {purchaseOptions.length === 0 && (
          <p className="text-sm text-gray-500 text-center mt-2">
            Add at least one package to enable purchases
          </p>
        )}
      </div>
    </motion.div>
  );
}