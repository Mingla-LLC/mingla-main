/**
 * #2099 — Business WEB launcher (Amendment 4 §D2, re-hosted by Amendment 6 §F3).
 *
 * The ONLY #2099 module `app/venue/[venueId]/index.tsx` pulls in eagerly, and
 * deliberately tiny: a pending-only button plus the on-intent dynamic import
 * that fetches the real dialog. The dialog and the correction RPC service must
 * NEVER be statically imported here — the async chunk boundary is what keeps
 * the correction feature out of the eager `__common` payload AND out of both
 * native import graphs (`.native.tsx` renders nothing at all).
 *
 * A failed chunk load leaves the venue page fully usable and offers Retry.
 *
 * The two literals below are load-bearing contract, not decoration:
 *   `venue-page-correct-identity-web` — Check H's mount proof (H-1…H-5) and
 *   `Correct venue identity`          — Check P's disk-truth assertion (P-10).
 * The native launcher must carry NEITHER, which is what makes the tag
 * unforgeable against a platform-resolution mutation.
 */

import React, { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";

import { spacing } from "../../constants/designSystem";
import { Button } from "../ui/Button";

type DialogModule = typeof import("./PendingVenueIdentityCorrectionDialog.web");
type DialogComponent = DialogModule["PendingVenueIdentityCorrectionDialog"];

export interface PendingVenueIdentityCorrectionLauncherProps {
  venueId: string | null;
  claimStatus: string | null;
  /**
   * Amendment 7 §G5 — OPTIONAL. Cache invalidation is owned by the dialog and
   * dispatched by query KEY, so it reaches every mounted observer (including
   * the ones inside `VenueSuiteShell`, which #2099 may not edit). The host page
   * needs no callback and must not wire one to a discarded query handle.
   */
  onSuccess?: () => void;
}

export function PendingVenueIdentityCorrectionLauncher({
  venueId,
  claimStatus,
  onSuccess,
}: PendingVenueIdentityCorrectionLauncherProps): React.ReactElement | null {
  const [open, setOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [Dialog, setDialog] = useState<DialogComponent | null>(null);

  const loadDialog = useCallback(async (): Promise<void> => {
    if (loading) return;
    if (Dialog !== null) {
      setOpen(true);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const loaded = await import("./PendingVenueIdentityCorrectionDialog.web");
      setDialog(() => loaded.PendingVenueIdentityCorrectionDialog);
      setOpen(true);
    } catch {
      // Constitution #3 — surface it; never fail silently.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [Dialog, loading]);

  // The host page already gates on the claim state; this is the second,
  // independent gate Amendment 6 §F3 constraint 3 requires.
  if (venueId === null || claimStatus !== "pending_review") return null;

  return (
    <View style={styles.host}>
      <Button
        label="Correct venue identity"
        variant="secondary"
        size="md"
        leadingIcon="edit"
        loading={loading}
        onPress={() => void loadDialog()}
        testID="venue-page-correct-identity-web"
        accessibilityLabel="Correct venue identity"
      />
      {loadError ? (
        <Button
          label="Couldn't load the correction tool. Retry."
          variant="ghost"
          size="sm"
          onPress={() => void loadDialog()}
          testID="venue-page-correct-identity-chunk-retry"
          accessibilityLabel="Couldn't load the correction tool. Retry."
        />
      ) : null}
      {Dialog !== null ? (
        <Dialog
          visible={open}
          venueId={venueId}
          onClose={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            if (onSuccess !== undefined) onSuccess();
          }}
        />
      ) : null}
    </View>
  );
}

// The launcher owns its own spacing — Amendment 6 §F3 constraint 2 forbids a
// host-side wrapper, because on native this component renders `null` and a
// padded wrapper would leave a visible empty band on iOS and Android.
const styles = StyleSheet.create({
  host: {
    alignItems: "flex-start",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
});

export default PendingVenueIdentityCorrectionLauncher;
