/**
 * #4389 (decision S-11, "Go native anyway") — the payment partner's secure
 * setup as a NATIVE full-screen component on iPhone and Android.
 *
 * Metro picks this file on iOS/Android only; the sibling
 * `ConnectOnboardingNative.tsx` is the web/tsc stub (never native). The SDK is
 * required lazily, AFTER `isNativeConnectModuleAvailable()` has confirmed the
 * native module is linked: `@stripe/stripe-react-native` calls
 * `TurboModuleRegistry.getEnforcing` at import time and would throw otherwise.
 *
 * Same contract as the web page (`ConnectOnboardingBody.web.tsx`): the same
 * terms and privacy URLs, the same collection options, onExit, onStepChange and
 * onLoadError. The first client secret is the one `brand-stripe-onboard` just
 * minted (the same call the web page's `?session=` comes from); a later refetch
 * by the SDK asks `brand-stripe-account-session` (surface "onboarding") for a
 * fresh one.
 *
 * Copy here never names the payment partner and never says "business".
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { TurboModuleRegistry } from "react-native";

import { accent, radius, semantic } from "../../constants/designSystem";
import { fetchBrandStripeAccountSession } from "../../services/brandStripeAccountSessionService";
import {
  CONNECT_ONBOARDING_COLLECTION_OPTIONS,
  CONNECT_ONBOARDING_PRIVACY_URL,
  CONNECT_ONBOARDING_TERMS_URL,
} from "./nativeConnectOnboarding";

/**
 * The iOS native modal dismisses only on a visible true -> false change, never
 * on unmount (an unmounted-while-presented modal stays on screen: seen on the
 * iOS 26.5 simulator, #4389). On a load error the modal is hidden first through
 * the `dismissed` prop (patches/@stripe+stripe-react-native+0.65.1.patch), and
 * the browser-sheet fallback runs after the dismiss animation.
 */
export const NATIVE_CONNECT_DISMISS_SETTLE_MS = 700;
/**
 * A screen that neither starts its loader nor reports an error within this
 * time is treated as a load error (falls back to the browser sheet), so a hung
 * native screen can never strand the host on a spinner.
 */
export const NATIVE_CONNECT_LOAD_TIMEOUT_MS = 25000;

export interface ConnectOnboardingNativeProps {
  brandId: string;
  /** Minted by brand-stripe-onboard for this attempt. */
  clientSecret: string;
  onExit: () => void;
  onLoadError: (event: unknown) => void;
  onStepChange?: (step: string) => void;
}

type StripeConnectModule = typeof import("@stripe/stripe-react-native");

/** True when this binary links the native SDK module the screen needs. */
export const isNativeConnectModuleAvailable = (): boolean => {
  try {
    if (TurboModuleRegistry.get("StripeSdk") === null) return false;
  } catch {
    return false;
  }
  return true;
};

let cachedModule: StripeConnectModule | null = null;
const loadStripeConnectModule = (): StripeConnectModule | null => {
  if (cachedModule !== null) return cachedModule;
  if (!isNativeConnectModuleAvailable()) return null;
  try {
    // Lazy on purpose (see header): evaluated only once the module is linked.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require("@stripe/stripe-react-native") as StripeConnectModule;
    return cachedModule;
  } catch (error) {
    console.warn("[ConnectOnboardingNative] native module failed to load", error);
    return null;
  }
};

const readPublishableKey = (): string | null => {
  // expo-constants is read lazily: a module-scope expo import breaks every
  // render suite that reaches this file through BrandOnboardView.
  let extra: Record<string, unknown> | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    extra = (require("expo-constants") as { default?: { expoConfig?: { extra?: Record<string, unknown> } } })
      .default?.expoConfig?.extra;
  } catch (error) {
    console.warn("[ConnectOnboardingNative] could not read app config for the publishable key", error);
  }
  const fromExtra = extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (typeof fromExtra === "string" && fromExtra.length > 0) return fromExtra;
  const fromEnv = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  return typeof fromEnv === "string" && fromEnv.length > 0 ? fromEnv : null;
};

