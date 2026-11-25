/**
 * #4490 P2-5 — web camera scanning for the Check-in panel, where the browser
 * can read QR codes (the BarcodeDetector API, e.g. Chrome on Android and
 * macOS). Where it can't, the panel keeps the type/paste code field, which
 * keyboard-wedge scanners type into. The camera stops when the panel closes.
 */
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";

export interface ScanCameraProps {
  active: boolean;
  onCode: (payload: string) => void;
  onUnavailable?: (reason: "unsupported" | "denied" | "failed") => void;
  height?: number;
}

interface DetectedCode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<DetectedCode[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

function detectorCtor(): BarcodeDetectorCtor | null {
  const g = globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return typeof g.BarcodeDetector === "function" ? g.BarcodeDetector : null;
}

export function scanCameraSupported(): boolean {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  return detectorCtor() !== null && typeof nav?.mediaDevices?.getUserMedia === "function";
}

export function ScanCamera({ active, onCode, onUnavailable, height = 260 }: ScanCameraProps): React.ReactElement | null {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<"starting" | "on" | "off">("starting");
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    if (!active) return undefined;
    const Ctor = detectorCtor();
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    if (Ctor === null || typeof nav?.mediaDevices?.getUserMedia !== "function") {
      setStatus("off");
      onUnavailableRef.current?.("unsupported");
      return undefined;
    }
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let lastValue = "";
    let lastAt = 0;
    const detector = new Ctor({ formats: ["qr_code"] });
    const tick = async (): Promise<void> => {
      if (stopped) return;
      const video = videoRef.current;
      if (video !== null && video.readyState >= 2) {
        try {
          const codes = await detector.detect(video);
          const value = codes[0]?.rawValue ?? "";
          const now = Date.now();
          // The same code held in front of the camera fires once every 3 s.
          if (value.length > 0 && (value !== lastValue || now - lastAt > 3000)) {
            lastValue = value;
            lastAt = now;
            onCodeRef.current(value);
          }
        } catch {
          // A frame the detector can't read: try the next one.
        }
      }
      timer = setTimeout(() => void tick(), 250);
    };
    void (async () => {
      try {
        stream = await nav.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (video !== null) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setStatus("on");
        void tick();
      } catch (error) {
        setStatus("off");
        const name = error !== null && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
        onUnavailableRef.current?.(name === "NotAllowedError" ? "denied" : "failed");
      }
    })();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active]);

  if (!active || status === "off") return null;
  return (
    <View style={[styles.frame, { height }]} testID="scan-camera">
      {React.createElement("video", {
        ref: videoRef,
        muted: true,
        playsInline: true,
        style: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
        "aria-label": "Camera. Hold the guest's pass in the frame.",
      })}
      {status === "starting" ? (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>Starting the camera…</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: color.ink,
  },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  overlayText: { ...type.small, color: color.textOnPhoto },
});
