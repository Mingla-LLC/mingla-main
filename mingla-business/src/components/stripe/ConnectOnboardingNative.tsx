/**
 * #4389 (decision S-11) — web / tsc stub of the native secure setup screen.
 *
 * Metro substitutes `ConnectOnboardingNative.native.tsx` on iOS and Android.
 * On web (Host web keeps the web component on /connect-onboarding) the native
 * module is never available, so the caller always uses its web path, and this
 * stub renders nothing. It never imports the native SDK, so the web bundle
 * stays free of it (ORCH-0778).
 */
import type React from "react";

export interface ConnectOnboardingNativeProps {
  brandId: string;
  clientSecret: string;
  onExit: () => void;
  onLoadError: (event: unknown) => void;
  onStepChange?: (step: string) => void;
}

export const isNativeConnectModuleAvailable = (): boolean => false;

export const ConnectOnboardingNative: React.FC<ConnectOnboardingNativeProps> = () => null;

export default ConnectOnboardingNative;
