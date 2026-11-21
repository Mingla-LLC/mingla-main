/* eslint-disable import/first */
import { describe, expect, jest, test } from "@jest/globals";

const mockInvoke = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>
>();

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

import { parseDoorAnswers, scanRsvp } from "../scanRsvpService";

const good = { state: "answered", header: "Dietary", lines: ["Vegan"], fullAnswers: true };

describe("#4541 door answers parser", () => {
  test("a well-formed payload passes through", () => {
    expect(parseDoorAnswers(good)).toEqual(good);
    expect(parseDoorAnswers({ ...good, header: undefined })?.header).toBeNull();
  });

  test.each([
    ["null", null],
    ["array", []],
    ["string", "x"],
    ["bad state", { ...good, state: "nope" }],
    ["lines not an array", { ...good, lines: "Vegan" }],
    ["lines with a non-string", { ...good, lines: ["a", 2] }],
    ["bad header", { ...good, header: 5 }],
    ["fullAnswers not boolean", { ...good, fullAnswers: "yes" }],
  ])("malformed (%s) becomes null", (_name, value) => {
    expect(parseDoorAnswers(value)).toBeNull();
  });

  test("a bad doorAnswers never breaks an admitted scan result", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { result: "success", scanId: "s1", doorAnswers: { lines: 3 } },
      error: null,
    });
    const out = await scanRsvp("e1", "qr");
    expect(out.result).toBe("success");
    expect(out.doorAnswers).toBeNull();
  });
});
