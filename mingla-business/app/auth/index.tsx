import { useEffect } from "react";
import { useRouter } from "expo-router";
import BusinessWelcomeScreen from "../../src/components/auth/BusinessWelcomeScreen";
import AppRoutes from "../../src/config/routes";
import { useAuth } from "../../src/context/AuthContext";

export default function AuthIndex() {
  const router = useRouter();
  const { user, loading, signInWithGoogle, signInWithApple } = useAuth();

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
    />
  );
}
