/**
 * #4271 — Stripe Terminal for the life of the app, mounted as a SIBLING of the
 * root <Stack> (app/_layout.tsx). It must never wrap the Stack: flipping the
 * release state would remount the navigator and lose the host's place.
 *
 * It renders nothing visible, and nothing at all unless this is a native build,
 * the release gate says live, the phone is supported and the SDK loaded. So
 * store builds never start Stripe Terminal.
 *
 * - The SDK is loaded lazily (terminalSdk.ts).
 * - tokenProvider calls terminal-connection-token for the current scope; the
 *   server scopes the token to the brand's connected Stripe account and checks
 *   the door-payment permission.
 * - Switching brand clears the SDK's cached credentials so a token for one
 *   connected account is never reused for another.
 * - A crash in here never takes the app down: it is reported and Tap to Pay
 *   reads as unavailable.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import type { Reader } from "@stripe/stripe-terminal-react-native";

import { reportNonFatal } from "../../../diagnostics/reportNonFatal";
import { useBrand } from "../../../hooks/useBrands";
import { currentTapToPayDevice, isTapToPayDeviceSupported } from "../../../services/terminal/tapToPayDevice";
import { useTapToPayRelease } from "../../../hooks/useTapToPayRelease";
import { fetchDoorTapLocation, fetchTerminalConnectionToken } from "../../../services/terminal/doorTapEdge";
import { hasTapToPayLocation, requestTapToPayLocation } from "../../../services/terminal/tapToPayAndroidLocation";
import { readTapToPayWarmHint } from "../../../services/terminal/tapToPaySetupStore";
import { TapToPayWarmUp } from "../../../services/terminal/tapToPayWarmUp";
import type {
  TerminalErrorLike,
  TerminalPaymentIntentLike,
} from "../../../services/terminal/tapToPayFlow";
import {
  getTapToPaySession,
  noteTapToPayConnectResult,
  parseTapProgress,
  updateTapToPaySession,
  useTapToPayTerminal,
  type TapToPaySessionClient,
  type TapToPayTerminalStatus,
} from "../../../services/terminal/tapToPaySession";
import { loadTerminalSdk, type TerminalSdk } from "../../../services/terminal/terminalSdk";
import { tapToPayConnectParams } from "../../../services/terminal/tapToPayConnectParams";
import { isTerminalSimulated } from "../../../services/terminal/terminalConfig";
import { useCurrentBrandId } from "../../../store/currentBrandStore";

/** Last connected account scope, per JS runtime (the native SDK is a singleton). */
let lastInitializedBrandId: string | null = null;

const asTerminalError = (error: unknown): TerminalErrorLike => {
  if (typeof error === "object" && error !== null) return error as TerminalErrorLike;
  return { message: String(error) };
};

export { tapToPayConnectParams };

interface BridgeProps {
  sdk: TerminalSdk;
  brandId: string;
  merchantDisplayName: string;
}

