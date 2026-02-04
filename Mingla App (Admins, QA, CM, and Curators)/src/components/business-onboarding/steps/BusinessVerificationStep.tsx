import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { Checkbox } from '../../ui/checkbox';
import { Label } from '../../ui/label';
import { BusinessOnboardingStepProps } from '../types';

export default function BusinessVerificationStep({ data, onUpdate }: BusinessOnboardingStepProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-[#eb7825]/10 rounded-full">
          <ShieldCheck className="w-7 h-7 text-[#eb7825]" />
        </div>
        <h2 className="text-2xl text-black">
          Terms & Verification
        </h2>
        <p className="text-gray-600">
          Review and accept our terms to continue
        </p>
      </div>

      {/* Terms Content */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 space-y-6">
        {/* Terms of Service */}
        <div className="space-y-3">
          <h3 className="font-medium text-black">Business Partner Agreement</h3>
          <div className="bg-gray-50 rounded-lg p-4 max-h-64 overflow-y-auto text-sm text-gray-700 space-y-3">
            <p>
              <strong>1. Account Terms</strong><br />
              By creating a Mingla Business account, you agree to provide accurate, current, and complete information about your business.
            </p>
            <p>
              <strong>2. Business Obligations</strong><br />
              You are responsible for maintaining the quality and accuracy of your experiences, honoring bookings, and providing excellent customer service.
            </p>
            <p>
              <strong>3. Payments & Fees</strong><br />
              Mingla charges a platform fee on each booking. You'll receive detailed information about fees and payout schedules in your dashboard.
            </p>
            <p>
              <strong>4. Commission Structure</strong><br />
              If you work with curators, commission rates will be agreed upon separately. Mingla facilitates these partnerships but you control the terms.
            </p>
            <p>
              <strong>5. Cancellations & Refunds</strong><br />
              You must honor your stated cancellation policy. Excessive cancellations may result in account suspension.
            </p>
            <p>
              <strong>6. Content & Intellectual Property</strong><br />
              You retain ownership of your content but grant Mingla a license to display it on the platform.
            </p>
            <p>
              <strong>7. Prohibited Activities</strong><br />
              Fraudulent activity, discrimination, or violation of laws will result in immediate account termination.
            </p>
            <p>
              <strong>8. Account Termination</strong><br />
              Either party may terminate this agreement with 30 days notice. Outstanding obligations must be fulfilled.
            </p>
          </div>
        </div>

        {/* Acceptance Checkboxes */}
        <div className="space-y-4 pt-4 border-t border-gray-200">
          <div className="flex items-start gap-4">
            <Checkbox
              id="terms"
              checked={data.termsAccepted}
              onCheckedChange={(checked) => onUpdate({ termsAccepted: checked as boolean })}
              className="mt-1 flex-shrink-0"
            />
            <Label 
              htmlFor="terms" 
              className="text-sm cursor-pointer flex-1"
              style={{ lineHeight: '1.8' }}
            >
              I have read and agree to the <a href="#" className="text-[#eb7825] underline text-sm inline">Terms of Service</a> and <a href="#" className="text-[#eb7825] underline text-sm inline">Business Partner Agreement</a> *
            </Label>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="marketing"
              checked={data.marketingConsent}
              onCheckedChange={(checked) => onUpdate({ marketingConsent: checked as boolean })}
            />
            <Label 
              htmlFor="marketing" 
              className="text-sm leading-relaxed cursor-pointer"
            >
              I agree to receive marketing communications, tips, and updates from Mingla (optional)
            </Label>
          </div>
        </div>

        {/* Verification Notice */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-900">
            ⏱️ <strong>Verification Process:</strong> After completing onboarding, our team will review your business within 24-48 hours. You'll be notified once verified and can start accepting bookings.
          </p>
        </div>

        {/* Data Privacy */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-900">
            🔒 <strong>Your Privacy:</strong> We take data security seriously. Your business information is encrypted and will only be used to operate your Mingla presence. Read our{' '}
            <button className="text-[#eb7825] hover:underline">
              Privacy Policy
            </button>
            {' '}for details.
          </p>
        </div>
      </div>
    </div>
  );
}