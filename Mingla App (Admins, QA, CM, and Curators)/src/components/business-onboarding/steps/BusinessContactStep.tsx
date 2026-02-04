import React from 'react';
import { Phone, Globe, Instagram, Facebook, Twitter } from 'lucide-react';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { BusinessOnboardingStepProps } from '../types';
import { formatPhoneNumber, validatePhone } from '../helpers';

export default function BusinessContactStep({ data, onUpdate }: BusinessOnboardingStepProps) {
  const handlePhoneChange = (value: string) => {
    onUpdate({ phone: value });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-[#eb7825]/10 rounded-full">
          <Phone className="w-7 h-7 text-[#eb7825]" />
        </div>
        <h2 className="text-2xl text-black">
          Contact Information
        </h2>
        <p className="text-gray-600">
          How can customers reach you?
        </p>
      </div>

      {/* Form */}
      <div className="space-y-4 bg-white rounded-xl p-6 border border-gray-200">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone Number *</Label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              id="phone"
              type="tel"
              placeholder="(555) 123-4567"
              value={data.phone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              className="w-full pl-10"
            />
          </div>
          {data.phone && !validatePhone(data.phone) && (
            <p className="text-sm text-red-500">Please enter a valid phone number</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="address">Business Address *</Label>
          <Input
            id="address"
            type="text"
            placeholder="123 Main Street"
            value={data.address}
            onChange={(e) => onUpdate({ address: e.target.value })}
            className="w-full"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              type="text"
              placeholder="San Francisco"
              value={data.city}
              onChange={(e) => onUpdate({ city: e.target.value })}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="state">State</Label>
            <Input
              id="state"
              type="text"
              placeholder="CA"
              value={data.state}
              onChange={(e) => onUpdate({ state: e.target.value })}
              className="w-full"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="zipCode">ZIP Code</Label>
            <Input
              id="zipCode"
              type="text"
              placeholder="94102"
              value={data.zipCode}
              onChange={(e) => onUpdate({ zipCode: e.target.value })}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="country">Country</Label>
            <Input
              id="country"
              type="text"
              placeholder="United States"
              value={data.country}
              onChange={(e) => onUpdate({ country: e.target.value })}
              className="w-full"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-gray-200">
          <h3 className="text-sm text-gray-700 mb-3">Online Presence (Optional)</h3>
          
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="website"
                  type="url"
                  placeholder="https://yourwebsite.com"
                  value={data.website}
                  onChange={(e) => onUpdate({ website: e.target.value })}
                  className="w-full pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="instagram">Instagram</Label>
              <div className="relative">
                <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="instagram"
                  type="text"
                  placeholder="@yourbusiness"
                  value={data.socialMedia.instagram}
                  onChange={(e) => onUpdate({ 
                    socialMedia: { ...data.socialMedia, instagram: e.target.value }
                  })}
                  className="w-full pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="facebook">Facebook</Label>
              <div className="relative">
                <Facebook className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="facebook"
                  type="text"
                  placeholder="facebook.com/yourbusiness"
                  value={data.socialMedia.facebook}
                  onChange={(e) => onUpdate({ 
                    socialMedia: { ...data.socialMedia, facebook: e.target.value }
                  })}
                  className="w-full pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="twitter">Twitter / X</Label>
              <div className="relative">
                <Twitter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="twitter"
                  type="text"
                  placeholder="@yourbusiness"
                  value={data.socialMedia.twitter}
                  onChange={(e) => onUpdate({ 
                    socialMedia: { ...data.socialMedia, twitter: e.target.value }
                  })}
                  className="w-full pl-10"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
