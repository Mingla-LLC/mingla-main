/**
 * issue #1780 [bundle budget] — the wizard invite surfaces, loaded in their own
 * chunk.
 *
 * All four creation wizards (Event, RSVP, Experience, Trip) show the invite
 * step, its Review summary and its publish confirmation. Each wizard is its own
 * lazy route chunk, and Metro places any module two lazy chunks import
 * statically into `__common`, the boot payload every business-web visitor
 * downloads before anything renders (ORCH-1083 / issue #1509). A static import
 * of `InvitePeopleStep` therefore charged every visitor — a guest opening a
 * checkout link included — for the whole invite cluster: the step itself, its
 * analytics helper, and through them `peopleService` and
 * `marketing/manualGroupService`, which until then were reachable only from the
 * lazy People and Marketing routes. Measured at 51,029 B of `__common` growth
 * against a 12,000 B per-pull-request allowance.
 *
 * So all four wizards import THIS owner, and the cluster loads through a
 * dynamic `import()` the first time a wizard mounts. Routes that never open a
 * creation wizard — every buyer and guest route — never load it at all.
 *
 * A hand loader rather than React.lazy, for the two reasons issue #3284's
 * `LazyRefundPolicyEditor` documents and this surface shares:
 * - once the chunk is in memory the real surface renders on the FIRST frame of
 *   every later mount. React.lazy suspends each new tree for a tick, which
 *   would flash the placeholder every time the host steps back onto the invite
 *   step or the Review step;
 * - a failed load can be retried. React.lazy caches a rejected import forever,
 *   so its "Try again" could never succeed without a reload.
 *
 * WARMING. `InvitePeoplePublishConfirmation` is mounted by every wizard for the
 * whole of its life (a closed dialog renders nothing), so its wrapper starts
 * the load at wizard mount — several steps before the host can reach the invite
 * step. In practice the chunk is in memory long before any placeholder below
 * can be seen; the placeholders exist for a cold, slow or failed load, not for
 * the normal path. This mirrors #1742's "preload one step early" for the
 * pre-publish gate.
 *
 * PLACEHOLDERS. Each one reserves the geometry of the surface it stands in for,
 * so nothing below it moves when the real surface arrives:
 * - the step shows the step's OWN loading treatment, byte-identical to what it
 *   renders while its saved selection loads (same `minHeight: 220` centred box,
 *   same spinner, same "Loading your saved selection…" line), so the two states
 *   are visually one;
 * - the Review summary shows the summary card with its "Invites" heading and
 *   one muted line, the same bordered box with the same two rows;
 * - the publish confirmation shows nothing, which is exactly what a closed
 *   ConfirmDialog renders.
 *
 * A load failure is reported through reportNonFatal and shows the app's
 * standard error fallback ("Something broke. We're on it." with Try again). No
 * new copy anywhere.
 *
 * NOTE ON NATIVE. iOS and Android ship one bundle, so `import()` resolves from
 * memory and nothing is fetched; the only effect is the tick before the first
 * mount resolves, which the warming above spends at wizard mount. Native
 * behaviour is unchanged.
 */

import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { DefaultFallback } from "../ui/ErrorBoundary";
import type {
  InviteNavigationPhase,
  InviteNavigationState,
  InvitePeopleStepProps,
} from "./InvitePeopleStep";

export type { InviteNavigationPhase, InviteNavigationState, InvitePeopleStepProps };

type InviteModule = typeof import("./InvitePeopleStep");

let loadedInvites: InviteModule | undefined;
let pendingInvites: Promise<InviteModule> | undefined;

/**
 * Load the invite chunk once. A failed load is forgotten, so the next call —
 * the Try again button, or the next wizard mount — retries it.
 */
export const loadInvitePeopleStep = (): Promise<InviteModule> => {
  if (loadedInvites !== undefined) return Promise.resolve(loadedInvites);
  pendingInvites ??= import("./InvitePeopleStep").then(
    (module) => (loadedInvites = module),
    (error: unknown) => {
      pendingInvites = undefined;
      throw error;
    },
  );
  return pendingInvites;
};

