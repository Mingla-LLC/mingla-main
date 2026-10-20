// #2107 — web resolution of the native version gate (Host).
//
// Web has no installed binary, so there is no store version to enforce: the
// native gate already returned its children untouched when Platform.OS ===
// "web". But a Platform check at RUNTIME still ships the whole native module to
// the browser — the gate, its policy coordinator and the update telemetry —
// inside the EAGER boot chunk. Metro resolves `.web.tsx` ahead of `.tsx` for
// web builds, so this file is what the browser gets instead.
//
// KEEP THIS FILE FREE OF IMPORTS beyond React. Anything imported here lands in
// the boot payload of every web page load.
// Guarded by .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs.

import React from "react";

export type VersionForegroundEvent = {
  id: number;
  backgroundDurationMs: number;
};

export function MandatoryUpdateGate({
  children,
}: {
  children: React.ReactNode;
  foregroundEvent: VersionForegroundEvent | null;
  onRequiredChange: (required: boolean) => void;
  onForegroundCheckComplete: (eventId: number) => void;
}): React.ReactElement {
  return <>{children}</>;
}
