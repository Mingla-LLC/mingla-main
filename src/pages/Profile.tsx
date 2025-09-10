import React, { useState } from 'react';
import { Settings, Bell, MapPin, DollarSign, Users, Share2, Eye, EyeOff, UserCog } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const Profile = () => {
  const navigate = useNavigate();
  const [currency, setCurrency] = useState('USD');
  const [shareLocation, setShareLocation] = useState(true);
  const [shareBudget, setShareBudget] = useState(false);
  const [shareCategories, setShareCategories] = useState(true);
  const [shareDateTime, setShareDateTime] = useState(true);
  const [notifications, setNotifications] = useState(true);

  const stats = [
    { label: 'Experiences Saved', value: '12' },
    { label: 'Boards Created', value: '3' },
    { label: 'Collaborations', value: '8' },
    { label: 'Places Visited', value: '45' }
  ];

  const savedLocations = [
    'Home - Capitol Hill',
    'Work - Downtown',
    'Gym - Belltown'
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 pt-12 pb-6">
        <div className="flex items-center gap-4 mb-6">
          <Avatar className="w-16 h-16">
            <AvatarImage src="https://images.unsplash.com/photo-1494790108755-2616b79444d7" />
            <AvatarFallback className="text-lg">JD</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold">Jane Doe</h1>
            <p className="text-muted-foreground">jane.doe@email.com</p>
            <Badge variant="outline" className="mt-1">Seattle, WA</Badge>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {stats.map((stat, index) => (
            <Card key={index} className="p-3 text-center">
              <div className="text-lg font-bold text-primary">{stat.value}</div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </Card>
          ))}
        </div>
      </div>

      {/* Currency Settings */}
      <div className="px-6 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <DollarSign className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Currency Preference</h2>
          </div>
          <div className="space-y-3">
            <div>
              <Label className="text-sm text-muted-foreground">
                Auto-set based on your region (App Store/Play Store)
              </Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">$ USD (United States Dollar)</SelectItem>
                  <SelectItem value="EUR">€ EUR (Euro)</SelectItem>
                  <SelectItem value="GBP">£ GBP (British Pound)</SelectItem>
                  <SelectItem value="CAD">$ CAD (Canadian Dollar)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              All prices shown as "per person" in your selected currency
            </p>
          </div>
        </Card>
      </div>

      {/* Collaboration Defaults */}
      <div className="px-6 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <Users className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Collaboration Defaults</h2>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <Label>Share Location</Label>
              </div>
              <div className="flex items-center gap-2">
                {shareLocation ? <Eye className="h-4 w-4 text-muted-foreground" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                <Switch checked={shareLocation} onCheckedChange={setShareLocation} />
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <Label>Share Budget</Label>
              </div>
              <div className="flex items-center gap-2">
                {shareBudget ? <Eye className="h-4 w-4 text-muted-foreground" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                <Switch checked={shareBudget} onCheckedChange={setShareBudget} />
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-muted-foreground" />
                <Label>Share Categories</Label>
              </div>
              <div className="flex items-center gap-2">
                {shareCategories ? <Eye className="h-4 w-4 text-muted-foreground" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                <Switch checked={shareCategories} onCheckedChange={setShareCategories} />
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-muted-foreground" />
                <Label>Share Date & Time</Label>
              </div>
              <div className="flex items-center gap-2">
                {shareDateTime ? <Eye className="h-4 w-4 text-muted-foreground" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                <Switch checked={shareDateTime} onCheckedChange={setShareDateTime} />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            These settings apply when you join collaborative planning sessions
          </p>
        </Card>
      </div>

      {/* Saved Locations */}
      <div className="px-6 mb-6">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">Saved Locations</h2>
            </div>
            <Button variant="outline" size="sm">Add</Button>
          </div>
          <div className="space-y-2">
            {savedLocations.map((location, index) => (
              <div key={index} className="flex items-center justify-between py-2">
                <span className="text-sm">{location}</span>
                <Button variant="ghost" size="sm">Edit</Button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Notifications */}
      <div className="px-6 mb-6">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">Notifications</h2>
            </div>
            <Switch checked={notifications} onCheckedChange={setNotifications} />
          </div>
          <p className="text-sm text-muted-foreground">
            Get notified about new recommendations, board activity, and collaboration invites
          </p>
        </Card>
      </div>

      {/* Account Actions */}
      <div className="px-6 pb-8">
        <div className="space-y-3">
          <Button variant="outline" className="w-full justify-start" onClick={() => navigate('/profiles')}>
            <UserCog className="h-4 w-4 mr-2" />
            Manage Profiles
          </Button>
          <Button variant="outline" className="w-full justify-start">
            <Settings className="h-4 w-4 mr-2" />
            Account Settings
          </Button>
          <Button variant="outline" className="w-full justify-start">
            Privacy Policy
          </Button>
          <Button variant="outline" className="w-full justify-start">
            Terms of Service
          </Button>
          <Button variant="outline" className="w-full justify-start text-destructive hover:text-destructive">
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Profile;