import React, { useState } from 'react';
import WelcomeScreen from './signIn/WelcomeScreen';
import SignInForm from './signIn/SignInForm';
import SignUpForm from './signIn/SignUpForm';

interface SignInPageProps {
  onSignInRegular: (credentials: { email: string; password: string }) => void;
  onSignUpRegular: (userData: { email: string; password: string; name: string }) => void;
  onSignInCurator: (credentials: { email: string; password: string }) => void;
  onSignUpCurator: (userData: { email: string; password: string; name: string; organization?: string }) => void;
}

type AuthMode = 'welcome' | 'sign-in' | 'sign-up';

export default function SignInPage({ onSignInRegular, onSignUpRegular }: SignInPageProps) {
  const [authMode, setAuthMode] = useState<AuthMode>('welcome');

  const handleBackToWelcome = () => {
    setAuthMode('welcome');
  };

  const handleNavigateToSignIn = () => {
    setAuthMode('sign-in');
  };

  const handleNavigateToSignUp = () => {
    setAuthMode('sign-up');
  };

  const handleSignIn = (credentials: { email: string; password: string }) => {
    onSignInRegular(credentials);
  };

  const handleSignUp = (userData: { email: string; password: string; name: string }) => {
    onSignUpRegular(userData);
  };

  // Render different components based on current mode
  switch (authMode) {
    case 'welcome':
      return (
        <WelcomeScreen 
          onSignUp={handleSignUp}
          onNavigateToSignIn={handleNavigateToSignIn}
        />
      );
    
    case 'sign-in':
      return (
        <SignInForm 
          onSignIn={handleSignIn}
          onSwitchToSignUp={handleNavigateToSignUp}
          onBack={handleBackToWelcome}
        />
      );
    
    case 'sign-up':
      return (
        <SignUpForm 
          onSignUp={handleSignUp}
          onSwitchToSignIn={handleNavigateToSignIn}
          onBack={handleBackToWelcome}
        />
      );
    
    default:
      return (
        <WelcomeScreen 
          onSignUp={handleSignUp}
          onNavigateToSignIn={handleNavigateToSignIn}
        />
      );
  }
}