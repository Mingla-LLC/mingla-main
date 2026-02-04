import React from 'react';
import { CheckCircle2, Building2, Phone, Clock, Image, Sparkles, ArrowRight } from 'lucide-react';
import { Button } from '../../ui/button';
import { BusinessOnboardingStepProps } from '../types';

interface BusinessCompletionStepProps extends BusinessOnboardingStepProps {
  onEditStep: (step: number) => void;
  onComplete: () => void;
}

export default function BusinessCompletionStep({ 
  data, 
  onEditStep,
  onComplete
}: BusinessCompletionStepProps) {
  const completionItems = [
    {
      icon: Building2,
      label: 'Business Information',
      value: data.businessName,
      step: 1
    },
    {
      icon: Phone,
      label: 'Contact Details',
      value: data.phone,
      step: 2
    },
    {
      icon: Clock,
      label: 'Operating Hours',
      value: 'Configured',
      step: 3
    },
    {
      icon: Image,
      label: 'Photos & Media',
      value: `${data.photos.length} photo${data.photos.length !== 1 ? 's' : ''}`,
      step: 4
    },
    {
      icon: Sparkles,
      label: 'First Experience',
      value: data.firstExperienceCreated ? 'Created' : 'Skipped',
      step: 6
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full">
          <CheckCircle2 className="w-10 h-10 text-green-600" />
        </div>
        <div>
          <h2 className="text-3xl text-black mb-2">
            You're All Set! 🎉
          </h2>
          <p className="text-gray-600">
            Welcome to Mingla Business, {data.ownerFirstName}!
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 space-y-4">
        <h3 className="font-medium text-black mb-4">Onboarding Summary</h3>
        
        {completionItems.map((item, index) => (
          <div 
            key={index}
            className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#eb7825]/10 rounded-lg">
                <item.icon className="w-4 h-4 text-[#eb7825]" />
              </div>
              <div>
                <p className="text-sm font-medium text-black">{item.label}</p>
                <p className="text-xs text-gray-500">{item.value}</p>
              </div>
            </div>
            <button
              onClick={() => onEditStep(item.step)}
              className="text-sm text-[#eb7825] hover:underline"
            >
              Edit
            </button>
          </div>
        ))}
      </div>

      {/* Next Steps */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 space-y-3">
        <h3 className="font-medium text-blue-900">What happens next?</h3>
        <ol className="space-y-2 text-sm text-blue-900">
          <li className="flex items-start gap-2">
            <span className="font-semibold mt-0.5">1.</span>
            <span>Our team will review your business profile within 24-48 hours</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-semibold mt-0.5">2.</span>
            <span>You'll receive an email once your account is verified</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-semibold mt-0.5">3.</span>
            <span>Complete your payout setup to start receiving payments</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-semibold mt-0.5">4.</span>
            <span>Your experiences will go live and you can start accepting bookings!</span>
          </li>
        </ol>
      </div>

      {/* Quick Tips */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 space-y-3">
        <h3 className="font-medium text-black">Quick Tips for Success</h3>
        <ul className="space-y-2 text-sm text-gray-700">
          <li className="flex items-start gap-2">
            <span className="text-[#eb7825] mt-0.5">✓</span>
            <span><strong>Respond quickly:</strong> Fast responses lead to more bookings</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#eb7825] mt-0.5">✓</span>
            <span><strong>Keep availability updated:</strong> Prevent double bookings</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#eb7825] mt-0.5">✓</span>
            <span><strong>Ask for reviews:</strong> Great reviews attract more customers</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#eb7825] mt-0.5">✓</span>
            <span><strong>Create more experiences:</strong> More offerings = more bookings</span>
          </li>
        </ul>
      </div>

      {/* Complete Button */}
      <Button
        onClick={onComplete}
        className="w-full bg-[#eb7825] hover:bg-[#d6691f] text-white flex items-center justify-center gap-2 h-12"
      >
        Go to Dashboard
        <ArrowRight className="w-5 h-5" />
      </Button>

      {/* Support */}
      <p className="text-center text-sm text-gray-500">
        Need help?{' '}
        <button className="text-[#eb7825] hover:underline">
          Contact Support
        </button>
      </p>
    </div>
  );
}
