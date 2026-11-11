/**
 * #4389 P2 — Ari said "{brand} is set up" while its own setup card showed
 * 2 of 4. The words were the app-written State B greeting
 * (firstRunGreeting, #4304), which ignored brand_setup. Only a complete
 * brand_setup may be called "set up"; otherwise the brand "was created" and
 * the next step is named. AriChatScreen passes brand_setup.complete.
 *
 * FAILS ON REVERT: the unconditional "is set up" headline → T1/T2; the
 * screen not passing `setupComplete` → T3.
 */
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

import { firstRunGreeting } from "../firstRunState";

const base = { stage: "empty_brand" as const, displayName: "Tobi", brandName: "Wythe Hospitality", remembered: null };

describe("#4389 — Ari never claims setup is complete unless brand_setup is", () => {
  test("T1: incomplete (2 of 4) → created + what's next, never 'set up'", () => {
    const copy = firstRunGreeting({ ...base, setupComplete: false });
    expect(copy.headline).toBe("Wythe Hospitality was created. What are you hosting first?");
    expect(copy.body).toMatch(/^Next, finish setup to take payments\./);
    expect(`${copy.headline} ${copy.body}`).not.toMatch(/is set up/i);
  });

  test("T2: unknown (checklist not read yet) is treated as not complete", () => {
    expect(firstRunGreeting(base).headline).not.toMatch(/is set up/);
  });

  test("T3: complete → 'is set up'; the Ari screen passes brand_setup.complete", () => {
    expect(firstRunGreeting({ ...base, setupComplete: true }).headline).toBe(
      "Wythe Hospitality is set up. What are you hosting first?",
    );
    const screen = fs.readFileSync(path.join(__dirname, "../../screens/ari/AriChatScreen.tsx"), "utf8");
    expect(screen).toContain("setupComplete: setupData?.facts.complete === true");
  });
});
