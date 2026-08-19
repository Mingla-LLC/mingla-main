/**
 * #2305 — implementor happy-path regression proof for the client half.
 *
 * Two contracts are load-bearing and both are easy to break silently:
 *
 *   1. THE STRIP RENDERS `null` AT ZERO. #1774 designed a calm People page; a
 *      queue that is usually empty must leave it byte-for-byte as shipped. A
 *      zero-state, an "all filed" badge or a ghost rail would each be a
 *      permanent new fixture on a page anyone at rank 20+ opens for unrelated
 *      reasons. It must also render nothing in every UNSETTLED query state — a
 *      failed conflicts fetch must not make the roster look broken.
 *
 *   2. RESOLVING INVALIDATES BOTH QUERY KEYS. Resolving ADDS a person to the
 *      book, so the conflicts key and the people key must both refetch. The
 *      payoff frame — recovered buyers appearing in the roster in the same frame
 *      the warning band disappears — depends on both firing, and a stale book
 *      after a successful resolve is a visible bug.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The repo ships no @types/react-test-renderer; every sibling People suite loads
// it through this same narrow cast rather than adding a devDependency.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => { toJSON: () => unknown };
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

import { marketingKeys } from "../../../hooks/marketing/marketingKeys";

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Sheet", () => ({ Sheet: () => null }));
jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../ui/EmptyState", () => ({ EmptyState: () => null }));
jest.mock("../../ui/Skeleton", () => ({ Skeleton: () => null }));
jest.mock("../../ui/Spinner", () => ({ Spinner: () => null }));
jest.mock("../../ui/Avatar", () => ({ Avatar: () => null }));

// eslint-disable-next-line import/first
import { ConflictReviewStrip } from "../ConflictReviewSheet";

const textOf = (json: unknown): string => {
  if (json === null || json === undefined) return "";
  if (typeof json === "string") return json;
  if (Array.isArray(json)) return json.map(textOf).join(" ");
  const node = json as { children?: unknown };
  return textOf(node.children ?? null);
};

const renderStrip = (props: React.ComponentProps<typeof ConflictReviewStrip>): unknown => {
  let tree: { toJSON: () => unknown } | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<ConflictReviewStrip {...props} />);
  });
  return (tree as unknown as { toJSON: () => unknown }).toJSON();
};

const base = {
  kind: "success" as const,
  openCount: 0,
  oldestCreatedAt: null,
  stacked: false,
  onReview: (): void => {},
};

describe("#2305 Book-block strip", () => {
  test("renders NOTHING at zero — #1774's calm page is untouched in the normal case", () => {
    expect(renderStrip(base)).toBeNull();
  });

  test("renders people-language, never error-language, when buyers are waiting", () => {
    const out = textOf(renderStrip({ ...base, openCount: 3 }));
    expect(out).toContain("3 buyers are waiting to be added");
    // These are humans who paid. Never "records", "conflicts", "errors", "items".
    expect(out).not.toMatch(/error|failed|conflict|record|item/i);
  });

  test("singularises at one buyer rather than shipping a second design", () => {
    expect(textOf(renderStrip({ ...base, openCount: 1 }))).toContain(
      "1 buyer is waiting to be added",
    );
  });

  test("converts the count into a debt once the oldest has waited a day", () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 86_400_000).toISOString();
    const out = textOf(renderStrip({ ...base, openCount: 2, oldestCreatedAt: sixDaysAgo }));
    expect(out).toContain("Oldest has waited 6 days.");
  });

  test("omits the wait line while the oldest is under a day old", () => {
    const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const out = textOf(renderStrip({ ...base, openCount: 2, oldestCreatedAt: anHourAgo }));
    expect(out).not.toContain("Oldest has waited");
  });

  test("renders nothing in every unsettled state — a failed fetch must not redden the roster", () => {
    for (const kind of [
      "loading", "error", "offlineEmpty", "staleError", "forbidden", "authLoading", "roleLoading",
    ] as const) {
      expect(renderStrip({ ...base, kind, openCount: 5 })).toBeNull();
    }
  });

  test("still renders from cache when offline — the count is still true", () => {
    expect(renderStrip({ ...base, kind: "offlineStale", openCount: 2 })).not.toBeNull();
  });
});

describe("#2305 query keys", () => {
  test("the conflicts key is nested under people.all so one prefix covers both", () => {
    const all = marketingKeys.people.all("brand-1");
    const conflicts = marketingKeys.people.conflicts("brand-1");
    expect(conflicts.slice(0, all.length)).toEqual(all);
    expect(conflicts).not.toEqual(all);
  });

  test("keys are brand-scoped — one brand's queue can never invalidate another's", () => {
    expect(marketingKeys.people.conflicts("brand-1")).not.toEqual(
      marketingKeys.people.conflicts("brand-2"),
    );
  });
});

describe("#2305 resolve invalidates BOTH keys", () => {
  test("a successful resolve refetches the queue AND the book", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidated: unknown[][] = [];
    const realInvalidate = client.invalidateQueries.bind(client);
    client.invalidateQueries = ((filters?: { queryKey?: unknown[] }) => {
      if (filters?.queryKey) invalidated.push(filters.queryKey);
      return realInvalidate(filters as never);
    }) as typeof client.invalidateQueries;

    // Exercise the hook's real onSuccess rather than re-implementing it.
    const { useResolveBrandPersonConflict } = await import(
      "../../../hooks/marketing/useBrandPersonConflicts"
    );
    let mutate: ((input: unknown) => Promise<unknown>) | null = null;
    function Probe(): React.ReactElement | null {
      const m = useResolveBrandPersonConflict("brand-1");
      mutate = m.mutateAsync as unknown as (input: unknown) => Promise<unknown>;
      return null;
    }
    TestRenderer.act(() => {
      TestRenderer.create(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    expect(mutate).not.toBeNull();

    jest
      .spyOn(await import("../../../services/peopleService"), "resolveBrandPersonConflict")
      .mockResolvedValue({
        conflictIds: ["c1"], resolution: "merge", personId: "p1",
        links: [{ conflictId: "c1", sourceLinkId: "l1" }],
        mergedPersonIds: [], replayed: false,
      });

    await TestRenderer.act(async () => {
      await (mutate as unknown as (input: unknown) => Promise<unknown>)({
        brandId: "brand-1", conflictIds: ["c1"], resolution: "merge",
        winnerPersonId: "p1", clientRequestId: "r1",
      });
    });

    const flat = invalidated.map((k) => JSON.stringify(k));
    expect(flat).toContain(JSON.stringify(marketingKeys.people.conflicts("brand-1")));
    expect(flat).toContain(JSON.stringify(marketingKeys.people.all("brand-1")));
  });
});

/* ------------------------------------------------------------- REWORK ---- */
/* #2305 REWORK — the two client defects the tester proved at runtime.       */

