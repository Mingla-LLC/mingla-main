// @ts-nocheck — bundler-only harness entry (metro-resolved `__ORCH1197_SHEET__`
// virtual import + react-dom/client); not part of the app type surface.
/**
 * ORCH-1197 — real-Chromium reproduction harness ENTRY (client render).
 *
 * Mounts the REAL `Sheet` (web variant SheetWeb) open with realistic form content
 * and a bottom CTA, through react-native-web, exactly like the deployed business
 * web. The Playwright spec loads the bundle in real Chromium at an iPhone-Safari
 * viewport and measures the panel bottom Y vs the visible viewport. Not shipped.
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Pressable, Text, TextInput, View } from "react-native";

import { Sheet } from "__ORCH1197_SHEET__";

function Harness(): React.ReactElement {
  const [open, setOpen] = useState<boolean>(true);
  return (
    <View style={{ flex: 1 }}>
      <Pressable testID="reopen" onPress={() => setOpen(true)}>
        <Text>open</Text>
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} snapPoint="full" testID="orch1197-sheet">
        <View style={{ flex: 1 }} testID="sheet-content">
          <Text style={{ fontSize: 22, color: "#fff", marginBottom: 16 }}>New reservation</Text>
          <TextInput placeholder="Guest name" style={{ height: 44, marginBottom: 12, backgroundColor: "#222" }} />
          <TextInput placeholder="Party size" style={{ height: 44, marginBottom: 12, backgroundColor: "#222" }} />
          <TextInput placeholder="Phone" style={{ height: 44, marginBottom: 12, backgroundColor: "#222" }} />
          <TextInput placeholder="Notes" style={{ height: 44, marginBottom: 12, backgroundColor: "#222" }} />
          <Pressable
            // @ts-expect-error RNW forwards testID to data-testid
            testID="orch1197-cta"
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
