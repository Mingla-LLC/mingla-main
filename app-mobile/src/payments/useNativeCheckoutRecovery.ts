import { useEffect, useRef } from "react";

import {
  recoverNativeCheckout,
  type NativeCheckoutOutcome,
} from "./nativeCheckoutRecovery";

export const useNativeCheckoutRecovery = (input: {
  accountId: string | null;
  eventId: string | null;
  recheckWhen: boolean;
  onRecovered: (outcome: NativeCheckoutOutcome) => void;
}): void => {
  const onRecoveredRef = useRef(input.onRecovered);
  const identityRef = useRef<string | null>(null);
  const wasRecheckActiveRef = useRef(false);

  useEffect(() => {
    onRecoveredRef.current = input.onRecovered;
  }, [input.onRecovered]);

  useEffect(() => {
    const identity = input.accountId && input.eventId
      ? `${input.accountId}:${input.eventId}`
      : null;
    const identityChanged = identity !== null && identityRef.current !== identity;
    const reopened = input.recheckWhen && !wasRecheckActiveRef.current;
    identityRef.current = identity;
    wasRecheckActiveRef.current = input.recheckWhen;
    if (identity === null || (!identityChanged && !reopened)) return;

    let active = true;
    void recoverNativeCheckout({
      accountId: input.accountId as string,
      eventId: input.eventId as string,
    }).then((outcome) => {
      if (active && outcome !== null) onRecoveredRef.current(outcome);
    });
    return () => {
      active = false;
    };
  }, [input.accountId, input.eventId, input.recheckWhen]);
};
