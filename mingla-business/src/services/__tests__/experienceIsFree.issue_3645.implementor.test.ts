/**
 * issue #3645 bundle 2C — the Host reads the host's paid/free choice, the
 * same rule as the server's issue_3645_experience_is_free and Ari's flow row
 * (supabase/functions/_shared/__tests__/issue_3645_paid_free_choice
 * .implementor.test.ts, same case table): a priced option means paid; else
 * the stored choice; else the first option (rows saved before the choice).
 */
import * as fs from "fs";
import * as path from "path";

jest.mock("../supabase", () => ({ supabase: {} }));

// eslint-disable-next-line import/first
import { experienceIsFree } from "../experienceDetailService";

const free = { priceCents: 0, isFree: true };
const paid = { priceCents: 500_000, isFree: false };

describe("issue #3645 2C — experienceIsFree", () => {
  const cases: Array<[string, unknown, typeof free[], number | null, boolean]> = [
    ["a paid draft saved at 0 stays paid", false, [free], 0, false],
    ["an explicit free choice is free", true, [free], 0, true],
    ["a priced option beats a stale free choice", true, [paid], 500_000, false],
    ["free first + paid second is paid", true, [free, paid], 500_000, false],
    ["legacy: no stored choice, free ticket", undefined, [free], 0, true],
    ["legacy: no stored choice, priced ticket", undefined, [paid], 500_000, false],
    ["legacy: no stored choice, no ticket, whole 0", undefined, [], 0, true],
    // A stored choice that is not a boolean is ignored (both directions).
    ["a non-boolean \"false\" is ignored (free ticket reads free)", "false", [free], 0, true],
    ["a non-boolean \"true\" is ignored (no ticket, whole priced)", "true", [], 500_000, false],
  ];
  test.each(cases)("%s", (_name, stored, tickets, whole, want) => {
    expect(experienceIsFree(stored, tickets, whole)).toBe(want);
  });

  test("the detail read and the edit screen use it, not the first option", () => {
    const service = fs.readFileSync(
      path.join(__dirname, "..", "experienceDetailService.ts"),
      "utf8",
    );
    expect(service).toMatch(
      /isFree: experienceIsFree\(meta\.is_free, tickets, raw\.whole_price_cents\)/,
    );
    const edit = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "app", "experience", "[id]", "edit.tsx"),
      "utf8",
    );
    expect(edit).toMatch(/isFree: exp\.isFree \?\? exp\.ticket\?\.isFree \?\? false,/);
  });
});
