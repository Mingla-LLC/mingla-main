import React from 'react';
import { Heart, Coffee, MapPin, DollarSign, Clock, Calendar, Users, Navigation, Edit } from 'lucide-react';
import { OnboardingData } from '../types';
import MinglaLogo from '../../MinglaLogo';

interface CompletionStepProps {
  data: OnboardingData;
  onEditStep?: (step: number) => void;
}

export default function CompletionStep({ data, onEditStep }: CompletionStepProps) {
  const getSummaryItems = () => {
    const items = [];

    // User Profile
    if (data.userProfile.firstName && data.userProfile.lastName) {
      items.push({
        icon: Users,
        label: 'Profile',
        value: `${data.userProfile.firstName} ${data.userProfile.lastName}`,
        step: 0
      });
    }

    // Intents
    if (data.intents.length > 0) {
      items.push({
        icon: Heart,
        label: 'Intents',
        value: data.intents.map(i => i.title).join(', '),
        step: 1
      });
    }

    // Vibes
    if (data.vibes.length > 0) {
      items.push({
        icon: Coffee,
        label: 'Categories',
        value: data.vibes.map(v => v.name).join(', '),
        step: 2
      });
    }

    // Location
    if (data.location) {
      items.push({
        icon: MapPin,
        label: 'Location',
        value: data.location,
        step: 3
      });
    }

    // Travel Mode
    if (data.travelMode) {
      items.push({
        icon: Navigation,
        label: 'Travel Mode',
        value: data.travelMode.charAt(0).toUpperCase() + data.travelMode.slice(1),
        step: 4
      });
    }

    // Budget
    if (data.budgetMin !== '' || data.budgetMax !== '') {
      items.push({
        icon: DollarSign,
        label: 'Budget',
        value: `$${data.budgetMin || 0}-${data.budgetMax || '∞'} per person`,
        step: 6
      });
    }

    // Travel Constraint
    if (data.timeConstraint !== '' || data.distanceConstraint !== '') {
      items.push({
        icon: Clock,
        label: 'Travel Limit',
        value: data.constraintType === 'time'
          ? `Up to ${data.timeConstraint} minutes`
          : `Up to ${data.distanceConstraint} km`,
        step: 5
      });
    }

    // Date & Time
    if (data.datePreference) {
      const dateLabels: any = { now: 'Now', today: 'Today', weekend: 'This Weekend', custom: 'Custom Date' };
      const timeLabels: any = { brunch: 'Brunch', afternoon: 'Afternoon', dinner: 'Dinner', latenight: 'Late Night' };
      const dateText = dateLabels[data.datePreference] || data.datePreference;
      const timeText = data.timeSlot ? ` • ${timeLabels[data.timeSlot]}` : '';
      
      items.push({
        icon: Calendar,
        label: 'Date & Time',
        value: dateText + timeText,
        step: 7
      });
    }

    // Friends
    if (data.invitedFriends.length > 0) {
      items.push({
        icon: Users,
        label: 'Friends Invited',
        value: `${data.invitedFriends.length} ${data.invitedFriends.length === 1 ? 'friend' : 'friends'}`,
        step: 8
      });
    }

    return items;
  };

  const summaryItems = getSummaryItems();

  return (
    <div className="space-y-4 px-4 sm:px-6">
      {/* Header */}
      <div className="text-center space-y-1">
        <MinglaLogo className="w-20 h-20 sm:w-24 sm:h-24 object-contain mb-3 mx-auto" />
        <h2 className="text-gray-900">You're almost there!</h2>
        <p className="text-xs text-gray-600">
          Here's your summary
        </p>
      </div>

      {/* Profile Summary */}
      <div className="space-y-1.5">
        {summaryItems.map((item, index) => {
          const IconComponent = item.icon;
          
          return (
            <div key={index} className="bg-gray-50 rounded-lg p-2 flex items-center justify-between gap-2">
              <div className="flex items-center space-x-2 min-w-0 flex-1">
                <div className="w-6 h-6 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
                  <IconComponent className="w-3.5 h-3.5 text-[#eb7825]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-600 leading-tight">{item.label}</p>
                  <p className="text-xs text-gray-900 truncate leading-tight">{item.value}</p>
                </div>
              </div>
              {onEditStep && (
                <button
                  onClick={() => onEditStep(item.step)}
                  className="flex-shrink-0 p-1 hover:bg-white rounded transition-colors"
                >
                  <Edit className="w-3 h-3 text-gray-400 hover:text-[#eb7825]" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Get Started Message */}
      <div className="text-center space-y-1">
        <p className="text-sm text-gray-600">
          Ready to discover amazing experiences?
        </p>
        <p className="text-xs text-gray-500">
          Click "Get Started" to begin your journey
        </p>
      </div>
    </div>
  );
}