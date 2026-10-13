/**
 * useOrganiserTermsPublishGate — #3645 PR11c paid-publish Organiser Terms door.
 *
 * Free listings skip the gate. Paid listings require CURRENT_MINGLA_TOS_VERSION
 * acceptance before the confirm/publish flow continues. When acceptance is
 * missing, the gate sheet opens.
 *
 * #3645 (2026-10-13) — "Accept and continue" CONTINUES. The caller hands the
 * gate the publish it interrupted (`onAccepted`); once the terms are accepted
 * the gate closes and that publish resumes, so the host lands on the publish
 * confirmation instead of back on the screen with Publish to press again.
 * Before this the gate only closed itself and a toast told the host to tap
 * Publish again.
 *
 * Two details make the resume safe:
 *  - acceptance is read through a ref, so the interrupted handler (a closure
 *    from before the acceptance) is not blocked a second time by its own stale
 *    copy of "not accepted";
 *  - the resume runs from an effect AFTER the gate has unmounted, never from
 *    inside the gate's own callback, and at most once per interruption.
 *
 * MinglaToSAcceptanceGate is required lazily so wizard suites that do not open
 * the gate never load expo-haptics through this module.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../context/AuthContext";
import {
  isCurrentMinglaToSAccepted,
  useMinglaToSAcceptance,
} from "./useMinglaToSAcceptance";

/**
 * Shown when the gate opens for a caller that cannot hand over a publish to
 * resume. Callers that pass `onAccepted` show nothing: the sheet says what is
 * needed and accepting continues on its own.
 */
export const ORGANISER_TERMS_PUBLISH_RETRY_TOAST =
  "Accept the Organiser Terms to publish." as const;

/**
 * How long after the gate closes the interrupted publish resumes. Equal to
 * `DEFER_SETTLE_MS` in utils/deferAfterDismiss.ts (the sheet's 280 ms unmount
 * window plus a 60 ms margin). Written out rather than imported because that
 * module pulls the sheet primitives, and this hook must stay loadable in wizard
 * suites that never open the gate. Pinned equal by this hook's test.
 */
export const ORGANISER_TERMS_RESUME_SETTLE_MS = 340 as const;

export interface OrganiserTermsPublishGate {
  /**
   * Returns true when publish must stop (gate opened / ToS still loading for a
   * paid listing). Pass `onAccepted` — the publish that was interrupted — and
   * it runs once the terms are accepted and the gate has closed.
   */
  blockPaidPublishUntilAccepted: (
    isPaid: boolean,
    onAccepted?: () => void,
  ) => boolean;
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
  // Read through a ref so a handler captured BEFORE acceptance (the publish
  // being resumed) sees the acceptance. `justPassedRef` covers the moment
  // between the gate reporting success and the acceptance query catching up.
  const acceptedRef = useRef<boolean>(accepted);
  acceptedRef.current = accepted;
  const justPassedRef = useRef<boolean>(false);
  const pendingResumeRef = useRef<(() => void) | null>(null);
  const [resumeNonce, setResumeNonce] = useState(0);

  const blockPaidPublishUntilAccepted = useCallback(
    (isPaid: boolean, onAccepted?: () => void): boolean => {
      if (!isPaid) return false;
      if (acceptedRef.current || justPassedRef.current) return false;
      // Still loading: open the gate (renders null while loading, then sheet or
      // onPassed). Prefer fail-closed over publishing without a known accept.
      pendingResumeRef.current = onAccepted ?? null;
      setGateOpen(true);
      return true;
    },
    [],
  );

  const handlePassed = useCallback((): void => {
    justPassedRef.current = true;
    setGateOpen(false);
    if (pendingResumeRef.current !== null) {
      setResumeNonce((n) => n + 1);
    }
  }, []);

  // A different brand has its own acceptance; never carry "just accepted" over.
  useEffect(() => {
    justPassedRef.current = false;
    pendingResumeRef.current = null;
  }, [resolvedBrandId, userId]);

  // Resume the interrupted publish once, after the gate has unmounted AND its
  // native sheet has finished dismissing: iOS presents one modal at a time and
  // silently drops a confirmation raised while the sheet is still leaving
  // (#1360). The gate reports success twice (mutation success, then the query
  // catching up), so the timer lives in a ref and is cleared only on unmount —
  // a second report must not cancel the first one's resume.
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (resumeNonce === 0) return;
    const resume = pendingResumeRef.current;
    pendingResumeRef.current = null;
    if (resume === null) return;
    resumeTimerRef.current = setTimeout(() => {
      resumeTimerRef.current = null;
      resume();
    }, ORGANISER_TERMS_RESUME_SETTLE_MS);
  }, [resumeNonce]);
  useEffect(
    () => (): void => {
      if (resumeTimerRef.current !== null) clearTimeout(resumeTimerRef.current);
    },
    [],
  );

  let gateElement: React.ReactElement | null = null;
  if (gateOpen && resolvedBrandId !== null && userId !== null) {
    // Lazy require keeps expo-haptics out of wizard suites that never open the gate.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MinglaToSAcceptanceGate } = require(
      "../components/onboarding/MinglaToSAcceptanceGate",
    ) as typeof import("../components/onboarding/MinglaToSAcceptanceGate");
    gateElement = React.createElement(MinglaToSAcceptanceGate, {
      brandId: resolvedBrandId,
      userId,
      onPassed: handlePassed,
      subtitle: "A quick read before you publish a paid listing.",
    });
  }

  return { blockPaidPublishUntilAccepted, gateElement };
}
