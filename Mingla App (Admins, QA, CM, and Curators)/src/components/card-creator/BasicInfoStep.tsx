import React from 'react';
import { AlertCircle, Upload, Trash2, Star, ImageIcon, Building2, DollarSign, Sparkles } from 'lucide-react';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { motion } from 'motion/react';
import { CATEGORIES, EXPERIENCE_TYPES, PARTY_TYPES, VIBE_TAGS, MUSIC_GENRES } from './constants';
import { ImageGalleryItem } from './types';

interface BasicInfoStepProps {
  cardName: string;
  setCardName: (value: string) => void;
  selectedCategories: string[];
  setSelectedCategories: (value: string[]) => void;
  selectedTypes: string[];
  setSelectedTypes: (value: string[]) => void;
  description: string;
  setDescription: (value: string) => void;
  selectedBusinessId: string;
  setSelectedBusinessId: (value: string) => void;
  selectedBusinessName: string;
  setSelectedBusinessName: (value: string) => void;
  businesses: any[];
  imageGallery: ImageGalleryItem[];
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  removeImageFromGallery: (imageId: string) => void;
  setImageAsHero: (imageId: string) => void;
  isPartiesSelected?: boolean;
  partyType?: string;
  setPartyType?: (value: string) => void;
  vibeTags?: string[];
  setVibeTags?: (value: string[]) => void;
  musicGenres?: string[];
  setMusicGenres?: (value: string[]) => void;
}

