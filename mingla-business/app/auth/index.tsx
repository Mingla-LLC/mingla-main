// orch-strict-grep-allow safearea-on-fullscreen-routes — BusinessWelcomeScreen renders its own SafeAreaView internally (BusinessWelcomeScreen.tsx:463 with edges={["top", "left", "right"]}); wrapping at the route level would double-pad
import { useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import BusinessWelcomeScreen from "../../src/components/auth/BusinessWelcomeScreen";
import AppRoutes from "../../src/config/routes";
import { useAuth } from "../../src/context/AuthContext";
import {
  captureNextRoute,
  consumeNextRoute,
} from "../../src/utils/authNextHandoff";
import { sanitizeNextRoute } from "../../src/utils/nextRoute";

// ORCH-1098 Stage 3: the mobile→static-home redirect is GONE. Phones boot the
// real Expo app, so a signed-in user is routed straight to the real home.
//
// ORCH-1375 [`?next=` resume path] — THE RESUME CAPTURE + THE EMAIL-OTP RESUME.
//
// BEFORE: `next` had FOUR writers and ZERO readers. This route ignored query
// params entirely and hard-redirected every signed-in user to home — so an
// invitee who signed in here had their invite token SILENTLY DISCARDED and
// landed on the home page as if nothing had happened. The `/rsvp/create` and
// `/event/create` resume flows were broken the same way.
//
// ⚠️ WHY CAPTURE HERE AND NOT JUST READ THE URL ON THE WAY BACK: on the OAuth
// path the browser LEAVES THIS PAGE ENTIRELY (→ Google → Supabase →
// /auth/callback#access_token=…). `buildWebRedirectTo()` returns a bare
// `${origin}/auth/callback` with NO query params, so `next` — which lives only
// in THIS page's URL — is destroyed at the signInWithOAuth call, before
// /auth/callback ever exists. Capturing to sessionStorage on mount is what
// survives that round-trip. See src/utils/authNextHandoff.ts.
export default function AuthIndex() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string | string[] }>();
  const {
    user,
    loading,
    signInWithGoogle,
    signInWithApple,
    signInWithEmail,
    verifyEmailOtp,
  } = useAuth();

  // STEP 1 — CAPTURE. On mount, validate `next` from the URL and stash it for
  // the round-trip. An invalid value is discarded SILENTLY and we proceed as if
  // it were absent (never redirect to it, never throw).
  useEffect(() => {
    captureNextRoute(sanitizeNextRoute(params.next));
    // Intentionally mount-only: the URL's `next` cannot change without a
    // remount, and re-running on every param identity change would re-capture a
    // value we may have just consumed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // STEP 2 — RESUME (email-OTP path). `signInWithOtp` + `verifyEmailOtp` do NOT
  // navigate the page, so `next` is still in this URL when `user` flips. Prefer
  // the live URL, fall back to the captured value, and RE-VALIDATE either way —
  // sessionStorage is same-origin-writable, so a stored value is untrusted input
  // exactly like the URL's.
  useEffect(() => {
    if (loading || !user) return;
    const fromUrl = sanitizeNextRoute(params.next);
    // Consume-once ALWAYS (even when the URL wins), so a stale `next` can never
    // resume a later, unrelated sign-in.
    const stored = consumeNextRoute();
    // ⚠️ RE-VALIDATE the stored value: sessionStorage is same-origin WRITABLE,
    // so it is untrusted input exactly like the URL. `consumeNextRoute` returns
    // RAW by design — never hand its result to the router unsanitized.
    const next = fromUrl ?? sanitizeNextRoute(stored);
    router.replace((next ?? AppRoutes.home) as never);
  }, [loading, user, params.next, router]);

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
