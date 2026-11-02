import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const results: { data: unknown; error: { code: string } | null }[] = [];
const selects: string[] = [];

jest.mock("../supabase", () => {
  const chain = {
    select: (columns: string) => {
      selects.push(columns);
      return chain;
    },
    eq: () => chain,
    is: () => chain,
    order: async () => results.shift(),
  };
  return { supabase: { from: () => chain } };
});

import { fetchTicketsForEvent } from "../businessEvents";

const row = {
  id: "t1",
  name: "General",
  is_free: true,
  price_cents: 0,
  quantity_total: 10,
  is_unlimited: false,
};

describe("issue #3281 ticket read while a migration is pending", () => {
  beforeEach(() => {
    results.length = 0;
    selects.length = 0;
  });

  test("a missing day list column falls back to All dates", async () => {
    results.push({ data: null, error: { code: "42703" } }, { data: [row], error: null });
    const tickets = await fetchTicketsForEvent("e1");
    expect(tickets[0].validDayIds).toBeNull();
    expect(selects[1]).not.toContain("valid_occurrence_keys");
  });

  test("the column is read when it exists", async () => {
    results.push({ data: [{ ...row, valid_occurrence_keys: ["fri"] }], error: null });
    const tickets = await fetchTicketsForEvent("e1");
    expect(tickets[0].validDayIds).toEqual(["fri"]);
    expect(selects).toHaveLength(1);
  });

  test("any other error still throws", async () => {
    results.push({ data: null, error: { code: "42501" } });
    await expect(fetchTicketsForEvent("e1")).rejects.toEqual({ code: "42501" });
  });
});
