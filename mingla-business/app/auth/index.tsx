// orch-strict-grep-allow safearea-on-fullscreen-routes — BusinessWelcomeScreen renders its own SafeAreaView internally (BusinessWelcomeScreen.tsx:463 with edges={["top", "left", "right"]}); wrapping at the route level would double-pad
import { useEffect } from "react";
import { useRouter } from "expo-router";
import BusinessWelcomeScreen from "../../src/components/auth/BusinessWelcomeScreen";
import AppRoutes from "../../src/config/routes";
import { useAuth } from "../../src/context/AuthContext";

export default function AuthIndex() {
  const router = useRouter();
  const {
    user,
    loading,
    signInWithGoogle,
    signInWithApple,
    signInWithEmail,
    verifyEmailOtp,
  } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      router.replace(AppRoutes.home);
    }
  }, [loading, user, router]);

  return (
    <BusinessWelcomeScreen
      onBack={() => router.back()}
      onGoogleSignIn={async () => {
        await signInWithGoogle();
      }}
      onAppleSignIn={async () => {
        await signInWithApple();
      }}
      onEmailSignIn={signInWithEmail}
      onVerifyEmailOtp={verifyEmailOtp}
    />
  );
}
