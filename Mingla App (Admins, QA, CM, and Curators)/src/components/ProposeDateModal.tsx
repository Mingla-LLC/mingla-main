import React, { useState } from 'react';
import { X, Calendar, Clock, CheckCircle, AlertTriangle, Copy, Loader2, Archive } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { validateFutureDateTime, isTimePastForToday } from './utils/dateUtils';

interface ProposeDateModalProps {
  isOpen: boolean;
  onClose: () => void;
  cardData: any;
  currentDateTimePreferences: {
    timeOfDay: string;
    dayOfWeek: string;
    planningTimeframe: string;
  };
  onProposeDateAccepted: (newDateTimePreferences: any) => void;
  accountPreferences: any;
}

export default function ProposeDateModal({
  isOpen,
  onClose,
  cardData,
  currentDateTimePreferences,
  onProposeDateAccepted,
  accountPreferences
}: ProposeDateModalProps) {
  const [step, setStep] = useState<'input' | 'checking' | 'result'>('input');
  const [dateOption, setDateOption] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [exactTime, setExactTime] = useState<string>('');
  const [compatibilityResult, setCompatibilityResult] = useState<{
    isCompatible: boolean;
    score: number;
    message: string;
    details: string[];
    warnings?: string[];
  } | null>(null);

  // Convert date/time picker values to actual Date objects
  const calculateActualDateTime = () => {
    const now = new Date();
    let targetDate = new Date();
    let targetTime = exactTime || '14:00';

    if (dateOption === 'now') {
      // Capture the current moment
      return {
        scheduledDate: now.toISOString(),
        scheduledTime: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        displayText: now.toLocaleString('en-US', { 
          weekday: 'long', 
          month: 'long', 
          day: 'numeric', 
          hour: 'numeric', 
          minute: '2-digit' 
        })
      };
    } else if (dateOption === 'today') {
      targetDate = new Date(now);
    } else if (dateOption === 'weekend') {
      // Calculate next Saturday
      const daysUntilSaturday = (6 - now.getDay() + 7) % 7 || 7;
      targetDate = new Date(now);
      targetDate.setDate(now.getDate() + daysUntilSaturday);
    } else if (dateOption === 'pick' && selectedDate) {
      targetDate = new Date(selectedDate);
    }

    // Set the time on the target date
    if (exactTime) {
      const [hours, minutes] = exactTime.split(':').map(Number);
      targetDate.setHours(hours, minutes, 0, 0);
    } else {
      targetDate.setHours(14, 0, 0, 0);
    }

    return {
      scheduledDate: targetDate.toISOString(),
      scheduledTime: targetTime,
      displayText: targetDate.toLocaleString('en-US', { 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric', 
        hour: 'numeric', 
        minute: '2-digit' 
      })
    };
  };

  const handleCheckCompatibility = async () => {
    // Validate that the proposed date/time is in the future
    const proposedDateTime = calculateActualDateTime();
    const validation = validateFutureDateTime(
      proposedDateTime.scheduledDate,
      proposedDateTime.scheduledTime
    );
    
    if (!validation.isValid) {
      setCompatibilityResult({
        isCompatible: false,
        score: 0,
        message: '❌ Cannot propose a date in the past',
        details: [validation.message || 'Please select a date and time in the present or future.'],
        warnings: ['Mingla only allows scheduling for current or future dates and times.']
      });
      setStep('result');
      return;
    }
    
    setStep('checking');
    
    // Simulate LLM API call with intelligent compatibility checking
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Mock LLM compatibility logic based on card data and proposed time
    const compatibility = simulateLLMCompatibilityCheck(
      cardData,
      currentDateTimePreferences,
      proposedDateTime
    );

    setCompatibilityResult(compatibility);
    setStep('result');
  };

  const simulateLLMCompatibilityCheck = (
    card: any,
    current: any,
    proposed: any
  ) => {
    // Analyze card category and characteristics
    const categoryId = card.categoryId || '';
    const isOutdoor = ['stroll', 'picnics', 'playMove'].includes(categoryId);
    const isRestaurant = ['casualEats', 'diningExp', 'sipChill'].includes(categoryId);
    const isEvening = ['screenRelax', 'diningExp'].includes(categoryId);
    const isFlexible = ['creative', 'wellness'].includes(categoryId);

    let score = 85; // Base compatibility score
    const details: string[] = [];
    const warnings: string[] = [];

    // Time of day analysis
    if (proposed.timeOfDay) {
      if (isOutdoor && proposed.timeOfDay.includes('Night')) {
        score -= 25;
        warnings.push('Outdoor activities are less enjoyable at night');
      } else if (isOutdoor && (proposed.timeOfDay.includes('Morning') || proposed.timeOfDay.includes('Afternoon'))) {
        score += 10;
        details.push('Excellent time for outdoor activities');
      }

      if (isRestaurant && (proposed.timeOfDay.includes('Afternoon') || proposed.timeOfDay.includes('Evening'))) {
        score += 10;
        details.push('Prime dining hours - great choice!');
      } else if (isRestaurant && proposed.timeOfDay.includes('Early Morning')) {
        score -= 15;
        warnings.push('Most restaurants may not be open for this activity');
      }

      if (isEvening && proposed.timeOfDay.includes('Evening')) {
        score += 15;
        details.push('Perfect timing for this evening experience');
      }
    }

    // Day of week analysis
    if (proposed.dayOfWeek) {
      if (proposed.dayOfWeek.includes('Weekend')) {
        details.push('Weekend availability - may be busier but great atmosphere');
        if (isRestaurant) {
          warnings.push('Expect higher crowds on weekends');
        }
      } else if (proposed.dayOfWeek.includes('Weekday')) {
        details.push('Weekday scheduling - typically less crowded');
        score += 5;
      }
    }

    // Planning timeframe analysis
    if (proposed.planningTimeframe) {
      if (proposed.planningTimeframe === 'This week' && card.requiresReservation) {
        score -= 10;
        warnings.push('Short notice - availability may be limited');
      } else if (proposed.planningTimeframe.includes('month')) {
        details.push('Good planning window for reservations');
      }
    }

    // Calculate final compatibility
    const isCompatible = score >= 60;
    let message = '';

    if (score >= 85) {
      message = '🌟 Excellent Match! This new date & time is perfect for this experience.';
    } else if (score >= 70) {
      message = '✅ Great Match! This date & time works well for this experience.';
    } else if (score >= 60) {
      message = '⚠️ Acceptable Match - Some considerations to keep in mind.';
    } else {
      message = '❌ Not Recommended - This date & time may not be ideal for this experience.';
    }

    return {
      isCompatible,
      score,
      message,
      details,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  };

  const handleAcceptProposal = () => {
    if (compatibilityResult?.isCompatible) {
      const proposedDateTime = calculateActualDateTime();
      onProposeDateAccepted(proposedDateTime);
      onClose();
    }
  };

  const handleReset = () => {
    setStep('input');
    setDateOption('');
    setSelectedDate('');
    setExactTime('');
    setCompatibilityResult(null);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-end sm:items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%', opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: '100%', opacity: 0, scale: 0.95 }}
          transition={{ 
            type: 'spring', 
            damping: 30, 
            stiffness: 300,
            mass: 0.8
          }}
          className="bg-white/95 backdrop-blur-xl rounded-t-3xl sm:rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl border border-white/20"
          style={{
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1)'
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header with Glassmorphism */}
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="relative bg-gradient-to-r from-[#eb7825] to-[#d6691f] px-6 py-5 text-white overflow-hidden"
          >
            <div className="absolute inset-0 bg-white/10 backdrop-blur-sm"></div>
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                <motion.div 
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                  className="bg-white/20 backdrop-blur-sm rounded-2xl p-2.5 shadow-lg"
                >
                  <Calendar className="w-6 h-6" />
                </motion.div>
                <div>
                  <motion.h2 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 }}
                    className="font-semibold text-lg"
                  >
                    Schedule Date & Time
                  </motion.h2>
                  <motion.p 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 }}
                    className="text-sm text-white/90 line-clamp-1"
                  >
                    {cardData?.title || cardData?.experience?.title}
                  </motion.p>
                </div>
              </div>
              <motion.button
                initial={{ scale: 0, rotate: 90 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.2, type: 'spring' }}
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                onClick={onClose}
                className="bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-full p-2 transition-all duration-200"
              >
                <X className="w-5 h-5" />
              </motion.button>
            </div>
          </motion.div>

          {/* Content with Staggered Animations */}
          <div className="overflow-y-auto max-h-[calc(90vh-180px)] p-6 space-y-5">
            {/* Archive Notice with Animation */}
            {cardData.isArchived && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.1 }}
                className="bg-gradient-to-br from-blue-50 to-indigo-50 backdrop-blur-sm rounded-2xl p-4 border border-blue-200/50 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: 'spring' }}
                    className="bg-blue-100 p-2.5 rounded-xl"
                  >
                    <Archive className="w-5 h-5 text-blue-600" />
                  </motion.div>
                  <div>
                    <h3 className="font-semibold text-blue-900">Archived Experience</h3>
                    <p className="text-sm text-blue-700">This experience's scheduled date has passed. You can propose a new date to schedule it again.</p>
                  </div>
                </div>
              </motion.div>
            )}
            
            {/* Current Schedule with Glassmorphism */}
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: cardData.isArchived ? 0.2 : 0.1 }}
              className="bg-gradient-to-br from-orange-50/80 to-amber-50/80 backdrop-blur-sm rounded-2xl p-5 border border-[#eb7825]/20 shadow-sm"
            >
              <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-[#eb7825]" />
                Current Date & Time
              </h3>
              {cardData.dateTimePreferences?.scheduledDate ? (
                <div className="space-y-2.5">
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 }}
                    className="flex items-center gap-3 p-3.5 bg-white/80 backdrop-blur-sm rounded-xl shadow-sm hover:shadow-md transition-all duration-200"
                  >
                    <Calendar className="w-5 h-5 text-[#eb7825]" />
                    <div>
                      <p className="text-xs text-gray-500 font-medium">Scheduled For</p>
                      <p className="font-semibold text-gray-900">
                        {new Date(cardData.dateTimePreferences.scheduledDate).toLocaleString('en-US', {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </p>
                    </div>
                  </motion.div>
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.35 }}
                    className="flex items-center gap-3 p-3.5 bg-white/80 backdrop-blur-sm rounded-xl shadow-sm hover:shadow-md transition-all duration-200"
                  >
                    <Clock className="w-5 h-5 text-[#eb7825]" />
                    <div>
                      <p className="text-xs text-gray-500 font-medium">Time</p>
                      <p className="font-semibold text-gray-900">
                        {cardData.dateTimePreferences.scheduledTime || 
                         new Date(cardData.dateTimePreferences.scheduledDate).toLocaleTimeString('en-US', {
                           hour: 'numeric',
                           minute: '2-digit'
                         })}
                      </p>
                    </div>
                  </motion.div>
                </div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="text-sm text-gray-600 bg-white/60 backdrop-blur-sm p-4 rounded-xl"
                >
                  <p className="font-medium">No specific date/time scheduled yet</p>
                  <p className="text-xs text-gray-500 mt-1.5">
                    Preferences: {currentDateTimePreferences.timeOfDay} • {currentDateTimePreferences.dayOfWeek}
                  </p>
                </motion.div>
              )}
            </motion.div>

            {/* Step 1: Input New Date/Time with Staggered Animations */}
            {step === 'input' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="space-y-5"
              >
                <motion.h3 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                  className="font-semibold text-gray-800 text-center text-lg"
                >
                  Choose New Date & Time
                </motion.h3>

                {/* Date Section with Glass Effect */}
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="bg-gray-50/80 backdrop-blur-sm rounded-2xl p-5 border border-gray-200/50 shadow-sm"
                >
                  <h4 className="text-sm font-semibold text-gray-700 mb-4">Date</h4>
                  <div className="grid grid-cols-2 gap-2.5 mb-3">
                    {[
                      { id: 'now', label: 'Now' },
                      { id: 'today', label: 'Today' },
                      { id: 'weekend', label: 'This Weekend' },
                      { id: 'pick', label: 'Pick a Date' }
                    ].map((option, idx) => (
                      <motion.button
                        key={option.id}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.35 + idx * 0.05 }}
                        whileHover={{ scale: 1.02, y: -2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setDateOption(option.id)}
                        className={`
                          py-3.5 px-4 rounded-xl transition-all duration-300 font-medium text-sm shadow-sm
                          ${dateOption === option.id 
                            ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-lg shadow-orange-500/30 scale-105' 
                            : 'bg-white text-gray-700 border border-gray-200 hover:border-[#eb7825]/50 hover:bg-orange-50/50 hover:shadow-md'
                          }
                        `}
                      >
                        {option.label}
                      </motion.button>
                    ))}
                  </div>

                  {/* Weekend Info with Slide Animation */}
                  <AnimatePresence>
                    {dateOption === 'weekend' && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0, y: -10 }}
                        animate={{ opacity: 1, height: 'auto', y: 0 }}
                        exit={{ opacity: 0, height: 0, y: -10 }}
                        transition={{ duration: 0.3 }}
                        className="bg-gradient-to-r from-orange-50 to-amber-50 p-3.5 rounded-xl border border-orange-200/50 shadow-sm overflow-hidden"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Calendar className="w-4 h-4 text-orange-600" />
                          <p className="text-sm font-medium text-orange-800">This Weekend:</p>
                        </div>
                        <p className="text-xs text-orange-700">Automatically includes Friday, Saturday & Sunday</p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Pick a Date with Slide Animation */}
                  <AnimatePresence>
                    {dateOption === 'pick' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0, y: -10 }}
                        animate={{ opacity: 1, height: 'auto', y: 0 }}
                        exit={{ opacity: 0, height: 0, y: -10 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                      >
                        <label className="block text-sm text-gray-600 mb-2.5 font-medium">Select Date</label>
                        <div className="relative">
                          <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                          <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            min={new Date().toISOString().split('T')[0]}
                            className="w-full pl-12 pr-4 py-3.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#eb7825]/30 focus:border-[#eb7825] bg-white text-sm transition-all duration-200 shadow-sm hover:shadow-md"
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>

                {/* Time Section with Slide-in Animation */}
                <AnimatePresence>
                  {dateOption !== 'now' && dateOption !== '' && (
                    <motion.div 
                      initial={{ opacity: 0, y: 20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -20, scale: 0.95 }}
                      transition={{ duration: 0.3, type: 'spring', stiffness: 200 }}
                      className="bg-gray-50/80 backdrop-blur-sm rounded-2xl p-5 border border-gray-200/50 shadow-sm"
                    >
                      <h4 className="text-sm font-semibold text-gray-700 mb-4">Time</h4>
                      
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs text-gray-600 mb-2.5 font-medium">Quick Select</label>
                          <div className="grid grid-cols-3 gap-2">
                            {(dateOption === 'today' 
                              ? ['09:00', '12:00', '15:00', '18:00', '21:00']
                              : dateOption === 'weekend'
                              ? ['10:00', '14:00', '17:00', '19:00', '22:00']
                              : ['09:00', '12:00', '15:00', '18:00', '21:00']
                            ).map((time, idx) => (
                              <motion.button
                                key={time}
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: idx * 0.05 }}
                                whileHover={{ scale: 1.05, y: -2 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => setExactTime(time)}
                                className={`
                                  py-3 px-3 rounded-xl border-2 transition-all duration-200 font-medium text-sm shadow-sm
                                  ${exactTime === time 
                                    ? 'border-[#eb7825] bg-orange-50 text-orange-700 shadow-md shadow-orange-500/20' 
                                    : 'border-gray-200 hover:border-gray-300 text-gray-700 bg-white hover:shadow-md'
                                  }
                                `}
                              >
                                {time}
                              </motion.button>
                            ))}
                          </div>
                        </div>
                        
                        <div>
                          <label className="block text-xs text-gray-600 mb-2.5 font-medium">Custom Time</label>
                          <div className="relative">
                            <Clock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                              type="time"
                              value={exactTime}
                              onChange={(e) => setExactTime(e.target.value)}
                              className="w-full pl-12 pr-4 py-3.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#eb7825]/30 focus:border-[#eb7825] bg-white text-sm transition-all duration-200 shadow-sm hover:shadow-md"
                              placeholder="Enter custom time"
                            />
                          </div>
                        </div>

                        {dateOption === 'today' && (
                          <motion.p 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-xs text-blue-700 bg-blue-50 p-3 rounded-xl border border-blue-200/50"
                          >
                            💡 Choose any time from now until the end of today
                          </motion.p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Schedule Button with Premium Animation */}
                <motion.button
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleCheckCompatibility}
                  disabled={!dateOption || (dateOption === 'pick' && !selectedDate) || (dateOption !== 'now' && !exactTime)}
                  className="w-full bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white py-4 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-xl shadow-lg shadow-orange-500/30 transition-all duration-300 flex items-center justify-center gap-2"
                >
                  Schedule
                </motion.button>
              </motion.div>
            )}

            {/* Step 2: Checking with Pulse Animation */}
            {step === 'checking' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="py-16 text-center space-y-5"
              >
                <div className="flex justify-center">
                  <motion.div
                    animate={{ 
                      rotate: 360,
                      scale: [1, 1.1, 1]
                    }}
                    transition={{ 
                      rotate: { duration: 2, repeat: Infinity, ease: 'linear' },
                      scale: { duration: 1, repeat: Infinity }
                    }}
                  >
                    <Loader2 className="w-16 h-16 text-[#eb7825]" />
                  </motion.div>
                </div>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <h3 className="font-semibold text-gray-800 mb-2 text-lg">Analyzing Compatibility...</h3>
                  <p className="text-sm text-gray-600">Our AI is checking if this date & time works for your experience</p>
                </motion.div>
              </motion.div>
            )}

            {/* Step 3: Results with Staggered Card Animations */}
            {step === 'result' && compatibilityResult && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className="space-y-4"
              >
                {/* Compatibility Score with Premium Glass Effect */}
                <motion.div 
                  initial={{ opacity: 0, y: 20, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 0.1, type: 'spring' }}
                  className={`rounded-2xl p-6 border-2 shadow-lg ${
                    compatibilityResult.isCompatible 
                      ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-200/50' 
                      : 'bg-gradient-to-br from-red-50 to-rose-50 border-red-200/50'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <motion.div
                      initial={{ scale: 0, rotate: -180 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                    >
                      {compatibilityResult.isCompatible ? (
                        <CheckCircle className="w-7 h-7 text-green-600 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="w-7 h-7 text-red-600 flex-shrink-0" />
                      )}
                    </motion.div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-3">
                        <motion.h3 
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.25 }}
                          className="font-semibold text-gray-800 text-lg"
                        >
                          Compatibility Score
                        </motion.h3>
                        <motion.span 
                          initial={{ opacity: 0, scale: 0 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
                          className={`text-3xl font-bold ${
                            compatibilityResult.isCompatible ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {compatibilityResult.score}%
                        </motion.span>
                      </div>
                      <motion.p 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.35 }}
                        className="text-sm text-gray-700 leading-relaxed"
                      >
                        {compatibilityResult.message}
                      </motion.p>
                    </div>
                  </div>
                </motion.div>

                {/* Details with Stagger Effect */}
                {compatibilityResult.details.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-gradient-to-br from-blue-50 to-indigo-50 backdrop-blur-sm rounded-2xl p-5 border border-blue-200/50 shadow-sm"
                  >
                    <h4 className="font-semibold text-blue-900 mb-3 text-sm flex items-center gap-2">
                      ✨ Analysis Details
                    </h4>
                    <ul className="space-y-2">
                      {compatibilityResult.details.map((detail, idx) => (
                        <motion.li 
                          key={idx}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.25 + idx * 0.05 }}
                          className="text-sm text-blue-800 flex items-start gap-2.5 bg-white/50 p-2 rounded-lg"
                        >
                          <span className="text-blue-400 mt-0.5">•</span>
                          <span>{detail}</span>
                        </motion.li>
                      ))}
                    </ul>
                  </motion.div>
                )}

                {/* Warnings with Stagger Effect */}
                {compatibilityResult.warnings && compatibilityResult.warnings.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="bg-gradient-to-br from-orange-50 to-amber-50 backdrop-blur-sm rounded-2xl p-5 border border-orange-200/50 shadow-sm"
                  >
                    <h4 className="font-semibold text-orange-900 mb-3 text-sm flex items-center gap-2">
                      ⚠️ Considerations
                    </h4>
                    <ul className="space-y-2">
                      {compatibilityResult.warnings.map((warning, idx) => (
                        <motion.li 
                          key={idx}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.35 + idx * 0.05 }}
                          className="text-sm text-orange-800 flex items-start gap-2.5 bg-white/50 p-2 rounded-lg"
                        >
                          <span className="text-orange-400 mt-0.5">•</span>
                          <span>{warning}</span>
                        </motion.li>
                      ))}
                    </ul>
                  </motion.div>
                )}

                {/* Proposed Schedule Summary with Glass Effect */}
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="bg-gray-50/80 backdrop-blur-sm rounded-2xl p-5 border border-gray-200/50 shadow-sm"
                >
                  <h4 className="font-semibold text-gray-700 mb-4">Proposed Schedule</h4>
                  <div className="space-y-3 text-sm">
                    {/* Date Selection */}
                    <motion.div 
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.45 }}
                      className="flex items-center justify-between p-4 bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200/50 shadow-sm hover:shadow-md transition-all duration-200"
                    >
                      <div className="flex items-center gap-3">
                        <Calendar className="w-5 h-5 text-[#eb7825]" />
                        <div>
                          <p className="text-xs text-gray-500 font-medium">Date</p>
                          <p className="font-medium text-gray-800">
                            {dateOption === 'now' && 'Now'}
                            {dateOption === 'today' && 'Today'}
                            {dateOption === 'weekend' && 'This Weekend'}
                            {dateOption === 'pick' && selectedDate && new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                      </div>
                    </motion.div>

                    {/* Time Selection */}
                    {exactTime && (
                      <motion.div 
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.5 }}
                        className="flex items-center justify-between p-4 bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200/50 shadow-sm hover:shadow-md transition-all duration-200"
                      >
                        <div className="flex items-center gap-3">
                          <Clock className="w-5 h-5 text-[#eb7825]" />
                          <div>
                            <p className="text-xs text-gray-500 font-medium">Time</p>
                            <p className="font-medium text-gray-800">{exactTime}</p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                </motion.div>

                {/* Action Buttons with Hover Effects */}
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="flex gap-3 pt-2"
                >
                  <motion.button
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleReset}
                    className="flex-1 px-4 py-3.5 border-2 border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 hover:shadow-md transition-all duration-200 whitespace-nowrap text-sm"
                  >
                    Change Time
                  </motion.button>
                  {compatibilityResult.isCompatible && (
                    <motion.button
                      whileHover={{ scale: 1.02, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleAcceptProposal}
                      className="flex-1 px-4 py-3.5 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white rounded-xl font-semibold hover:shadow-xl shadow-lg shadow-orange-500/30 transition-all duration-200 flex items-center justify-center gap-2 whitespace-nowrap text-sm"
                    >
                      <Copy className="w-4 h-4" />
                      Schedule New Date
                    </motion.button>
                  )}
                </motion.div>
              </motion.div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
