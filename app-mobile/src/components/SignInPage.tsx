import React, { useState } from "react";
import WelcomeScreen from "./signIn/WelcomeScreen";
import SignInForm from "./signIn/SignInForm";
import SignUpForm from "./signIn/SignUpForm";
import SignUpAsStep from "./signIn/SignUpAsStep";
import AccountSetupStep from "./onboarding/AccountSetupStep";
import { useAuthSimple } from "../hooks/useAuthSimple";
import { SafeAreaView } from "react-native-safe-area-context";

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

type AuthMode =
  | "welcome"
  | "sign-in"
  | "sign-up"
  | "sign-up-as"
  | "account-setup";

export default function SignInPage({
  onSignInRegular,
  onSignUpRegular,
  onStartOnboarding,
  initialMode = "welcome",
  onResetSignUpForm,
}: SignInPageProps) {
  const [authMode, setAuthMode] = useState<AuthMode>(initialMode);
  const [selectedAccountType, setSelectedAccountType] = useState<string | null>(
    null
  );
  const { signInWithGoogle, signInWithApple } = useAuthSimple();

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

  const handleNavigateToAccountSetup = () => {
    setAuthMode("account-setup");
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

  const handleGoogleSignIn = async () => {
    try {
      const result = await signInWithGoogle();
      if (result.error) {
        // Error is already handled by signInWithGoogle (shows Alert)
        /*    console.error('Google sign-in error:', result.error); */
      }
      // If successful, app/index.tsx will handle navigation based on onboarding status
    } catch (error) {
      console.error("Unexpected error during Google sign-in:", error);
    }
  };

  const handleAppleSignIn = async () => {
    try {
      const result = await signInWithApple();
      if (result.error) {
        // Error is already handled by signInWithApple (shows Alert)
        console.error("Apple sign-in error:", result.error);
      }
      // If successful, app/index.tsx will handle navigation based on onboarding status
    } catch (error) {
      console.error("Unexpected error during Apple sign-in:", error);
    }
  };

  // Render different components based on current mode
  switch (authMode) {
    case "welcome":
      return (
        <WelcomeScreen
          onSignUp={handleNavigateToSignUp}
          onNavigateToSignIn={handleNavigateToSignIn}
          onStartOnboarding={onStartOnboarding}
          onGoogleSignIn={handleGoogleSignIn}
          onAppleSignIn={handleAppleSignIn}
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
          onSwitchToSignUp={handleNavigateToAccountSetup}
          onBack={handleBackToWelcome}
        />
      );

    case "sign-up":
      return (
        <SignUpForm
          onSignUp={handleSignUp}
          onSwitchToSignIn={handleBackToWelcome}
          onBack={handleBackToWelcome}
        />
      );

    case "account-setup":
      return (
        <SafeAreaView
          edges={["top"]}
          style={{ flex: 1, backgroundColor: "white" }}
        >
          <AccountSetupStep
            onNext={handleNavigateToSignUp}
            onBack={handleBackToWelcome}
            onNavigateToSignUp={(accountType) => {
              setSelectedAccountType(accountType || null);
              setAuthMode("sign-up");
            }}
            onNavigateToGoogleSignIn={handleGoogleSignIn}
            onNavigateToAppleSignIn={handleAppleSignIn}
            accountType={selectedAccountType}
          />
        </SafeAreaView>
      );

    default:
      return (
        <WelcomeScreen
          onSignUp={handleNavigateToSignUp}
          onNavigateToSignIn={handleNavigateToSignIn}
          onStartOnboarding={onStartOnboarding}
          onGoogleSignIn={handleGoogleSignIn}
          onAppleSignIn={handleAppleSignIn}
        />
      );
  }
}
