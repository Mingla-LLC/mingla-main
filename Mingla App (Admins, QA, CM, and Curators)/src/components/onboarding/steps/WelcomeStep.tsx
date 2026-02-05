import React from 'react';
import { Mail, ArrowLeft, ArrowRight } from 'lucide-react';
import { StepProps } from '../types';

// Apple Icon SVG
const AppleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
  </svg>
);

// Google Icon SVG
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

interface WelcomeStepProps extends StepProps {
  onBackToSignIn?: () => void;
}

export default function WelcomeStep({ data, onUpdate, onNext, onBack, onBackToSignIn }: WelcomeStepProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-1 px-4 sm:px-6">
        <h2 className="text-gray-900">Welcome to Mingla</h2>
        <p className="text-xs text-gray-600">
          Let's get you started with your personalized experience
        </p>
      </div>

      {/* User Profile Display */}
      <div className="flex flex-col items-center px-4 sm:px-6">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center text-white mb-3">
          <span className="text-2xl">
            {data.userProfile.firstName && data.userProfile.lastName
              ? `${data.userProfile.firstName[0]}${data.userProfile.lastName[0]}`
              : 'JD'
            }
          </span>
        </div>
        <h3 className="text-gray-900">
          {data.userProfile.firstName && data.userProfile.lastName
            ? `${data.userProfile.firstName} ${data.userProfile.lastName}`
            : 'John Doe'
          }
        </h3>
        <p className="text-xs text-gray-600">
          {data.userProfile.email || 'john.doe@email.com'}
        </p>
      </div>

      {/* Social Login Buttons */}
      <div className="space-y-2.5 px-4 sm:px-6">
        {/* Continue with Apple */}
        <button
          onClick={() => {
            // Mock Apple login
            onUpdate({
              userProfile: {
                firstName: 'John',
                lastName: 'Doe',
                email: 'john.doe@icloud.com',
                profilePhoto: ''
              }
            });
          }}
          className="w-full py-3.5 px-4 bg-black text-white rounded-xl flex items-center justify-center gap-3 hover:bg-gray-900 transition-colors"
        >
          <AppleIcon />
          <span className="text-sm">Continue with Apple</span>
        </button>

        {/* Continue with Google */}
        <button
          onClick={() => {
            // Mock Google login
            onUpdate({
              userProfile: {
                firstName: 'John',
                lastName: 'Doe',
                email: 'john.doe@gmail.com',
                profilePhoto: ''
              }
            });
          }}
          className="w-full py-3.5 px-4 bg-white border-2 border-gray-200 text-gray-900 rounded-xl flex items-center justify-center gap-3 hover:border-gray-300 hover:bg-gray-50 transition-colors"
        >
          <GoogleIcon />
          <span className="text-sm">Continue with Google</span>
        </button>

        {/* Continue with Email */}
        <button
          onClick={() => {
            // Mock Email login
            onUpdate({
              userProfile: {
                firstName: 'John',
                lastName: 'Doe',
                email: 'john.doe@email.com',
                profilePhoto: ''
              }
            });
          }}
          className="w-full py-3.5 px-4 bg-white border-2 border-gray-200 text-gray-900 rounded-xl flex items-center justify-center gap-3 hover:border-gray-300 hover:bg-gray-50 transition-colors"
        >
          <Mail className="w-5 h-5 text-gray-600" />
          <span className="text-sm">Continue with Email</span>
        </button>
      </div>

      {/* Navigation Buttons */}
      <div className="flex gap-3 px-4 sm:px-6">
        {onBackToSignIn && (
          <button
            type="button"
            onClick={onBackToSignIn}
            className="flex-1 py-3 px-4 bg-white border-2 border-gray-200 text-gray-700 rounded-xl flex items-center justify-center gap-2 hover:border-gray-300 hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </button>
        )}
        
        <button
          onClick={onNext}
          className="flex-1 py-3 px-4 bg-[#eb7825] text-white rounded-xl flex items-center justify-center gap-2 hover:bg-[#d6691f] transition-colors shadow-md"
        >
          <span className="text-sm">Continue</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Footer Text */}
      <div className="text-center px-4 sm:px-6">
        <p className="text-xs text-gray-500">
          By continuing, you agree to Mingla's Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
}