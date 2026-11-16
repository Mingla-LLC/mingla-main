/**
 * #2830 — what the publish design checks found, as one list.
 *
 * The six design checks (mingla-site-cms `designChecks.ts`) are warnings:
 * none blocks publishing; what blocks is a failed draft validation. Ari's
 * publish step and the Host setup screen's publish step both read the same
 * stored run through this, so they give the same count and the same
 * sentences (each already names its page, "(Home, Call to action block 2)").
 */
import { blockActionLinks } from "./blocks.ts";
import { actionHrefProblem, type ActionHrefProblem, type ActionIntent, type MinglaActionScope } from "./safety.ts";

export type PublishFinding = {
  /** The check it came from ("truth", "links"…). */
  readonly check: string;
  /** The check's own label ("Truth"). */
  readonly label: string;
  /** The owner-facing sentence; the check's label when it gave none. */
  readonly message: string;
  /** Where to fix it: a page address ("" is Home), or null. */
  readonly pagePath: string | null;
  /** A Website section to fix it in, when there is no page. */
  readonly section: string | null;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Every warning in a design-check run's `checks`, in check order. */
export function publishFindings(checks: unknown): PublishFinding[] {
  const out: PublishFinding[] = [];
  for (const raw of Array.isArray(checks) ? checks : []) {
    const check = record(raw);
    if (check.status !== "warn") continue;
    const key = text(check.key) ?? "check";
    const label = text(check.label) ?? "A design check";
    const items = Array.isArray(check.items) ? check.items.map(record) : [];
    if (items.length === 0) {
      out.push({ check: key, label, message: label, pagePath: null, section: null });
      continue;
    }
    for (const item of items) {
      out.push({
        check: key,
        label,
        message: text(item.message) ?? label,
        pagePath: typeof item.page_path === "string" ? item.page_path : null,
        section: text(item.section),
      });
    }
  }
  return out;
}

/** "1 thing to look at" / "3 things to look at". */
export function publishFindingsCount(count: number): string {
  return `${count} ${count === 1 ? "thing" : "things"} to look at`;
}

/*
 * #4453 PR 2 (booking lock, D5) — the one publish check that BLOCKS: a booking
 * button that points outside Mingla, or any button to a third-party booking
 * site (informational buttons may open maps, socials and files). Bookings and payments on a Mingla site go
 * through Mingla, so a single action link that fails isMinglaActionHref stops
 * the publish with this code, and the last good site stays live.
 *
 * invariant: I-SITES-ACTIONS-RESOLVE-TO-MINGLA (declared in safety.ts; this
 * check's test is mingla-site-cms/src/lib/bookingLock.issue4453.test.ts).
 */
export const OUTBOUND_ACTION_LINK = "OUTBOUND_ACTION_LINK" as const;
export const OUTBOUND_ACTION_LINK_MESSAGE =
  "This button points outside Mingla. Bookings and payments on your site go through Mingla. Change the link to one of your Mingla pages.";

/** One button that fails the booking lock: where it is and why. */
export type OutboundActionLink = {
  /** The page address ("" is Home), or null for the header button. */
  readonly pagePath: string | null;
  /** The block's position on its page, or null for the header button. */
  readonly blockIndex: number | null;
  readonly blockType: string | null;
  /** The field ("href", "ctas[0].href", "header_cta.href"). */
  readonly field: string;
  readonly href: string;
  /** Booking buttons must resolve to Mingla; informational ones may also open maps, socials, files. */
  readonly intent: ActionIntent;
  readonly problem: ActionHrefProblem;
};

type ScannedPage = {
  path: string;
  blocks?: ReadonlyArray<Record<string, unknown>> | null;
};

/**
 * Every action link in a site that the booking lock refuses, in page order,
 * then the header button. Pages are given by address ("" is Home); blocks may
 * be v2 blocks (`type`) or Studio blocks (`blockType`).
 */
export function outboundActionLinks(input: {
  pages: readonly ScannedPage[];
  headerCtaHref?: unknown;
  scope: MinglaActionScope | null;
}): OutboundActionLink[] {
  const out: OutboundActionLink[] = [];
  const asText = (value: unknown): string => (typeof value === "string" ? value : String(value)).slice(0, 2048);
  for (const page of input.pages) {
    (page.blocks ?? []).forEach((block, blockIndex) => {
      for (const link of blockActionLinks(block)) {
        const problem = actionHrefProblem(link.href, input.scope, link.intent);
        if (problem) {
          out.push({
            pagePath: page.path,
            blockIndex,
            blockType: String(block.type ?? block.blockType),
            field: link.field,
            href: asText(link.href),
            intent: link.intent,
            problem,
          });
        }
      }
    });
  }
  if (input.headerCtaHref !== undefined && input.headerCtaHref !== null && input.headerCtaHref !== "") {
    const problem = actionHrefProblem(input.headerCtaHref, input.scope);
    if (problem) {
      out.push({ pagePath: null, blockIndex: null, blockType: null, field: "header_cta.href", href: asText(input.headerCtaHref), intent: "booking", problem });
    }
  }
  return out;
}
