import type { BrandSiteOperation } from "./contracts";

/*
 * #2829 W9f (A18 item 1) — PUBLISH IS HONEST WHATEVER IT TAKES.
 *
 * Locally a publish takes ~18-26 s. brand-site-control gives up waiting for
 * Studio after 15 s, marks the operation "ambiguous" and answers 503
 * SERVICE_TEMPORARILY_UNAVAILABLE, while Studio finishes the publish and Core
 * records it as succeeded seconds later. The workspace treated that 503 as a
 * refusal and said "That didn't go through" about a publish that went live.
 *
 * A 503 (or any failure without a named refusal) means "the outcome is not
 * known yet", not "refused": the workspace now tracks the SAME operation
 * through its durable receipt and shows "Still publishing…" until Core says
 * succeeded or failed. If Core never accepted the operation, the receipt
 * answers NOT_FOUND and the #3583 orphan path says plainly nothing was
 * published. Only a named refusal (forbidden, conflict, validation…) is shown
 * as a failure straight away.
 */
export function publicationOutcomeUnknown(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code !== "string" || code === "SERVICE_TEMPORARILY_UNAVAILABLE";
}

export async function startTrackedPublication<T>(
  operation: T,
  deps: {
    run: (operation: T) => Promise<void>;
    track: (operation: T) => Promise<void>;
    refuse: (error: unknown) => void;
  },
): Promise<"tracking" | "refused"> {
  try {
    await deps.run(operation);
  } catch (error) {
    if (!publicationOutcomeUnknown(error)) {
      deps.refuse(error);
      return "refused";
    }
  }
  await deps.track(operation);
  return "tracking";
}

/** What the receipt box says while a publish or rollback is being tracked. */
export function publicationReceiptLine(
  operation: Pick<BrandSiteOperation, "status"> | null,
  timedOut: boolean,
): string {
  if (operation?.status === "failed") return "The operation reached a verified failure.";
  if (operation?.status === "succeeded") return "Published.";
  if (timedOut) {
    return "Automatic checks stopped before Mingla heard back. The operation is preserved; check it again.";
  }
  return "Still publishing… Mingla is waiting for the server to confirm the result.";
}

/** Long enough for a slow publish to finish; the receipt stays the truth after. */
export const PUBLICATION_TRACK_WINDOW_MS = 5 * 60_000;
