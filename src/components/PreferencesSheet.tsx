import React, { useState } from 'react';
import { X, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useUserProfile } from '@/hooks/useUserProfile';
import { formatCurrency } from '@/utils/currency';
import { categories } from '@/lib/categories';

interface PreferencesSheetProps {
  isOpen: boolean;
  onClose: () => void;
  measurementSystem?: string;
  activePreferences?: {
    budgetRange: [number, number];
    categories: string[];
    time: string;
    travel: string;
    travelConstraint: 'time' | 'distance';
    travelTime: number;
    travelDistance: number;
    location: string;
    groupSize?: number;
  };
  onPreferencesUpdate?: (preferences: {
    budgetRange: [number, number];
    categories: string[];
    time: string;
    travel: string;
    travelConstraint: 'time' | 'distance';
    travelTime: number;
    travelDistance: number;
    location: string;
    groupSize: number;
  }) => void;
}

const timeOptions = [
  'Now',
  'Tonight', 
  'This Weekend',
  'Custom'
];

const travelModes = [
  'Walk',
  'Drive',
  'Public Transport'
];

export const PreferencesSheet = ({ isOpen, onClose, measurementSystem = 'metric', activePreferences, onPreferencesUpdate }: PreferencesSheetProps) => {
  const [budget, setBudget] = useState<[number, number]>([10, 10000]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedTime, setSelectedTime] = useState('now');
  const [selectedTravel, setSelectedTravel] = useState('drive');
  const [travelConstraint, setTravelConstraint] = useState<'time' | 'distance'>('time');
  const [travelTime, setTravelTime] = useState(15);
  const [travelDistance, setTravelDistance] = useState(5);
  const [selectedLocation, setSelectedLocation] = useState('current');
  const [groupSize, setGroupSize] = useState(2);
  
  // Sync state with activePreferences whenever it changes
  React.useEffect(() => {
    if (activePreferences) {
      setBudget(activePreferences.budgetRange);
      setSelectedCategories(activePreferences.categories);
      setSelectedTime(activePreferences.time);
      setSelectedTravel(activePreferences.travel);
      setTravelConstraint(activePreferences.travelConstraint);
      setTravelTime(activePreferences.travelTime);
      setTravelDistance(activePreferences.travelDistance);
      setSelectedLocation(activePreferences.location);
      setGroupSize(activePreferences.groupSize || 2);
    }
  }, [activePreferences]);

  const [specificTime, setSpecificTime] = useState('');
  const [customDate, setCustomDate] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [customLocationName, setCustomLocationName] = useState('');
  
  const { profile } = useUserProfile();

  const savedLocations = [
    'Downtown Office',
    'Home (Capitol Hill)', 
    'Gym (Fremont)'
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
      <div className="bg-card w-full max-w-md mx-auto rounded-t-3xl animate-slide-up max-h-[75vh] flex flex-col mb-20">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border flex-shrink-0">
          <h2 className="text-xl font-bold">Preferences</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Apply Button */}
        <div className="p-6 pb-4 border-b border-border flex-shrink-0">
          <Button 
            className="w-full bg-gradient-primary hover:opacity-90 text-primary-foreground font-semibold" 
            onClick={() => {
                onPreferencesUpdate?.({
                  budgetRange: budget,
                  categories: selectedCategories,
                  time: selectedTime,
                  travel: selectedTravel,
                  travelConstraint,
                  travelTime,
                  travelDistance,
                  location: selectedLocation === 'custom' ? customLocationName : selectedLocation,
                  groupSize
                });
              onClose();
            }}
            size="lg"
          >
            Apply Preferences
          </Button>
        </div>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
          {/* Group Size */}
          <Card className="p-4 bg-gradient-warm/10">
            <div className="flex items-center gap-2 mb-3">
              <Users className="h-5 w-5" />
              <Label className="font-semibold">Group Size</Label>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Specify how many people will be in your group to get suitable recommendations
            </p>
            
            <div className="space-y-2">
              <Label className="text-sm font-medium">Number of People</Label>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setGroupSize(Math.max(1, groupSize - 1))}
                  className="h-8 w-8 p-0"
                >
                  -
                </Button>
                <span className="text-sm font-medium min-w-[2rem] text-center">{groupSize}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setGroupSize(groupSize + 1)}
                  className="h-8 w-8 p-0"
                >
                  +
                </Button>
                <span className="text-xs text-muted-foreground ml-2">
                  {groupSize === 1 ? 'person' : 'people'}
                </span>
              </div>
            </div>
          </Card>

          {/* Budget */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">Budget (per person)</Label>
            </div>
            <div className="px-2">
              <Slider
                value={budget}
                onValueChange={(value) => setBudget(value as [number, number])}
                max={10000}
                min={10}
                step={10}
                className="w-full"
              />
              <div className="flex justify-between text-sm text-muted-foreground mt-2">
                <span>{formatCurrency(10, profile?.currency || 'USD')}</span>
                <span className="font-semibold text-primary">{formatCurrency(budget[0], profile?.currency || 'USD')} - {formatCurrency(budget[1], profile?.currency || 'USD')}</span>
                <span>{budget[1] >= 10000 ? '∞' : `${formatCurrency(10000, profile?.currency || 'USD')}+`}</span>
              </div>
            </div>
          </div>

          {/* Categories */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">Categories</Label>
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <Badge
                  key={category.slug}
                  variant={selectedCategories.includes(category.slug) ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer transition-all",
                    selectedCategories.includes(category.slug)
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  )}
                  onClick={() => {
                    setSelectedCategories(prev =>
                      prev.includes(category.slug)
                        ? prev.filter(c => c !== category.slug)
                        : [...prev, category.slug]
                    );
                  }}
                >
                  <span className="mr-1">{category.icon}</span>
                  {category.name}
                </Badge>
              ))}
            </div>
          </div>

          {/* Date & Time */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">Date & Time</Label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {timeOptions.map((time) => (
                <Button
                  key={time}
                  variant={selectedTime === time ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedTime(time)}
                  className="justify-start"
                >
                  {time}
                </Button>
              ))}
            </div>
            
            {/* Time Selector for non-Now options */}
            {selectedTime !== 'Now' && (
              <Card className="p-3 bg-muted/50 space-y-3">
                <Label className="text-sm font-medium">Select Time</Label>
                <Input
                  type="time"
                  placeholder="Set specific time"
                  className="h-8"
                  onChange={(e) => setSpecificTime(e.target.value)}
                />
              </Card>
            )}
            
            {selectedTime === 'Custom' && (
              <Card className="p-3 bg-muted/50 space-y-3">
                <Label className="text-sm font-medium">Select Custom Date</Label>
                <Input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="h-8"
                />
              </Card>
            )}
          </div>

          {/* Travel Mode */}
          <div className="space-y-3">
            <Label className="font-semibold">Travel Mode</Label>
            <div className="grid grid-cols-1 gap-2">
              {travelModes.map((mode) => (
                <Button
                  key={mode}
                  variant={selectedTravel === mode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedTravel(mode)}
                  className="justify-start"
                >
                  {mode}
                </Button>
              ))}
            </div>
          </div>

          {/* Travel Constraint */}
          <div className="space-y-3">
            <Label className="font-semibold">Travel Constraint</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={travelConstraint === 'time' ? "default" : "outline"}
                size="sm"
                onClick={() => setTravelConstraint('time')}
              >
                By Time
              </Button>
              <Button
                variant={travelConstraint === 'distance' ? "default" : "outline"}
                size="sm"
                onClick={() => setTravelConstraint('distance')}
              >
                By Distance
              </Button>
            </div>
            
            {travelConstraint === 'time' && (
              <Card className="p-3 bg-muted/50">
                <Label className="text-sm font-medium block mb-2">
                  Maximum Travel Time: {travelTime} min
                </Label>
                <Slider
                  value={[travelTime]}
                  onValueChange={(value) => setTravelTime(value[0])}
                  max={60}
                  min={5}
                  step={5}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>5 min</span>
                  <span>60 min</span>
                </div>
              </Card>
            )}
            
            {travelConstraint === 'distance' && (
              <Card className="p-3 bg-muted/50">
                <Label className="text-sm font-medium block mb-2">
                  Maximum Distance: {travelDistance} {measurementSystem === 'metric' ? 'km' : 'miles'}
                </Label>
                <Slider
                  value={[travelDistance]}
                  onValueChange={(value) => setTravelDistance(value[0])}
                  max={measurementSystem === 'metric' ? 50 : 30}
                  min={1}
                  step={1}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>1 {measurementSystem === 'metric' ? 'km' : 'mile'}</span>
                  <span>{measurementSystem === 'metric' ? '50 km' : '30 miles'}</span>
                </div>
              </Card>
            )}
          </div>

          {/* Location */}
          <div className="space-y-3">
            <Label className="font-semibold">Starting Location</Label>
            <div className="grid grid-cols-1 gap-2">
              <Button
                variant={selectedLocation === 'current' ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedLocation('current')}
                className="justify-start"
              >
                📍 Current Location
              </Button>
              {savedLocations.map((location) => (
                <Button
                  key={location}
                  variant={selectedLocation === location ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedLocation(location)}
                  className="justify-start"
                >
                  {location}
                </Button>
              ))}
            </div>
            
            <Card className="p-3 bg-muted/50 space-y-3">
              <Label className="text-sm font-medium block">Custom Location</Label>
              <Input
                placeholder="Enter address or place name (e.g., 'San Francisco, CA')"
                value={locationInput}
                onChange={(e) => setLocationInput(e.target.value)}
                className="h-9"
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  if (locationInput.trim()) {
                    setCustomLocationName(locationInput.trim());
                    setSelectedLocation('custom');
                  }
                }}
              >
                Use This Location
              </Button>
              {customLocationName && selectedLocation === 'custom' && (
                <div className="text-xs text-muted-foreground">
                  Selected: {customLocationName}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};