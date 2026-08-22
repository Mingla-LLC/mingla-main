import React from "react";
// This repository intentionally does not install @types/react-dom; the runtime
// package is present and this browser-only regression harness uses its real API.
// @ts-expect-error -- react-dom/client has no declaration in this workspace.
import { createRoot } from "react-dom/client";
import { MultiDateDayChooser } from "../../src/components/event/MultiDateDayChooser";
import { Toast } from "../../src/components/ui/Toast";

const palette = {
  page: "#101010", card: "#181818", panel: "#181818", panelStrong: "#202020",
  panelBorder: "#444444", cutoutBorder: "#555555", glass: "#181818",
  glassTint: "dark" as const,
  primaryText: "#ffffff", secondaryText: "#cccccc", tertiaryText: "#aaaaaa",
  accent: "#eb7825", accentText: "#111111", accentWash: "#2f2420",
  heroOverlay: "transparent", mapTint: "transparent",
};

function Harness(): React.ReactElement {
  const [selected, setSelected] = React.useState<readonly string[]>([]);
  const [notice, setNotice] = React.useState(false);
  const revealFirstDay = (): void => {
    document.getElementById("issue-2160-day-row-earlier")?.focus();
  };
  return (
    <>
      <MultiDateDayChooser
        timezone="America/New_York"
        palette={palette}
        occurrences={[
          { id: "later", startAt: "2026-08-30T17:00:00.000Z", endAt: "2026-08-30T20:00:00.000Z", timezone: "America/New_York", isMaster: false, ticketsRemaining: null },
          { id: "earlier", startAt: "2026-08-29T17:00:00.000Z", endAt: "2026-08-29T20:00:00.000Z", timezone: "America/New_York", isMaster: true, ticketsRemaining: null },
        ].sort((a, b) => a.startAt.localeCompare(b.startAt))}
        selectedOccurrenceIds={selected}
        pricingMode="per_day"
        isPaid
        highlightUnchosen={notice}
        onToggle={(id) => setSelected((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id])}
      />
      <button
        id="blocked-checkout"
        onClick={() => setNotice(true)}
      >
        Continue
      </button>
      <Toast
        visible={notice}
        kind="info"
        message="Choose at least one day you're attending."
        onDismiss={() => setNotice(false)}
        autoDismissMs={null}
        preservePageFocusOnWeb
        onPresented={revealFirstDay}
        testID="issue-2399-focus-toast"
      />
    </>
  );
}

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(<Harness />);
}
