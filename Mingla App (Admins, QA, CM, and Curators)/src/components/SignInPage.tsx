import React, { useState } from 'react';
import { Eye, EyeOff, Mail, Briefcase, Building2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import minglaLogo from 'figma:asset/6850c6540f4158618f67e1fdd72281118b419a35.png';

interface SignInPageProps {
  onSignInRegular: (credentials: { email: string; password: string }) => void;
  onSignUpRegular: (userData: { email: string; password: string; name: string }) => void;
}

type AuthMode = 'welcome' | 'sign-in-regular' | 'sign-up-regular' | 'forgot-password' | 'role-select' | 'role-select-signup';
type UserRole = 'explorer' | 'business';

// Test credentials for different user roles
const TEST_CREDENTIALS = {
  explorer: {
    email: 'jordan.explorer@mingla.com',
    password: 'Mingla2025!',
    name: 'Jordan Explorer',
    description: 'Discover and plan amazing experiences'
  },
  business: {
    email: 'sunset.business@mingla.com',
    password: 'Mingla2025!',
    name: 'Sunset Wine Bar',
    description: 'Manage your business experiences and revenue'
  }
};

const ROLE_CONFIG = {
  explorer: {
    icon: Briefcase,
    color: 'from-orange-500 to-pink-500',
    label: 'Explorer'
  },
  business: {
    icon: Building2,
    color: 'from-emerald-500 to-teal-500',
    label: 'Business'
  }
};

export default function SignInPage({ onSignInRegular, onSignUpRegular }: SignInPageProps) {
  const [authMode, setAuthMode] = useState<AuthMode>('welcome');
  const [selectedRole, setSelectedRole] = useState<UserRole>('explorer');
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: TEST_CREDENTIALS.explorer.email,
    password: TEST_CREDENTIALS.explorer.password,
    name: TEST_CREDENTIALS.explorer.name
  });
  const [resetEmail, setResetEmail] = useState('');
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleRoleSelect = (role: UserRole, isSignUp: boolean = false) => {
    setSelectedRole(role);
    const credentials = TEST_CREDENTIALS[role];
    setFormData({
      email: credentials.email,
      password: credentials.password,
      name: credentials.name
    });
    
    if (isSignUp) {
      // Sign up flow - trigger signup which will show onboarding
      onSignUpRegular({ 
        email: credentials.email, 
        password: credentials.password, 
        name: credentials.name
      });
    } else {
      // Sign in flow - go directly to app
      onSignInRegular({ email: credentials.email, password: credentials.password });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    switch (authMode) {
      case 'sign-in-regular':
        onSignInRegular({ email: formData.email, password: formData.password });
        break;
      case 'sign-up-regular':
        onSignUpRegular({ email: formData.email, password: formData.password, name: formData.name });
        break;
    }
  };

  const handleForgotPassword = (e: React.FormEvent) => {
    e.preventDefault();
    setResetEmailSent(true);
    setTimeout(() => {
      setAuthMode('welcome');
      setResetEmailSent(false);
      setResetEmail('');
    }, 3000);
  };

  const resetForm = () => {
    const credentials = TEST_CREDENTIALS[selectedRole];
    setFormData({ 
      email: credentials.email, 
      password: credentials.password, 
      name: credentials.name 
    });
    setShowPassword(false);
  };

  const handleBackToWelcome = () => {
    setAuthMode('welcome');
    resetForm();
  };

  const handleDownloadProject = async () => {
    setIsDownloading(true);
    try {
      await downloadProjectAsZip();
      alert('✅ Project configuration downloaded!\n\nIMPORTANT: This ZIP contains configuration files only.\n\nYou must also copy all source files from your development environment:\n- App.tsx\n- /components folder (100+ files)\n- /screens folder\n- /theme folder\n- /navigation folder\n- /styles/globals.css\n- All .md files\n\nSee DOWNLOAD_NOTE.txt in the ZIP for details.');
    } catch (error) {
      console.error('Download failed:', error);
      alert('❌ Download failed. Please try again or use the browser download option.');
    } finally {
      setIsDownloading(false);
    }
  };

  // Role Selection Screen
  if (authMode === 'role-select' || authMode === 'role-select-signup') {
    const isSignUp = authMode === 'role-select-signup';
    
    return (
      <div className="h-screen bg-white flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-6 border-b border-gray-100 flex-shrink-0">
          <button
            onClick={handleBackToWelcome}
            className="text-gray-600 hover:text-[#eb7825] transition-colors text-sm sm:text-base"
          >
            ← Back
          </button>
          <img src={minglaLogo} alt="Mingla" className="h-5 sm:h-8 w-auto" />
          <div className="w-12"></div>
        </div>

        {/* Role Selection Content */}
        <div className="flex-1 flex flex-col items-center justify-start px-4 sm:px-6 py-6 sm:py-12 overflow-y-auto">
          <div className="w-full max-w-2xl">
            {/* Header */}
            <div className="text-center mb-8 sm:mb-12">
              <h1 className="text-gray-900 mb-2 text-xl sm:text-3xl">
                {isSignUp ? 'Sign Up as...' : 'Select Your Role'}
              </h1>
              <p className="text-gray-500 text-sm sm:text-base px-2">
                {isSignUp 
                  ? 'Choose a user type to sign up (Explorers & Curators will go through onboarding)'
                  : 'Choose a user type to sign in with pre-filled credentials'
                }
              </p>
            </div>

            {/* Role Cards */}
            <div className="space-y-3 sm:space-y-4">
              {/* Explorer */}
              <button
                onClick={() => handleRoleSelect('explorer', isSignUp)}
                className="w-full bg-white border-2 border-gray-200 hover:border-[#eb7825] rounded-2xl p-4 sm:p-6 transition-all duration-300 group hover:shadow-lg text-left"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[#eb7825] bg-opacity-10 flex items-center justify-center flex-shrink-0 group-hover:bg-opacity-20 transition-colors">
                    <Mail className="w-6 h-6 text-[#eb7825]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-gray-900 mb-1">Explorer (General User)</h3>
                    <p className="text-gray-500 text-sm mb-2">{TEST_CREDENTIALS.explorer.description}</p>
                    <div className="text-xs text-gray-400 font-mono">
                      {TEST_CREDENTIALS.explorer.email}
                    </div>
                  </div>
                </div>
              </button>

              {/* Business */}
              <button
                onClick={() => handleRoleSelect('business', isSignUp)}
                className="w-full bg-white border-2 border-gray-200 hover:border-green-600 rounded-2xl p-4 sm:p-6 transition-all duration-300 group hover:shadow-lg text-left"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0 group-hover:bg-green-200 transition-colors">
                    <Briefcase className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-gray-900 mb-1">Business</h3>
                    <p className="text-gray-500 text-sm mb-2">{TEST_CREDENTIALS.business.description}</p>
                    <div className="text-xs text-gray-400 font-mono">
                      {TEST_CREDENTIALS.business.email}
                    </div>
                  </div>
                </div>
              </button>
            </div>

            {/* Note */}
            <div className="mt-8 p-4 bg-gray-50 rounded-xl">
              <p className="text-gray-600 text-xs sm:text-sm text-center">
                All test accounts use the password: <span className="font-mono text-[#eb7825]">Mingla2025!</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (authMode === 'welcome') {
    return (
      <div className="h-screen bg-white flex flex-col overflow-hidden">
        {/* Main Content - Centered */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-4 sm:py-12">
          {/* Logo */}
          <div className="mb-4 sm:mb-8 animate-in fade-in duration-700">
            <img src={minglaLogo} alt="Mingla" className="h-12 sm:h-20 md:h-24 mx-auto w-auto" />
          </div>

          {/* Tagline */}
          <div className="text-center mb-4 sm:mb-12 max-w-md animate-in fade-in duration-700 delay-150 px-2">
            <p className="text-gray-600 tracking-wide text-xs sm:text-base leading-tight">
              The easiest way to figure out what to do on dates and hangouts.
            </p>
          </div>

          {/* Authentication Buttons */}
          <div className="w-full max-w-sm space-y-2 sm:space-y-4 animate-in fade-in duration-700 delay-300 px-2">
            {/* Sign In Buttons */}
            <div className="space-y-2">
              <Button
                onClick={() => setAuthMode('role-select')}
                className="w-full bg-[#eb7825] text-white hover:bg-[#d6691f] py-3.5 sm:py-6 rounded-2xl transition-all duration-300 shadow-sm hover:shadow-lg transform hover:scale-[1.02] text-sm sm:text-base"
              >
                Sign In with Test Account
              </Button>


            </div>

            <div className="relative py-2 sm:py-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 sm:px-4 text-gray-400 text-xs">or sign up</span>
              </div>
            </div>

            {/* Sign Up Buttons */}
            <div className="space-y-2">
              <Button
                onClick={() => setAuthMode('role-select-signup')}
                className="w-full bg-white border-2 border-[#eb7825] text-[#eb7825] hover:bg-[#eb7825] hover:text-white py-3.5 sm:py-6 rounded-2xl transition-all duration-300 shadow-sm hover:shadow-lg transform hover:scale-[1.02] text-sm sm:text-base"
              >
                Sign Up with Test Account
              </Button>


            </div>
          </div>


        </div>
      </div>
    );
  }

  // Forgot Password view
  if (authMode === 'forgot-password') {
    return (
      <div className="h-screen bg-white flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-6 border-b border-gray-100 flex-shrink-0">
          <button
            onClick={handleBackToWelcome}
            className="text-gray-600 hover:text-[#eb7825] transition-colors text-sm sm:text-base"
          >
            ← Back
          </button>
          <img src={minglaLogo} alt="Mingla" className="h-5 sm:h-8 w-auto" />
          <div className="w-12"></div>
        </div>

        {/* Form Content */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-4 sm:py-12 overflow-y-auto">
          <div className="w-full max-w-sm">
            {resetEmailSent ? (
              <div className="text-center space-y-3 sm:space-y-4 animate-in fade-in duration-500">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-[#eb7825] rounded-full flex items-center justify-center mx-auto mb-2 sm:mb-4">
                  <Mail className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                </div>
                <h1 className="text-gray-900 text-lg sm:text-2xl">Check your email</h1>
                <p className="text-gray-500 text-xs sm:text-base px-2">
                  We've sent password reset instructions to<br />
                  <span className="text-gray-900 break-all text-xs sm:text-sm">{resetEmail}</span>
                </p>
              </div>
            ) : (
              <>
                {/* Form Header */}
                <div className="text-center mb-6 sm:mb-10">
                  <h1 className="text-gray-900 mb-1 sm:mb-2 text-lg sm:text-2xl">Reset Password</h1>
                  <p className="text-gray-500 text-xs sm:text-base px-2">Enter your email to receive reset instructions</p>
                </div>

                {/* Form */}
                <form onSubmit={handleForgotPassword} className="space-y-4 sm:space-y-6">
                  <div>
                    <label className="text-gray-700 block mb-2 text-xs sm:text-base">
                      Email
                    </label>
                    <Input
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="Enter your email"
                      required
                      className="bg-gray-50 border-0 text-gray-900 placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-[#eb7825] rounded-xl py-4 sm:py-6 transition-all duration-300 text-sm sm:text-base"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-[#eb7825] text-white hover:bg-[#d6691f] py-4 sm:py-6 rounded-2xl transition-all duration-300 shadow-sm hover:shadow-lg transform hover:scale-[1.02] mt-4 sm:mt-8 text-sm sm:text-base"
                  >
                    Send Reset Link
                  </Button>
                </form>

                <div className="text-center mt-4 sm:mt-8">
                  <p className="text-gray-500 text-xs sm:text-base">
                    Remember your password?{' '}
                    <button
                      onClick={() => setAuthMode('sign-in-regular')}
                      className="text-[#eb7825] hover:text-[#d6691f] transition-colors"
                    >
                      Sign In
                    </button>
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Form view for all auth modes
  const isSignUp = authMode.includes('sign-up');
  
  const formTitle = isSignUp 
    ? 'Create Account'
    : 'Welcome Back';
  
  const formSubtitle = isSignUp
    ? 'Start your journey with Mingla'
    : 'Sign in to continue';

  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 sm:p-6 border-b border-gray-100 flex-shrink-0">
        <button
          onClick={handleBackToWelcome}
          className="text-gray-600 hover:text-[#eb7825] transition-colors text-sm sm:text-base"
        >
          ← Back
        </button>
        <img src={minglaLogo} alt="Mingla" className="h-5 sm:h-8 w-auto" />
        <div className="w-12"></div>
      </div>

      {/* Form Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-4 sm:py-12 overflow-y-auto">
        <div className="w-full max-w-sm px-4">
          {/* Prominent Mingla Logo */}
          <div className="flex justify-center mb-12 sm:mb-16">
            <img 
              src={minglaLogo} 
              alt="Mingla" 
              className="h-20 sm:h-24 w-auto"
            />
          </div>

          {/* Welcome Text */}
          <div className="text-center mb-8 sm:mb-12">
            <h1 className="text-gray-900 mb-2 tracking-tight">Welcome to Mingla</h1>
            <p className="text-gray-500">Sign in to discover amazing experiences</p>
          </div>

          {/* Sign-In Methods */}
          <div className="space-y-3 sm:space-y-4">
            {/* Email Sign-In */}
            <button className="w-full bg-white border-2 border-gray-200 hover:border-[#eb7825] text-gray-900 py-4 sm:py-5 rounded-2xl transition-all duration-300 shadow-sm hover:shadow-lg transform hover:scale-[1.02] flex items-center justify-center gap-3 group">
              <Mail className="w-5 h-5 sm:w-6 sm:h-6 text-gray-600 group-hover:text-[#eb7825] transition-colors" />
              <span className="font-medium">Continue with Email</span>
            </button>

            {/* Phone Sign-In */}
            <button className="w-full bg-white border-2 border-gray-200 hover:border-[#eb7825] text-gray-900 py-4 sm:py-5 rounded-2xl transition-all duration-300 shadow-sm hover:shadow-lg transform hover:scale-[1.02] flex items-center justify-center gap-3 group">
              <svg className="w-5 h-5 sm:w-6 sm:h-6 text-gray-600 group-hover:text-[#eb7825] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              <span className="font-medium">Continue with Phone</span>
            </button>

            {/* Divider */}
            <div className="relative flex items-center justify-center py-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-4 text-gray-400 text-sm">or continue with</span>
              </div>
            </div>

            {/* Google Sign-In */}
            <button className="w-full bg-white border-2 border-gray-200 hover:border-[#4285F4] text-gray-900 py-4 sm:py-5 rounded-2xl transition-all duration-300 shadow-sm hover:shadow-lg transform hover:scale-[1.02] flex items-center justify-center gap-3 group">
              <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span className="font-medium">Continue with Google</span>
            </button>

            {/* Apple Sign-In */}
            <button className="w-full bg-black hover:bg-gray-900 text-white py-4 sm:py-5 rounded-2xl transition-all duration-300 shadow-sm hover:shadow-lg transform hover:scale-[1.02] flex items-center justify-center gap-3">
              <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
              </svg>
              <span className="font-medium">Continue with Apple</span>
            </button>
          </div>

          {/* Footer Text */}
          <div className="text-center mt-8 sm:mt-10">
            <p className="text-gray-400 text-xs sm:text-sm px-4">
              By continuing, you agree to Mingla's Terms of Service and Privacy Policy
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}