const TerminalBridge = ({ sdk, brandId, merchantDisplayName }: BridgeProps): null => {
  const terminal = sdk.useStripeTerminal({
    onDidStartInstallingUpdate: () =>
      updateTapToPaySession({ config: { installing: true, progress: null } }),
    onDidReportReaderSoftwareUpdateProgress: (progress: string) =>
      updateTapToPaySession({ config: { installing: true, progress: parseTapProgress(progress) } }),
    onDidFinishInstallingUpdate: () =>
      updateTapToPaySession({ config: { installing: false, progress: null } }),
    onDidAcceptTermsOfService: () => noteTapToPayConnectResult(brandId, undefined),
  });
  const [status, setStatus] = useState<TapToPayTerminalStatus>("initializing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<number>(0);
  const connectedLocationRef = useRef<string | null>(null);
  const connectQueueRef = useRef<Promise<void>>(Promise.resolve());
  const terminalRef = useRef(terminal);
  terminalRef.current = terminal;

  useEffect(() => {
    let alive = true;
    const run = async (): Promise<void> => {
      setStatus("initializing");
      setErrorMessage(null);
      const init = await terminalRef.current.initialize();
      if (!alive) return;
      if (init.error) {
        setStatus("error");
        setErrorMessage("Couldn't start Tap to Pay. Check your connection and try again.");
        return;
      }
      if (lastInitializedBrandId !== null && lastInitializedBrandId !== brandId) {
        // A token from another brand's connected account must not be reused.
        // Best effort: a reader may not be connected yet; the credential clear
        // below is what guarantees the old account's token is gone.
        await terminalRef.current.disconnectReader().catch((error: unknown) => {
          if (__DEV__) console.warn("[#4271] disconnect before account switch failed", error);
        });
        await terminalRef.current.clearCachedCredentials();
        connectedLocationRef.current = null;
        updateTapToPaySession({ readerReady: false });
      }
      lastInitializedBrandId = brandId;
      if (alive) setStatus("ready");
    };
    void run().catch((error: unknown) => {
      if (__DEV__) console.warn("[#4271] Terminal initialize failed", error);
      if (alive) {
        setStatus("error");
        setErrorMessage("Couldn't start Tap to Pay. Try again.");
      }
    });
    return () => {
      alive = false;
    };
  }, [sdk, brandId, attempt]);

  const ensureReaderConnected = useCallback(
    async (
      locationId: string,
      options?: { mayAcceptTerms?: boolean; warm?: boolean },
    ): Promise<{ error?: TerminalErrorLike }> => {
      // One connect at a time: a sale that starts during a warm-up waits for it,
      // then finds the reader already connected.
      await connectQueueRef.current;
      const current = terminalRef.current;
      try {
        // Android asks here, when someone is connecting, never at app launch.
        // A warm-up never prompts: without the permission it just doesn't run.
        // The SDK needs coarse location on every API level (see
        // tapToPayAndroidLocation.ts): fine location is capped at API 30.
        if (Platform.OS === "android" && options?.warm === true) {
          if (!(await hasTapToPayLocation())) return { error: { message: "location_not_granted" } };
        } else if (Platform.OS === "android") {
          if (!(await requestTapToPayLocation())) {
            return { error: { message: "Allow location for Mingla Host in Settings to take card payments." } };
          }
        }
        const connected: Reader.Type | null | undefined = await current.getConnectedReader();
        if (connected && connectedLocationRef.current === locationId) {
          noteTapToPayConnectResult(brandId, undefined);
          return {};
        }
        if (connected) await current.disconnectReader();
        const result = await current.easyConnect(
          tapToPayConnectParams(locationId, merchantDisplayName, options?.mayAcceptTerms === true),
        );
        noteTapToPayConnectResult(brandId, result.error);
        if (result.error) return { error: result.error };
        connectedLocationRef.current = locationId;
        updateTapToPaySession({ readerReady: true });
        return {};
      } catch (error) {
        const asError = asTerminalError(error);
        noteTapToPayConnectResult(brandId, asError);
        return { error: asError };
      }
    },
    [merchantDisplayName, brandId],
  );

  // Everything goes through the queue so two connects never overlap in the SDK.
  const queuedConnect = useCallback<typeof ensureReaderConnected>(
    (locationId, options) => {
      const run = ensureReaderConnected(locationId, options);
      connectQueueRef.current = run.then(() => undefined);
      return run;
    },
    [ensureReaderConnected],
  );

  const client = useMemo<TapToPaySessionClient>(
    () => ({
      ensureReaderConnected: queuedConnect,
      checkDeviceSupport: async () => {
        try {
          const result = await terminalRef.current.supportsReadersOfType({
            deviceType: "tapToPay",
            discoveryMethod: "tapToPay",
            simulated: isTerminalSimulated(),
          });
          return { supported: result.readerSupportResult === true, error: result.error };
        } catch (error) {
          return { supported: false, error: asTerminalError(error) };
        }
      },
      retrievePaymentIntent: async (clientSecret: string) => {
        try {
          const result = await terminalRef.current.retrievePaymentIntent(clientSecret);
          return { error: result.error, paymentIntent: result.paymentIntent as TerminalPaymentIntentLike | undefined };
        } catch (error) {
          return { error: asTerminalError(error) };
        }
      },
      collectPaymentMethod: async (paymentIntent: TerminalPaymentIntentLike) => {
        try {
          const result = await terminalRef.current.collectPaymentMethod({
            paymentIntent: paymentIntent as never,
          });
          return { error: result.error, paymentIntent: result.paymentIntent as TerminalPaymentIntentLike | undefined };
        } catch (error) {
          return { error: asTerminalError(error) };
        }
      },
      confirmPaymentIntent: async (paymentIntent: TerminalPaymentIntentLike) => {
        try {
          const result = await terminalRef.current.confirmPaymentIntent({
            paymentIntent: paymentIntent as never,
          });
          return { error: result.error, paymentIntent: result.paymentIntent as TerminalPaymentIntentLike | undefined };
        } catch (error) {
          return { error: asTerminalError(error) };
        }
      },
      cancelCollectPaymentMethod: async () => {
        try {
          return await terminalRef.current.cancelCollectPaymentMethod();
        } catch (error) {
          return { error: asTerminalError(error) };
        }
      },
    }),
    [queuedConnect],
  );

  const retryInitialize = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    updateTapToPaySession({
      status,
      client: status === "ready" ? client : null,
      errorMessage,
      retryInitialize,
    });
  }, [status, client, errorMessage, retryInitialize]);

  useEffect(
    () => () => {
      updateTapToPaySession({ status: "unavailable", client: null, errorMessage: null, readerReady: false });
    },
    [],
  );

  // Warm-up: at launch and on each foreground, for a brand set up on this phone.
  // The bridge only exists while the release gate says live. Web never gets here.
  useEffect(() => {
    if (status !== "ready") return undefined;
    const warmUp = new TapToPayWarmUp({
      isLive: () => true,
      readHint: () => readTapToPayWarmHint(brandId),
      fetchLocation: () => {
        const scope = getTapToPaySession().scope;
        return fetchDoorTapLocation({ brandId, eventId: scope?.eventId ?? null });
      },
      connect: (locationId) => queuedConnect(locationId, { mayAcceptTerms: false, warm: true }),
      now: () => Date.now(),
      report: reportNonFatal,
    });
    void warmUp.trigger();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void warmUp.trigger();
    });
    return () => subscription.remove();
  }, [status, brandId, queuedConnect]);

  return null;
};

