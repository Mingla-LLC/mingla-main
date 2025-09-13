import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Save, Loader2, Check, X, Edit2 } from 'lucide-react';
import { AvatarPreview } from '@/components/AvatarPreview';
import { useUserProfile } from '@/hooks/useUserProfile';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useUsers } from '@/hooks/useUsers';

export default function ProfileSettings() {
  const { profile, user, loading: profileLoading, refreshProfile } = useUserProfile();
  const { getUserInitials, checkUsernameAvailability } = useUsers();
  
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    username: '',
    avatar_url: ''
  });
  const [saving, setSaving] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<'checking' | 'available' | 'taken' | null>(null);
  const [checkTimeout, setCheckTimeout] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (profile) {
      setFormData({
        first_name: profile.first_name || '',
        last_name: profile.last_name || '',
        username: profile.username || '',
        avatar_url: profile.avatar_url || ''
      });
      // Clear any pending username checks when profile changes
      if (checkTimeout) {
        clearTimeout(checkTimeout);
        setCheckTimeout(null);
      }
      setUsernameStatus(null);
    }
  }, [profile, checkTimeout]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (checkTimeout) {
        clearTimeout(checkTimeout);
      }
    };
  }, [checkTimeout]);

  // Handle username change with availability checking
  const handleUsernameChange = (newUsername: string) => {
    setFormData(prev => ({ ...prev, username: newUsername }));
    
    // Clear existing timeout
    if (checkTimeout) {
      clearTimeout(checkTimeout);
    }
    
    // Don't check availability if username hasn't changed from current
    if (profile && newUsername.trim() === profile.username) {
      setUsernameStatus(null);
      return;
    }
    
    // Don't check if empty
    if (!newUsername.trim()) {
      setUsernameStatus(null);
      return;
    }
    
    setUsernameStatus('checking');
    
    // Debounce the availability check
    const timeout = setTimeout(async () => {
      const isAvailable = await checkUsernameAvailability(newUsername.trim());
      setUsernameStatus(isAvailable ? 'available' : 'taken');
    }, 500);
    
    setCheckTimeout(timeout);
  };

  const handleSave = async () => {
    if (!user?.id) return;

    // Validate required fields
    if (!formData.username.trim()) {
      toast({
        title: "Username required",
        description: "Please enter a username",
        variant: "destructive"
      });
      return;
    }

    // Check if username is available (unless it's the current username)
    if (profile && formData.username.trim() !== profile.username && usernameStatus !== 'available') {
      if (usernameStatus === 'taken') {
        toast({
          title: "Username not available",
          description: "Please choose a different username",
          variant: "destructive"
        });
        return;
      }
      
      // Double-check availability before submitting
      const isAvailable = await checkUsernameAvailability(formData.username.trim());
      if (!isAvailable) {
        setUsernameStatus('taken');
        toast({
          title: "Username not available", 
          description: "Please choose a different username",
          variant: "destructive"
        });
        return;
      }
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: formData.first_name.trim() || null,
          last_name: formData.last_name.trim() || null,
          username: formData.username.trim(),
          avatar_url: formData.avatar_url || null
        })
        .eq('id', user.id);

      if (error) throw error;

      await refreshProfile();
      toast({
        title: "Profile updated",
        description: "Your profile has been updated successfully"
      });
    } catch (error) {
      console.error('Error updating profile:', error);
      toast({
        title: "Update failed",
        description: "Failed to update your profile. Please try again.",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpdate = (newAvatarUrl: string) => {
    setFormData(prev => ({ ...prev, avatar_url: newAvatarUrl }));
  };

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="px-6 pt-12 pb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-bold">Profile Settings</h1>
          </div>
        </div>
        <div className="px-6">
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="text-muted-foreground mt-4">Loading profile...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="min-h-screen bg-background">
        <div className="px-6 pt-12 pb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-bold">Profile Settings</h1>
          </div>
        </div>
        <div className="px-6">
          <p className="text-center text-muted-foreground py-8">
            Profile not found. Please try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 pt-12 pb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">Profile Settings</h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-6 space-y-6">
        {/* Profile Photo */}
        <Card>
          <CardHeader>
            <CardTitle>Profile Photo</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center space-y-4">
            <AvatarPreview
              currentAvatarUrl={formData.avatar_url}
              userId={user.id}
              userInitials={getUserInitials({ 
                username: formData.username, 
                first_name: formData.first_name, 
                last_name: formData.last_name,
                id: user.id
              })}
              onAvatarUpdate={handleAvatarUpdate}
              size="lg"
            />
            <p className="text-sm text-muted-foreground text-center">
              Click the camera icon to upload a new profile picture
            </p>
          </CardContent>
        </Card>

        {/* Personal Information */}
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="first_name">First Name</Label>
                <Input
                  id="first_name"
                  value={formData.first_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                  placeholder="Enter your first name"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="last_name">Last Name</Label>
                <Input
                  id="last_name"
                  value={formData.last_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                  placeholder="Enter your last name"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="username">Username *</Label>
              <div className="relative">
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => handleUsernameChange(e.target.value)}
                  placeholder="Enter your username"
                  required
                  className="pr-10"
                />
                {usernameStatus === 'checking' && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-muted-foreground border-t-primary"></div>
                  </div>
                )}
                {usernameStatus === 'available' && (
                  <Check className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-green-500" />
                )}
                {usernameStatus === 'taken' && (
                  <X className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-destructive" />
                )}
              </div>
              {usernameStatus === 'taken' && (
                <p className="text-sm text-destructive">This username is already taken</p>
              )}
              {usernameStatus === 'available' && (
                <p className="text-sm text-green-600">Username is available</p>
              )}
              <p className="text-xs text-muted-foreground">
                Your username is how friends can find and add you
              </p>
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                value={user.email || ''}
                disabled
                className="opacity-50"
              />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed from this page
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="pb-6">
          <Button 
            onClick={handleSave} 
            disabled={saving || !formData.username.trim() || usernameStatus === 'taken'}
            className="w-full"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}