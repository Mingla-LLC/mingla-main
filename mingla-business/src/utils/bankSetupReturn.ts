/**
 * bankSetupReturn — issue #3645.
 *
 * A host who is stopped at Publish because the brand has no bank taps
 * "Connect bank", finishes (or abandons) bank setup, and must land back on the
 * screen they left. Before this module nothing carried that origin: the web
 * flow always came back to `/brand/{id}/payments`.
 *
 * ONE generic return target, used by all four creators (event, RSVP, trip,
 * experience) and honoured by every bank-setup surface:
 *
 *   /brand/{id}/payments/onboard?resume=<path>
 *   /brand/{id}/connect?resume=<path>
 *
 * SAFETY CONTRACT (pinned by DRAFT invariant
 * I-PROPOSED-3645-BANK-SETUP-RETURN-IS-A-CLOSED-INTERNAL-PATH):
 *  - The value is never navigated to as given. It is PARSED against a closed
 *    list of creator routes and REBUILT from the parsed parts, so an absolute
 *    URL, a protocol-relative `//host`, a backslash trick, an encoded slash, a
 *    fragment or an unknown route all resolve to `null` and the caller falls
 *    back to its existing destination.
 *  - The only things a return path can carry are a route kind, a record id made
 *    of `[A-Za-z0-9_-]`, a screen (`edit` | `preview`) and a small step number.
 *    No free text, so no personal data can ride in the query string.
 *  - An absolute return URL is only ever built by joining the SANITISED path
 *    onto the page's own HTTPS origin.
 */

export const BANK_SETUP_RETURN_PARAM = "resume" as const;

export type BankSetupReturnKind = "event" | "rsvp" | "trip" | "experience";
export type BankSetupReturnScreen = "edit" | "preview";

export interface BankSetupReturnTarget {
  kind: BankSetupReturnKind;
  /** Draft / record id. `[A-Za-z0-9_-]{1,64}` only. */
  id: string;
  screen?: BankSetupReturnScreen;
  /** Wizard step to reopen on. Whole number 0..20. */
  step?: number | null;
}

const KINDS: readonly BankSetupReturnKind[] = [
  "event",
  "rsvp",
  "trip",
  "experience",
];
/** Only event and RSVP have a separate preview route. */
const PREVIEW_KINDS: readonly BankSetupReturnKind[] = ["event", "rsvp"];
const ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;
const STEP_SHAPE = /^(?:[0-9]|1[0-9]|20)$/;
const PATH_SHAPE =
  /^\/(event|rsvp|trip|experience)\/([A-Za-z0-9_-]{1,64})\/(edit|preview)$/;
const MAX_RAW_LENGTH = 160;

const isKind = (value: string): value is BankSetupReturnKind =>
  (KINDS as readonly string[]).includes(value);

const normalizeStep = (step: number | null | undefined): number | null => {
  if (typeof step !== "number" || !Number.isInteger(step)) return null;
  return step >= 0 && step <= 20 ? step : null;
};

/**
 * Build the canonical internal path for a creator screen. Returns null when
 * the parts could not form a path this module would accept back.
 */
export const buildBankSetupReturnPath = (
  target: BankSetupReturnTarget,
): string | null => {
  if (!isKind(target.kind)) return null;
  if (typeof target.id !== "string" || !ID_SHAPE.test(target.id)) return null;
  const screen: BankSetupReturnScreen = target.screen ?? "edit";
  if (screen !== "edit" && screen !== "preview") return null;
  if (screen === "preview" && !PREVIEW_KINDS.includes(target.kind)) return null;
  const base = `/${target.kind}/${target.id}/${screen}`;
  const step = screen === "edit" ? normalizeStep(target.step) : null;
  return step === null ? base : `${base}?step=${step}`;
};

/**
 * Validate an untrusted return value (a route param). Returns the canonical
 * path REBUILT from the parsed parts, or null. Never returns the input.
 */
