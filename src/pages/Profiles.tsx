import React, { useState, useEffect } from 'react';
import { ArrowLeft, Edit2, User, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { useUsers } from '@/hooks/useUsers';
import type { Database } from '@/integrations/supabase/types';
import type { User as SupabaseUser } from '@supabase/supabase-js';

type Profile = Database['public']['Tables']['profiles']['Row'];
type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

const Profiles = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [formData, setFormData] = useState({ 
    username: '', 
    firstName: '', 
    lastName: '' 
  });
  const [usernameStatus, setUsernameStatus] = useState<'checking' | 'available' | 'taken' | null>(null);
  const [checkTimeout, setCheckTimeout] = useState<NodeJS.Timeout | null>(null);
  const { checkUsernameAvailability } = useUsers();

  useEffect(() => {
    fetchUserAndProfile();
  }, []);

  const fetchUserAndProfile = async () => {
    try {
      setLoading(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/auth');
        return;
      }
      
      setUser(user);
      
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive"
        });
        return;
      }

      setProfile(profileData);
      if (profileData) {
        setFormData({
          username: profileData.username || '',
          firstName: profileData.first_name || '',
          lastName: profileData.last_name || ''
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch profile",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateEmail = async (newEmail: string) => {
    if (!user) return;
    
    try {
      const { error } = await supabase.auth.updateUser({
        email: newEmail
      });

      if (error) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive"
        });
        return;
      }

      toast({
        title: "Email Update",
        description: "Check your new email for confirmation",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update email",
        variant: "destructive"
      });
    }
  };

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

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user || !formData.username.trim()) {
      toast({
        title: "Error",
        description: "Username is required",
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

    try {
      const updateData = {
        id: user.id,
        username: formData.username.trim(),
        first_name: formData.firstName.trim() || null,
        last_name: formData.lastName.trim() || null,
      };

      const { error } = await supabase
        .from('profiles')
        .upsert(updateData, {
          onConflict: 'id'
        });

      if (error) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive"
        });
        return;
      }

      toast({
        title: "Success",
        description: "Profile updated successfully!",
      });

      setIsEditOpen(false);
      setUsernameStatus(null);
      fetchUserAndProfile();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update profile",
        variant: "destructive"
      });
    }
  };

  const openEditDialog = () => {
    setUsernameStatus(null);
    if (checkTimeout) {
      clearTimeout(checkTimeout);
    }
    setIsEditOpen(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-accent/10 p-6">
        <div className="max-w-2xl mx-auto">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="text-muted-foreground mt-4">Loading profiles...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-accent/10 p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header with Back Navigation */}
        <div className="flex items-center gap-4 mb-8">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate('/profile')}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Manage Profile</h1>
            <p className="text-muted-foreground">Update your profile information</p>
          </div>
        </div>

        {/* User Profile Management */}
        {user && (
          <Card className="mb-6">
            <CardHeader className="pb-6">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-4 flex-1">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="h-8 w-8 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-xl font-semibold mb-1 truncate">
                      {profile?.first_name && profile?.last_name 
                        ? `${profile.first_name} ${profile.last_name}` 
                        : profile?.username || 'User'}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mb-1 truncate">{user.email}</p>
                    {profile?.created_at && (
                      <p className="text-xs text-muted-foreground">
                        Member since {new Date(profile.created_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={openEditDialog}
                  className="w-full sm:w-auto"
                >
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit Profile
                </Button>
              </div>
            </CardHeader>
          </Card>
        )}

        {/* Edit Profile Dialog */}
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader className="pb-4">
              <DialogTitle className="text-xl font-semibold">Edit Profile</DialogTitle>
              <p className="text-sm text-muted-foreground">Update your profile information</p>
            </DialogHeader>
            <form onSubmit={handleUpdate} className="space-y-6">
              {/* Name Fields */}
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="first-name" className="text-sm font-medium">
                      First Name
                    </Label>
                    <Input
                      id="first-name"
                      type="text"
                      value={formData.firstName}
                      onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                      placeholder="Enter first name"
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="last-name" className="text-sm font-medium">
                      Last Name
                    </Label>
                    <Input
                      id="last-name"
                      type="text"
                      value={formData.lastName}
                      onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                      placeholder="Enter last name"
                      className="h-10"
                    />
                  </div>
                </div>
              </div>

              {/* Username Field */}
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-medium">
                  Username <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="username"
                    type="text"
                    value={formData.username}
                    onChange={(e) => handleUsernameChange(e.target.value)}
                    placeholder="Enter username"
                    className="h-10 pr-10"
                    required
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
              </div>

              {/* Email Section - Read Only Display */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Current Email</Label>
                <div className="p-3 bg-muted/50 rounded-md border">
                  <p className="text-sm">{user?.email}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Email changes must be done through account settings
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4 border-t">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => {
                    setIsEditOpen(false);
                    setFormData({
                      username: profile?.username || '',
                      firstName: profile?.first_name || '',
                      lastName: profile?.last_name || ''
                    });
                  }}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  className="w-full sm:w-auto"
                  disabled={!formData.username.trim()}
                >
                  Update Profile
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default Profiles;