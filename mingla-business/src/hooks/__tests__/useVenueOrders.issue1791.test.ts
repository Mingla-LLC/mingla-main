/* eslint-disable import/first */
/* eslint-disable react-hooks/rules-of-hooks -- the harness invokes the hook
   directly (react-query + AuthContext + supabase mocked) to capture the query
   options and the realtime subscription; no React tree is rendered, so the
   rules-of-hooks ordering guarantee is N/A here. This is the shipped
   useSupportStaff.test.ts pattern. */
/**
 * Issue #1791 (#1767 Phase 3, SPEC #1788 P-53) — the notification TRIPLE's two
 * client legs, proven at runtime rather than by reading the source.
 *
 * THE BUG THIS EXISTS TO PREVENT IS ALREADY SHIPPED, in the sibling module:
 * `useVenueReservations.ts:126-165` has `staleTime: 15_000`, a venue-filtered
 * realtime channel, NO `subscribe()` status callback and — the important one —
 * NO `refetchInterval`. A silently dropped channel therefore leaves the
 * reservations list frozen until somebody pulls to refresh, and an inbound
 * booking is simply never seen. An order queue with money already taken cannot
 * inherit that, so this file asserts BOTH legs actually reach react-query and
 * supabase:
 *
 *   (a) REALTIME — a `postgres_changes` subscription on `venue_orders`,
 *       filtered on a NON-PK column (the ORCH-0931 silent-drop rule).
 *   (b) THE 30-SECOND POLL FLOOR — `refetchInterval: 30_000`.
 *
 * # Fails-on-revert
 * Delete `refetchInterval` from `venueOrdersQueryOptions` (or from the hook's
 * disabled branch) → T-P1/T-P2 go RED. Point the channel at the wrong table,
 * drop the filter, or filter on `id` (a PK) → T-R1/T-R2 go RED. Remove the
 * `isAuthReady` fold → T-A1 goes RED and the queue caches an RLS-empty 200 that
 * a chef reads as "no orders".
 *
 * New sibling file (append-only safe).
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

interface CapturedQuery {
  queryKey: readonly unknown[];
  enabled: boolean;
  staleTime?: number;
  refetchInterval?: number;
  queryFn: () => Promise<unknown>;
}

interface CapturedChannel {
  name: string;
  event: string;
  schema: string;
  table: string;
  filter: string;
  subscribed: boolean;
}

const captured: { queries: CapturedQuery[]; channels: CapturedChannel[] } = {
  queries: [],
  channels: [],
};

let authReady = true;

jest.mock("@tanstack/react-query", () => ({
  useQuery: (opts: CapturedQuery) => {
    captured.queries.push(opts);
    return { data: undefined, isLoading: false, isError: false };
  },
  useMutation: (opts: unknown) => ({ mutate: jest.fn(), isPending: false, opts }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: authReady, user: { id: "user-1" } }),
}));

jest.mock("../../services/supabase", () => {
  const channel = (name: string) => {
    const self: Record<string, unknown> = {};
    self.on = (
      _event: string,
      cfg: { event: string; schema: string; table: string; filter: string },
    ) => {
      captured.channels.push({ name, ...cfg, subscribed: false });
      return self;
    };
    self.subscribe = () => {
      const last = captured.channels[captured.channels.length - 1];
      if (last) last.subscribed = true;
      return self;
    };
    return self;
  };
  return {
    supabase: {
      channel,
      removeChannel: jest.fn(),
      from: jest.fn(),
      functions: { invoke: jest.fn() },
    },
  };
});

// `useEffect` runs the subscription body immediately in this harness, so the
// channel config is captured without a React tree.
jest.mock("react", () => ({
  ...(jest.requireActual("react") as object),
  useEffect: (fn: () => void | (() => void)) => {
    fn();
  },
}));

import {
  VENUE_ORDERS_POLL_MS,
  VENUE_ORDERS_STALE_MS,
  useVenueOrders,
  venueOrdersKeys,
  venueOrdersQueryOptions,
} from "../useVenueOrders";

describe("issue #1791 — the notification triple's client legs", () => {
  beforeEach(() => {
    captured.queries = [];
    captured.channels = [];
    authReady = true;
  });

  test("T-P1 — the query options carry a 30-SECOND poll floor", () => {
    const opts = venueOrdersQueryOptions("brand-1");
    expect(opts.refetchInterval).toBe(30_000);
    expect(VENUE_ORDERS_POLL_MS).toBe(30_000);
    // The floor is BELOW the poll, so a poll always finds the cache stale and
    // actually refetches. A staleTime above the interval would make the
    // interval decorative.
    expect(opts.staleTime).toBe(VENUE_ORDERS_STALE_MS);
    expect(opts.staleTime).toBeLessThan(opts.refetchInterval);
    expect(opts.queryKey).toEqual(venueOrdersKeys.list("brand-1"));
  });

  test("T-P2 — the HOOK actually passes the poll floor to react-query", () => {
    // Proving the factory alone would be a comment agreeing with itself. This
    // asserts what react-query was really handed.
    useVenueOrders("brand-1");
    expect(captured.queries).toHaveLength(1);
    expect(captured.queries[0].refetchInterval).toBe(30_000);
    expect(captured.queries[0].enabled).toBe(true);
  });

  test("T-P2b — even the DISABLED branch keeps the poll floor", () => {
    // A hook that dropped the interval while disabled would silently ship a
    // no-poll queue for every brand that mounts before auth resolves.
    authReady = false;
    useVenueOrders("brand-1");
    expect(captured.queries[0].refetchInterval).toBe(30_000);
    expect(captured.queries[0].enabled).toBe(false);
  });

  test("T-R1 — the realtime leg subscribes to venue_orders and SUBSCRIBES", () => {
    useVenueOrders("brand-1");
    expect(captured.channels).toHaveLength(1);
    const ch = captured.channels[0];
    expect(ch.table).toBe("venue_orders");
    expect(ch.schema).toBe("public");
    expect(ch.event).toBe("*");
    expect(ch.subscribed).toBe(true);
    expect(ch.name).toContain("brand-1");
  });

  test("T-R2 — the filter is a NON-PK column (the ORCH-0931 silent-drop rule)", () => {
    useVenueOrders("brand-1");
    const filter = captured.channels[0].filter;
    // brand_id, not id: a PK filter is silently dropped by Supabase realtime,
    // and the queue would go quiet with money already taken.
    expect(filter).toBe("brand_id=eq.brand-1");
    expect(filter.startsWith("id=")).toBe(false);
    // BRAND-scoped on purpose (D-3b): a venue filter would drop exactly the
    // cross-venue tickets the design puts in one list.
    expect(filter.startsWith("venue_id=")).toBe(false);
  });

  test("T-A1 — nothing fires before auth is ready", () => {
    authReady = false;
    useVenueOrders("brand-1");
    expect(captured.queries[0].enabled).toBe(false);
    // ...and no channel is opened either: an unauthenticated subscriber gets
    // an RLS-empty stream that looks exactly like "no orders".
    expect(captured.channels).toHaveLength(0);
  });

  test("T-A2 — a null brand disables the queue entirely", () => {
    useVenueOrders(null);
    expect(captured.queries[0].enabled).toBe(false);
    expect(captured.channels).toHaveLength(0);
  });
});
