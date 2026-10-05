/**
 * useOrganiserTermsPublishGate — #3645 PR11c paid-publish Organiser Terms door.
 *
 * Free listings skip the gate. Paid listings require CURRENT_MINGLA_TOS_VERSION
 * acceptance before the confirm/publish flow continues. When acceptance is
 * missing, the gate sheet opens and the caller should toast
 * ORGANISER_TERMS_PUBLISH_RETRY_TOAST so the host taps Publish again after
 * accepting (avoids auto-reentrancy across confirm dialogs / intel gates).
 */

import React, { useCallback, useState } from "react";

import { MinglaToSAcceptanceGate } from "../components/onboarding/MinglaToSAcceptanceGate";
import { useAuth } from "../context/AuthContext";
import {
  isCurrentMinglaToSAccepted,
  useMinglaToSAcceptance,
} from "./useMinglaToSAcceptance";

/** Locked toast after the gate opens — host must re-tap Publish. */
export const ORGANISER_TERMS_PUBLISH_RETRY_TOAST =
  "Accept the Organiser Terms, then tap Publish again." as const;

export interface OrganiserTermsPublishGate {
  /**
   * Returns true when publish must stop (gate opened / ToS still loading for a
   * paid listing). Caller should toast ORGANISER_TERMS_PUBLISH_RETRY_TOAST when
   * this is true and the listing is paid.
   */
  blockPaidPublishUntilAccepted: (isPaid: boolean) => boolean;
  /** Mount at wizard root (I-13 overlay contract). Null when closed. */
  gateElement: React.ReactElement | null;
}

export function useOrganiserTermsPublishGate(
  brandId: string | null | undefined,
): OrganiserTermsPublishGate {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const resolvedBrandId =
    typeof brandId === "string" && brandId.trim().length > 0 ? brandId : null;
  const acceptanceQuery = useMinglaToSAcceptance(resolvedBrandId, userId);
  const [gateOpen, setGateOpen] = useState(false);

  const accepted = isCurrentMinglaToSAccepted(acceptanceQuery.data);

  const blockPaidPublishUntilAccepted = useCallback(
    (isPaid: boolean): boolean => {
      if (!isPaid) return false;
      if (accepted) return false;
      // Still loading: open the gate (renders null while loading, then sheet or
      // onPassed). Prefer fail-closed over publishing without a known accept.
      setGateOpen(true);
      return true;
    },
    [accepted],
  );

  const handlePassed = useCallback((): void => {
    setGateOpen(false);
  }, []);

  const gateElement =
    gateOpen && resolvedBrandId !== null && userId !== null
      ? React.createElement(MinglaToSAcceptanceGate, {
          brandId: resolvedBrandId,
          userId,
          onPassed: handlePassed,
          subtitle: "A quick read before you publish a paid listing.",
        })
      : null;

  return { blockPaidPublishUntilAccepted, gateElement };
}
