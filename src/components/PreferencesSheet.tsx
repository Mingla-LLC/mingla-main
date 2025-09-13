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
import { useUserProfile } from '@/hooks/useUserProfile';
import { formatCurrency } from '@/utils/currency';
import { categories, getCategoriesBySlug } from '@/lib/categories';

interface PreferencesSheetProps {
  isOpen: boolean;
  onClose: () => void;
  measurementSystem?: string; // Add prop for measurement system
  activePreferences?: {
    budgetRange: [number, number];
    categories: string[];
    time: string;
    travel: string;
    travelConstraint: 'time' | 'distance';
    travelTime: number;
    travelDistance: number;
    location: string;
    isCollaborating?: boolean;
    activeCollaborators?: number;
    activeCollaboratorsList?: Array<{
      id: string;
      username: string;
      name: string;
      avatar: string;
      initials: string;
    }>;
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
    isCollaborating: boolean;
    activeCollaborators: number;
    activeCollaboratorsList: Array<{
      id: string;
      username: string;
      name: string;
      avatar: string;
      initials: string;
    }>;
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
  const [isCollabMode, setIsCollabMode] = useState(false);
  
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
      setIsCollabMode(activePreferences.isCollaborating);
    }
  }, [activePreferences]);
  const [sharedBudget, setSharedBudget] = useState(true);
  const [sharedCategories, setSharedCategories] = useState(false);
  const [sharedTime, setSharedTime] = useState(true);
  const [newUsername, setNewUsername] = useState('');
  const [newCollaborator, setNewCollaborator] = useState('');
  const [specificTime, setSpecificTime] = useState('');
  const [customDate, setCustomDate] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [groupSize, setGroupSize] = useState(2);
  const [collaborators, setCollaborators] = useState([
    { id: '1', username: 'sarah_k', name: 'Sarah', isActive: true, avatar: 'https://images.unsplash.com/photo-1494790108755-2616b79444d7' },
    { id: '2', username: 'mike_dev', name: 'Mike', isActive: false, avatar: '' },
  ]);
  
  const { profile } = useUserProfile();
  
  // Add dummy users for tagging demo (same as BoardDetail)
  const allUsers = [
    ...collaborators,
    { id: 'dummy1', username: 'emmawilson', name: 'Emma Wilson', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80', isActive: true },
    { id: 'dummy2', username: 'jamesrodriguez', name: 'James Rodriguez', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e', isActive: true },
    { id: 'dummy3', username: 'priyapatel', name: 'Priya Patel', avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04', isActive: false }
  ];

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
              const activeUsers = allUsers.filter(u => u.isActive);
              onPreferencesUpdate?.({
                budgetRange: budget,
                categories: selectedCategories,
                time: selectedTime,
                travel: selectedTravel,
                travelConstraint,
                travelTime,
                travelDistance,
                location: selectedLocation,
                isCollaborating: isCollabMode,
                activeCollaborators: isCollabMode ? activeUsers.length : 0,
                activeCollaboratorsList: isCollabMode ? activeUsers.map(u => ({
                  id: u.id,
                  username: u.username,
                  name: u.name,
                  avatar: u.avatar,
                  initials: u.name.split(' ').map(n => n[0]).join('')
                })) : []
              });
              onClose();
            }}
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
              <Switch 
                checked={isCollabMode} 
                onCheckedChange={(enabled) => {
                  setIsCollabMode(enabled);
                  const activeUsers = allUsers.filter(u => u.isActive);
                  onPreferencesUpdate?.({
                    budgetRange: budget,
                    categories: selectedCategories,
                    time: selectedTime,
                    travel: selectedTravel,
                    travelConstraint,
                    travelTime,
                    travelDistance,
                    location: selectedLocation,
                    isCollaborating: enabled,
                    activeCollaborators: enabled ? activeUsers.length : 0,
                    activeCollaboratorsList: enabled ? activeUsers.map(u => ({
                      id: u.id,
                      username: u.username,
                      name: u.name,
                      avatar: u.avatar,
                      initials: u.name.split(' ').map(n => n[0]).join('')
                    })) : []
                  });
                }} 
              />
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
                    onClick={() => {
                      const newSize = Math.max(1, groupSize - 1);
                      setGroupSize(newSize);
                      // Update preferences immediately
                      onPreferencesUpdate?.({
                        budgetRange: budget,
                        categories: selectedCategories,
                        time: selectedTime,
                        travel: selectedTravel,
                        travelConstraint,
                        travelTime,
                        travelDistance,
                        location: selectedLocation,
                        isCollaborating: false,
                        activeCollaborators: newSize,
                        activeCollaboratorsList: []
                      });
                    }}
                    className="h-8 w-8 p-0"
                  >
                    -
                  </Button>
                  <span className="text-sm font-medium min-w-[2rem] text-center">{groupSize}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newSize = groupSize + 1;
                      setGroupSize(newSize);
                      // Update preferences immediately
                      onPreferencesUpdate?.({
                        budgetRange: budget,
                        categories: selectedCategories,
                        time: selectedTime,
                        travel: selectedTravel,
                        travelConstraint,
                        travelTime,
                        travelDistance,
                        location: selectedLocation,
                        isCollaborating: false,
                        activeCollaborators: newSize,
                        activeCollaboratorsList: []
                      });
                    }}
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
                {/* Active Collaborators */}
                {allUsers.filter(u => u.isActive).length > 0 && (
                  <div className="mb-4">
                    <Label className="text-sm font-medium text-primary mb-2 block">Active Collaborators</Label>
                    <div className="flex flex-wrap gap-2">
                      {allUsers.filter(u => u.isActive).map((user) => (
                        <div key={user.id} className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 rounded-full">
                          <Avatar className="w-5 h-5">
                            <AvatarImage src={user.avatar} />
                            <AvatarFallback className="text-xs">
                              {user.name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-xs font-medium text-primary">@{user.username}</span>
                          <div className="w-1.5 h-1.5 bg-primary rounded-full" />
                          <button
                            onClick={() => {
                              // Remove user from active collaborators
                              const updatedUsers = allUsers.map(u => 
                                u.id === user.id ? { ...u, isActive: false } : u
                              );
                              
                              // Update collaborators state
                              const collaboratorUser = collaborators.find(c => c.id === user.id);
                              if (collaboratorUser) {
                                setCollaborators(prev => prev.map(c => 
                                  c.id === user.id ? { ...c, isActive: false } : c
                                ));
                              }
                              
                              // Update preferences
                              const activeUsers = updatedUsers.filter(u => u.isActive);
                              onPreferencesUpdate?.({
                                budgetRange: budget,
                                categories: selectedCategories,
                                time: selectedTime,
                                travel: selectedTravel,
                                travelConstraint,
                                travelTime,
                                travelDistance,
                                location: selectedLocation,
                                isCollaborating: activeUsers.length > 0,
                                activeCollaborators: activeUsers.length,
                    activeCollaboratorsList: activeUsers.map(u => ({
                      id: u.id,
                      username: u.username,
                      name: u.name,
                      avatar: u.avatar,
                      initials: u.name.split(' ').map(n => n[0]).join('')
                    }))
                              });
                            }}
                            className="ml-1 hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                          >
                            <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add Collaborator */}
                <div className="flex gap-2 relative">
                  <div className="flex-1 relative">
                    <Input
                      placeholder="Enter username"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="h-8 text-sm pr-8"
                    />
                    {newUsername.includes('@') && (
                      <div className="absolute bottom-full left-0 right-0 bg-card border border-border rounded-md mb-1 z-[70] shadow-lg max-h-32 overflow-y-auto">
                        {allUsers.filter(u => {
                          const searchTerm = newUsername.split('@').pop()?.toLowerCase() || '';
                          return u.username.toLowerCase().includes(searchTerm) && searchTerm.length > 0;
                        }).slice(0, 5).map((user) => (
                          <button
                            key={user.id}
                            className="w-full text-left px-3 py-2 hover:bg-muted flex items-center gap-2 text-sm first:rounded-t-md last:rounded-b-md transition-colors"
                            onClick={(e) => {
                              e.preventDefault();
                              const parts = newUsername.split('@');
                              const beforeAt = parts.slice(0, -1).join('@');
                              const afterCurrentTag = parts[parts.length - 1].split(' ').slice(1).join(' ');
                              const newText = `${beforeAt}@${user.username} ${afterCurrentTag}`.trim() + ' ';
                              setNewUsername(newText);
                            }}
                          >
                            <Avatar className="w-5 h-5">
                              <AvatarImage src={user.avatar} />
                              <AvatarFallback className="text-xs">
                                {user.name.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <span className="font-medium">{user.name}</span>
                              <p className="text-xs text-muted-foreground">@{user.username}</p>
                            </div>
                          </button>
                        ))}
                        {allUsers.filter(u => {
                          const searchTerm = newUsername.split('@').pop()?.toLowerCase() || '';
                          return u.username.toLowerCase().includes(searchTerm) && searchTerm.length > 0;
                        }).length === 0 && newUsername.split('@').pop()?.length > 0 && (
                          <div className="px-3 py-2 text-xs text-muted-foreground">
                            No users found
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => {
                      if (newUsername.trim()) {
                        // Send collaboration request instead of directly adding
                        const username = newUsername.trim().replace('@', '');
                        const existingUser = allUsers.find(u => u.username === username);
                        
                        if (existingUser) {
                          // Mock sending collaboration request
                          console.log(`Sending collaboration request to ${username}`);
                          // In real app, this would send a request to the backend
                          
                          // For demo, simulate immediate acceptance after 2 seconds
                          setTimeout(() => {
                            setCollaborators(prev => prev.map(c => 
                              c.username === username ? { ...c, isActive: true } : c
                            ));
                            
                            // Update preferences with new active collaborators
                            const updatedUsers = allUsers.map(u => 
                              u.username === username ? { ...u, isActive: true } : u
                            );
                            const activeUsers = updatedUsers.filter(u => u.isActive);
                            onPreferencesUpdate?.({
                              budgetRange: budget,
                              categories: selectedCategories,
                              time: selectedTime,
                              travel: selectedTravel,
                              travelConstraint,
                              travelTime,
                              travelDistance,
                              location: selectedLocation,
                              isCollaborating: activeUsers.length > 0,
                              activeCollaborators: activeUsers.length,
                    activeCollaboratorsList: activeUsers.map(u => ({
                      id: u.id,
                      username: u.username,
                      name: u.name,
                      avatar: u.avatar,
                      initials: u.name.split(' ').map(n => n[0]).join('')
                    }))
                            });
                          }, 2000);
                        } else {
                          // Create new user and send request
                          const newUser = {
                            id: Date.now().toString(),
                            username: username,
                            name: username,
                            isActive: false,
                            avatar: ''
                          };
                          setCollaborators(prev => [...prev, newUser]);
                        }
                        setNewUsername('');
                      }
                    }}
                    className="bg-blue-50 hover:bg-blue-100 text-blue-600 border-blue-200"
                  >
                    <UserPlus className="h-3 w-3" />
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => {
                      // Mock sending collaboration request
                      if (newUsername.trim()) {
                        console.log('Sending collaboration invitation...');
                        setNewUsername('');
                      }
                    }}
                    className="bg-green-50 hover:bg-green-100 text-green-600 border-green-200"
                  >
                    <Send className="h-3 w-3" />
                  </Button>
                </div>

                {/* Collaborator List */}
                {allUsers.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Available Users</Label>
                    {allUsers.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => {
                          // Toggle user's active status
                          const updatedUsers = allUsers.map(u => 
                            u.id === user.id ? { ...u, isActive: !u.isActive } : u
                          );
                          
                          // Update collaborators state
                          const collaboratorUser = collaborators.find(c => c.id === user.id);
                          if (collaboratorUser) {
                            setCollaborators(prev => prev.map(c => 
                              c.id === user.id ? { ...c, isActive: !c.isActive } : c
                            ));
                          }
                          
                          // Update preferences with new active collaborators
                          const activeUsers = updatedUsers.filter(u => u.isActive);
                          onPreferencesUpdate?.({
                            budgetRange: budget,
                            categories: selectedCategories,
                            time: selectedTime,
                            travel: selectedTravel,
                            travelConstraint,
                            travelTime,
                            travelDistance,
                            location: selectedLocation,
                            isCollaborating: activeUsers.length > 0,
                            activeCollaborators: activeUsers.length,
                                activeCollaboratorsList: activeUsers.map(u => ({
                                  id: u.id,
                                  username: u.username,
                                  name: u.name,
                                  avatar: u.avatar,
                                  initials: u.name.split(' ').map(n => n[0]).join('')
                                }))
                          });
                          
                          // Also add to input if not already there
                          if (!user.isActive && !newCollaborator.includes(`@${user.username}`)) {
                            setNewCollaborator(prev => prev + (prev ? ' ' : '') + `@${user.username}`);
                          } else if (user.isActive) {
                            // Remove from input  
                            setNewCollaborator(prev => prev.replace(new RegExp(`@${user.username}\\s*`, 'g'), '').trim());
                          }
                        }}
                        className="w-full flex items-center gap-2 p-2 bg-muted/30 hover:bg-muted/50 rounded-lg transition-colors cursor-pointer"
                      >
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={user.avatar} />
                          <AvatarFallback className="text-xs">
                            {user.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 text-left">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "text-xs font-medium",
                              user.isActive ? "text-foreground" : "text-muted-foreground"
                            )}>
                              @{user.username}
                            </span>
                            <div className={cn(
                              "w-2 h-2 rounded-full",
                              user.isActive ? "bg-primary" : "bg-muted-foreground"
                            )} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {user.isActive ? 'Active' : 'Available'}
                          </p>
                        </div>
                      </button>
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
            
            {/* Travel Constraints */}
            <Card className="p-3 bg-muted/50 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Travel Constraint</Label>
                <div className="flex items-center gap-2 text-xs">
                  <span className={`${travelConstraint === 'time' ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                    Time
                  </span>
                  <Switch 
                    checked={travelConstraint === 'distance'} 
                    onCheckedChange={(checked) => setTravelConstraint(checked ? 'distance' : 'time')} 
                  />
                  <span className={`${travelConstraint === 'distance' ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                    Distance
                  </span>
                </div>
              </div>
              
              {travelConstraint === 'time' ? (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Maximum travel time</Label>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[travelTime]}
                      onValueChange={(value) => setTravelTime(value[0])}
                      max={300} // 5 hours max
                      min={1}
                      step={travelTime < 60 ? 1 : 5}
                      className="flex-1"
                    />
                    <span className="text-sm font-medium min-w-[4rem]">
                      {travelTime >= 300 
                        ? 'Infinity'
                        : travelTime >= 1440 
                        ? `${Math.round(travelTime / 1440)} ${Math.round(travelTime / 1440) === 1 ? 'day' : 'days'}`
                        : travelTime >= 60 
                        ? `${Math.round(travelTime / 60)} ${Math.round(travelTime / 60) === 1 ? 'hr' : 'hrs'}`
                        : `${travelTime} min`}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Maximum distance ({measurementSystem === 'metric' ? 'km' : 'miles'})
                  </Label>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[travelDistance]}
                      onValueChange={(value) => setTravelDistance(value[0])}
                      max={500} // 500 km/miles max
                      min={1}
                      step={measurementSystem === 'metric' ? 1 : 0.5}
                      className="flex-1"
                    />
                    <span className="text-sm font-medium min-w-[4rem]">
                      {travelDistance >= 500 
                        ? 'Infinity'
                        : `${travelDistance} ${measurementSystem === 'metric' ? 'km' : 'mi'}`}
                    </span>
                  </div>
                </div>
              )}
            </Card>
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