import React from 'react';
import { 
  Calendar as CalendarIcon, MapPin, Clock, Star, Eye, Users, QrCode, Share2, 
  Trash2, Search, Filter, ChevronDown, ChevronRight, ExternalLink, CalendarClock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ImageWithFallback } from '../figma/ImageWithFallback';
import { CalendarTabProps } from './types';
import { categorizeCalendarEntries } from './utils';
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

export default function CalendarTab({
  calendarEntries,
  searchQuery,
  timeFilter,
  typeFilter,
  showFilters,
  activeCollapsed,
  archivesCollapsed,
  accountPreferences,
  categoryFilter = [],
  budgetFilter = 'all',
  experienceTypeFilter = [],
  onSearchChange,
  onTimeFilterChange,
  onTypeFilterChange,
  onToggleFilters,
  onToggleActiveCollapsed,
  onToggleArchivesCollapsed,
  onProposeNewDate,
  onRemoveEntry,
  onShowQRCode,
  onOpenReview,
  onCategoryFilterChange,
  onBudgetFilterChange,
  onExperienceTypeFilterChange
}: CalendarTabProps) {
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
    onTimeFilterChange('all');
    onTypeFilterChange('all');
    if (onCategoryFilterChange) onCategoryFilterChange([]);
    if (onBudgetFilterChange) onBudgetFilterChange('all');
    if (onExperienceTypeFilterChange) onExperienceTypeFilterChange([]);
  };

  // Check if any filters are active
  const hasActiveFilters = timeFilter !== 'all' || 
    typeFilter !== 'all' ||
    categoryFilter.length > 0 || 
    budgetFilter !== 'all' || 
    experienceTypeFilter.length > 0;

  // Filter calendar entries
  let filteredCalendar = [...calendarEntries];
  
  // Apply search filter
  if (searchQuery) {
    filteredCalendar = filteredCalendar.filter(entry =>
      entry.experience?.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.experience?.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.experience?.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }
  
  // Apply time-based filter
  if (timeFilter !== 'all') {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const endOfWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const endOfMonth = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    filteredCalendar = filteredCalendar.filter(entry => {
      const entryDate = entry.suggestedDates?.[0] ? new Date(entry.suggestedDates[0]) : null;
      if (!entryDate) return false;
      
      switch (timeFilter) {
        case 'today':
          return entryDate >= today && entryDate < endOfToday;
        case 'this-week':
          return entryDate >= today && entryDate < endOfWeek;
        case 'this-month':
          return entryDate >= today && entryDate < endOfMonth;
        case 'upcoming':
          return entryDate >= today;
        default:
          return true;
      }
    });
  }
  
  // Apply type filter
  if (typeFilter === 'purchased') {
    filteredCalendar = filteredCalendar.filter(entry => entry.isPurchased === true);
  } else if (typeFilter === 'scheduled') {
    filteredCalendar = filteredCalendar.filter(entry => !entry.isPurchased);
  }

  // Apply category filter
  if (categoryFilter.length > 0) {
    filteredCalendar = filteredCalendar.filter(entry => 
      categoryFilter.includes(entry.experience?.category)
    );
  }

  // Apply experience type filter
  if (experienceTypeFilter.length > 0) {
    filteredCalendar = filteredCalendar.filter(entry => 
      experienceTypeFilter.includes(entry.experience?.type)
    );
  }

  const { active, archived } = categorizeCalendarEntries(filteredCalendar);

  const renderEntry = (entry: any, index: number) => {
    return (
      <motion.div 
        key={entry.id}
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ 
          delay: index * 0.05,
          duration: 0.3,
          type: 'spring',
          stiffness: 200
        }}
        whileHover={{ y: -4, transition: { duration: 0.2 } }}
        className="bg-white/95 backdrop-blur-xl rounded-2xl border border-gray-200/50 shadow-md hover:shadow-xl overflow-hidden transition-all duration-300"
        style={{
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
        }}
      >
        <div className="p-4">
          <div className="flex gap-3">
            {/* Image with Premium Shadow */}
            <motion.div 
              whileHover={{ scale: 1.05 }}
              transition={{ duration: 0.2 }}
              className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 shadow-lg"
            >
              <ImageWithFallback
                src={entry.experience?.image || entry.experience?.images?.[0]}
                alt={entry.experience?.title}
                className="w-full h-full object-cover"
              />
            </motion.div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-gray-900 line-clamp-1">{entry.experience?.title}</h3>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>{entry.experience?.category}</span>
                  </div>
                </div>
                {entry.isPurchased && (
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: 'spring' }}
                    className="px-2.5 py-1 bg-gradient-to-r from-green-50 to-emerald-50 rounded-full border border-green-200/50 shadow-sm"
                  >
                    <span className="text-xs text-green-700 font-medium">Purchased</span>
                  </motion.div>
                )}
              </div>
              
              {/* Date and Time with Staggered Animation */}
              <div className="space-y-1.5 mb-2">
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 }}
                  className="flex items-center gap-2 text-sm text-gray-600"
                >
                  <CalendarIcon className="w-4 h-4 text-[#eb7825]" />
                  <span>
                    {entry.suggestedDates?.[0] 
                      ? new Date(entry.suggestedDates[0]).toLocaleDateString('en-US', { 
                          weekday: 'short', 
                          month: 'short', 
                          day: 'numeric' 
                        })
                      : 'Date to be confirmed'}
                  </span>
                </motion.div>
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 }}
                  className="flex items-center gap-2 text-sm text-gray-600"
                >
                  <Clock className="w-4 h-4 text-[#eb7825]" />
                  <span>
                    {entry.suggestedDates?.[0] 
                      ? new Date(entry.suggestedDates[0]).toLocaleTimeString('en-US', { 
                          hour: 'numeric', 
                          minute: '2-digit', 
                          hour12: true 
                        })
                      : 'Time to be determined'}
                  </span>
                </motion.div>
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                  className="flex items-center gap-2 text-sm text-gray-600"
                >
                  <MapPin className="w-4 h-4 text-[#eb7825]" />
                  <span className="line-clamp-1">{entry.experience?.address || 'Location details will be provided'}</span>
                </motion.div>
              </div>

              {/* Session type indicator */}
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.25 }}
                className="mt-2"
              >
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs shadow-sm ${
                  entry.sessionType === 'solo' 
                    ? 'bg-gradient-to-r from-blue-100 to-blue-50 text-blue-600 border border-blue-200/50' 
                    : 'bg-gradient-to-r from-purple-100 to-purple-50 text-purple-600 border border-purple-200/50'
                }`}>
                  {entry.sessionType === 'solo' ? (
                    <>
                      <Eye className="w-3 h-3" />
                      <span className="font-medium">Solo Plan</span>
                    </>
                  ) : (
                    <>
                      <Users className="w-3 h-3" />
                      <span className="font-medium">{entry.sessionName || 'Group Plan'}</span>
                    </>
                  )}
                </div>
              </motion.div>
            </div>
          </div>
        </div>

        {/* Quick Actions with Premium Buttons */}
        <div className="px-4 pb-4 space-y-2">
          {/* Primary Actions */}
          <div className="flex gap-2">
            {entry.isPurchased ? (
              <>
                <motion.button 
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onShowQRCode(entry.id)}
                  className="flex-1 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white py-2.5 px-4 rounded-xl font-medium text-sm shadow-lg shadow-orange-500/30 hover:shadow-xl hover:shadow-orange-500/40 transition-all duration-300 flex items-center justify-center gap-2"
                >
                  <QrCode className="w-4 h-4" />
                  View QR Code
                </motion.button>
                {onOpenReview && (
                  <motion.button 
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => onOpenReview(entry)}
                    className="bg-white/90 backdrop-blur-sm border border-gray-200 text-gray-700 py-2.5 px-4 rounded-xl font-medium text-sm hover:bg-gray-50 hover:shadow-md transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    <Star className="w-4 h-4" />
                    Review
                  </motion.button>
                )}
              </>
            ) : (
              <>
                <motion.button 
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onProposeNewDate(entry)}
                  className="flex-1 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white py-2.5 px-4 rounded-xl font-medium text-sm shadow-lg shadow-orange-500/30 hover:shadow-xl hover:shadow-orange-500/40 transition-all duration-300 flex items-center justify-center gap-2"
                >
                  <CalendarClock className="w-4 h-4" />
                  Reschedule
                </motion.button>
                <motion.button 
                  whileHover={{ scale: 1.05, rotate: 5 }}
                  whileTap={{ scale: 0.95 }}
                  className="bg-white/90 backdrop-blur-sm border border-gray-200 text-gray-700 py-2.5 px-4 rounded-xl font-medium text-sm hover:bg-gray-50 hover:shadow-md transition-all duration-200"
                >
                  <Share2 className="w-4 h-4" />
                </motion.button>
              </>
            )}
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onRemoveEntry(entry)}
              className="bg-white/90 backdrop-blur-sm border border-red-200 text-red-600 py-2.5 px-4 rounded-xl font-medium text-sm hover:bg-red-50 hover:shadow-md transition-all duration-200"
            >
              <Trash2 className="w-4 h-4" />
            </motion.button>
          </div>

          {/* Contact Information */}
          {(entry.experience?.phoneNumber || entry.experience?.website) && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex gap-2 text-xs"
            >
              {entry.experience.phoneNumber && (
                <div className="flex-1 flex items-center gap-1.5 px-3 py-2 bg-gray-50/80 backdrop-blur-sm rounded-lg text-gray-600 border border-gray-100">
                  <span>📞</span>
                  <span>{entry.experience.phoneNumber}</span>
                </div>
              )}
              {entry.experience.website && (
                <motion.a
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  href={entry.experience.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center gap-1.5 px-3 py-2 bg-gray-50/80 backdrop-blur-sm rounded-lg text-gray-600 hover:bg-gray-100 border border-gray-100 transition-all duration-200"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Website</span>
                </motion.a>
              )}
            </motion.div>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <div className="space-y-5 px-4 sm:px-6 pt-6">
      {/* Premium Search and Filter Bar */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, type: 'spring' }}
        className="relative"
      >
        {/* Search Input with Integrated Filter Button */}
        <div className="relative flex items-center gap-2.5">
          <div className="flex-1 relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <motion.input
              whileFocus={{ scale: 1.01 }}
              type="text"
              placeholder="Search by name, date, or type..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-11 pr-4 py-3.5 bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#eb7825]/30 focus:border-[#eb7825] shadow-sm hover:shadow-md transition-all duration-200"
              style={{
                fontFamily: 'Poppins, sans-serif',
                fontWeight: 400
              }}
            />
          </div>
          
          {/* Filter Toggle Button with Animation */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onToggleFilters}
            className={`flex-shrink-0 px-4 py-3.5 rounded-2xl border transition-all duration-300 flex items-center gap-2 shadow-sm ${
              showFilters || hasActiveFilters
                ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white border-transparent shadow-lg shadow-orange-500/30'
                : 'bg-white/90 backdrop-blur-xl text-gray-600 border-gray-200/50 hover:border-[#eb7825]/50 hover:shadow-md'
            }`}
            style={{
              fontFamily: 'Poppins, sans-serif',
              fontWeight: 400
            }}
          >
            <Filter className="w-5 h-5" />
            <motion.div
              animate={{ rotate: showFilters ? 180 : 0 }}
              transition={{ duration: 0.3 }}
            >
              <ChevronDown className="w-4 h-4" />
            </motion.div>
          </motion.button>
        </div>
        
        {/* Dropdown Filters with Premium Glass Effect */}
        <AnimatePresence>
          {showFilters && (
            <motion.div 
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.3, type: 'spring' }}
              className="absolute top-full left-0 right-0 mt-2.5 bg-white/95 backdrop-blur-xl border border-gray-200/50 rounded-2xl shadow-2xl p-5 space-y-5 z-10"
              style={{
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
              }}
            >
              {/* Time Filter */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
              >
                <div className="text-xs text-gray-500 mb-3 font-semibold uppercase tracking-wide" style={{ fontFamily: 'Poppins, sans-serif' }}>
                  When
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'all', label: 'All Dates' },
                    { value: 'today', label: 'Today' },
                    { value: 'this-week', label: 'This Week' },
                    { value: 'this-month', label: 'This Month' },
                    { value: 'upcoming', label: 'Upcoming' }
                  ].map((option, idx) => (
                    <motion.button
                      key={option.value}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.15 + idx * 0.03 }}
                      whileHover={{ scale: 1.05, y: -2 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => onTimeFilterChange(option.value as any)}
                      className={`px-4 py-2 rounded-xl transition-all duration-200 text-sm shadow-sm ${
                        timeFilter === option.value
                          ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-md shadow-orange-500/30'
                          : 'bg-gray-100/80 text-gray-600 hover:bg-gray-200/80 hover:shadow-md'
                      }`}
                      style={{
                        fontFamily: 'Poppins, sans-serif',
                        fontWeight: 500
                      }}
                    >
                      {option.label}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
              
              {/* Type Filter */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
              >
                <div className="text-xs text-gray-500 mb-3 font-semibold uppercase tracking-wide" style={{ fontFamily: 'Poppins, sans-serif' }}>
                  Type
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'all', label: 'All Types' },
                    { value: 'purchased', label: 'Purchased' },
                    { value: 'scheduled', label: 'Scheduled' }
                  ].map((option, idx) => (
                    <motion.button
                      key={option.value}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.25 + idx * 0.03 }}
                      whileHover={{ scale: 1.05, y: -2 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => onTypeFilterChange(option.value as any)}
                      className={`px-4 py-2 rounded-xl transition-all duration-200 text-sm shadow-sm ${
                        typeFilter === option.value
                          ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-md shadow-orange-500/30'
                          : 'bg-gray-100/80 text-gray-600 hover:bg-gray-200/80 hover:shadow-md'
                      }`}
                      style={{
                        fontFamily: 'Poppins, sans-serif',
                        fontWeight: 500
                      }}
                    >
                      {option.label}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
              
              {/* Category Filter */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
              >
                <div className="text-xs text-gray-500 mb-3 font-semibold uppercase tracking-wide" style={{ fontFamily: 'Poppins, sans-serif' }}>
                  Category
                </div>
                <div className="flex flex-wrap gap-2">
                  {CATEGORY_OPTIONS.map((option, idx) => (
                    <motion.button
                      key={option.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.35 + idx * 0.02 }}
                      whileHover={{ scale: 1.05, y: -2 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleCategoryToggle(option.id)}
                      className={`px-3 py-2 rounded-xl transition-all duration-200 text-sm shadow-sm ${
                        categoryFilter.includes(option.id)
                          ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-md shadow-orange-500/30'
                          : 'bg-gray-100/80 text-gray-600 hover:bg-gray-200/80 hover:shadow-md'
                      }`}
                      style={{
                        fontFamily: 'Poppins, sans-serif',
                        fontWeight: 500
                      }}
                    >
                      {option.label}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
              
              {/* Experience Type Filter */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
              >
                <div className="text-xs text-gray-500 mb-3 font-semibold uppercase tracking-wide" style={{ fontFamily: 'Poppins, sans-serif' }}>
                  Experience Type
                </div>
                <div className="flex flex-wrap gap-2">
                  {EXPERIENCE_TYPE_OPTIONS.map((option, idx) => (
                    <motion.button
                      key={option.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.45 + idx * 0.02 }}
                      whileHover={{ scale: 1.05, y: -2 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleExperienceTypeToggle(option.id)}
                      className={`px-3 py-2 rounded-xl transition-all duration-200 text-sm shadow-sm ${
                        experienceTypeFilter.includes(option.id)
                          ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-md shadow-orange-500/30'
                          : 'bg-gray-100/80 text-gray-600 hover:bg-gray-200/80 hover:shadow-md'
                      }`}
                      style={{
                        fontFamily: 'Poppins, sans-serif',
                        fontWeight: 500
                      }}
                    >
                      {option.label}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
              
              {/* Clear Filters Button */}
              {hasActiveFilters && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleClearAllFilters}
                  className="w-full py-2.5 text-sm text-gray-600 hover:text-[#eb7825] transition-colors font-medium bg-gray-50/50 rounded-xl hover:bg-gray-100/50"
                  style={{
                    fontFamily: 'Poppins, sans-serif'
                  }}
                >
                  Clear all filters
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      
      {/* Active Section with Premium Header */}
      {active.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-3"
        >
          <motion.button
            whileHover={{ scale: 1.01, x: 4 }}
            whileTap={{ scale: 0.99 }}
            onClick={onToggleActiveCollapsed}
            className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gray-50/80 to-gray-100/80 backdrop-blur-sm hover:from-gray-100/80 hover:to-gray-50/80 rounded-2xl transition-all duration-200 group shadow-sm hover:shadow-md border border-gray-200/50"
          >
            <h3 className="text-sm font-semibold text-gray-800">Active ({active.length})</h3>
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
          <AnimatePresence>
            {!activeCollapsed && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-3"
              >
                {active.map((entry, index) => renderEntry(entry, index))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Archives Section with Premium Header */}
      {archived.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-3"
        >
          <motion.button
            whileHover={{ scale: 1.01, x: 4 }}
            whileTap={{ scale: 0.99 }}
            onClick={onToggleArchivesCollapsed}
            className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gray-50/80 to-gray-100/80 backdrop-blur-sm hover:from-gray-100/80 hover:to-gray-50/80 rounded-2xl transition-all duration-200 group shadow-sm hover:shadow-md border border-gray-200/50"
          >
            <h3 className="text-sm font-semibold text-gray-800">Archives ({archived.length})</h3>
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
          <AnimatePresence>
            {!archivesCollapsed && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-3"
              >
                {archived.map((entry, index) => renderEntry(entry, index))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Empty State with Premium Design */}
      {filteredCalendar.length === 0 && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="text-center py-16"
        >
          <motion.div
            animate={{ 
              y: [0, -10, 0],
              rotate: [0, 5, -5, 0]
            }}
            transition={{ 
              duration: 3,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="inline-block"
          >
            <CalendarIcon className="w-16 h-16 text-gray-300 mx-auto mb-5" />
          </motion.div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {searchQuery ? 'No events found' : 'No Scheduled Events'}
          </h3>
          <p className="text-gray-500 text-sm">
            {searchQuery 
              ? 'Try adjusting your search or filters' 
              : 'Schedule experiences from your saved list to see them here'}
          </p>
        </motion.div>
      )}
    </div>
  );
}
