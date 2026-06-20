/**
 * ORCH-1172 R5 — the managed-event detail query reads FRESH on every mount.
 *
 * R4 made EditPublishedScreen seed its local editState from the server event
 * only once useBusinessEventById has SETTLED (serverEventSettled = isAuthReady
 * && !isLoading && !isFetching). But that gate is only meaningful if a mount
 * actually triggers a NETWORK fetch. With the previous `staleTime: 30s` +
 * default `refetchOnMount`, a mount within 30s of viewing the event resolved
 * INSTANTLY from STALE cache → R4 seeded stale → a full-state/diff save could
 * still clobber a server field that had diverged (the rsvp_discoverable revert
 * edge).
 *
 * This source-contract test pins the fix: `useBusinessEventById` MUST configure
 * `staleTime: 0` + `refetchOnMount: "always"` so every mount forces a fresh DB
 * read, and R4's `!isFetching` gate holds the editor's Loading shell until the
 * fresh row arrives.
 *
 * FAILS-ON-REVERT: if either `staleTime: 0` or `refetchOnMount: "always"` is
 * reverted (e.g. back to `staleTime: STALE_TIME_MS` with no refetchOnMount),
 * the assertions below fail — re-arming the stale-cache clobber.
 */
import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

// Isolate the body of `useBusinessEventById` so the assertions cannot be
// satisfied by config that belongs to a sibling hook in the same file.
const useBusinessEventByIdBody = (source: string): string => {
  const start = source.indexOf("export const useBusinessEventById");
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("export const ", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
};

describe("ORCH-1172 R5 — managed-event editor reads fresh on mount", () => {
  const source = repoFile("src/hooks/useBusinessEvents.ts");
  const body = useBusinessEventByIdBody(source);

  test("useBusinessEventById sets staleTime: 0 (no 30s stale window)", () => {
    expect(body).toContain("staleTime: 0");
    expect(body).not.toContain("staleTime: STALE_TIME_MS");
  });

  test("useBusinessEventById sets refetchOnMount: \"always\" (fresh fetch each mount)", () => {
    expect(body).toContain('refetchOnMount: "always"');
  });

  test("the hot brand-list feed is NOT made fresh-on-mount (scope guard)", () => {
    // useBusinessEventsForBrand is the LIST feed — it must keep its 30s
    // staleTime and must NOT gain refetchOnMount:"always" (would storm the
    // hub list). Confirm the fresh-read config is scoped to the detail hook.
    const listStart = source.indexOf("export const useBusinessEventsForBrand");
    const listEnd = source.indexOf("export const useBusinessEventById");
    const listBody = source.slice(listStart, listEnd);
    expect(listBody).toContain("staleTime: STALE_TIME_MS");
    expect(listBody).not.toContain('refetchOnMount: "always"');
  });
});
