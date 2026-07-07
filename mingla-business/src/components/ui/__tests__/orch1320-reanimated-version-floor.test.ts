import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1320 [biz Account-tab Apple crash] — T-7 (adversarial angle: dependency regression).
 *
 * Distinct angle from T-1 (which guards the BottomNav SOURCE). The Account-tab
 * crash (Apple rejection 3, EXC_BAD_ACCESS SIGSEGV) was a use-after-free in the
 * react-native-reanimated worklets runtime racing the Fabric mount-commit. Fix B
 * bumped the durable root fix: reanimated -> 4.3.1 (contains the upstream
 * "fix registries race conditions" patch, GitHub tag/4.3.1, 2026-05-07) and its
 * required react-native-worklets -> 0.8.3. A silent downgrade back under the floor
 * would reintroduce the UAF class app-wide even if BottomNav stays de-worklet'd.
 *
 * Enforces I-1320-REANIMATED-WORKLETS-VERSION-FLOOR. FAILS on revert of Fix B
 * (reanimated < 4.3.1 or worklets < 0.8.0).
 */

const pkg = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "..", "..", "..", "..", "package.json"),
    "utf8",
  ),
) as { dependencies?: Record<string, string> };

/** Parse a semver range/pin ("4.3.1", "~4.3.1", "^4.3.1") into [major,minor,patch]. */
function parseFloor(spec: string): [number, number, number] {
  const m = spec.replace(/^[\^~>=\s]*/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`unparseable version spec: ${spec}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function gte(v: [number, number, number], floor: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (v[i] > floor[i]) return true;
    if (v[i] < floor[i]) return false;
  }
  return true;
}

describe("ORCH-1320 reanimated/worklets version floor (no UAF-class regression)", () => {
  const deps = pkg.dependencies ?? {};

  it("react-native-reanimated is pinned at or above 4.3.1 (the registry-race fix)", () => {
    expect(deps["react-native-reanimated"]).toBeDefined();
    expect(gte(parseFloor(deps["react-native-reanimated"]!), [4, 3, 1])).toBe(true);
  });

  it("react-native-worklets is pinned at or above 0.8.0 (reanimated 4.3.x peer)", () => {
    expect(deps["react-native-worklets"]).toBeDefined();
    expect(gte(parseFloor(deps["react-native-worklets"]!), [0, 8, 0])).toBe(true);
  });
});
