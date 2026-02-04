import React, { useState } from 'react';
import { 
  User, Mail, Lock, Bell, CreditCard, Shield,
  Globe, Palette, Save, Eye, EyeOff, LogOut
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { Switch } from '../ui/switch';
import { Separator } from '../ui/separator';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import CuratorPageLayout from './CuratorPageLayout';
import { toast } from 'sonner@2.0.3';

interface CuratorSettingsProps {
  userData?: any;
  onSignOut: () => void;
}

export default function CuratorSettings({ userData, onSignOut }: CuratorSettingsProps) {
  const [activeSection, setActiveSection] = useState<'profile' | 'account' | 'notifications' | 'payout' | 'privacy'>('profile');
  const [showPassword, setShowPassword] = useState(false);

  const handleSave = () => {
    toast.success('Settings saved successfully');
  };

  const sections = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'account', label: 'Account', icon: Mail },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'payout', label: 'Payout Settings', icon: CreditCard },
    { id: 'privacy', label: 'Privacy & Security', icon: Shield }
  ];

  return (
    <CuratorPageLayout
      title="Settings"
      description="Manage your curator account preferences"
    >
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Settings Navigation */}
        <Card className="lg:col-span-1 p-4 border border-gray-200 h-fit">
          <nav className="space-y-1">
            {sections.map(section => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id as any)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                    activeSection === section.id
                      ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-sm">{section.label}</span>
                </button>
              );
            })}
          </nav>
        </Card>

        {/* Settings Content */}
        <Card className="lg:col-span-3 p-4 sm:p-6 border border-gray-200">
          {activeSection === 'profile' && (
            <div className="space-y-5 sm:space-y-6">
              <div>
                <h2 className="text-[#111827] mb-1">Profile Information</h2>
                <p className="text-[#6B7280] text-sm">Update your personal details and public profile</p>
              </div>

              <Separator />

              <div className="space-y-4 sm:space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                  <div>
                    <Label htmlFor="fullName" className="mb-2 block">Full Name</Label>
                    <Input 
                      id="fullName"
                      defaultValue={userData?.name || ''}
                      placeholder="Enter your full name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="organization" className="mb-2 block">Organization</Label>
                    <Input 
                      id="organization"
                      defaultValue={userData?.organization || ''}
                      placeholder="Your company or organization"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="bio" className="mb-2 block">Bio</Label>
                  <Textarea 
                    id="bio"
                    placeholder="Tell us about yourself..."
                    rows={4}
                  />
                  <p className="text-xs text-[#6B7280] mt-1.5">Brief description for your public curator profile</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                  <div>
                    <Label htmlFor="location" className="mb-2 block">Location</Label>
                    <Input 
                      id="location"
                      placeholder="City, State/Province"
                    />
                  </div>
                  <div>
                    <Label htmlFor="website" className="mb-2 block">Website</Label>
                    <Input 
                      id="website"
                      type="url"
                      placeholder="https://yourwebsite.com"
                    />
                  </div>
                </div>

                <div>
                  <Label className="mb-2 block">Profile Picture</Label>
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-full flex items-center justify-center text-white text-2xl">
                      {userData?.name?.charAt(0) || 'C'}
                    </div>
                    <div>
                      <Button variant="outline" size="sm">Upload New Photo</Button>
                      <p className="text-xs text-[#6B7280] mt-1">JPG, PNG or GIF. Max 2MB.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-start sm:justify-end">
                <Button onClick={handleSave} className="bg-[#eb7825] hover:bg-[#d6691f] text-white">
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </Button>
              </div>
            </div>
          )}

          {activeSection === 'account' && (
            <div className="space-y-5 sm:space-y-6">
              <div>
                <h2 className="text-[#111827] mb-1">Account Settings</h2>
                <p className="text-[#6B7280] text-sm">Manage your email and password</p>
              </div>

              <Separator />

              <div className="space-y-4 sm:space-y-5">
                <div>
                  <Label htmlFor="email" className="mb-2 block">Email Address</Label>
                  <Input 
                    id="email"
                    type="email"
                    defaultValue={userData?.email || ''}
                  />
                  <p className="text-xs text-[#6B7280] mt-1.5">This is your primary contact email</p>
                </div>

                <div>
                  <Label htmlFor="currentPassword" className="mb-2 block">Current Password</Label>
                  <div className="relative">
                    <Input 
                      id="currentPassword"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter current password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                  <div>
                    <Label htmlFor="newPassword" className="mb-2 block">New Password</Label>
                    <Input 
                      id="newPassword"
                      type="password"
                      placeholder="Enter new password"
                    />
                  </div>
                  <div>
                    <Label htmlFor="confirmPassword" className="mb-2 block">Confirm Password</Label>
                    <Input 
                      id="confirmPassword"
                      type="password"
                      placeholder="Confirm new password"
                    />
                  </div>
                </div>

                <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                  <p className="text-sm text-blue-900">
                    <strong>Password requirements:</strong> At least 8 characters with a mix of uppercase, lowercase, numbers, and symbols.
                  </p>
                </div>
              </div>

              <div className="flex justify-start sm:justify-end">
                <Button onClick={handleSave} className="bg-[#eb7825] hover:bg-[#d6691f] text-white">
                  <Save className="w-4 h-4 mr-2" />
                  Update Account
                </Button>
              </div>
            </div>
          )}

          {activeSection === 'notifications' && (
            <div className="space-y-5 sm:space-y-6">
              <div>
                <h2 className="text-[#111827] mb-1">Notification Preferences</h2>
                <p className="text-[#6B7280] text-sm">Choose what updates you want to receive</p>
              </div>

              <Separator />

              <div className="space-y-5 sm:space-y-6">
                <div>
                  <h3 className="text-[#111827] text-sm mb-4">Email Notifications</h3>
                  <div className="space-y-3">
                    {[
                      { label: 'New bookings on your experiences', description: 'Get notified when someone books an experience you created' },
                      { label: 'Card status updates', description: 'When your cards are approved, returned, or require changes' },
                      { label: 'Business messages', description: 'New messages from your business partners' },
                      { label: 'Monthly earnings reports', description: 'Summary of your earnings and performance' },
                      { label: 'Payment confirmations', description: 'When payouts are processed to your account' }
                    ].map((item, index) => (
                      <div key={index} className="flex items-start justify-between p-4 rounded-xl border border-gray-200">
                        <div className="flex-1">
                          <p className="text-[#111827]">{item.label}</p>
                          <p className="text-[#6B7280] text-sm mt-1">{item.description}</p>
                        </div>
                        <Switch defaultChecked />
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-[#111827] text-sm mb-4">Push Notifications</h3>
                  <div className="space-y-3">
                    {[
                      { label: 'Urgent alerts', description: 'Critical updates that need immediate attention' },
                      { label: 'Messages', description: 'New messages from businesses and customers' },
                      { label: 'Marketing updates', description: 'New features, tips, and platform updates' }
                    ].map((item, index) => (
                      <div key={index} className="flex items-start justify-between p-4 rounded-xl border border-gray-200">
                        <div className="flex-1">
                          <p className="text-[#111827]">{item.label}</p>
                          <p className="text-[#6B7280] text-sm mt-1">{item.description}</p>
                        </div>
                        <Switch defaultChecked />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-start sm:justify-end">
                <Button onClick={handleSave} className="bg-[#eb7825] hover:bg-[#d6691f] text-white">
                  <Save className="w-4 h-4 mr-2" />
                  Save Preferences
                </Button>
              </div>
            </div>
          )}

          {activeSection === 'payout' && (
            <div className="space-y-5 sm:space-y-6">
              <div>
                <h2 className="text-[#111827] mb-1">Payout Settings</h2>
                <p className="text-[#6B7280] text-sm">Manage how you receive your earnings</p>
              </div>

              <Separator />

              <div className="space-y-4 sm:space-y-5">
                <div className="p-4 sm:p-6 rounded-xl border-2 border-[#eb7825] bg-orange-50">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-0 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-white rounded-lg">
                        <CreditCard className="w-5 h-5 text-[#eb7825]" />
                      </div>
                      <div>
                        <p className="text-[#111827]">Bank Account</p>
                        <p className="text-[#6B7280] text-sm">••••••4242</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 bg-[#eb7825] text-white text-xs rounded-full self-start">Primary</span>
                  </div>
                  <p className="text-sm text-[#6B7280] leading-relaxed">
                    Next payout: <strong>$2,340.00</strong> on <strong>November 1, 2025</strong>
                  </p>
                </div>

                <Button variant="outline" className="w-full">
                  <CreditCard className="w-4 h-4 mr-2" />
                  Add Payment Method
                </Button>

                <div className="p-4 sm:p-6 bg-gray-50 rounded-xl">
                  <h3 className="text-[#111827] text-sm mb-4">Payout Schedule</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-2">
                      <span className="text-[#6B7280]">Frequency:</span>
                      <span className="text-[#111827]">Monthly (1st of the month)</span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-2">
                      <span className="text-[#6B7280]">Minimum payout:</span>
                      <span className="text-[#111827]">$50.00</span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-2">
                      <span className="text-[#6B7280]">Processing time:</span>
                      <span className="text-[#111827]">2-5 business days</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                  <p className="text-sm text-blue-900">
                    <strong>Tax Information:</strong> You'll need to provide tax information before receiving your first payout. <button className="text-blue-700 underline">Complete tax form</button>
                  </p>
                </div>
              </div>

              <div className="flex justify-start sm:justify-end">
                <Button onClick={handleSave} className="bg-[#eb7825] hover:bg-[#d6691f] text-white">
                  <Save className="w-4 h-4 mr-2" />
                  Save Settings
                </Button>
              </div>
            </div>
          )}

          {activeSection === 'privacy' && (
            <div className="space-y-5 sm:space-y-6">
              <div>
                <h2 className="text-[#111827] mb-1">Privacy & Security</h2>
                <p className="text-[#6B7280] text-sm">Control your privacy and account security</p>
              </div>

              <Separator />

              <div className="space-y-5 sm:space-y-6">
                <div>
                  <h3 className="text-[#111827] text-sm mb-4">Privacy Settings</h3>
                  <div className="space-y-3">
                    {[
                      { label: 'Show my profile to the public', description: 'Allow users to see your curator profile and experiences' },
                      { label: 'Display email on profile', description: 'Make your email visible to business partners' },
                      { label: 'Allow direct messages', description: 'Let businesses contact you directly' }
                    ].map((item, index) => (
                      <div key={index} className="flex items-start justify-between p-4 rounded-xl border border-gray-200">
                        <div className="flex-1">
                          <p className="text-[#111827]">{item.label}</p>
                          <p className="text-[#6B7280] text-sm mt-1">{item.description}</p>
                        </div>
                        <Switch defaultChecked />
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-[#111827] text-sm mb-4">Security</h3>
                  <div className="space-y-3">
                    <Button variant="outline" className="w-full justify-start">
                      <Shield className="w-4 h-4 mr-2" />
                      Enable Two-Factor Authentication
                    </Button>
                    <Button variant="outline" className="w-full justify-start">
                      <Lock className="w-4 h-4 mr-2" />
                      View Login Activity
                    </Button>
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-[#111827] text-sm mb-4">Data & Account</h3>
                  <div className="space-y-3">
                    <Button variant="outline" className="w-full justify-start">
                      Download My Data
                    </Button>
                    <Button variant="outline" className="w-full justify-start text-red-600 hover:text-red-700 hover:border-red-300">
                      Delete Account
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex justify-start sm:justify-end">
                <Button onClick={handleSave} className="bg-[#eb7825] hover:bg-[#d6691f] text-white">
                  <Save className="w-4 h-4 mr-2" />
                  Save Settings
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Sign Out Section */}

    </CuratorPageLayout>
  );
}