/** Mingla tokens the SDK's appearance variables accept. */
const APPEARANCE = {
  variables: {
    colorPrimary: accent.warm,
    colorDanger: semantic.error,
    borderRadius: `${radius.md}px`,
  },
} as const;

export const ConnectOnboardingNative: React.FC<ConnectOnboardingNativeProps> = ({
  brandId,
  clientSecret,
  onExit,
  onLoadError,
  onStepChange,
}) => {
  const sdk = loadStripeConnectModule();
  const publishableKey = readPublishableKey();
  // The first fetch returns the secret already minted; later ones mint fresh.
  const firstSecretUsedRef = useRef(false);
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;
  const [dismissed, setDismissed] = useState(false);
  const pendingErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => (): void => {
      if (pendingErrorTimer.current !== null) clearTimeout(pendingErrorTimer.current);
    },
    [],
  );
  const loadedRef = useRef(false);
  const handleLoadError = (event: unknown): void => {
    if (pendingErrorTimer.current !== null) return;
    setDismissed(true);
    pendingErrorTimer.current = setTimeout(() => {
      pendingErrorTimer.current = null;
      onLoadErrorRef.current(event);
    }, NATIVE_CONNECT_DISMISS_SETTLE_MS);
  };

  const connectInstance = useMemo(() => {
    if (sdk === null || publishableKey === null) return null;
    return sdk.loadConnectAndInitialize({
      publishableKey,
      fetchClientSecret: async (): Promise<string> => {
        if (!firstSecretUsedRef.current) {
          firstSecretUsedRef.current = true;
          return clientSecret;
        }
        const fresh = await fetchBrandStripeAccountSession(brandId, "onboarding");
        return fresh.clientSecret;
      },
      appearance: APPEARANCE,
    });
  }, [sdk, publishableKey, brandId, clientSecret]);

  const unavailable = sdk === null || connectInstance === null;
  useEffect(() => {
    if (!unavailable) return;
    // Not silent: the caller falls back to the browser sheet.
    onLoadErrorRef.current({
      error: {
        type: "native_unavailable",
        message: publishableKey === null ? "publishable_key_missing" : "native_module_missing",
      },
    });
  }, [unavailable, publishableKey]);

  const handleLoadErrorRef = useRef(handleLoadError);
  handleLoadErrorRef.current = handleLoadError;
  useEffect(() => {
    if (unavailable) return;
    const timer = setTimeout(() => {
      if (loadedRef.current) return;
      handleLoadErrorRef.current({
        error: { type: "load_timeout", message: "native_load_timeout" },
      });
    }, NATIVE_CONNECT_LOAD_TIMEOUT_MS);
    return (): void => clearTimeout(timer);
  }, [unavailable]);

  if (sdk === null || connectInstance === null) return null;
  const { ConnectComponentsProvider, ConnectAccountOnboarding } = sdk;

  return (
    <ConnectComponentsProvider connectInstance={connectInstance}>
      <ConnectAccountOnboarding
        title="Secure setup"
        onExit={onExit}
        onStepChange={(change): void => onStepChange?.(change.step)}
        onLoadError={handleLoadError}
        onLoaderStart={(): void => {
          loadedRef.current = true;
        }}
        dismissed={dismissed}
        fullTermsOfServiceUrl={CONNECT_ONBOARDING_TERMS_URL}
        recipientTermsOfServiceUrl={CONNECT_ONBOARDING_TERMS_URL}
        privacyPolicyUrl={CONNECT_ONBOARDING_PRIVACY_URL}
        collectionOptions={CONNECT_ONBOARDING_COLLECTION_OPTIONS}
      />
    </ConnectComponentsProvider>
  );
};

export default ConnectOnboardingNative;
