/**
 * AlertDialogHost — #4420. The root mount point for the web confirm that
 * `showAlert` raises (Alert.alert is a no-op on react-native-web).
 *
 * Mounted once at the app root (`app/_layout.tsx`, beside the root
 * ToastHost). It renders nothing, and loads nothing, until the first web
 * alert with choices; then it loads `showAlertWeb` (the queue + the shared
 * ConfirmDialog) on intent, so the dialog stays off the boot bundle. Native
 * never asks for it (showAlert calls Alert.alert there).
 */

import React, { Suspense } from "react";

import { useAlertHostWanted } from "./alertHost";

const LazyWebAlertLayer = React.lazy(() => import("./showAlertWeb"));

export const AlertDialogHost: React.FC = () => {
  const wanted = useAlertHostWanted();
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <LazyWebAlertLayer />
    </Suspense>
  );
};

export default AlertDialogHost;
