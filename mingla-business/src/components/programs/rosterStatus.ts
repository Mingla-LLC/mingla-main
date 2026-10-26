// #3872 — My creators status words (On Mingla / Invited / Link only).
import type { CreatorRosterRow } from "../../services/creatorRosterService";

export type RosterFilter = "all" | "on_mingla" | "invited";

export function rosterStatus(
  row: Pick<
    CreatorRosterRow,
    "status" | "linked_creator_account_id" | "referral_member_id" | "link_slug"
  >,
): {
  key: "on_mingla" | "invited" | "link_only" | "saved";
  label: string;
  tone: "done" | "waiting" | "ended";
} {
  if (row.linked_creator_account_id || row.status === "joined")
    return { key: "on_mingla", label: "On Mingla", tone: "done" };
  if (row.status === "invited" || row.referral_member_id)
    return { key: "invited", label: "Invited", tone: "waiting" };
  if (row.link_slug)
    return { key: "link_only", label: "Link only", tone: "ended" };
  return { key: "saved", label: "Saved", tone: "ended" };
}
