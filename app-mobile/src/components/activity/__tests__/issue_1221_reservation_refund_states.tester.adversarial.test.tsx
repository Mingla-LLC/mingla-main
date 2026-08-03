import fs from "node:fs";
import path from "node:path";

declare const test: (name: string, body: () => void) => void;
declare const expect: (value: unknown) => {
  toContain(expected: unknown): void;
  not: { toContain(expected: unknown): void };
};

test("consumer cancellation never treats HTTP acceptance as refund success", () => {
  const calendar = fs.readFileSync(path.resolve(__dirname, "../CalendarTab.tsx"), "utf8");
  expect(calendar).toContain('result.refund?.buyer_state === "processed"');
  expect(calendar).not.toContain("refunded && amount");
  expect(calendar).not.toContain('reservation.fee_currency || "USD"');
});
