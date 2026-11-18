/**
 * #4473 — "Is this your ticket?"
 *
 * Shown when a signed-in person opens a /c claim link and the sweep does not
 * attach that purchase (this account has not proved the email or number it
 * was bought with). It is the add sheet starting on its "landed" step: the
 * ticket from the link, the masked purchase contact, "Send code to …", the
 * same in-sheet code step, then Checking and Found / shared / nothing.
 * "I can't get into that inbox" goes to Ask them to send it.
 */
import React from "react";

import { AddIdentitySheet } from "./AddIdentitySheet";
import { useClaimIdentifiers } from "../../hooks/useClaimIdentifiers";
import type { PendingClaim } from "../../services/attendanceClaimService";

export function ClaimLinkLandedSheet({
  claim,
  userId,
  onClose,
}: {
  claim: PendingClaim | null;
  userId: string | null;
  onClose: () => void;
}): React.ReactElement {
  const identifiers = useClaimIdentifiers(userId);
  return (
    <AddIdentitySheet
      claimLink={claim}
      identifiers={identifiers.data}
      initialStep="landed"
      onClose={onClose}
      userId={userId}
      visible={claim !== null && userId !== null}
    />
  );
}