export function BasicInfoStep({
  cardName,
  setCardName,
  selectedCategories,
  setSelectedCategories,
  selectedTypes,
  setSelectedTypes,
  description,
  setDescription,
  selectedBusinessId,
  setSelectedBusinessId,
  selectedBusinessName,
  setSelectedBusinessName,
  businesses,
  imageGallery,
  fileInputRef,
  handleFileSelect,
  removeImageFromGallery,
  setImageAsHero,
  isPartiesSelected,
  partyType = '',
  setPartyType = () => {},
  vibeTags = [],
  setVibeTags = () => {},
  musicGenres = [],
  setMusicGenres = () => {},
}: BasicInfoStepProps) {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const showBusinessSection = currentUser.role?.toLowerCase() !== 'business' && currentUser.role?.toLowerCase() !== 'qa';

  const [isGeneratingName, setIsGeneratingName] = React.useState(false);
  const [suggestedNames, setSuggestedNames] = React.useState<string[]>([]);
  const [isGeneratingDescription, setIsGeneratingDescription] = React.useState(false);
  const [suggestedDescriptions, setSuggestedDescriptions] = React.useState<string[]>([]);

  // AI Name Improvement Function
  const improveNameWithAI = () => {
    setIsGeneratingName(true);
    
    // Simulate AI generation with a delay
    setTimeout(() => {
      const userInput = cardName.trim();
      
      // Generate improved variations based on user input
      const improvements: string[] = [];
      
      // Style 1: Add descriptive adjectives
      const adjectives = ['Exclusive', 'Premium', 'Artisan', 'Signature', 'Curated', 'Authentic', 'Unforgettable', 'Unique'];
      const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
      improvements.push(`${randomAdj} ${userInput}`);
      
      // Style 2: Add experience-related suffixes
      const suffixes = ['Experience', 'Journey', 'Adventure', 'Discovery', 'Workshop', 'Tour', 'Session'];
      const randomSuffix = suffixes[Math.floor(Math.random() * suffixes.length)];
      if (!userInput.toLowerCase().includes(randomSuffix.toLowerCase())) {
        improvements.push(`${userInput} ${randomSuffix}`);
      }
      
      // Style 3: Make it more engaging with action words
      const actionPrefixes = ['Discover', 'Experience', 'Explore', 'Immerse in', 'Journey to', 'Uncover'];
      const randomPrefix = actionPrefixes[Math.floor(Math.random() * actionPrefixes.length)];
      improvements.push(`${randomPrefix} ${userInput}`);
      
      // Style 4: Add "The" prefix for prestige
      if (!userInput.toLowerCase().startsWith('the ')) {
        improvements.push(`The ${userInput}`);
      }
      
      // Style 5: Combine adjective + suffix
      const adj2 = adjectives[Math.floor(Math.random() * adjectives.length)];
      const suffix2 = suffixes[Math.floor(Math.random() * suffixes.length)];
      if (!userInput.toLowerCase().includes(suffix2.toLowerCase())) {
        improvements.push(`${adj2} ${userInput} ${suffix2}`);
      }
      
      // Style 6: Keep original but capitalize properly
      const properCased = userInput
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
      if (properCased !== userInput) {
        improvements.push(properCased);
      }
      
      // Filter to only valid length and unique values
      const validImprovements = [...new Set(improvements)]
        .filter(name => name.length <= 80)
        .slice(0, 4);
      
      setSuggestedNames(validImprovements);
      setIsGeneratingName(false);
    }, 1500);
  };

  // AI Description Improvement Function
  const improveDescriptionWithAI = () => {
    setIsGeneratingDescription(true);
    
    // Simulate AI generation with a delay
    setTimeout(() => {
      const userInput = description.trim();
      const experienceName = cardName.trim();
      
      // Get category and type labels for context
      const categoryLabels = selectedCategories
        .map(catId => CATEGORIES.find(c => c.id === catId)?.label)
        .filter(Boolean);
      const typeLabels = selectedTypes
        .map(typeId => EXPERIENCE_TYPES.find(t => t.id === typeId)?.label)
        .filter(Boolean);
      
      // Generate improved variations based on all context
      const improvements: string[] = [];
      
      // Style 1: Add experience name context at the beginning
      if (experienceName) {
        improvements.push(`Join us for ${experienceName}! ${userInput}`);
        improvements.push(`${experienceName} offers ${userInput}`);
      }
      
      // Style 2: Add category-specific enhancements
      if (categoryLabels.length > 0) {
        const categoryContext = categoryLabels[0];
        improvements.push(`A perfect ${categoryContext.toLowerCase()} experience: ${userInput}`);
        improvements.push(`${userInput} This ${categoryContext.toLowerCase()} adventure is designed to create unforgettable memories.`);
      }
      
      // Style 3: Add type-specific context
      if (typeLabels.length > 0) {
        const typeContext = typeLabels.join(' and ').toLowerCase();
        improvements.push(`${userInput} Perfect for ${typeContext} gatherings.`);
        improvements.push(`Designed as a ${typeContext} experience, ${userInput.charAt(0).toLowerCase() + userInput.slice(1)}`);
      }
      
      // Style 4: Combine name + categories for rich context
      if (experienceName && categoryLabels.length > 0) {
        improvements.push(`Experience ${experienceName} - a ${categoryLabels.join(' and ').toLowerCase()} journey where ${userInput.charAt(0).toLowerCase() + userInput.slice(1)}`);
      }
      
      // Style 5: Add compelling call-to-action ending
      const ctas = [
        'Book your spot today!',
        'Join us for an unforgettable adventure!',
        'Reserve your experience now!',
        'Don\'t miss this unique opportunity!',
        'Create memories that last a lifetime!',
      ];
      const randomCta = ctas[Math.floor(Math.random() * ctas.length)];
      improvements.push(`${userInput} ${randomCta}`);
      
      // Style 6: Enhanced with explorers language
      improvements.push(`${userInput} Perfect for explorers seeking authentic and memorable experiences.`);
      
      // Style 7: Add category + type + name all together
      if (experienceName && categoryLabels.length > 0 && typeLabels.length > 0) {
        improvements.push(`Discover ${experienceName}, our signature ${categoryLabels[0].toLowerCase()} experience designed for ${typeLabels[0].toLowerCase()} explorers. ${userInput}`);
      }
      
      // Filter to unique values and reasonable length
      const validImprovements = [...new Set(improvements)]
        .filter(desc => desc.length > 0 && desc.length <= 1000)
        .slice(0, 4);
      
      // If we don't have enough improvements, add some generic enhancements
      if (validImprovements.length < 4) {
        validImprovements.push(`${userInput} This carefully curated experience promises to exceed your expectations.`);
        validImprovements.push(`Immerse yourself in ${userInput.charAt(0).toLowerCase() + userInput.slice(1)}`);
      }
      
      setSuggestedDescriptions(validImprovements.slice(0, 4));
      setIsGeneratingDescription(false);
    }, 1500);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-6"
    >
      {/* Experience Name */}
      <div>
        <label className="block text-gray-700 mb-2">
          Experience Name <span className="text-red-500">*</span>
        </label>
        <Input
          value={cardName}
          onChange={(e) => setCardName(e.target.value)}
          placeholder="e.g., Artisan Chocolate Workshop"
          maxLength={80}
          className="rounded-xl"
        />
        <p className="text-xs text-gray-500 mt-1">{cardName.length}/80 characters</p>
        
        {/* AI Name Improvement Button - Only shows when user has typed something */}
        {cardName.trim().length > 0 && (
          <div className="mt-2">
            <Button
              type="button"
              onClick={improveNameWithAI}
              className="rounded-xl h-10 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white hover:shadow-lg hover:scale-[1.02] transition-all"
              disabled={isGeneratingName}
            >
              {isGeneratingName ? (
                <>
                  <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Improve with AI
                </>
              )}
            </Button>
          </div>
        )}
        
        {/* Suggested Names List */}
        {suggestedNames.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 p-3 bg-gradient-to-br from-orange-50 to-amber-50 rounded-xl border border-orange-200"
          >
            <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#eb7825]" />
              AI-Generated Suggestions
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {suggestedNames.map((name, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    setCardName(name);
                    setSuggestedNames([]);
                  }}
                  className="px-3 py-2 text-left rounded-lg bg-white text-gray-700 hover:bg-[#eb7825] hover:text-white transition-all duration-200 text-sm border border-gray-200 hover:border-[#eb7825] hover:shadow-md"
                >
                  {name}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Categories - Multi-select */}
      <div>
        <label className="block text-gray-700 mb-2">
          Experience Categories <span className="text-red-500">*</span> (Select at least one)
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            const isSelected = selectedCategories.includes(cat.id);
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  if (isSelected) {
                    setSelectedCategories(selectedCategories.filter(id => id !== cat.id));
                  } else {
                    setSelectedCategories([...selectedCategories, cat.id]);
                  }
                }}
                className={`p-3 sm:p-4 rounded-xl border-2 transition-all duration-200 text-left ${
                  isSelected
                    ? 'border-[#eb7825] bg-orange-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-1 sm:mb-2">
                  <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${isSelected ? 'text-[#eb7825]' : 'text-gray-500'}`} />
                  <span className={`font-medium text-sm sm:text-base ${isSelected ? 'text-orange-700' : 'text-gray-900'}`}>
                    {cat.label}
                  </span>
                </div>
                {isSelected && (
                  <p className="text-xs sm:text-sm text-orange-600">{cat.description}</p>
                )}
              </button>
            );
          })}
        </div>
        {selectedCategories.length === 0 && (
          <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-xl">
            <p className="text-xs text-orange-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Select at least one category to proceed
            </p>
          </div>
        )}
      </div>

      {/* Experience Types - Pills */}
      {!isPartiesSelected && (
        <div>
          <label className="block text-gray-700 mb-2">
            Experience Types <span className="text-red-500">*</span> (Select at least one)
          </label>
          <div className="flex flex-wrap gap-2">
            {EXPERIENCE_TYPES.map(type => {
              const Icon = type.icon;
              const isSelected = selectedTypes.includes(type.id);
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => {
                    if (isSelected) {
                      setSelectedTypes(selectedTypes.filter(t => t !== type.id));
                    } else {
                      setSelectedTypes([...selectedTypes, type.id]);
                    }
                  }}
                  className={`px-4 py-2 rounded-full transition-all duration-200 flex items-center gap-2 text-sm border ${
                    isSelected
                      ? 'border-[#eb7825] bg-[#eb7825] text-white shadow-md'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300 hover:bg-orange-50'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-gray-500'}`} />
                  <span className="whitespace-nowrap">{type.label}</span>
                </button>
              );
            })}
          </div>
          {selectedTypes.length > 0 && (
            <p className="text-xs text-gray-600 mt-2">
              {selectedTypes.length} type{selectedTypes.length === 1 ? '' : 's'} selected
            </p>
          )}
        </div>
      )}

      {/* Party-Specific Fields */}
      {isPartiesSelected && (
        <>
          {/* Party Type Dropdown */}
          <div>
            <label className="block text-gray-700 mb-2">
              Party Type <span className="text-red-500">*</span>
            </label>
            <Select value={partyType} onValueChange={setPartyType}>
              <SelectTrigger className="rounded-xl">
                <SelectValue placeholder="Select party type..." />
              </SelectTrigger>
              <SelectContent>
                {PARTY_TYPES.map(type => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Vibe Tags */}
          <div>
            <label className="block text-gray-700 mb-2">
              Vibe Tags (Select all that apply)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {VIBE_TAGS.map(tag => {
                const isSelected = vibeTags.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        setVibeTags(vibeTags.filter(t => t !== tag.id));
                      } else {
                        setVibeTags([...vibeTags, tag.id]);
                      }
                    }}
                    className={`px-3 py-2 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-sm border ${
                      isSelected
                        ? 'border-[#eb7825] bg-[#eb7825] text-white shadow-md'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300 hover:bg-orange-50'
                    }`}
                  >
                    <span>{tag.emoji}</span>
                    <span className="whitespace-nowrap">{tag.label}</span>
                  </button>
                );
              })}
            </div>
            {vibeTags.length > 0 && (
              <p className="text-xs text-gray-600 mt-2">
                {vibeTags.length} vibe{vibeTags.length === 1 ? '' : 's'} selected
              </p>
            )}
          </div>

          {/* Music Genres */}
          <div>
            <label className="block text-gray-700 mb-2">
              Music Genre (Select all that will be played)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MUSIC_GENRES.map(genre => {
                const isSelected = musicGenres.includes(genre.id);
                return (
                  <button
                    key={genre.id}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        setMusicGenres(musicGenres.filter(g => g !== genre.id));
                      } else {
                        setMusicGenres([...musicGenres, genre.id]);
                      }
                    }}
                    className={`px-4 py-3 rounded-xl transition-all duration-200 text-left border ${
                      isSelected
                        ? 'border-[#eb7825] bg-orange-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className={`font-medium ${isSelected ? 'text-[#eb7825]' : 'text-gray-900'}`}>
                          {genre.label}
                        </span>
                        {genre.subgenres.length > 0 && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {genre.subgenres.slice(0, 2).join(', ')}
                            {genre.subgenres.length > 2 ? '...' : ''}
                          </p>
                        )}
                      </div>
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-[#eb7825] flex items-center justify-center flex-shrink-0">
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            {musicGenres.length > 0 && (
              <p className="text-xs text-gray-600 mt-2">
                {musicGenres.length} genre{musicGenres.length === 1 ? '' : 's'} selected
              </p>
            )}
          </div>
        </>
      )}

      {/* Description */}
      <div>
        <label className="block text-gray-700 mb-2">
          Experience Description <span className="text-red-500">*</span>
        </label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the experience - what makes it special, what to expect, and why explorers will love it"
          rows={4}
          className="rounded-xl"
        />
        <p className="text-xs text-gray-500 mt-1">{description.length} characters • This is what explorers will see</p>
        
        {/* AI Description Improvement Button - Only shows when user has typed something */}
        {description.trim().length > 0 && (
          <div className="mt-2">
            <Button
              type="button"
              onClick={improveDescriptionWithAI}
              className="rounded-xl h-10 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white hover:shadow-lg hover:scale-[1.02] transition-all"
              disabled={isGeneratingDescription}
            >
              {isGeneratingDescription ? (
                <>
                  <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Improve with AI
                </>
              )}
            </Button>
          </div>
        )}
        
        {/* Suggested Descriptions List */}
        {suggestedDescriptions.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 p-3 bg-gradient-to-br from-orange-50 to-amber-50 rounded-xl border border-orange-200"
          >
            <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#eb7825]" />
              AI-Generated Suggestions
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {suggestedDescriptions.map((desc, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    setDescription(desc);
                    setSuggestedDescriptions([]);
                  }}
                  className="px-3 py-2 text-left rounded-lg bg-white text-gray-700 hover:bg-[#eb7825] hover:text-white transition-all duration-200 text-sm border border-gray-200 hover:border-[#eb7825] hover:shadow-md"
                >
                  {desc}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Image Gallery */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-gray-700">
            Image Gallery <span className="text-red-500">*</span>
          </label>
          {imageGallery.length > 0 && (
            <span className="text-xs text-gray-500">
              {imageGallery.length} image{imageGallery.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        
        {/* Gallery Grid - Compact Thumbnails */}
        {imageGallery.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            {imageGallery.map((image) => (
              <motion.div
                key={image.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                  image.isHero
                    ? 'border-[#eb7825] ring-2 ring-[#eb7825]/30'
                    : 'border-gray-200'
                }`}
              >
                {/* Image Preview - Smaller aspect ratio */}
                <div className="aspect-[4/3] bg-gray-100 relative">
                  <img
                    src={image.url}
                    alt="Gallery"
                    className="w-full h-full object-cover"
                  />
                  
                  {/* Hero Badge Overlay */}
                  {image.isHero && (
                    <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 bg-[#eb7825] text-white rounded-lg text-xs shadow-md">
                      <Star className="w-3 h-3 fill-white" />
                      <span className="hidden sm:inline">Main</span>
                    </div>
                  )}
                </div>
                
                {/* Control Bar - Compact */}
                <div className="p-2 flex items-center justify-between bg-white border-t border-gray-100">
                  <div className="flex-1 min-w-0">
                    {!image.isHero && (
                      <button
                        type="button"
                        onClick={() => setImageAsHero(image.id)}
                        className="text-xs text-gray-600 hover:text-[#eb7825] transition-colors truncate"
                      >
                        Set as Main
                      </button>
                    )}
                  </div>
                  
                  <button
                    type="button"
                    onClick={() => removeImageFromGallery(image.id)}
                    className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Add More Images Section */}
        <div className={`rounded-2xl border-2 border-dashed transition-all ${
          imageGallery.length === 0 
            ? 'border-[#eb7825] bg-[#eb7825]/5 p-6' 
            : 'border-gray-200 bg-gray-50 p-4'
        }`}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="space-y-3">
            {imageGallery.length === 0 && (
              <div className="text-center mb-4">
                <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-sm">
                  <ImageIcon className="w-8 h-8 text-[#eb7825]" />
                </div>
                <h4 className="text-gray-900 mb-1">Add Your First Image</h4>
                <p className="text-sm text-gray-600">
                  Upload high-quality images from your device
                </p>
              </div>
            )}

            {/* Upload from Device Button - Consistent Styling */}
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl h-12 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white hover:shadow-lg hover:scale-[1.02] transition-all w-full"
            >
              <Upload className="w-4 h-4 mr-2" />
              {imageGallery.length === 0 ? 'Upload Images' : 'Add More Images'}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}