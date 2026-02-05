/**
 * Auth Screen - Authentication flow
 * Sign in and sign up for all user roles
 */

import React from 'react';
import SignInPage from '../components/SignInPage';

interface AuthScreenProps {
  onSignInRegular: (credentials: { email: string; password: string }) => void;
  onSignUpRegular: (userData: { email: string; password: string; name: string }) => void;
  onSignInCurator: (credentials: { email: string; password: string }) => void;
  onSignUpCurator: (userData: { email: string; password: string; name: string; organization?: string }) => void;
}

export default function AuthScreen(props: AuthScreenProps) {
  return <SignInPage {...props} />;
}
