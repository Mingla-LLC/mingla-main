import React from 'react';
import { 
  Star, Navigation, ChevronRight, ChevronDown, Eye, Users, ShoppingBag, 
  Calendar, Share2, Trash2, Search, Filter, MapPin, Clock, ChevronLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ImageWithFallback } from '../figma/ImageWithFallback';
import { SavedTabProps } from './types';
import { getIconComponent, categorizeSavedCards } from './utils';
import { formatCurrency } from '../utils/formatters';

// Category and Experience Type options
const CATEGORY_OPTIONS = [
  { id: 'stroll', label: 'Take a Stroll' },
  { id: 'sipChill', label: 'Sip & Chill' },
  { id: 'casualEats', label: 'Casual Eats' },
  { id: 'screenRelax', label: 'Screen & Relax' },
  { id: 'creative', label: 'Creative & Hands-On' },
  { id: 'picnics', label: 'Picnics' },
  { id: 'playMove', label: 'Play & Move' },
  { id: 'diningExp', label: 'Dining Experiences' },
  { id: 'wellness', label: 'Wellness Dates' },
  { id: 'freestyle', label: 'Freestyle' }
];

const EXPERIENCE_TYPE_OPTIONS = [
  { id: 'soloAdventure', label: 'Solo Adventure' },
  { id: 'firstDate', label: 'First Date' },
  { id: 'romantic', label: 'Romantic' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'groupFun', label: 'Group Fun' },
  { id: 'business', label: 'Business' }
];

