/**
 * #2099 — Business WEB launcher.
 *
 * SPEC + Amendments 1–5, §D2. This is the only #2099 module the venue page
 * pulls in eagerly, and it is deliberately tiny: a pending-only button plus the
 * on-intent dynamic import that fetches the real dialog. The dialog and the
 * correction RPC service must NOT be statically imported here — that is what
 * put 12,269 B of correction code into the eager `__common` chunk and failed
 * the boot-payload tripwire.
 *
 * A failed chunk load leaves the venue page fully usable and offers Retry.
 */

import React, { useCallback, useState } from "react";

import { Button } from "../ui/Button";

type DialogModule = typeof import("./PendingVenueIdentityCorrectionDialog.web");
type DialogComponent = DialogModule["PendingVenueIdentityCorrectionDialog"];

export interface PendingVenueIdentityCorrectionLauncherProps {
  venueId: string | null;
  claimStatus: string | null;
  onSuccess: () => void;
}

export function PendingVenueIdentityCorrectionLauncher({
  venueId,
  claimStatus,
  onSuccess,
}: PendingVenueIdentityCorrectionLauncherProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
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

  if (venueId === null || claimStatus !== "pending_review") return null;

  return (
    <>
      <Button
        label={loading ? "Loading correction tool…" : "Correct venue identity"}
        variant="secondary"
        size="md"
        leadingIcon="edit"
        disabled={loading}
        onPress={() => void loadDialog()}
        testID="issue-2099-launch"
        accessibilityLabel="Correct this pending venue identity"
      />
      {loadError ? (
        <Button
          label="Couldn't load the correction tool. Retry."
          variant="secondary"
          size="md"
          onPress={() => void loadDialog()}
          testID="issue-2099-chunk-retry"
          accessibilityLabel="Retry loading the venue correction tool"
        />
      ) : null}
      {Dialog !== null ? (
        <Dialog
          visible={open}
          venueId={venueId}
          onClose={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            onSuccess();
          }}
        />
      ) : null}
    </>
  );
}
