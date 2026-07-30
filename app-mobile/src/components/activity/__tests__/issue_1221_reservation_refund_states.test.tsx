import fs from "node:fs";
import path from "node:path";

declare const test: (name: string, body: () => void) => void;
declare const expect: (value: unknown) => {
  toContain(expected: unknown): void;
};

const root = path.resolve(__dirname, "..");
test("consumer Calendar renders all durable refund states and exact currency", () => {
  const status = fs.readFileSync(
    path.join(root, "ReservationRefundStatus.tsx"),
    "utf8",
  );
  const calendar = fs.readFileSync(path.join(root, "CalendarTab.tsx"), "utf8");
  for (
    const state of [
      "queued",
      "provider_pending",
      "needs_attention",
      "processed",
      "failed_retryable",
      "failed_terminal",
    ]
  ) {
    expect(status).toContain(state);
  }
  expect(calendar).toContain("result.refund.currency");
  expect(calendar).toContain("SourceRefundAttentionSheet");
  const sheet = fs.readFileSync(
    path.join(root, "SourceRefundAttentionSheet.tsx"),
    "utf8",
  );
  expect(sheet).toContain(
    "We couldn&apos;t confirm the text was sent. Your refund still needs",
  );
  expect(sheet).toContain("Continue here or contact Mingla Support.");
});
