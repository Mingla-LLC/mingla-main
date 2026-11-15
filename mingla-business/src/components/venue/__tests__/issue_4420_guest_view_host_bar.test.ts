/**
 * #4420 (round-3 item 18) — the "Guest view · Back to Mingla Host" bar on the
 * two guest pages. Chrome only: shown for a stored host session, loaded
 * lazily, and the anon-tolerant routes still call no auth hook.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../..");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
const routes = ["app/reserve/[brandId]/index.tsx", "app/o/venue/[orderId].tsx"];

describe("#4420 guest view host bar", () => {
  test.each(routes)("%s shows the bar only for a host session, lazily, with no auth hook", (rel) => {
    const src = read(rel);
    expect(src).toMatch(/const hostViewer = useSignedInHostViewer\(\);/);
    expect(src).toMatch(/\{hostViewer \? \(/);
    expect(src).toMatch(/React\.lazy\(\(\) =>\s*import\("\.\.\/\.\.\/\.\.\/src\/components\/venue\/GuestViewHostBar"\)/);
    expect(src).not.toMatch(/\buseAuth\w*\s*\(/);
    expect(src).not.toMatch(/from\s+["'][^"']*AuthContext["']/);
  });

  test("the session read uses the stored session, not AuthContext", () => {
    const src = read("src/components/venue/guestViewHostSession.ts");
    expect(src).toContain("supabase.auth.getSession()");
    expect(src).not.toMatch(/from\s+["'][^"']*AuthContext["']/);
    expect(src).not.toMatch(/\buseAuth\w*\s*\(/);
  });

  test("the bar says Guest view and returns to Mingla Host home", () => {
    const src = read("src/components/venue/GuestViewHostBar.tsx");
    expect(src).toContain(">Guest view<");
    expect(src).toContain(">Back to Mingla Host<");
    expect(src).toContain('router.replace("/(tabs)/home" as never)');
  });
});
