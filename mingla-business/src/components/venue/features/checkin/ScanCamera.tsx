/**
 * #4490 P2-5 — camera scanning inside the Check-in panel. On the native apps
 * the camera is its own screen (`/venue/[venueId]/check-in/scan`, expo-camera),
 * so this panel-level camera is web only (ScanCamera.web.tsx). Native renders
 * nothing here and reports no in-panel camera.
 */
import type React from "react";

export interface ScanCameraProps {
  active: boolean;
  onCode: (payload: string) => void;
  onUnavailable?: (reason: "unsupported" | "denied" | "failed") => void;
  height?: number;
}

export function scanCameraSupported(): boolean {
  return false;
}

export function ScanCamera(_props: ScanCameraProps): React.ReactElement | null {
  return null;
}
