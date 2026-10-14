/**
 * #3720 Slice C / bug 11 — re-verify Host web sign-out stays local by default
 * (#3655). No product change in this slice; this pin keeps the contract visible
 * on the #3720 test surface.
 */

import * as fs from "node:fs";
import * as path from "node:path";

describe("#3720 Host web sign-out scope re-verify (bug 11)", () => {
  test("AuthContext defaults signOut scope to local", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "AuthContext.tsx"),
      "utf8",
    );
    expect(src).toContain('scope?: "local" | "global"');
    expect(src).toContain('options?.scope ?? "local"');
  });

  test("Account tab exposes Sign out and Sign out everywhere", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "app", "(tabs)", "account.tsx"),
      "utf8",
    );
    expect(src).toContain('handleSignOut("local")');
    expect(src).toContain('handleSignOut("global")');
    expect(src).toContain('label="Sign out everywhere"');
  });
});
