import React, { useState } from 'react';
import { User, Mail, Lock, Bell, Eye, EyeOff } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { toast } from 'sonner@2.0.3';
import AdminPageLayout from './AdminPageLayout';

export default function AdminSettings({ userData, onSignOut }: any) {
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  
  const [profileData, setProfileData] = useState({
    name: userData?.name || '',
    email: userData?.email || ''
  });

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [notifications, setNotifications] = useState({
    emailNotifications: true,
    newTickets: true,
    newUsers: true,
    systemAlerts: true
  });

  const handleSaveProfile = () => {
    if (!profileData.name || !profileData.email) {
      toast.error('Please fill in all fields');
      return;
    }

    // Update in localStorage
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    const updatedUser = { ...currentUser, ...profileData };
    localStorage.setItem('currentUser', JSON.stringify(updatedUser));

    // Update in users list
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const updatedUsers = users.map((u: any) => 
      u.id === currentUser.id ? updatedUser : u
    );
    localStorage.setItem('users', JSON.stringify(updatedUsers));

    toast.success('Profile updated successfully');
  };

  const handleChangePassword = () => {
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      toast.error('Please fill in all password fields');
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    if (passwordData.newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    // In a real app, you'd verify the current password and update it
    toast.success('Password changed successfully');
    setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
  };

  const handleSaveNotifications = () => {
    localStorage.setItem('adminNotificationSettings', JSON.stringify(notifications));
    toast.success('Notification settings saved');
  };

  return (
    <AdminPageLayout
      title="Settings"
      description="Manage your account settings and preferences"
    >
      <div className="space-y-6">
        {/* Profile Settings */}
        <Card className="p-6 border border-gray-200">
        <h2 className="text-[#111827] mb-4">Profile Settings</h2>
        <div className="space-y-4">
          <div>
            <Label>Full Name</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                value={profileData.name}
                onChange={(e) => setProfileData({ ...profileData, name: e.target.value })}
                className="pl-10"
                placeholder="Enter your name"
              />
            </div>
          </div>

          <div>
            <Label>Email Address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="email"
                value={profileData.email}
                onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                className="pl-10"
                placeholder="Enter your email"
              />
            </div>
          </div>

          <div className="pt-2">
            <Button 
              onClick={handleSaveProfile}
              className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
            >
              Save Profile
            </Button>
          </div>
        </div>
      </Card>

      {/* Password Settings */}
      <Card className="p-6 border border-gray-200">
        <h2 className="text-[#111827] mb-4">Change Password</h2>
        <div className="space-y-4">
          <div>
            <Label>Current Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type={showCurrentPassword ? 'text' : 'password'}
                value={passwordData.currentPassword}
                onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                className="pl-10 pr-10"
                placeholder="Enter current password"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <Label>New Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type={showNewPassword ? 'text' : 'password'}
                value={passwordData.newPassword}
                onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                className="pl-10 pr-10"
                placeholder="Enter new password"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <Label>Confirm New Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="password"
                value={passwordData.confirmPassword}
                onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                className="pl-10"
                placeholder="Confirm new password"
              />
            </div>
          </div>

          <div className="pt-2">
            <Button 
              onClick={handleChangePassword}
              className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
            >
              Change Password
            </Button>
          </div>
        </div>
      </Card>

      {/* Notification Settings */}
      <Card className="p-6 border border-gray-200">
        <h2 className="text-[#111827] mb-4">Notification Preferences</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[#111827]">Email Notifications</p>
              <p className="text-[#6B7280] text-sm">Receive notifications via email</p>
            </div>
            <Switch
              checked={notifications.emailNotifications}
              onCheckedChange={(checked) => 
                setNotifications({ ...notifications, emailNotifications: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-[#111827]">New Support Tickets</p>
              <p className="text-[#6B7280] text-sm">Get notified when new tickets are created</p>
            </div>
            <Switch
              checked={notifications.newTickets}
              onCheckedChange={(checked) => 
                setNotifications({ ...notifications, newTickets: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-[#111827]">New User Registrations</p>
              <p className="text-[#6B7280] text-sm">Get notified when users sign up</p>
            </div>
            <Switch
              checked={notifications.newUsers}
              onCheckedChange={(checked) => 
                setNotifications({ ...notifications, newUsers: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-[#111827]">System Alerts</p>
              <p className="text-[#6B7280] text-sm">Get notified about system issues</p>
            </div>
            <Switch
              checked={notifications.systemAlerts}
              onCheckedChange={(checked) => 
                setNotifications({ ...notifications, systemAlerts: checked })
              }
            />
          </div>

          <div className="pt-2">
            <Button 
              onClick={handleSaveNotifications}
              className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
            >
              Save Preferences
            </Button>
          </div>
        </div>
      </Card>

      {/* Danger Zone */}
      <Card className="p-6 border border-red-200 bg-red-50/50">
        <h2 className="text-red-900 mb-2">Danger Zone</h2>
        <p className="text-red-700 text-sm mb-4">
          Once you sign out, you'll need to log in again to access your account.
        </p>
        <Button 
          onClick={onSignOut}
          variant="destructive"
        >
          Sign Out
        </Button>
      </Card>
      </div>
    </AdminPageLayout>
  );
}
