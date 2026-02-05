import React from 'react';
import { Building2 } from 'lucide-react';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { BusinessOnboardingStepProps } from '../types';
import { BUSINESS_TYPES, BUSINESS_CATEGORIES, TEAM_SIZES } from '../constants';

export default function BusinessInfoStep({ data, onUpdate }: BusinessOnboardingStepProps) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_, i) => currentYear - i);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-[#eb7825]/10 rounded-full">
          <Building2 className="w-7 h-7 text-[#eb7825]" />
        </div>
        <h2 className="text-2xl text-black">
          Tell us about your business
        </h2>
        <p className="text-gray-600">
          Help us understand what makes your business unique
        </p>
      </div>

      {/* Form */}
      <div className="space-y-4 bg-white rounded-xl p-6 border border-gray-200">
        <div className="space-y-2">
          <Label htmlFor="businessName">Business Name *</Label>
          <Input
            id="businessName"
            type="text"
            placeholder="e.g., The Coffee Lab"
            value={data.businessName}
            onChange={(e) => onUpdate({ businessName: e.target.value })}
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="businessType">Business Type *</Label>
          <Select
            value={data.businessType}
            onValueChange={(value) => onUpdate({ businessType: value as any })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select business type" />
            </SelectTrigger>
            <SelectContent>
              {BUSINESS_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="businessCategory">Business Category *</Label>
          <Select
            value={data.businessCategory}
            onValueChange={(value) => onUpdate({ businessCategory: value })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {BUSINESS_CATEGORIES.map((category) => (
                <SelectItem key={category.value} value={category.value}>
                  {category.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="foundingYear">Year Founded</Label>
            <Select
              value={data.foundingYear}
              onValueChange={(value) => onUpdate({ foundingYear: value })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="teamSize">Team Size</Label>
            <Select
              value={data.teamSize}
              onValueChange={(value) => onUpdate({ teamSize: value })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select size" />
              </SelectTrigger>
              <SelectContent>
                {TEAM_SIZES.map((size) => (
                  <SelectItem key={size.value} value={size.value}>
                    {size.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Business Description</Label>
          <Textarea
            id="description"
            placeholder="Tell customers what makes your business special..."
            value={data.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            className="w-full min-h-[120px]"
          />
          <p className="text-sm text-gray-500">
            {data.description.length}/500 characters
          </p>
        </div>
      </div>
    </div>
  );
}