class TerminalHostBoundary extends React.Component<{ children: React.ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  componentDidCatch(error: unknown): void {
    reportNonFatal("door-tap.host", error);
    updateTapToPaySession({ status: "unavailable", client: null });
  }

  render(): React.ReactNode {
    return this.state.crashed ? null : this.props.children;
  }
}

/** Mounted only while live, so a store build opens no brand query or realtime channel here. */
const LiveTerminal = ({ sdk, brandId }: { sdk: TerminalSdk; brandId: string }): React.ReactElement => {
  const session = useTapToPayTerminal();
  const brandQuery = useBrand(brandId);
  const merchantDisplayName =
    session.scope?.merchantDisplayName ?? brandQuery.data?.displayName ?? "Mingla Host";
  const brandIdRef = useRef(brandId);
  brandIdRef.current = brandId;
  const tokenProvider = useCallback(async (): Promise<string> => {
    const currentScope = getTapToPaySession().scope;
    return fetchTerminalConnectionToken({
      brandId: currentScope?.brandId ?? brandIdRef.current,
      eventId: currentScope?.eventId ?? null,
    });
  }, []);
  const { StripeTerminalProvider } = sdk;
  return (
    <StripeTerminalProvider
      tokenProvider={tokenProvider}
      localeConfig={{ type: "hardcoded", locale: "en-GB" }}
    >
      <TerminalBridge sdk={sdk} brandId={brandId} merchantDisplayName={merchantDisplayName} />
    </StripeTerminalProvider>
  );
};

const TerminalHostInner = (): React.ReactElement | null => {
  const sdk = useMemo(() => loadTerminalSdk(), []);
  const session = useTapToPayTerminal();
  const currentBrandId = useCurrentBrandId();
  const brandId = session.scope?.brandId ?? currentBrandId;
  const { live } = useTapToPayRelease(brandId);
  const hostable =
    sdk !== null && brandId !== null && live && isTapToPayDeviceSupported(currentTapToPayDevice());

  useEffect(() => {
    if (!hostable) updateTapToPaySession({ status: "unavailable", client: null, errorMessage: null });
  }, [hostable]);

  if (!hostable || sdk === null || brandId === null) return null;
  return <LiveTerminal sdk={sdk} brandId={brandId} />;
};

export const TapToPayTerminalHost = (): React.ReactElement => (
  <TerminalHostBoundary>
    <TerminalHostInner />
  </TerminalHostBoundary>
);
