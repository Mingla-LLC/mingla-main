/**
 * #4453 — when the read of one item's brand counts as "still loading".
 *
 * The chrome shows a placeholder while it is (never another brand's name), so
 * the read must stop being "pending" whenever it can no longer answer:
 * otherwise the placeholder never ends.
 *
 * FAILS-ON-REVERT: report `pending: query.isPending` alone and "offline" stays
 * pending for ever.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/hooks/__tests__/issue_4453_item_route_brand_read.implementor.test.ts
 */
/* eslint-disable import/first */
import { describe, expect, jest, test } from "@jest/globals";

let mockQuery: { data?: string | null; isPending: boolean; fetchStatus: string } = { isPending: true, fetchStatus: "fetching" };
const mockUseQuery = jest.fn((_options: { enabled: boolean }) => mockQuery);
let mockAuthReady = true;

jest.mock("@tanstack/react-query", () => ({ useQuery: (options: { enabled: boolean }) => mockUseQuery(options) }));
jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: mockAuthReady }) }));
jest.mock("../../services/supabase", () => ({ supabase: {} }));

import { useItemRouteBrand } from "../useItemRouteBrand";

const TRIP = { table: "events" as const, id: "a3e4756c-f273-47fc-bf73-2f8432217e3a" };

describe("#4453 the read of an item's brand", () => {
  test("not an item screen, or signed out: nothing to wait for", () => {
    mockQuery = { isPending: true, fetchStatus: "idle" };
    expect(useItemRouteBrand(null, true)).toEqual({ brandId: null, pending: false });
    expect(useItemRouteBrand(TRIP, false)).toEqual({ brandId: null, pending: false });
  });

  test("waiting for the session, then reading: pending", () => {
    mockAuthReady = false;
    mockQuery = { isPending: true, fetchStatus: "idle" };
    expect(useItemRouteBrand(TRIP, true)).toEqual({ brandId: null, pending: true });
    expect(mockUseQuery.mock.calls[mockUseQuery.mock.calls.length - 1]![0].enabled).toBe(false);
    mockAuthReady = true;
    mockQuery = { isPending: true, fetchStatus: "fetching" };
    expect(useItemRouteBrand(TRIP, true)).toEqual({ brandId: null, pending: true });
    expect(mockUseQuery.mock.calls[mockUseQuery.mock.calls.length - 1]![0].enabled).toBe(true);
  });

  test("answered: the brand, or none (not found, no access)", () => {
    mockQuery = { data: "brand-gameland", isPending: false, fetchStatus: "idle" };
    expect(useItemRouteBrand(TRIP, true)).toEqual({ brandId: "brand-gameland", pending: false });
    mockQuery = { data: null, isPending: false, fetchStatus: "idle" };
    expect(useItemRouteBrand(TRIP, true)).toEqual({ brandId: null, pending: false });
  });

  test("a failed read, or offline with nothing cached: not known, and no longer loading", () => {
    mockQuery = { data: undefined, isPending: false, fetchStatus: "idle" };
    expect(useItemRouteBrand(TRIP, true)).toEqual({ brandId: null, pending: false });
    mockQuery = { data: undefined, isPending: true, fetchStatus: "paused" };
    expect(useItemRouteBrand(TRIP, true)).toEqual({ brandId: null, pending: false });
  });
});
