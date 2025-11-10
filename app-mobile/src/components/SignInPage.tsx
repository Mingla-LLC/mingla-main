import React, { useState } from "react";
import WelcomeScreen from "./signIn/WelcomeScreen";
import SignInForm from "./signIn/SignInForm";
import SignUpForm from "./signIn/SignUpForm";
import SignUpAsStep from "./signIn/SignUpAsStep";

interface SignInPageProps {
  onSignInRegular: (credentials: { email: string; password: string }) => void;
  onSignUpRegular: (userData: {
    email: string;
    password: string;
    name: string;
    username: string;
    account_type?: string;
  }) => void;
  onSignInCurator: (credentials: { email: string; password: string }) => void;
  onSignUpCurator: (userData: {
    email: string;
    password: string;
    name: string;
    username: string;
    organization?: string;
    account_type?: string;
  }) => void;
  onStartOnboarding?: (accountType?: string) => void;
  initialMode?: "welcome" | "sign-in" | "sign-up" | "sign-up-as";
  onResetSignUpForm?: () => void;
}

type AuthMode = "welcome" | "sign-in" | "sign-up" | "sign-up-as";

export default function SignInPage({
  onSignInRegular,
  onSignUpRegular,
  onStartOnboarding,
  initialMode = "welcome",
  onResetSignUpForm,
}: SignInPageProps) {
  const [authMode, setAuthMode] = useState<AuthMode>(initialMode);
  const [selectedAccountType, setSelectedAccountType] = useState<string | null>(null);

  const handleBackToWelcome = () => {
    setAuthMode("welcome");
    setSelectedAccountType(null);
    if (onResetSignUpForm) {
      onResetSignUpForm();
    }
  };

  const handleNavigateToSignIn = () => {
    setAuthMode("sign-in");
  };

  const handleNavigateToSignUp = () => {
    setAuthMode("sign-up");
  };

  const handleNavigateToSignUpAs = () => {
    setAuthMode("sign-up-as");
  };

  const handleSelectAccountType = (accountType: string) => {
    setSelectedAccountType(accountType);
    if (onStartOnboarding) {
      onStartOnboarding(accountType);
    }
  };

  const handleSignIn = (credentials: { email: string; password: string }) => {
    onSignInRegular(credentials);
  };

  const handleSignUp = (userData: {
    email: string;
    password: string;
    name: string;
    username: string;
  }) => {
    onSignUpRegular({
      ...userData,
      account_type: selectedAccountType || undefined,
    });
  };

  // Render different components based on current mode
  switch (authMode) {
    case "welcome":
      return (
        <WelcomeScreen
          onSignUp={handleNavigateToSignUp}
          onNavigateToSignIn={handleNavigateToSignIn}
          onStartOnboarding={handleNavigateToSignUpAs}
        />
      );

    case "sign-up-as":
      return (
        <SignUpAsStep
          onSelectAccountType={handleSelectAccountType}
          onBack={handleBackToWelcome}
        />
      );

    case "sign-in":
      return (
        <SignInForm
          onSignIn={handleSignIn}
          onSwitchToSignUp={handleNavigateToSignUp}
          onBack={handleBackToWelcome}
        />
      );

    case "sign-up":
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
          onSignUp={handleNavigateToSignUp}
          onNavigateToSignIn={handleNavigateToSignIn}
          onStartOnboarding={handleNavigateToSignUpAs}
        />
      );
  }
}
