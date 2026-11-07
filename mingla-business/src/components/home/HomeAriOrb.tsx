/**
 * #4304 — the Ari orb for Home: the same animated three-ring AriOrb as Ari's
 * own screen, loaded after first paint so reanimated stays out of Home's boot
 * path. Until then — or wherever its runtime cannot load (Home's render
 * suites) — a still mark with AriOrb's exact geometry and colours shows.
 *
 * Its own file with no text input, so components that only need the orb (the
 * empty-Recent prompt, which scrolls with Home) do not import a TextInput
 * through it (ORCH-0892 / #1841 keyboard gate follows imports).
 */

import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

const ORB_GEOMETRY = { sm: { orb: 24, halo: 3 }, md: { orb: 32, halo: 4 } } as const;
export type HomeAriOrbSize = keyof typeof ORB_GEOMETRY;

function StaticAriMark({ size = "sm" }: { size?: HomeAriOrbSize }): React.ReactElement {
  const { orb, halo } = ORB_GEOMETRY[size];
  return (
    <View
      style={[mark.host, { width: orb, height: orb }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          mark.outer,
          { top: -halo, left: -halo, width: orb + halo * 2, height: orb + halo * 2, borderRadius: (orb + halo * 2) / 2 },
        ]}
      />
      <View style={[mark.middle, { width: orb, height: orb, borderRadius: orb / 2 }]} />
      <View style={[mark.core, { width: orb * 0.46, height: orb * 0.46, borderRadius: orb * 0.23 }]} />
    </View>
  );
}

type AriOrbComponent = typeof import("../ari/AriOrb").AriOrb;

/** #4304 — the same animated three-ring orb as Ari's own screen, loaded after
 *  first paint so reanimated stays out of Home's boot path. Until then — or
 *  wherever its runtime cannot load (Home's render suites) — the still mark,
 *  identical at rest, stays. */
export function HomeAriOrb({ size = "sm" }: { size?: HomeAriOrbSize }): React.ReactElement {
  const [Orb, setOrb] = useState<AriOrbComponent | null>(null);
  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("../ari/AriOrb") as typeof import("../ari/AriOrb");
      setOrb(() => mod.AriOrb);
    } catch {
      // Keep the still mark.
    }
  }, []);
  return Orb ? <Orb size={size} decorative /> : <StaticAriMark size={size} />;
}

const mark = StyleSheet.create({
  host: { alignItems: "center", justifyContent: "center" },
  outer: { position: "absolute", borderWidth: 1.5, borderColor: "#f07a3d" },
  middle: { position: "absolute", borderWidth: 2, borderColor: "#f07a3d" },
  core: { position: "absolute", borderWidth: 1, borderColor: "#ffb07c", backgroundColor: "#f07a3d" },
});