export const sanitizeBankSetupReturnPath = (raw: unknown): string | null => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_RAW_LENGTH) return null;
  // Reject anything that is not plain printable ASCII path characters before
  // parsing: no whitespace, control characters, backslashes, percent-encoding,
  // fragments or a second query separator.
  if (!/^[A-Za-z0-9_\-/?=]+$/.test(value)) return null;
  const queryAt = value.indexOf("?");
  const path = queryAt === -1 ? value : value.slice(0, queryAt);
  const query = queryAt === -1 ? null : value.slice(queryAt + 1);
  const match = PATH_SHAPE.exec(path);
  if (match === null) return null;
  const kind = match[1];
  const id = match[2];
  const screen = match[3] as BankSetupReturnScreen;
  if (!isKind(kind)) return null;
  let step: number | null = null;
  if (query !== null) {
    if (!query.startsWith("step=")) return null;
    const stepText = query.slice("step=".length);
    if (!STEP_SHAPE.test(stepText)) return null;
    step = Number(stepText);
  }
  if (screen === "preview" && query !== null) return null;
  return buildBankSetupReturnPath({ kind, id, screen, step });
};

/**
 * Append the return target to a bank-setup route. An invalid target leaves the
 * route exactly as it was.
 */
export const withBankSetupReturn = (
  route: string,
  returnPath: string | null | undefined,
): string => {
  const safe = sanitizeBankSetupReturnPath(returnPath);
  if (safe === null) return route;
  const joiner = route.includes("?") ? "&" : "?";
  return `${route}${joiner}${BANK_SETUP_RETURN_PARAM}=${encodeURIComponent(safe)}`;
};

/** The bank-setup route for a brand, carrying where to come back to. */
export const bankSetupRouteWithReturn = (
  brandId: string,
  target: BankSetupReturnTarget | null,
): string => {
  const route = `/brand/${brandId}/payments/onboard`;
  if (target === null) return route;
  return withBankSetupReturn(route, buildBankSetupReturnPath(target));
};

/**
 * The absolute URL hosted bank setup sends the browser back to on web. Built
 * only from the page's own HTTPS origin plus a sanitised internal path; returns
 * null when either is unusable so the caller keeps its existing return URL.
 */
export const buildBankSetupWebReturnUrl = (
  origin: string,
  returnPath: string | null | undefined,
): string | null => {
  const safe = sanitizeBankSetupReturnPath(returnPath);
  if (safe === null) return null;
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return null;
  }
  if (parsedOrigin.protocol !== "https:") return null;
  const url = new URL(safe, parsedOrigin.origin);
  // Belt and braces: the join must not have left the page's own origin.
  if (url.origin !== parsedOrigin.origin) return null;
  return url.toString();
};

/**
 * Which step a creator may OPEN on when the host comes back after a full page
 * load (`?step=N` on the creator's edit route). Each wizard has steps that only
 * exist mid-flow, so an arbitrary number is never trusted: anything a wizard
 * cannot open cold starts at step 1.
 */

/**
 * Trip wizard: steps 1-6 and Review (8). The Invite step (7) is only reachable
 * through the invite pre-check.
 */
export const resolveTripWizardInitialStep = (
  initialStep: number | undefined,
): 1 | 2 | 3 | 4 | 5 | 6 | 8 => {
  if (typeof initialStep !== "number" || !Number.isInteger(initialStep)) return 1;
  if (initialStep < 1 || initialStep > 8 || initialStep === 7) return 1;
  return initialStep as 1 | 2 | 3 | 4 | 5 | 6 | 8;
};

/**
 * Experience wizard: steps 1-5 open directly. Review (7) only exists once the
 * invite step is known to be on, so the wizard opens on Cover (5) and moves to
 * Review when that is confirmed. The Invite step (6) is never opened cold.
 */
export const resolveExperienceWizardInitialStep = (
  initialStep: number | undefined,
): { start: 1 | 2 | 3 | 4 | 5; resumeReview: boolean } => {
  if (typeof initialStep !== "number" || !Number.isInteger(initialStep)) {
    return { start: 1, resumeReview: false };
  }
  if (initialStep === 7) return { start: 5, resumeReview: true };
  if (initialStep >= 1 && initialStep <= 5) {
    return { start: initialStep as 1 | 2 | 3 | 4 | 5, resumeReview: false };
  }
  return { start: 1, resumeReview: false };
};
