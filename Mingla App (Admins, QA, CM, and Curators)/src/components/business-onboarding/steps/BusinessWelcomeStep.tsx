import React from 'react';
import { ArrowRight, Briefcase } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import MinglaLogo from '../../MinglaLogo';
import { BusinessOnboardingStepProps } from '../types';
import { validateEmail } from '../helpers';

interface BusinessWelcomeStepProps extends BusinessOnboardingStepProps {
  onBackToSignIn?: () => void;
}

export default function BusinessWelcomeStep({ 
  data, 
  onUpdate, 
  onNext,
  onBackToSignIn 
}: BusinessWelcomeStepProps) {
  const canProceed = data.ownerFirstName.trim() && 
                     data.ownerLastName.trim() && 
                     data.email.trim() &&
                     validateEmail(data.email);

  return (
    <div className="flex flex-col items-center text-center space-y-8">
      {/* Logo */}
      <div className="flex justify-center">
        <MinglaLogo size={96} />
      </div>

      {/* Welcome Content */}
      <div className="space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-[#eb7825]/10 rounded-full">
          <Briefcase className="w-8 h-8 text-[#eb7825]" />
        </div>
        
        <h1 className="text-3xl text-black">
          Welcome to Mingla Business
        </h1>
        
        <p className="text-gray-600 max-w-md mx-auto">
          Let's get your business set up so you can start offering amazing experiences to our community
        </p>
      </div>

      {/* Form Fields */}
      <div className="w-full max-w-md space-y-4 text-left">
        <div className="space-y-2">
          <Label htmlFor="firstName">First Name *</Label>
          <Input
            id="firstName"
            type="text"
            placeholder="John"
            value={data.ownerFirstName}
            onChange={(e) => onUpdate({ ownerFirstName: e.target.value })}
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="lastName">Last Name *</Label>
          <Input
            id="lastName"
            type="text"
            placeholder="Smith"
            value={data.ownerLastName}
            onChange={(e) => onUpdate({ ownerLastName: e.target.value })}
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email Address *</Label>
          <Input
            id="email"
            type="email"
            placeholder="john@example.com"
            value={data.email}
            onChange={(e) => onUpdate({ email: e.target.value })}
            className="w-full"
          />
          {data.email && !validateEmail(data.email) && (
            <p className="text-sm text-red-500">Please enter a valid email address</p>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="w-full max-w-md space-y-3">
        <Button
          onClick={onNext}
          disabled={!canProceed}
          className="w-full bg-[#eb7825] hover:bg-[#d6691f] text-white flex items-center justify-center gap-2"
        >
          Get Started
          <ArrowRight className="w-4 h-4" />
        </Button>

        {onBackToSignIn && (
          <Button
            onClick={onBackToSignIn}
            variant="ghost"
            className="w-full text-gray-600"
          >
            Back to Sign In
          </Button>
        )}
      </div>

      {/* Help Text */}
      <p className="text-sm text-gray-500 max-w-md">
        Already have a business account?{' '}
        <button
          onClick={onBackToSignIn}
          className="text-[#eb7825] hover:underline"
        >
          Sign in here
        </button>
      </p>
    </div>
  );
}
