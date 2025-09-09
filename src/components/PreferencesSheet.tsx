import React, { useState } from 'react';
import { X, Users, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface PreferencesSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

const categories = [
  'Coffee & Walk',
  'Quick Bite', 
  'Brunch',
  'Activity Date',
  'Creative Date',
  'Dinner'
];

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

export const PreferencesSheet = ({ isOpen, onClose }: PreferencesSheetProps) => {
  const [budget, setBudget] = useState([50]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['Coffee & Walk']);
  const [selectedTime, setSelectedTime] = useState('Now');
  const [selectedTravel, setSelectedTravel] = useState('Walk');
  const [isCollabMode, setIsCollabMode] = useState(false);
  const [sharedBudget, setSharedBudget] = useState(true);
  const [sharedCategories, setSharedCategories] = useState(false);
  const [sharedTime, setSharedTime] = useState(true);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
      <div className="bg-card w-full max-w-md mx-auto rounded-t-3xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-bold">Preferences</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Collaboration Mode */}
          <Card className="p-4 bg-gradient-warm/10">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {isCollabMode ? <Users className="h-5 w-5" /> : <User className="h-5 w-5" />}
                <Label className="font-semibold">
                  {isCollabMode ? 'Collaboration Mode' : 'Solo Mode'}
                </Label>
              </div>
              <Switch checked={isCollabMode} onCheckedChange={setIsCollabMode} />
            </div>
            <p className="text-sm text-muted-foreground">
              {isCollabMode 
                ? 'Share preferences with friends to find perfect group activities'
                : 'Find activities just for you'
              }
            </p>
          </Card>

          {/* Budget */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">Budget (per person)</Label>
              {isCollabMode && (
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Share</Label>
                  <Switch checked={sharedBudget} onCheckedChange={setSharedBudget} />
                </div>
              )}
            </div>
            <div className="px-2">
              <Slider
                value={budget}
                onValueChange={setBudget}
                max={200}
                min={10}
                step={5}
                className="w-full"
              />
              <div className="flex justify-between text-sm text-muted-foreground mt-2">
                <span>$10</span>
                <span className="font-semibold text-primary">${budget[0]}</span>
                <span>$200+</span>
              </div>
            </div>
          </div>

          {/* Categories */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">Categories</Label>
              {isCollabMode && (
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Share</Label>
                  <Switch checked={sharedCategories} onCheckedChange={setSharedCategories} />
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <Badge
                  key={category}
                  variant={selectedCategories.includes(category) ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer transition-all",
                    selectedCategories.includes(category)
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  )}
                  onClick={() => {
                    setSelectedCategories(prev =>
                      prev.includes(category)
                        ? prev.filter(c => c !== category)
                        : [...prev, category]
                    );
                  }}
                >
                  {category}
                </Badge>
              ))}
            </div>
          </div>

          {/* Date & Time */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">Date & Time</Label>
              {isCollabMode && (
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Share</Label>
                  <Switch checked={sharedTime} onCheckedChange={setSharedTime} />
                </div>
              )}
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
            {selectedTime === 'Custom' && (
              <Card className="p-3 bg-muted/50">
                <p className="text-sm text-muted-foreground">
                  Custom date picker would appear here
                </p>
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
                  {mode === 'Public Transport' && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      via Google Maps
                    </span>
                  )}
                </Button>
              ))}
            </div>
          </div>

          {/* Location */}
          <div className="space-y-3">
            <Label className="font-semibold">Location</Label>
            <Button variant="outline" className="w-full justify-start">
              📍 Use Current Location
            </Button>
          </div>
        </div>

        {/* Apply Button */}
        <div className="p-6 border-t border-border">
          <Button 
            className="w-full bg-gradient-primary hover:opacity-90" 
            onClick={onClose}
          >
            Apply Preferences
          </Button>
        </div>
      </div>
    </div>
  );
};