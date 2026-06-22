// @ts-nocheck — bundler-only harness entry (metro-resolved `__ORCH1207_SHEET__`
// virtual import + react-dom/client); not part of the app type surface.
/**
 * ORCH-1207 — real-Chromium harness ENTRY for the two SheetWeb fixes:
 *   Bug 1: the open panel must be effectively OPAQUE (page content behind it
 *          must NOT ghost through).
 *   Bug 2: a downward DRAG on the handle/header must dismiss the sheet.
 *
 * Renders the REAL `Sheet` (web variant SheetWeb) open over a BRIGHT magenta
 * full-screen page behind it, through react-native-web exactly like the deployed
 * business web. The Playwright spec loads the bundle in real Chromium, samples
 * the pixel behind the panel (proves opacity), reads the panel's computed
 * background-color alpha, and dispatches pointer events on the drag handle to
 * prove onClose fires past threshold + springs back below it.
 */
import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { createRoot } from "react-dom/client";

import { Sheet } from "__ORCH1207_SHEET__";

// A loud color behind the sheet — if ANY of it shows through the panel the pixel
// sample will read magenta-ish instead of the dark opaque sheet fill.
const PAGE_BEHIND = "#ff00ff";

function Harness(): React.ReactElement {
  const [open, setOpen] = useState<boolean>(true);
  const [closedCount, setClosedCount] = useState<number>(0);
  return (
    <View style={{ flex: 1, backgroundColor: PAGE_BEHIND }} testID="page-behind">
      {/* Loud text content behind the sheet — bleed-through would render it. */}
      <Text style={{ fontSize: 40, color: "#00ff00", padding: 20 }}>
        BEHIND-THE-SHEET-CONTENT-XYZ
      </Text>
      <Pressable testID="reopen" onPress={() => setOpen(true)}>
        <Text>open</Text>
      </Pressable>
      <Text testID="closed-count">{`closed:${closedCount}`}</Text>
      <Sheet
        visible={open}
        onClose={() => {
          setOpen(false);
          setClosedCount((c) => c + 1);
        }}
        snapPoint="half"
        testID="orch1207-sheet"
      >
        <View style={{ flex: 1 }} testID="sheet-content">
          <Text style={{ fontSize: 22, color: "#fff", marginBottom: 16 }}>New reservation</Text>
          <TextInput placeholder="Guest name" style={{ height: 44, marginBottom: 12, backgroundColor: "#222" }} />
          <TextInput placeholder="Party size" style={{ height: 44, marginBottom: 12, backgroundColor: "#222" }} />
          <Pressable
            // @ts-expect-error RNW forwards testID to data-testid
            testID="orch1207-cta"
            style={{ height: 52, backgroundColor: "#5b6cff", alignItems: "center", justifyContent: "center", borderRadius: 12 }}
          >
            <Text style={{ color: "#fff", fontSize: 17 }}>Save reservation</Text>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<Harness />);
}
