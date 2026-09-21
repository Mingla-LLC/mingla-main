/**
 * rsvpGuestCopy — guest-facing RSVP copy that must match the event's real
 * settings. Pure and dependency-free (no react / react-native) so it can be
 * tested without a renderer.
 *
 * Two owners live here:
 *
 * 1. `rsvpAudienceMicrocopy` — the line under the Going / Maybe / Can't go
 *    buttons. It used to say "Anyone with the link can RSVP." for every
 *    auto-approve RSVP, including public events listed on the discovery feed.
 *    The line now follows the host's "Who can find this" settings.
 *
 * 2. `rsvpContactIssues` + `buildRsvpValidationHint` — what a guest still has to
 *    fill in before a decision tap can go through. The hint is shown NEXT TO the
 *    control the guest tapped, because the fields themselves are usually far
 *    above it on a phone.
 */

export type RsvpAudienceVisibility = "public" | "unlisted" | "private";

export interface RsvpAudienceInput {
  /** events.visibility. Undefined when the surface does not know it. */
  visibility?: RsvpAudienceVisibility | string | null;
  /** events.rsvp_discoverable — "Also show this on Mingla's discovery feed". */
  discoverable?: boolean | null;
  /** events.rsvp_approval_mode === 'manual'. */
  manualApproval: boolean;
}

/** The line under the decision buttons for a guest who has not replied yet. */
export const rsvpAudienceMicrocopy = (input: RsvpAudienceInput): string => {
  const visibility = input.visibility ?? null;
  if (visibility === "private") {
    return input.manualApproval
      ? "Private event · the host reviews each request."
      : "Private event · for invited guests.";
  }
  if (input.manualApproval) {
    return "The host reviews each request before you're in.";
  }
  if (input.discoverable === true) {
    return "Listed on Mingla · anyone can RSVP.";
  }
  if (visibility === "public") {
    return "Public event · anyone can RSVP.";
  }
  // Unlisted, or a surface that does not know the setting: the only thing we
  // can say for certain is that this link works.
  return "Anyone with the link can RSVP.";
};

export type RsvpContactFieldKey = "name" | "email" | "phone";

export interface RsvpContactIssue {
  /** null ⇒ the primary guest; otherwise the zero-based plus-one index. */
  guestIndex: number | null;
  field: RsvpContactFieldKey;
  /** "missing" ⇒ empty; "invalid" ⇒ filled but not usable. */
  problem: "missing" | "invalid";
}

export interface RsvpContactDraft {
  name: string;
  email: string;
  phone: string;
}

export interface RsvpContactIssuesInput {
  primary: RsvpContactDraft;
  /** False when the primary guest is signed in and not asked for details. */
  primaryRequired: boolean;
  guests: ReadonlyArray<RsvpContactDraft>;
  emailPattern: RegExp;
  phonePattern: RegExp;
}

const draftIssues = (
  draft: RsvpContactDraft,
  guestIndex: number | null,
  emailPattern: RegExp,
  phonePattern: RegExp,
): RsvpContactIssue[] => {
  const issues: RsvpContactIssue[] = [];
  // Same order as on screen: name, email, phone. A blank field is "missing"; a
  // filled one that fails its pattern (name has none) is "invalid".
  const check = (field: RsvpContactFieldKey, pattern: RegExp | null): void => {
    const value = draft[field].trim();
    if (value.length === 0) issues.push({ guestIndex, field, problem: "missing" });
    else if (pattern !== null && !pattern.test(value)) issues.push({ guestIndex, field, problem: "invalid" });
  };
  check("name", null);
  check("email", emailPattern);
  check("phone", phonePattern);
  return issues;
};

/** Every unfinished contact field, in on-screen order (primary first, then guests). */
export const rsvpContactIssues = (
  input: RsvpContactIssuesInput,
): RsvpContactIssue[] => {
  const issues: RsvpContactIssue[] = input.primaryRequired
    ? draftIssues(input.primary, null, input.emailPattern, input.phonePattern)
    : [];
  input.guests.forEach((guest, index) => {
    issues.push(
      ...draftIssues(guest, index, input.emailPattern, input.phonePattern),
    );
  });
  return issues;
};

const joinList = (parts: string[]): string => {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
};

const FIELD_NOUN: Record<RsvpContactFieldKey, string> = {
  name: "name",
  email: "email",
  phone: "phone number",
};

/**
 * The short message shown beside the tapped decision control, or null when
 * nothing is left to fill in. Only the FIRST person with unfinished details is
 * named, so the line stays one sentence.
 *
 *   all primary fields empty         → "Add your name, email and phone number above to RSVP."
 *   primary name + email empty       → "Add your name and email above to RSVP."
 *   primary email malformed          → "Add a valid email above to RSVP."
 *   name + email empty, phone bad    → "Add your name, email and a valid phone number above to RSVP."
 *   email malformed, phone empty     → "Add a valid email and your phone number above to RSVP."
 *   primary done, guest 1 unfinished → "Finish Guest 1's details above to RSVP."
 */
export const buildRsvpValidationHint = (
  issues: ReadonlyArray<RsvpContactIssue>,
): string | null => {
  const first = issues[0];
  if (first === undefined) return null;
  if (first.guestIndex !== null) {
    return `Finish Guest ${first.guestIndex + 1}'s details above to RSVP.`;
  }
  // One flat list in on-screen order, so there is only ever one "and"; the
  // first missing field carries "your" ("your name, email and a valid phone
  // number", "a valid email and your phone number").
  let yourUsed = false;
  const parts = issues
    .filter((issue) => issue.guestIndex === null)
    .map((issue) => {
      const noun = FIELD_NOUN[issue.field];
      if (issue.problem === "invalid") return `a valid ${noun}`;
      if (yourUsed) return noun;
      yourUsed = true;
      return `your ${noun}`;
    });
  return `Add ${joinList(parts)} above to RSVP.`;
};
