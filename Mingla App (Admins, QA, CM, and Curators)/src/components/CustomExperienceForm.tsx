import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Wand2, Sparkles, RefreshCw, Heart, Users, Star, Globe,
  Coffee, DollarSign, Clock, MapPin, Calendar, User, UserPlus
} from 'lucide-react';

interface CustomExperienceFormProps {
  onGenerate: (data: any) => void;
  isGenerating: boolean;
  userPreferences?: any;
  onboardingData?: any;
}

export default function CustomExperienceForm({
  onGenerate,
  isGenerating,
  userPreferences,
  onboardingData
}: CustomExperienceFormProps) {
  // Determine user's main experience types from onboarding or preferences
  const userIntents = onboardingData?.intents || [];
  const hasRomanticIntent = userIntents.some((i: string) => 
    i === 'romantic' || i === 'first-dates'
  );
  const hasSoloIntent = userIntents.includes('solo-adventure');
  const hasGroupIntent = userIntents.some((i: string) => 
    i === 'group-fun' || i === 'friendly'
  );

  // State
  const [relationshipStatus, setRelationshipStatus] = useState<string>('');
  const [experienceType, setExperienceType] = useState<string>('');
  const [experiencePrompt, setExperiencePrompt] = useState('');
  const [peopleCount, setPeopleCount] = useState<number>(1);
  const [budget, setBudget] = useState<number | ''>('');
  const [duration, setDuration] = useState<string>('');
  const [vibe, setVibe] = useState<string[]>([]);

  // Dynamic experience type options based on relationship status
  const getExperienceTypeOptions = () => {
    const baseOptions = [
      { id: 'solo', label: 'Solo Adventure', icon: Star, emoji: '🌟' },
      { id: 'casual-hangout', label: 'Casual Hangout', icon: Users, emoji: '👥' },
      { id: 'group-activity', label: 'Group Activity', icon: Users, emoji: '🎉' },
    ];

    if (relationshipStatus === 'single') {
      return [
        ...baseOptions,
        { id: 'first-date', label: 'First Date', icon: Heart, emoji: '💕' },
        { id: 'meet-new-people', label: 'Meet New People', icon: UserPlus, emoji: '✨' },
      ];
    } else if (relationshipStatus === 'relationship' || relationshipStatus === 'married') {
      return [
        ...baseOptions,
        { id: 'romantic-date', label: 'Romantic Date', icon: Heart, emoji: '💘' },
        { id: 'couples-activity', label: 'Couples Activity', icon: Heart, emoji: '💑' },
      ];
    }

    return baseOptions;
  };

  // Dynamic placeholder text based on selections
  const getPlaceholderText = () => {
    if (!experienceType) {
      return "Describe what you're looking for...";
    }

    const placeholders: { [key: string]: string } = {
      'solo': 'e.g., "A peaceful afternoon exploring local art galleries"',
      'first-date': 'e.g., "Fun and relaxed activity for getting to know someone"',
      'romantic-date': 'e.g., "Intimate dinner with stunning views and live music"',
      'casual-hangout': 'e.g., "Coffee and conversation at a cozy spot"',
      'couples-activity': 'e.g., "Adventurous outdoor activity we can enjoy together"',
      'group-activity': 'e.g., "Fun evening activity for 4-6 friends"',
      'meet-new-people': 'e.g., "Social event or class to meet like-minded people"',
    };

    return placeholders[experienceType] || "Describe your ideal experience...";
  };

  // Dynamic vibe options based on experience type
  const getVibeOptions = () => {
    const allVibes = [
      { id: 'relaxed', label: 'Relaxed', emoji: '😌' },
      { id: 'adventurous', label: 'Adventurous', emoji: '🏔️' },
      { id: 'romantic', label: 'Romantic', emoji: '💖' },
      { id: 'energetic', label: 'Energetic', emoji: '⚡' },
      { id: 'cultural', label: 'Cultural', emoji: '🎭' },
      { id: 'foodie', label: 'Foodie', emoji: '🍽️' },
      { id: 'outdoors', label: 'Outdoors', emoji: '🌿' },
      { id: 'cozy', label: 'Cozy', emoji: '☕' },
    ];

    // Filter based on experience type
    if (experienceType === 'romantic-date' || experienceType === 'couples-activity') {
      return allVibes.filter(v => 
        ['romantic', 'relaxed', 'cultural', 'foodie', 'cozy', 'adventurous'].includes(v.id)
      );
    } else if (experienceType === 'group-activity') {
      return allVibes.filter(v => 
        ['energetic', 'adventurous', 'cultural', 'foodie', 'outdoors'].includes(v.id)
      );
    }

    return allVibes;
  };

  const toggleVibe = (vibeId: string) => {
    setVibe(prev => 
      prev.includes(vibeId) ? prev.filter(v => v !== vibeId) : [...prev, vibeId]
    );
  };

  const handleSubmit = () => {
    onGenerate({
      relationshipStatus,
      experienceType,
      experiencePrompt,
      peopleCount,
      budget,
      duration,
      vibe
    });
  };

  const canSubmit = experiencePrompt.trim().length > 0 && experienceType;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="mx-4 mt-6 space-y-6"
    >
      {/* Hero Section */}
      <div className="glass-card rounded-2xl p-6 shadow-lg spring-in">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-xl shadow-lg">
            <Wand2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Create Custom Experience</h2>
            <p className="text-sm text-gray-600">AI-powered local experience generator</p>
          </div>
        </div>
      </div>

      {/* Step 1: Relationship Status */}
      <div className="glass-card rounded-2xl p-6 shadow-lg slide-up" style={{ animationDelay: '0.05s' }}>
        <label className="block text-sm font-semibold text-gray-900 mb-3">
          What's your current status?
        </label>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: 'single', label: 'Single', emoji: '🙋' },
            { id: 'relationship', label: 'In a Relationship', emoji: '💑' },
            { id: 'married', label: 'Married', emoji: '💍' },
            { id: 'its-complicated', label: "It's Complicated", emoji: '🤔' },
          ].map(status => (
            <button
              key={status.id}
              onClick={() => setRelationshipStatus(status.id)}
              className={`
                py-4 px-4 rounded-xl transition-smooth text-sm font-medium hover:scale-105 active:scale-95 shadow-sm hover:shadow-md group
                ${relationshipStatus === status.id
                  ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-md'
                  : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-orange-200'
                }
              `}
            >
              <div className="text-2xl mb-1 transition-smooth group-hover:scale-110">{status.emoji}</div>
              <div>{status.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Step 2: Experience Type (shows after relationship status selected) */}
      {relationshipStatus && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6 shadow-lg"
        >
          <label className="block text-sm font-semibold text-gray-900 mb-3">
            What type of experience?
          </label>
          <div className="grid grid-cols-2 gap-3">
            {getExperienceTypeOptions().map(type => {
              const Icon = type.icon;
              return (
                <button
                  key={type.id}
                  onClick={() => setExperienceType(type.id)}
                  className={`
                    py-4 px-4 rounded-xl transition-smooth text-sm font-medium hover:scale-105 active:scale-95 shadow-sm hover:shadow-md group
                    ${experienceType === type.id
                      ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-md'
                      : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-orange-200'
                    }
                  `}
                >
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <span className="text-xl">{type.emoji}</span>
                    <Icon className={`w-4 h-4 transition-smooth group-hover:scale-110 ${
                      experienceType === type.id ? 'text-white' : 'text-gray-500'
                    }`} />
                  </div>
                  <div>{type.label}</div>
                </button>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Step 3: Main Prompt (shows after experience type selected) */}
      {experienceType && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6 shadow-lg"
        >
          <label className="block text-sm font-semibold text-gray-900 mb-3">
            Describe your ideal experience
          </label>
          <textarea
            value={experiencePrompt}
            onChange={(e) => setExperiencePrompt(e.target.value)}
            placeholder={getPlaceholderText()}
            className="w-full px-4 py-4 bg-white/50 glass-input border-2 border-gray-200 rounded-xl text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#eb7825] transition-smooth shadow-sm min-h-[120px] resize-none"
            autoFocus
          />
        </motion.div>
      )}

      {/* Step 4: Additional Details (shows after prompt is entered) */}
      {experiencePrompt.trim().length > 10 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Vibe Selection */}
          <div className="glass-card rounded-2xl p-6 shadow-lg">
            <label className="block text-sm font-semibold text-gray-900 mb-3">
              Select the vibe (optional)
            </label>
            <div className="flex flex-wrap gap-2">
              {getVibeOptions().map(vibeOption => (
                <button
                  key={vibeOption.id}
                  onClick={() => toggleVibe(vibeOption.id)}
                  className={`
                    px-4 py-2 rounded-full text-sm font-medium transition-smooth hover:scale-105 active:scale-95 shadow-sm
                    ${vibe.includes(vibeOption.id)
                      ? 'bg-[#eb7825] text-white shadow-md'
                      : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-orange-200'
                    }
                  `}
                >
                  <span className="mr-1">{vibeOption.emoji}</span>
                  {vibeOption.label}
                </button>
              ))}
            </div>
          </div>

          {/* Budget and Duration */}
          <div className="grid grid-cols-2 gap-4">
            <div className="glass-card rounded-xl p-4 shadow-lg">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Budget per person
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value ? Number(e.target.value) : '')}
                  placeholder="50"
                  className="w-full pl-10 pr-3 py-3 glass-input border-2 border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#eb7825] transition-smooth"
                />
              </div>
            </div>

            <div className="glass-card rounded-xl p-4 shadow-lg">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Duration
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <select
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-full pl-10 pr-3 py-3 glass-input border-2 border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:border-[#eb7825] transition-smooth appearance-none"
                >
                  <option value="">Select</option>
                  <option value="1-2">1-2 hours</option>
                  <option value="2-4">2-4 hours</option>
                  <option value="4-6">4-6 hours</option>
                  <option value="full-day">Full day</option>
                  <option value="evening">Evening</option>
                </select>
              </div>
            </div>
          </div>

          {/* Number of People (if not solo) */}
          {experienceType !== 'solo' && (
            <div className="glass-card rounded-xl p-4 shadow-lg">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Number of people
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="number"
                  min="2"
                  max="20"
                  value={peopleCount}
                  onChange={(e) => setPeopleCount(Number(e.target.value))}
                  placeholder="2"
                  className="w-full pl-10 pr-3 py-3 glass-input border-2 border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#eb7825] transition-smooth"
                />
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Generate Button */}
      {canSubmit && (
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={handleSubmit}
          disabled={isGenerating}
          className="w-full bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white py-5 rounded-2xl font-bold text-lg hover:shadow-lg transition-smooth disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-lg hover:scale-105 active:scale-95"
        >
          {isGenerating ? (
            <>
              <RefreshCw className="w-6 h-6 animate-spin" />
              Crafting your experience...
            </>
          ) : (
            <>
              <Sparkles className="w-6 h-6" />
              Generate Custom Experience
            </>
          )}
        </motion.button>
      )}

      <p className="text-center text-sm text-gray-500">
        AI will create 3 personalized local experiences based on your preferences
      </p>
    </motion.div>
  );
}