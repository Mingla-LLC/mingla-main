/* eslint-disable import/first */
/**
 * Issue #2489 — the two anonymous checkout resolvers must not ask the base record
 * for the address columns.
 *
 * WHY THIS EXISTS. Both of these resolvers ran as an unauthenticated buyer and asked
 * for every column with a star. That handed the caller the exact venue pin and the
 * combined "venue, then street" string on every screen of both checkout chains, even
 * though nothing downstream reads either one — and it made both readers depend on a
 * privilege that is being narrowed in a follow-on deploy. A star cannot survive that
 * narrowing: selecting every column from a relation where one column has been withheld
 * does not return nulls, it refuses the whole read.
 *
 * WHAT IS ASSERTED. The select list each resolver actually sends: that it is not a
 * star, that it names neither address column, and that it still carries the theme the
 * mappers genuinely read. The assertion is on the string sent to the client, not on
 * source text, so deleting the column list and restoring the star fails this file.
 *
 * NOT ASSERTED HERE: what the server withholds. That is a server-side guarantee and is
 * proven against an unauthenticated read in the SQL fixture for this issue; a client
 * assertion could never establish it, which is the whole lesson of #2489.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcMock = jest.fn() as any;
const selectCalls: Array<{ table: string; columns: string }> = [];

// Minimal PostgREST-shaped recorder: every builder method returns the builder, and
// the terminal awaits resolve empty so the resolvers exit early and predictably.
function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = (): unknown => builder;
  for (const m of ["eq", "in", "is", "order", "limit", "neq", "not", "or", "filter"]) {
    builder[m] = chain;
  }
  builder.select = (columns: string) => {
    selectCalls.push({ table, columns });
    return builder;
  };
  builder.maybeSingle = async () => ({ data: null, error: null });
  builder.single = async () => ({ data: null, error: null });
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: [], error: null });
  return builder;
}

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (table: string) => makeBuilder(table),
  },
}));

jest.mock("expo-image", () => ({}), { virtual: true });

import { getPublicTripById } from "../publicEventsService";
import { getPublicExperienceById } from "../publicExperienceService";

const ADDRESS_COLUMNS = ["location_geo", "location_text"];

function baseRecordSelect(): string {
  const hit = selectCalls.find((c) => c.table === "events");
  if (hit === undefined) {
    throw new Error(
      "the resolver never read the base record, so this file would assert nothing",
    );
  }
  return hit.columns;
}

describe("#2489 — anonymous checkout resolvers and the address columns", () => {
  beforeEach(() => {
    selectCalls.length = 0;
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  test("the trip resolver names its columns and asks for neither address column", async () => {
    await getPublicTripById("11111111-1111-1111-1111-111111111111");
    const columns = baseRecordSelect();

    expect(columns).not.toBe("*");
    expect(columns.startsWith("*")).toBe(false);
    for (const column of ADDRESS_COLUMNS) {
      expect(columns).not.toContain(column);
    }
    // Anti-vacuity: a resolver that asked for nothing would satisfy every assertion
    // above while breaking the product. It must still carry what the mapper reads.
    expect(columns).toContain("theme");
    expect(columns).toContain("id");
    expect(columns).toContain("slug");
  });

  test("the experience resolver names its columns and asks for neither address column", async () => {
    await getPublicExperienceById("22222222-2222-2222-2222-222222222222");
    const columns = baseRecordSelect();

    expect(columns).not.toBe("*");
    expect(columns.startsWith("*")).toBe(false);
    for (const column of ADDRESS_COLUMNS) {
      expect(columns).not.toContain(column);
    }
    expect(columns).toContain("theme");
    expect(columns).toContain("brands(");
  });
});
