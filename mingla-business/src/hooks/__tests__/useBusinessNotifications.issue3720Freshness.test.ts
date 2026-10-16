/**
 * #3720 — push + bell sync regression contract.
 *
 * A notification row is committed before push provider I/O, but an INSERT can
 * occur while Host is suspended or before the auth-gated Realtime subscription
 * starts. The query must therefore read authoritatively on mount and foreground
 * instead of trusting a fresh-but-missed cache entry.
 */

import fs from "node:fs";
import path from "node:path";

describe("#3720 business inbox freshness", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../useBusinessNotifications.ts"),
    "utf8",
  );

  test("mount and foreground always recover missed Realtime inserts", () => {
    expect(source).toMatch(/staleTime:\s*0/);
    expect(source).toMatch(/refetchOnMount:\s*["']always["']/);
    expect(source).toMatch(/refetchOnWindowFocus:\s*["']always["']/);
  });
});