export default function SavedTab({
  savedCards,
  searchQuery,
  filter,
  showFilters,
  activeCollapsed,
  archivesCollapsed,
  expandedCard,
  currentImageIndex,
  accountPreferences,
  categoryFilter = [],
  budgetFilter = 'all',
  experienceTypeFilter = [],
  onSearchChange,
  onFilterChange,
  onToggleFilters,
  onToggleActiveCollapsed,
  onToggleArchivesCollapsed,
  onExpandCard,
  onImageNavigation,
  onScheduleCard,
  onPurchaseCard,
  onRemoveCard,
  onShareCard,
  onCategoryFilterChange,
  onBudgetFilterChange,
  onExperienceTypeFilterChange
}: SavedTabProps) {
  // Helper functions for multi-select filters
  const handleCategoryToggle = (categoryId: string) => {
    if (!onCategoryFilterChange) return;
    
    const newCategories = categoryFilter.includes(categoryId)
      ? categoryFilter.filter(id => id !== categoryId)
      : [...categoryFilter, categoryId];
    
    onCategoryFilterChange(newCategories);
  };

  const handleExperienceTypeToggle = (typeId: string) => {
    if (!onExperienceTypeFilterChange) return;
    
    const newTypes = experienceTypeFilter.includes(typeId)
      ? experienceTypeFilter.filter(id => id !== typeId)
      : [...experienceTypeFilter, typeId];
    
    onExperienceTypeFilterChange(newTypes);
  };

  const handleClearAllFilters = () => {
    onFilterChange('all');
    if (onCategoryFilterChange) onCategoryFilterChange([]);
    if (onBudgetFilterChange) onBudgetFilterChange('all');
    if (onExperienceTypeFilterChange) onExperienceTypeFilterChange([]);
  };

  // Check if any filters are active
  const hasActiveFilters = filter !== 'all' || 
    categoryFilter.length > 0 || 
    budgetFilter !== 'all' || 
    experienceTypeFilter.length > 0;

  // Filter and categorize cards
  let filteredSaved = [...savedCards];
  
  // Apply search filter
  if (searchQuery) {
    filteredSaved = filteredSaved.filter(card =>
      card.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      card.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      card.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }
  
  // Apply source filter
  if (filter !== 'all') {
    filteredSaved = filteredSaved.filter(card => card.source === filter);
  }

  // Apply category filter
  if (categoryFilter && categoryFilter.length > 0) {
    filteredSaved = filteredSaved.filter(card => {
      // Check if card has categories array or single category
      const cardCategories = Array.isArray(card.categories) ? card.categories : [card.categoryId || card.category];
      return cardCategories.some((cat: string) => categoryFilter.includes(cat));
    });
  }

  // Apply budget filter
  if (budgetFilter && budgetFilter !== 'all') {
    filteredSaved = filteredSaved.filter(card => {
      const price = card.price || card.pricePerPerson || 0;
      switch (budgetFilter) {
        case '0-25':
          return price >= 0 && price <= 25;
        case '25-75':
          return price > 25 && price <= 75;
        case '75-150':
          return price > 75 && price <= 150;
        case '150+':
          return price > 150;
        default:
          return true;
      }
    });
  }

  // Apply experience type filter
  if (experienceTypeFilter && experienceTypeFilter.length > 0) {
    filteredSaved = filteredSaved.filter(card => {
      // Check if card has experienceTypes array or single experienceType
      const cardTypes = Array.isArray(card.experienceTypes) ? card.experienceTypes : [card.experienceType];
      return cardTypes.some((type: string) => experienceTypeFilter.includes(type));
    });
  }

  const { active: activeSaved, archived: archivedSaved } = categorizeSavedCards(filteredSaved);

  const renderCard = (card: any) => {
    const CardIcon = getIconComponent(card.categoryIcon);
    const isExpanded = expandedCard === card.id;
    const imageIndex = currentImageIndex[card.id] || 0;
    const images = card.images || [card.image];

    return (
      <div key={card.id} className="glass-card rounded-2xl card-elevated overflow-hidden spring-in">
        <div className="p-4">
          <div className="flex gap-3">
            {/* Image */}
            <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 relative group shadow-md">
              <ImageWithFallback
                src={images[imageIndex]}
                alt={card.title}
                className="w-full h-full object-cover"
              />
              {images.length > 1 && (
                <>
                  <button
                    onClick={() => onImageNavigation(card.id, 'prev', images.length)}
                    className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ChevronLeft className="w-4 h-4 text-white" />
                  </button>
                  <button
                    onClick={() => onImageNavigation(card.id, 'next', images.length)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ChevronRight className="w-4 h-4 text-white" />
                  </button>
                </>
              )}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-gray-900 line-clamp-1">{card.title}</h3>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <CardIcon className="w-4 h-4 text-[#eb7825]" />
                    <span>{card.category}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <span>{card.dateAdded || 'Recently saved'}</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-4 text-gray-600">
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 fill-[#eb7825] text-[#eb7825]" />
                    <span>{card.rating || '4.5'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Navigation className="w-4 h-4 text-[#eb7825]" />
                    <span>{card.travelTime || '15 min'}</span>
                  </div>
                  <span className="text-[#eb7825] font-semibold">
                    {card.priceRange || 
                      (card.price ? formatCurrency(card.price, accountPreferences?.currency) : '$25-50')}
                  </span>
                </div>
                
                <button
                  onClick={() => onExpandCard(isExpanded ? null : card.id)}
                  className="p-1 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <ChevronRight className={`w-4 h-4 text-gray-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>
              </div>

              {/* Source indicator */}
              <div className="mt-2">
                <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                  card.source === 'solo' 
                    ? 'bg-blue-50 text-blue-700' 
                    : 'bg-purple-50 text-purple-700'
                }`}>
                  {card.source === 'solo' ? (
                    <>
                      <Eye className="w-3 h-3" />
                      <span>Solo Discovery</span>
                    </>
                  ) : (
                    <>
                      <Users className="w-3 h-3" />
                      <span>From {card.sessionName}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="px-4 pb-4">
          <div className="flex gap-2">
            {/* Conditional Buy Now/Schedule button based on purchaseOptions */}
            {card.purchaseOptions && card.purchaseOptions.length > 0 ? (
              <button 
                onClick={() => onPurchaseCard(card)}
                className="flex-1 bg-[#eb7825] text-white py-2 px-4 rounded-xl font-medium text-sm hover:bg-[#d6691f] transition-smooth hover:scale-105 active:scale-95 flex items-center justify-center gap-1 shadow-md"
              >
                <ShoppingBag className="w-4 h-4" />
                Buy Now
              </button>
            ) : (
              <button 
                onClick={() => onScheduleCard(card)}
                className="flex-1 bg-[#eb7825] text-white py-2 px-4 rounded-xl font-medium text-sm hover:bg-[#d6691f] transition-smooth hover:scale-105 active:scale-95 flex items-center justify-center gap-1 shadow-md"
              >
                <Calendar className="w-4 h-4" />
                Schedule
              </button>
            )}
            <button 
              onClick={() => onShareCard(card)}
              className="glass-button border border-gray-200 text-gray-700 py-2 px-4 rounded-xl font-medium text-sm transition-smooth hover:scale-110 active:scale-95"
            >
              <Share2 className="w-4 h-4" />
            </button>
            <button 
              onClick={() => onRemoveCard(card)}
              className="bg-white border border-red-200 text-red-600 py-2 px-4 rounded-xl font-medium text-sm hover:bg-red-50 transition-smooth hover:scale-110 active:scale-95 shadow-sm"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="px-4 pb-4 border-t border-gray-100 pt-4 space-y-3">
            <p className="text-sm text-gray-600">{card.description}</p>
            {card.address && (
              <div className="flex items-start gap-2 text-sm text-gray-600">
                <MapPin className="w-4 h-4 text-[#eb7825] mt-0.5" />
                <span>{card.address}</span>
              </div>
            )}
            {card.duration && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Clock className="w-4 h-4 text-[#eb7825]" />
                <span>{card.duration}</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 px-4 sm:px-6 pt-6">
      {/* Compact Search and Filter Bar */}
      <div className="relative slide-up">
        {/* Search Input with Integrated Filter Button */}
        <div className="relative flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search saved experiences..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-10 pr-4 py-3 glass-input rounded-xl focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent transition-smooth"
              style={{
                fontFamily: 'Poppins, sans-serif',
                fontWeight: 400
              }}
            />
          </div>
          
          {/* Filter Toggle Button */}
          <button
            onClick={onToggleFilters}
            className={`flex-shrink-0 px-4 py-3 rounded-xl border transition-smooth flex items-center gap-2 hover:scale-105 active:scale-95 ${
              showFilters || hasActiveFilters
                ? 'bg-[#eb7825] text-white border-[#eb7825] shadow-lg'
                : 'glass-button text-gray-600 border-gray-200 hover:border-[#eb7825]'
            }`}
            style={{
              fontFamily: 'Poppins, sans-serif',
              fontWeight: 400
            }}
          >
            <Filter className="w-5 h-5" />
            <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>
        
        {/* Dropdown Filters */}
        {showFilters && (
          <div className="absolute top-full left-0 right-0 mt-2 glass-card rounded-xl shadow-xl p-4 space-y-4 z-10 spring-in max-h-[60vh] overflow-y-auto">
            {/* Source Filter */}
            <div>
              <div className="text-xs text-gray-500 mb-2" style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 500 }}>
                Source
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'All Sources' },
                  { value: 'solo', label: 'Solo' },
                  { value: 'collaboration', label: 'Collaboration' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onFilterChange(option.value as any)}
                    className={`px-3 py-1.5 rounded-lg transition-colors text-sm ${
                      filter === option.value
                        ? 'bg-[#eb7825] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    style={{
                      fontFamily: 'Poppins, sans-serif',
                      fontWeight: 400
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Category Filter */}
            <div>
              <div className="text-xs text-gray-500 mb-2" style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 500 }}>
                Category
              </div>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => handleCategoryToggle(option.id as any)}
                    className={`px-3 py-1.5 rounded-lg transition-colors text-sm ${
                      categoryFilter.includes(option.id)
                        ? 'bg-[#eb7825] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    style={{
                      fontFamily: 'Poppins, sans-serif',
                      fontWeight: 400
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Budget Filter */}
            <div>
              <div className="text-xs text-gray-500 mb-2" style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 500 }}>
                Budget
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'All Budgets' },
                  { value: '0-25', label: '$0 - $25' },
                  { value: '25-75', label: '$25 - $75' },
                  { value: '75-150', label: '$75 - $150' },
                  { value: '150+', label: '$150+' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onBudgetFilterChange(option.value as any)}
                    className={`px-3 py-1.5 rounded-lg transition-colors text-sm ${
                      budgetFilter === option.value
                        ? 'bg-[#eb7825] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    style={{
                      fontFamily: 'Poppins, sans-serif',
                      fontWeight: 400
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Experience Type Filter */}
            <div>
              <div className="text-xs text-gray-500 mb-2" style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 500 }}>
                Experience Type
              </div>
              <div className="flex flex-wrap gap-2">
                {EXPERIENCE_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => handleExperienceTypeToggle(option.id as any)}
                    className={`px-3 py-1.5 rounded-lg transition-colors text-sm ${
                      experienceTypeFilter.includes(option.id)
                        ? 'bg-[#eb7825] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    style={{
                      fontFamily: 'Poppins, sans-serif',
                      fontWeight: 400
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Clear Filters Button */}
            {hasActiveFilters && (
              <button
                onClick={handleClearAllFilters}
                className="w-full py-2 text-sm text-gray-600 hover:text-[#eb7825] transition-colors"
                style={{
                  fontFamily: 'Poppins, sans-serif',
                  fontWeight: 400
                }}
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* Active Section */}
      {activeSaved.length > 0 && (
        <div className="space-y-3">
          <motion.button
            whileHover={{ scale: 1.01, x: 4 }}
            whileTap={{ scale: 0.99 }}
            onClick={onToggleActiveCollapsed}
            className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gray-50/80 to-gray-100/80 backdrop-blur-sm hover:from-gray-100/80 hover:to-gray-50/80 rounded-2xl transition-all duration-200 group shadow-sm hover:shadow-md border border-gray-200/50"
          >
            <h3 className="text-sm font-semibold text-gray-800">Active ({activeSaved.length})</h3>
            <motion.div
              animate={{ rotate: activeCollapsed ? 0 : 0 }}
              transition={{ duration: 0.2 }}
            >
              {activeCollapsed ? (
                <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-[#eb7825] transition-colors" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-500 group-hover:text-[#eb7825] transition-colors" />
              )}
            </motion.div>
          </motion.button>
          {!activeCollapsed && activeSaved.map(renderCard)}
        </div>
      )}

      {/* Archives Section */}
      {archivedSaved.length > 0 && (
        <div className="space-y-3">
          <motion.button
            whileHover={{ scale: 1.01, x: 4 }}
            whileTap={{ scale: 0.99 }}
            onClick={onToggleArchivesCollapsed}
            className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gray-50/80 to-gray-100/80 backdrop-blur-sm hover:from-gray-100/80 hover:to-gray-50/80 rounded-2xl transition-all duration-200 group shadow-sm hover:shadow-md border border-gray-200/50"
          >
            <h3 className="text-sm font-semibold text-gray-800">Archives ({archivedSaved.length})</h3>
            <motion.div
              animate={{ rotate: archivesCollapsed ? 0 : 0 }}
              transition={{ duration: 0.2 }}
            >
              {archivesCollapsed ? (
                <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-[#eb7825] transition-colors" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-500 group-hover:text-[#eb7825] transition-colors" />
              )}
            </motion.div>
          </motion.button>
          {!archivesCollapsed && archivedSaved.map(renderCard)}
        </div>
      )}

      {/* Empty State */}
      {filteredSaved.length === 0 && (
        <div className="text-center py-12">
          <Star className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchQuery ? 'No experiences found' : 'No Saved Experiences'}
          </h3>
          <p className="text-gray-500">
            {searchQuery 
              ? 'Try adjusting your search or filters' 
              : 'Swipe right on experiences you love to save them here'}
          </p>
        </div>
      )}
    </div>
  );
}