/**
 * Shared load state. `report` names the surface in the non-fatal report so a
 * failure says which of the three was on screen.
 */
function useInviteModule(report: string): {
  module: InviteModule | undefined;
  failure: unknown;
  retry: () => void;
} {
  const [module, setModule] = useState(loadedInvites);
  const [failure, setFailure] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (module !== undefined) return undefined;
    let live = true;
    loadInvitePeopleStep().then(
      (loaded) => {
        if (live) setModule(loaded);
      },
      (error: unknown) => {
        // Loaded on this failure path only: statically the reporter pulls the
        // native Sentry SDK into all four wizards that show these surfaces.
        void import("../../diagnostics/reportNonFatal").then(
          ({ reportNonFatal }) => reportNonFatal(report, error),
          () => undefined,
        );
        if (live) setFailure(error ?? "load failed");
      },
    );
    return (): void => {
      live = false;
    };
  }, [module, attempt, report]);

  const retry = useCallback((): void => {
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  return { module, failure, retry };
}

/** The invite step. Placeholder = the step's own "loading your selection" state. */
export const InvitePeopleStep: React.FC<InvitePeopleStepProps> = (props) => {
  const { module, failure, retry } = useInviteModule("LazyInvitePeopleStep");
  if (module !== undefined) return <module.InvitePeopleStep {...props} />;
  if (failure !== null) return <DefaultFallback error={failure} resetErrorBoundary={retry} />;
  // The step renders exactly this while its saved selection loads, so the chunk
  // wait and the plan wait are one uninterrupted state to the host.
  return (
    <View style={styles.center} testID="invite-people-step-loading">
      <ActivityIndicator color={accent.warm} />
      <Text style={styles.muted}>Loading your saved selection…</Text>
    </View>
  );
};

type ReviewSummaryProps = React.ComponentProps<InviteModule["InvitePlanReviewSummary"]>;

/** The Review-step summary. Placeholder = the same card, same two rows. */
export const InvitePlanReviewSummary: React.FC<ReviewSummaryProps> = (props) => {
  const { module, failure, retry } = useInviteModule("LazyInvitePlanReviewSummary");
  if (module !== undefined) return <module.InvitePlanReviewSummary {...props} />;
  if (failure !== null) return <DefaultFallback error={failure} resetErrorBoundary={retry} />;
  // Mirrors InvitePlanReviewSummary's card: the section title over one muted
  // line, in the same bordered box, so Review does not move when it arrives.
  return (
    <View style={styles.reviewSummary} testID="invite-plan-review-summary-loading">
      <Text style={styles.sectionTitle}>Invites</Text>
      <Text style={styles.muted}>Checking your invite selection…</Text>
    </View>
  );
};

type PublishConfirmationProps = React.ComponentProps<
  InviteModule["InvitePeoplePublishConfirmation"]
>;

/**
 * The publish confirmation. Every wizard keeps this mounted, so this wrapper is
 * what WARMS the chunk at wizard mount. Its placeholder is nothing, which is
 * what a closed ConfirmDialog renders; a failed load also renders nothing here
 * rather than a fallback card floating over the wizard — Publish stays blocked
 * by the wizard's own pre-check, which reports its own error.
 */
export const InvitePeoplePublishConfirmation: React.FC<PublishConfirmationProps> = (props) => {
  const { module } = useInviteModule("LazyInvitePeoplePublishConfirmation");
  if (module === undefined) return null;
  return <module.InvitePeoplePublishConfirmation {...props} />;
};

const styles = StyleSheet.create({
  // Mirrors InvitePeopleStep's `center`, `muted`, `reviewSummary` and
  // `sectionTitle` so each placeholder occupies the same box as the real thing.
  center: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  muted: { ...typography.bodySm, color: textTokens.secondary },
  reviewSummary: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    padding: spacing.md,
    gap: spacing.xxs,
  },
  sectionTitle: { ...typography.h3, color: textTokens.primary },
});
