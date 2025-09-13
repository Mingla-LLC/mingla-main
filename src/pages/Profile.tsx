import React, { useState, useEffect } from 'react';
import { Settings, Bell, MapPin, DollarSign, Users, Share2, Eye, EyeOff, UserCog, LogOut, LogIn } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { User, Session } from '@supabase/supabase-js';

const Profile = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Profile data state
  const [profileData, setProfileData] = useState<any>(null);
  const [username, setUsername] = useState('');
  const [saving, setSaving] = useState(false);
  
  // Settings state
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

  // Auth and data fetching effects
  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch profile data when user changes
  useEffect(() => {
    if (user) {
      fetchProfileData();
    }
  }, [user]);

  const fetchProfileData = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      
      if (error) {
        console.error('Error fetching profile:', error);
        return;
      }
      
      // If no profile exists, create one with default username
      if (!data) {
        const defaultUsername = user.email?.split('@')[0] || `user_${user.id.slice(0, 8)}`;
        
        const { data: newProfile, error: createError } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            username: defaultUsername,
            currency: 'USD',
            measurement_system: 'metric'
          })
          .select()
          .single();
          
        if (createError) {
          console.error('Error creating profile:', createError);
          // Still set a fallback username for display
          setUsername(defaultUsername);
          setProfileData({ username: defaultUsername });
        } else {
          setProfileData(newProfile);
          setUsername(newProfile.username);
        }
      } else {
        setProfileData(data);
        setUsername(data.username || '');
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      toast({
        title: "Sign out failed", 
        description: error.message,
        variant: "destructive"
      });
    } else {
      toast({
        title: "Signed out successfully"
      });
    }
  };

  const handleSaveProfile = async () => {
    if (!user || !username.trim()) {
      toast({
        title: "Error",
        description: "Username is required",
        variant: "destructive"
      });
      return;
    }
    
    setSaving(true);
    
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          username: username.trim(),
          currency: profileData?.currency || 'USD',
          measurement_system: profileData?.measurement_system || 'metric'
        }, { 
          onConflict: 'id' 
        });
      
      if (error) {
        toast({
          title: "Error saving profile",
          description: error.message,
          variant: "destructive"
        });
      } else {
        toast({
          title: "Profile saved successfully"
        });
        await fetchProfileData(); // Refetch data
      }
    } catch (error) {
      toast({
        title: "Error saving profile",
        description: "An unexpected error occurred",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-6 max-w-md w-full mx-4">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold">Authentication Error</h1>
            <p className="text-muted-foreground">
              Please sign in again
            </p>
            <Button onClick={() => navigate('/auth')} className="w-full">
              <LogIn className="h-4 w-4 mr-2" />
              Go to Sign In
            </Button>
          </div>
        </Card>
      </div>
    );
  }

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
            <h1 className="text-2xl font-bold">
              {profileData?.first_name && profileData?.last_name 
                ? `${profileData.first_name} ${profileData.last_name}` 
                : profileData?.username || user.email?.split('@')[0] || 'User'}
            </h1>
            <p className="text-muted-foreground">{user.email}</p>
            {profileData?.username && (
              <p className="text-sm text-muted-foreground">@{profileData.username}</p>
            )}
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
          <Button variant="outline" className="w-full justify-start" onClick={() => navigate('/account-settings')}>
            <Settings className="h-4 w-4 mr-2" />
            Account Settings
          </Button>
          <Button variant="outline" className="w-full justify-start">
            Privacy Policy
          </Button>
          <Button variant="outline" className="w-full justify-start">
            Terms of Service
          </Button>
          <Button 
            variant="outline" 
            className="w-full justify-start text-destructive hover:text-destructive"
            onClick={handleSignOut}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Profile;