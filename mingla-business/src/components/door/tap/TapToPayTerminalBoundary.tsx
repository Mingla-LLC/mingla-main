/**
 * #4271 — mounts Stripe Terminal ONLY around the door Tap to Pay routes
 * (app/event/[id]/door/tap/_layout.tsx), never app-wide.
 *
 * - The SDK is loaded lazily (terminalSdk.ts). On web, or on a binary without
 *   the native module, children render with `status: "unavailable"` and the
 *   screens show "This phone can't take taps" instead of crashing.
 * - tokenProvider calls the terminal-connection-token edge function for this
 *   event; the server scopes the token to the brand's connected Stripe account
 *   and checks the door-payment permission.
 * - Switching to another brand's event clears the SDK's cached credentials so a
 *   token for one connected account is never reused for another.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import type { Reader } from "@stripe/stripe-terminal-react-native";

import { loadTerminalSdk, type TerminalSdk } from "../../../services/terminal/terminalSdk";
import { fetchTerminalConnectionToken } from "../../../services/terminal/doorTapEdge";
import { isTerminalSimulated } from "../../../services/terminal/terminalConfig";
import type {
  TapToPayTerminalClient,
  TerminalErrorLike,
  TerminalPaymentIntentLike,
} from "../../../services/terminal/tapToPayFlow";

export type TapToPayTerminalStatus = "unavailable" | "initializing" | "ready" | "error";

export interface TapToPaySessionClient extends TapToPayTerminalClient {
  /** Stripe's own check: can this phone run a Tap to Pay reader? */
  checkDeviceSupport(): Promise<{ supported: boolean; error?: TerminalErrorLike }>;
}

export interface TapToPayTerminalContextValue {
  status: TapToPayTerminalStatus;
  client: TapToPaySessionClient | null;
  /** Plain-English reason when status is "error". */
  errorMessage: string | null;
  retryInitialize: () => void;
}

const UNAVAILABLE: TapToPayTerminalContextValue = {
  status: "unavailable",
  client: null,
  errorMessage: null,
  retryInitialize: () => {},
};

const TapToPayTerminalContext = createContext<TapToPayTerminalContextValue>(UNAVAILABLE);

export const useTapToPayTerminal = (): TapToPayTerminalContextValue =>
  useContext(TapToPayTerminalContext);

/** Last connected account scope, per JS runtime (the native SDK is a singleton). */
let lastInitializedBrandId: string | null = null;

const asTerminalError = (error: unknown): TerminalErrorLike => {
  if (typeof error === "object" && error !== null) return error as TerminalErrorLike;
  return { message: String(error) };
};

interface BridgeProps {
  sdk: TerminalSdk;
  brandId: string;
  merchantDisplayName: string;
  children: React.ReactNode;
}

const TerminalBridge = ({ sdk, brandId, merchantDisplayName, children }: BridgeProps): React.ReactElement => {
  const terminal = sdk.useStripeTerminal();
  const [status, setStatus] = useState<TapToPayTerminalStatus>("initializing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<number>(0);
  const connectedLocationRef = useRef<string | null>(null);
  const terminalRef = useRef(terminal);
  terminalRef.current = terminal;

  useEffect(() => {
    let alive = true;
    const run = async (): Promise<void> => {
      setStatus("initializing");
      setErrorMessage(null);
      if (Platform.OS === "android") {
        const permission = (await sdk.requestNeededAndroidPermissions({
          accessFineLocation: {
            title: "Location for card payments",
            message: "Card payments need to know where they are taken. Mingla Host only uses your location for payments at the door.",
            buttonPositive: "Allow",
          },
        })) as unknown as { error?: unknown };
        if (permission?.error !== undefined) {
          if (alive) {
            setStatus("error");
            setErrorMessage("Allow location for Mingla Host in Settings to take card payments.");
          }
          return;
        }
      }
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
    async (locationId: string): Promise<{ error?: TerminalErrorLike }> => {
      const current = terminalRef.current;
      try {
        const connected: Reader.Type | null | undefined = await current.getConnectedReader();
        if (connected && connectedLocationRef.current === locationId) return {};
        if (connected) await current.disconnectReader();
        const result = await current.easyConnect({
          discoveryMethod: "tapToPay",
          simulated: isTerminalSimulated(),
          locationId,
          merchantDisplayName,
          autoReconnectOnUnexpectedDisconnect: true,
          tosAcceptancePermitted: true,
        });
        if (result.error) return { error: result.error };
        connectedLocationRef.current = locationId;
        return {};
      } catch (error) {
        return { error: asTerminalError(error) };
      }
    },
    [merchantDisplayName],
  );

  const client = useMemo<TapToPaySessionClient>(
    () => ({
      ensureReaderConnected,
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
    [ensureReaderConnected],
  );

  const retryInitialize = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo<TapToPayTerminalContextValue>(
    () => ({
      status,
      client: status === "ready" ? client : null,
      errorMessage,
      retryInitialize,
    }),
    [status, client, errorMessage, retryInitialize],
  );

  return <TapToPayTerminalContext.Provider value={value}>{children}</TapToPayTerminalContext.Provider>;
};

export interface TapToPayTerminalBoundaryProps {
  eventId: string | null;
  brandId: string | null;
  merchantDisplayName: string;
  children: React.ReactNode;
}

export const TapToPayTerminalBoundary = ({
  eventId,
  brandId,
  merchantDisplayName,
  children,
}: TapToPayTerminalBoundaryProps): React.ReactElement => {
  const sdk = useMemo(() => loadTerminalSdk(), []);
  const eventIdRef = useRef(eventId);
  eventIdRef.current = eventId;

  const tokenProvider = useCallback(async (): Promise<string> => {
    const currentEventId = eventIdRef.current;
    if (currentEventId === null) throw new Error("No event for Tap to Pay");
    return fetchTerminalConnectionToken(currentEventId);
  }, []);

  if (sdk === null || eventId === null || brandId === null) {
    return <TapToPayTerminalContext.Provider value={UNAVAILABLE}>{children}</TapToPayTerminalContext.Provider>;
  }
  const { StripeTerminalProvider } = sdk;
  return (
    <StripeTerminalProvider
      tokenProvider={tokenProvider}
      localeConfig={{ type: "hardcoded", locale: "en-GB" }}
    >
      <TerminalBridge sdk={sdk} brandId={brandId} merchantDisplayName={merchantDisplayName}>
        {children}
      </TerminalBridge>
    </StripeTerminalProvider>
  );
};
