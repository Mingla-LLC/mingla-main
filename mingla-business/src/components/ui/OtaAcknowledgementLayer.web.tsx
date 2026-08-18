// #2107 — web resolution of the OTA acknowledgement layer.
//
// Web has no installed binary and no OTA: the native layer already returns its
// children untouched when Platform.OS === "web". But a Platform check at RUNTIME
// still ships the whole module to the browser — the native layer, its policy
// core, and expo-updates — inside the EAGER `__common` boot chunk. Measured on
// #2107: 3,761 B added, against #2099's 1,024 B ceiling.
//
// Metro resolves `.web.tsx` ahead of `.tsx` for web builds, so this file is what
// the browser gets and none of the native module graph is reachable from it.
//
// KEEP THIS FILE FREE OF IMPORTS beyond React. Anything imported here lands in
// the boot payload of every business-web page load.
// Guarded by .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs.

import React from "react";

export function OtaAcknowledgementLayer({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
