/**
 * #4490 fix 3 (N87) — a member booking as a member (their membership saved on
 * this device) starts with their name and email filled in. Read with the
 * member's own token; fields the guest already typed are never replaced. A
 * failed read changes nothing (the fields stay empty to type).
 */
import { useEffect } from "react";

import { venueMembershipGuestService } from "../../../services/venueMembershipGuestService";
import { parseGuestMember } from "./memberGuestModel";
import type { GuestDetailsState } from "./GuestDetails";

export function useMemberPrefill(
  member: { subscriptionId: string; token: string } | null,
  details: Pick<GuestDetailsState, "name" | "email" | "setName" | "setEmail">,
): void {
  const subscriptionId = member?.subscriptionId ?? null;
  const token = member?.token ?? null;
  const { setName, setEmail } = details;
  useEffect(() => {
    if (subscriptionId === null || token === null) return undefined;
    let live = true;
    venueMembershipGuestService
      .get({ subscriptionId, token })
      .then((raw) => {
        if (!live) return;
        const parsed = parseGuestMember(raw);
        if (parsed === null) return;
        if (parsed.memberName.trim().length > 0 && parsed.memberName !== "Member") {
          setName((current) => (current.trim().length === 0 ? parsed.memberName : current));
        }
        const email = parsed.memberEmail ?? null;
        if (email !== null) setEmail((current) => (current.trim().length === 0 ? email : current));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [subscriptionId, token, setName, setEmail]);
}
