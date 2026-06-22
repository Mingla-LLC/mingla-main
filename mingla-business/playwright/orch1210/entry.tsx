// @ts-nocheck — bundler-only harness entry (metro-resolved `__ORCH1210_TOPSHEET__`
// virtual import + react-dom/client); not part of the app type surface.
/**
 * ORCH-1210 — real-Chromium harness ENTRY for the TopSheetWeb swipe-UP-to-dismiss
 * fix. Renders the REAL `TopSheet` (web variant TopSheetWeb) open over a page,
 * through react-native-web exactly like the deployed business web. The Playwright
 * spec loads the bundle in real Chromium, reads the drag-catch computed
 * `touch-action` (must be `none`), and dispatches UPWARD pointer drags on the
 * drag-catch to prove onClose fires past threshold + springs back below it. Scrim
 * tap dismissal is also exercised.
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { createRoot } from "react-dom/client";

import { TopSheet } from "__ORCH1210_TOPSHEET__";

function Harness(): React.ReactElement {
  const [open, setOpen] = useState<boolean>(true);
  const [closedCount, setClosedCount] = useState<number>(0);
  return (
    <View style={{ flex: 1, backgroundColor: "#101216" }} testID="page-behind">
      <Text style={{ fontSize: 28, color: "#00ff00", padding: 20 }}>
        BEHIND-THE-TOPSHEET-CONTENT-XYZ
      </Text>
      <Pressable testID="reopen" onPress={() => setOpen(true)}>
        <Text style={{ color: "#fff" }}>open</Text>
      </Pressable>
      <Text testID="closed-count" style={{ color: "#fff" }}>{`closed:${closedCount}`}</Text>
      <TopSheet
        visible={open}
        onClose={() => {
          setOpen(false);
          setClosedCount((c) => c + 1);
        }}
        testID="orch1210-topsheet"
      >
        <View style={{ flex: 1 }} testID="topsheet-content">
          <Text style={{ fontSize: 22, color: "#fff", margin: 16 }}>Switch brand</Text>
          <Pressable
            // @ts-expect-error RNW forwards testID to data-testid
            testID="orch1210-row"
            style={{ height: 52, margin: 12, backgroundColor: "#222", justifyContent: "center", paddingLeft: 16 }}
          >
            <Text style={{ color: "#fff", fontSize: 17 }}>Brand A</Text>
          </Pressable>
        </View>
      </TopSheet>
    </View>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<Harness />);
}
