import React, { useState } from 'react';
import { X, Users, User, Plus, Send, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
  const [newUsername, setNewUsername] = useState('');
  const [specificTime, setSpecificTime] = useState('');
  const [customDate, setCustomDate] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('current');
  const [groupSize, setGroupSize] = useState(2);
  const [collaborators, setCollaborators] = useState([
    { id: '1', username: 'sarah_k', name: 'Sarah', isActive: true },
    { id: '2', username: 'mike_dev', name: 'Mike', isActive: false },
  ]);

  const savedLocations = [
    'Downtown Office',
    'Home (Capitol Hill)', 
    'Gym (Fremont)'
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
      <div className="bg-card w-full max-w-md mx-auto rounded-t-3xl animate-slide-up max-h-[95vh] flex flex-col">
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
            onClick={onClose}
            size="lg"
          >
            Apply Preferences
          </Button>
        </div>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
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
            <p className="text-sm text-muted-foreground mb-3">
              {isCollabMode 
                ? 'Share preferences with friends to find perfect group activities'
                : 'Plan activities on your own - you can still specify group size'
              }
            </p>

            {/* Group Size for Solo Mode */}
            {!isCollabMode && (
              <div className="space-y-2 mb-3">
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
            )}

            {/* Collaborators Section */}
            {isCollabMode && (
              <div className="space-y-3">
                {/* Add Collaborator */}
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter username"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="flex-1 h-8 text-sm"
                  />
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => {
                      if (newUsername.trim()) {
                        setCollaborators(prev => [...prev, {
                          id: Date.now().toString(),
                          username: newUsername.trim(),
                          name: newUsername.trim(),
                          isActive: false
                        }]);
                        setNewUsername('');
                      }
                    }}
                  >
                    <UserPlus className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="outline">
                    <Send className="h-3 w-3" />
                  </Button>
                </div>

                {/* Collaborator List */}
                {collaborators.length > 0 && (
                  <div className="space-y-2">
                    {collaborators.map((collaborator) => (
                      <div key={collaborator.id} className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg">
                        <Avatar className="w-6 h-6">
                          <AvatarFallback className="text-xs">
                            {collaborator.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "text-xs font-medium",
                              collaborator.isActive ? "text-foreground" : "text-muted-foreground"
                            )}>
                              @{collaborator.username}
                            </span>
                            <div className={cn(
                              "w-2 h-2 rounded-full",
                              collaborator.isActive ? "bg-primary" : "bg-muted-foreground"
                            )} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {collaborator.isActive ? 'Active' : 'Invited'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
                max={10000}
                min={10}
                step={10}
                className="w-full"
              />
              <div className="flex justify-between text-sm text-muted-foreground mt-2">
                <span>$10</span>
                <span className="font-semibold text-primary">${budget[0]}</span>
                <span>{budget[0] >= 10000 ? '∞' : '$10000+'}</span>
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
            
            {/* Current Location */}
            <Button 
              variant={selectedLocation === 'current' ? "default" : "outline"} 
              className="w-full justify-start"
              onClick={() => setSelectedLocation('current')}
            >
              📍 Use Current Location
            </Button>
            
            {/* Manual Input */}
            <div className="space-y-2">
              <Button
                variant={selectedLocation === 'manual' ? "default" : "outline"}
                className="w-full justify-start"
                onClick={() => setSelectedLocation('manual')}
              >
                🔍 Enter Location Manually
              </Button>
              {selectedLocation === 'manual' && (
                <Input
                  placeholder="Enter address or location"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  className="h-8"
                />
              )}
            </div>
            
            {/* Saved Locations */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Saved Locations</Label>
              {savedLocations.map((location) => (
                <Button
                  key={location}
                  variant={selectedLocation === location ? "default" : "outline"}
                  className="w-full justify-start text-sm"
                  onClick={() => setSelectedLocation(location)}
                >
                  📌 {location}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};