/**
 * The sheet's source with COMMENTS STRIPPED.
 *
 * These cases assert that a defective expression is gone, and the fix for each
 * one is documented in a comment that necessarily quotes the defective
 * expression. Asserting against raw source would therefore fail on the very
 * prose explaining the fix — the same trap that turned the #1774 analytics gate
 * red on a comment. Assert on code.
 */
function sheetCode(): string {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const raw = fs.readFileSync(path.join(__dirname, "..", "ConflictReviewSheet.tsx"), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

describe("#2305 REWORK P2-3 — the header must not double-count", () => {
  test("`remaining` is the server's openCount, never openCount minus a local tally", () => {
    // The bug: `Math.max(openCount - resolvedThisSession, 0)`. `onSuccess`
    // invalidates the conflicts key, so the refetched openCount has ALREADY
    // dropped; subtracting the session tally removed each resolve a second
    // time. Observed on web as "1 to review" above 2 cards, then the line
    // disappearing entirely with one card still on screen.
    const src = sheetCode();
    expect(src).toContain("const remaining = openCount;");
    expect(src).not.toContain("openCount - resolvedThisSession");
    expect(src).not.toContain("Math.max(openCount");
  });
});

describe("#2305 REWORK P3-2 — the empty queue must not misreport permission", () => {
  test("an empty list does not claim the viewer needs a brand admin", () => {
    const src = sheetCode();
    // `rows.length > 0 && rows.every(…)` is FALSE when rows is empty, so the
    // rank-gated sentence showed to the rank-60 owner who had just emptied the
    // queue themselves — on both web and iOS.
    expect(src).toContain("rows.length === 0 || rows.every(");
    expect(src).not.toContain("rows.length > 0 && rows.every(");
  });
});

describe("#2305 REWORK P3-3 — the destructive-confirm CTA must fit", () => {
  test("the single-candidate confirm label is short enough not to truncate", () => {
    const src = sheetCode();
    // "Yes, same person" truncated to "Yes, same pers…" on an iPhone 17 Pro, on
    // the one control that prevents a destructive mistake. The dialog title
    // already restates the target name in full.
    expect(src).toContain('"Yes, file it"');
    expect(src).not.toContain('"Yes, same person"');
  });
});

