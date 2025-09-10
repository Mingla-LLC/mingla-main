import React, { useState, useEffect } from 'react';
import { ArrowLeft, Mail, Lock, Shield, AlertCircle, DollarSign, Users, MapPin, Share2, Settings, Eye, EyeOff, Ruler } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { User, Session } from '@supabase/supabase-js';

const AccountSettings = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Form state
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  
  // Settings state
  const [currency, setCurrency] = useState('USD');
  const [measurementSystem, setMeasurementSystem] = useState('metric');
  const [shareLocation, setShareLocation] = useState(true);
  const [shareBudget, setShareBudget] = useState(false);
  const [shareCategories, setShareCategories] = useState(true);
  const [shareDateTime, setShareDateTime] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(false);

  // Auth and data fetching effects
  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        if (session?.user?.email) {
          setEmail(session.user.email);
        }
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user?.email) {
        setEmail(session.user.email);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleEmailUpdate = async () => {
    if (!user || !email.trim() || email === user.email) {
      toast({
        title: "Error",
        description: "Please enter a valid new email address",
        variant: "destructive"
      });
      return;
    }

    if (!email.includes('@') || !email.includes('.')) {
      toast({
        title: "Error", 
        description: "Please enter a valid email address",
        variant: "destructive"
      });
      return;
    }

    setEmailLoading(true);
    
    try {
      const { error } = await supabase.auth.updateUser({
        email: email.trim()
      });
      
      if (error) {
        toast({
          title: "Error updating email",
          description: error.message,
          variant: "destructive"
        });
      } else {
        toast({
          title: "Email update initiated",
          description: "Check your new email address to confirm the change"
        });
      }
    } catch (error) {
      toast({
        title: "Error updating email",
        description: "An unexpected error occurred",
        variant: "destructive"
      });
    } finally {
      setEmailLoading(false);
    }
  };

  const handlePasswordUpdate = async () => {
    if (!newPassword || !confirmPassword) {
      toast({
        title: "Error",
        description: "Please fill in all password fields",
        variant: "destructive"
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "Error",
        description: "New passwords do not match",
        variant: "destructive"
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters long",
        variant: "destructive"
      });
      return;
    }

    setPasswordLoading(true);
    
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });
      
      if (error) {
        toast({
          title: "Error updating password",
          description: error.message,
          variant: "destructive"
        });
      } else {
        toast({
          title: "Password updated successfully"
        });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (error) {
      toast({
        title: "Error updating password",
        description: "An unexpected error occurred",
        variant: "destructive"
      });
    } finally {
      setPasswordLoading(false);
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
            <p className="text-muted-foreground">Please sign in again</p>
            <Button onClick={() => navigate('/auth')} className="w-full">
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
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate('/profile')}
            className="p-2"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Account Settings</h1>
        </div>
      </div>

      {/* Security Information */}
      <div className="px-6 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Security Information</h2>
          </div>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>• Your password is encrypted and securely stored</p>
            <p>• Email changes require confirmation from your new email address</p>
            <p>• You'll be signed out from other devices after password changes</p>
            <p>• Contact support if you have trouble accessing your account</p>
          </div>
        </Card>
      </div>

      {/* Email Settings */}
      <div className="px-6 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <Mail className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Email Address</h2>
          </div>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email" className="text-sm text-muted-foreground">
                Current email: {user.email}
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter new email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2"
              />
            </div>
            <Button 
              onClick={handleEmailUpdate}
              disabled={emailLoading || email === user.email}
              className="w-full"
            >
              {emailLoading ? 'Updating...' : 'Update Email'}
            </Button>
            <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
              <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                You'll receive a confirmation email at your new address. Click the link to complete the change.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Password Settings */}
      <div className="px-6 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <Lock className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Change Password</h2>
          </div>
          <div className="space-y-4">
            <div>
              <Label htmlFor="newPassword" className="text-sm">
                New Password
              </Label>
              <Input
                id="newPassword"
                type="password"
                placeholder="Enter new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword" className="text-sm">
                Confirm New Password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1"
              />
            </div>
            <Button 
              onClick={handlePasswordUpdate}
              disabled={passwordLoading || !newPassword || !confirmPassword}
              className="w-full"
            >
              {passwordLoading ? 'Updating...' : 'Update Password'}
            </Button>
            <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
              <Shield className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Password must be at least 6 characters long. Choose a strong password for better security.
              </p>
            </div>
          </div>
        </Card>
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

      {/* Measurement System */}
      <div className="px-6 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <Ruler className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Measurement System</h2>
          </div>
          <div className="space-y-3">
            <Select value={measurementSystem} onValueChange={setMeasurementSystem}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="metric">Metric (km, m, °C)</SelectItem>
                <SelectItem value="imperial">Imperial (miles, ft, °F)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              This affects distance calculations and temperature units throughout the app
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

    </div>
  );
};

export default AccountSettings;