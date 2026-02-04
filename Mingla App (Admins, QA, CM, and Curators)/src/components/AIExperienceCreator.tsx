import React, { useState, useRef, useEffect } from 'react';
import { X, Upload, Camera, Sparkles, Loader2, ChevronRight, Edit, ArrowLeft } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { toast } from 'sonner@2.0.3';

interface AIExperienceCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onExperiencesGenerated: (experiences: any[]) => void;
  onDraftsSaved?: (experiences: any[]) => void;
  businessDescription?: string;
  currentUser?: any;
}

export default function AIExperienceCreator({
  isOpen,
  onClose,
  onExperiencesGenerated,
  onDraftsSaved,
  businessDescription = '',
  currentUser
}: AIExperienceCreatorProps) {
  const [step, setStep] = useState<'upload' | 'generating' | 'results'>('upload');
  const [description, setDescription] = useState(businessDescription);
  const [location, setLocation] = useState('');
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedExperiences, setGeneratedExperiences] = useState<any[]>([]);
  const [progress, setProgress] = useState(0);
  const [draftsSaved, setDraftsSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save drafts when modal is closed
  const handleClose = () => {
    if (generatedExperiences.length > 0 && onDraftsSaved && !draftsSaved) {
      onDraftsSaved(generatedExperiences);
      setDraftsSaved(true);
    }
    onClose();
  };

  if (!isOpen) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length + uploadedImages.length > 10) {
      toast.error('Maximum 10 images allowed');
      return;
    }
    setUploadedImages(prev => [...prev, ...files]);
  };

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleNext = () => {
    if (step === 'upload') {
      if (uploadedImages.length === 0) {
        toast.error('Please upload at least one menu image');
        return;
      }
      generateExperiences();
    }
  };

  const generateExperiences = async () => {
    setStep('generating');
    setIsGenerating(true);
    setProgress(0);

    // Simulate AI generation with progress
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 10;
      });
    }, 300);

    // Simulate API call - in production, this would analyze the menu images
    setTimeout(() => {
      clearInterval(progressInterval);
      setProgress(100);

      // Analyze the business description to create smarter mock experiences
      const descLower = description.toLowerCase();
      const isRestaurant = descLower.includes('restaurant') || descLower.includes('dining') || descLower.includes('food') || descLower.includes('menu');
      const isCafe = descLower.includes('cafe') || descLower.includes('coffee') || descLower.includes('bakery');
      const isBar = descLower.includes('bar') || descLower.includes('cocktail') || descLower.includes('drinks');
      const isFinedining = descLower.includes('fine') || descLower.includes('upscale') || descLower.includes('premium') || descLower.includes('signature');

      // Create relevant experiences based on the analysis
      const experiences = [];
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 9);

      if (isRestaurant || isFinedining) {
        experiences.push({
          id: `exp-${timestamp}-${randomSuffix}-1`,
          title: isFinedining ? 'Signature Tasting Menu' : 'Chef\'s Special Dinner',
          description: `Experience the best of what we offer. ${description.slice(0, 80)}${description.length > 80 ? '...' : ''} Perfect for special occasions and food enthusiasts.`,
          category: 'diningExp',
          experienceType: 'romantic',
          pricePerPerson: isFinedining ? 95 : 65,
          duration: '2-3 hours',
          location: location || 'Main location',
          images: uploadedImages.length > 0 ? [uploadedImages[0]] : [],
          status: 'draft',
          cancellationPolicy: 'Free cancellation up to 24 hours before',
          requirements: 'Reservation required',
          createdAt: new Date().toISOString()
        });
      }

      if (isRestaurant || isCafe) {
        experiences.push({
          id: `exp-${timestamp}-${randomSuffix}-2`,
          title: isCafe ? 'Coffee & Pastries Morning' : 'Casual Lunch Experience',
          description: `${isCafe ? 'Start your day right with our artisanal coffee and fresh pastries' : 'Enjoy a relaxed lunch with friends or colleagues'}. ${description.slice(0, 60)}${description.length > 60 ? '...' : ''}`,
          category: isCafe ? 'sipChill' : 'casualEats',
          experienceType: 'friendly',
          pricePerPerson: isCafe ? 18 : 32,
          duration: isCafe ? '1 hour' : '1-2 hours',
          location: location || 'Main location',
          images: uploadedImages.length > 1 ? [uploadedImages[1]] : uploadedImages.length > 0 ? [uploadedImages[0]] : [],
          status: 'draft',
          cancellationPolicy: 'Free cancellation up to 2 hours before',
          requirements: 'Walk-ins welcome',
          createdAt: new Date().toISOString()
        });
      }

      if (isBar || descLower.includes('happy hour')) {
        experiences.push({
          id: `exp-${timestamp}-${randomSuffix}-3`,
          title: 'Happy Hour Social',
          description: `Unwind with craft cocktails and small bites. ${description.slice(0, 70)}${description.length > 70 ? '...' : ''} Perfect for after-work gatherings.`,
          category: 'sipChill',
          experienceType: 'groupFun',
          pricePerPerson: 25,
          duration: '1-2 hours',
          location: location || 'Main location',
          images: uploadedImages.length > 2 ? [uploadedImages[2]] : uploadedImages.length > 0 ? [uploadedImages[0]] : [],
          status: 'draft',
          cancellationPolicy: 'Free cancellation up to 2 hours before',
          requirements: 'Ages 21+',
          createdAt: new Date().toISOString()
        });
      }

      // If no specific type detected, create generic dining experiences
      if (experiences.length === 0) {
        experiences.push(
          {
            id: `exp-${timestamp}-${randomSuffix}-1`,
            title: 'Signature Experience',
            description: `${description.slice(0, 100)}${description.length > 100 ? '...' : ''} A memorable dining experience.`,
            category: 'diningExp',
            experienceType: 'romantic',
            pricePerPerson: 75,
            duration: '2-3 hours',
            location: location || 'Main location',
            images: uploadedImages.length > 0 ? [uploadedImages[0]] : [],
            status: 'draft',
            cancellationPolicy: 'Free cancellation up to 24 hours before',
            requirements: 'Reservation required',
            createdAt: new Date().toISOString()
          },
          {
            id: `exp-${timestamp}-${randomSuffix}-2`,
            title: 'Casual Dining',
            description: `Relaxed atmosphere perfect for any occasion. ${description.slice(0, 80)}${description.length > 80 ? '...' : ''}`,
            category: 'casualEats',
            experienceType: 'friendly',
            pricePerPerson: 35,
            duration: '1-2 hours',
            location: location || 'Main location',
            images: uploadedImages.length > 1 ? [uploadedImages[1]] : uploadedImages.length > 0 ? [uploadedImages[0]] : [],
            status: 'draft',
            cancellationPolicy: 'Free cancellation up to 2 hours before',
            requirements: 'Walk-ins welcome',
            createdAt: new Date().toISOString()
          }
        );
      }

      setGeneratedExperiences(experiences);
      
      // Save all experiences as drafts immediately (only once)
      if (onDraftsSaved && !draftsSaved) {
        onDraftsSaved(experiences);
        setDraftsSaved(true);
      }
      
      setIsGenerating(false);
      setStep('results');
      
      setTimeout(() => {
        toast.success(`Generated ${experiences.length} experiences based on your menu! Click Edit to customize each one.`);
      }, 300);
    }, 3000);
  };

  const handleSelectExperience = (experience: any) => {
    // Don't close the AI creator, just open the editor
    onExperiencesGenerated([experience]);
  };

  const handleSelectAll = () => {
    onExperiencesGenerated(generatedExperiences);
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={step !== 'generating' ? handleClose : undefined}
      />
      
      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="relative bg-gradient-to-r from-[#eb7825] to-[#d6691f] p-6 flex-shrink-0">
          {step !== 'generating' && (
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          )}
          <div className="flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-white" />
            <div>
              <h2 className="text-2xl font-bold text-white">AI Experience Generator</h2>
              <p className="text-white/90 text-sm">
                {step === 'upload' && 'Upload your menu or photos'}
                {step === 'generating' && 'Generating your experiences...'}
                {step === 'results' && 'Review and customize generated experiences'}
              </p>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="h-1 bg-gray-200 flex-shrink-0">
          <div 
            className="h-full bg-gradient-to-r from-[#eb7825] to-[#d6691f] transition-all duration-300"
            style={{ 
              width: step === 'upload' ? '50%' : 
                     step === 'generating' ? `${50 + (progress / 2)}%` : 
                     '100%' 
            }}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 2: Upload Images */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div>
                <label className="block text-gray-900 font-medium mb-2">
                  Upload Menu or Service Offerings
                </label>
                <p className="text-sm text-gray-600 mb-4">
                  Upload images of your menu or service offerings list. AI will analyze these to generate relevant experiences.
                </p>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-[#eb7825] hover:bg-gray-50 transition-all cursor-pointer"
                >
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
                      <Upload className="w-8 h-8 text-gray-400" />
                    </div>
                    <div>
                      <p className="text-gray-900 font-medium">
                        Click to upload images
                      </p>
                      <p className="text-sm text-gray-500">
                        PNG, JPG up to 10MB each (max 10 images)
                      </p>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>

                {uploadedImages.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm text-gray-700 mb-3">
                      {uploadedImages.length} image{uploadedImages.length !== 1 ? 's' : ''} uploaded
                    </p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                      {uploadedImages.map((file, index) => (
                        <div key={index} className="relative group">
                          <img
                            src={URL.createObjectURL(file)}
                            alt={`Upload ${index + 1}`}
                            className="w-full h-24 object-cover rounded-lg border border-gray-200"
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeImage(index);
                            }}
                            className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Generating */}
          {step === 'generating' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="relative w-32 h-32 mb-6">
                <div className="absolute inset-0 border-4 border-gray-200 rounded-full" />
                <div 
                  className="absolute inset-0 border-4 border-[#eb7825] rounded-full border-t-transparent animate-spin"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-12 h-12 text-[#eb7825]" />
                </div>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Generating Experiences
              </h3>
              <p className="text-gray-600 mb-4">
                AI is analyzing your business and creating personalized experiences...
              </p>
              <div className="w-full max-w-md bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-sm text-gray-500 mt-2">{progress}%</p>
            </div>
          )}

          {/* Step 4: Results */}
          {step === 'results' && (
            <div className="space-y-4">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Generated {generatedExperiences.length} Experiences
                </h3>
                <p className="text-sm text-gray-600">
                  Select experiences to edit and publish. These are automatically saved as drafts.
                </p>
              </div>

              <div className="grid gap-4">
                {generatedExperiences.map((exp, index) => (
                  <div
                    key={exp.id}
                    className="border-2 border-gray-200 rounded-xl p-4 hover:border-[#eb7825] transition-all group"
                  >
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-24 h-24 bg-gray-100 rounded-lg overflow-hidden">
                        {exp.images.length > 0 ? (
                          <img
                            src={URL.createObjectURL(exp.images[0])}
                            alt={exp.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            <Camera className="w-8 h-8" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h4 className="text-lg font-semibold text-gray-900 mb-1">
                              {exp.title}
                            </h4>
                            <p className="text-sm text-gray-600 line-clamp-2 mb-2">
                              {exp.description}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                                {exp.category}
                              </span>
                              <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
                                ${exp.pricePerPerson}/person
                              </span>
                              <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded-full">
                                {exp.duration}
                              </span>
                            </div>
                          </div>
                          <Button
                            onClick={() => handleSelectExperience(exp)}
                            variant="outline"
                            size="sm"
                            className="border-[#eb7825] text-[#eb7825] hover:bg-[#eb7825] hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Edit className="w-4 h-4 mr-1" />
                            Edit
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 'generating' && step !== 'results' && (
          <div className="flex-shrink-0 border-t border-gray-200 p-6 flex justify-between items-center">
            <Button
              onClick={handleClose}
              variant="outline"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button
              onClick={handleNext}
              className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white"
            >
              {step === 'upload' ? 'Generate' : 'Generate'}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}