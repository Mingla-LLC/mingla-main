/** Issue #1447 — anonymous fragment-token RSVP pass recovery. */
import React, { Suspense, useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  fetchPublicRsvpPassMetadata,
  fetchPublicRsvpPassPdf,
} from "../../src/services/rsvpPassRecoveryService";
import { captureWeb } from "../../src/analytics/webAnalytics";
import { SafeScreen } from "../../src/components/ui/SafeScreen";

const QrCode = React.lazy(() => import("react-native-qrcode-svg"));
type PassData = Awaited<ReturnType<typeof fetchPublicRsvpPassMetadata>>;
interface RecoveryProof {
  entityType: "primary" | "guest";
  entityId: string;
  token: string;
}

export default function RsvpPassRecoveryRoute(): React.ReactElement {
  const [pass, setPass] = useState<PassData | null>(null);
  const [proof, setProof] = useState<RecoveryProof | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadPass = useCallback((): void => {
    if (typeof window === "undefined") return;
    setError(null);
    setPass(null);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const entityType = fragment.get("type");
    const entity = fragment.get("entity");
    const token = fragment.get("token");
    if ((entityType !== "primary" && entityType !== "guest") || !entity || !token) {
      setError("This RSVP invite link is incomplete."); return;
    }
    setProof({ entityType, entityId: entity, token });
    void fetchPublicRsvpPassMetadata(entityType, entity, token)
      .then((result) => {
        setPass(result);
        captureWeb("rsvp_pass_viewed", { surface: "anonymous_web_recovery" });
      })
      .catch(() => setError("This RSVP invite is no longer available."));
  }, []);
  useEffect(() => {
    if (typeof document !== "undefined") {
      const meta = document.createElement("meta");
      meta.name = "referrer";
      meta.content = "no-referrer";
      document.head.appendChild(meta);
      loadPass();
      return () => meta.remove();
    }
    loadPass();
  }, [loadPass]);
  const download = useCallback((): void => {
    if (!pass || !proof || typeof document === "undefined") return;
    const surface = "anonymous_web_recovery";
    captureWeb("rsvp_pass_pdf_requested", { surface });
    void fetchPublicRsvpPassPdf(proof.entityType, proof.entityId, proof.token)
      .then((pdf) => {
        const url = URL.createObjectURL(pdf.blob);
        const a = document.createElement("a"); a.href = url; a.download = pdf.filename;
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        captureWeb("rsvp_pass_pdf_result", { surface, outcome: "success" });
      })
      .catch(() => {
        captureWeb("rsvp_pass_pdf_result", { surface, outcome: "failure" });
        setError("Couldn't download this RSVP invite. Try again.");
      });
  }, [pass, proof]);
  return (
    <SafeScreen
      edges={["top", "bottom"]}
      style={styles.host}
      testID="issue-1447-rsvp-pass-recovery"
    >
      {/*
        #2211 — this region SCROLLS. `host` was `flex: 1` + `minHeight: 640` +
        `justifyContent: "center"` with no scroll container, wrapped around a
        card holding a NON-SHRINKABLE 220 pt QR plus brand, title, name, helper
        and a full-width download button. `minHeight: 640` guaranteed overflow
        on a 667 pt screen before the text scaled at all; at accessibility text
        sizes the button — the only way to save the pass — left the viewport
        with no gesture that recovered it.
      */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
      <View style={styles.card}>
        <Text style={styles.brand}>Mingla</Text>
        <Text style={styles.title}>Your RSVP invite</Text>
        {error ? <>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={loadPass} accessibilityRole="button" style={styles.button}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </> : pass ? (
          <>
            <View
              style={styles.qr}
              accessible
              accessibilityRole="image"
              accessibilityLabel={`RSVP QR code for ${pass.displayName}`}
            >
              <Suspense fallback={<ActivityIndicator color="#0c0e12" />}>
                <QrCode value={pass.qrCode ?? ""} size={220} />
              </Suspense>
            </View>
            <Text style={styles.name}>{pass.displayName}</Text>
            <Text style={styles.helper}>Show this QR code at the door.</Text>
            <Pressable onPress={download} accessibilityRole="button" style={styles.button}>
              <Text style={styles.buttonText}>Download RSVP invite PDF</Text>
            </Pressable>
          </>
        ) : <ActivityIndicator color="#ff6b2c" />}
      </View>
      </ScrollView>
    </SafeScreen>
  );
}
const styles = StyleSheet.create({
  // #2211 — `host` keeps only the frame. `minHeight: 640` is DELETED, not
  // moved: a hard floor taller than a 667 pt screen's safe area is exactly
  // what forced the overflow. Centring moved to `scrollContent`.
  host: { flex: 1, backgroundColor: "#0c0e12" },
  scroll: { flex: 1, overflow: "hidden" },
  // #2211 — EXPLICIT flexGrow (RN defaults content containers to 0).
  scrollContent: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 420, backgroundColor: "#15181f", borderRadius: 22, borderWidth: 1, borderColor: "rgba(255,255,255,.12)", padding: 24, alignItems: "center", gap: 14 },
  brand: { color: "#ff6b2c", fontSize: 24, fontWeight: "900" },
  title: { color: "#fff", fontSize: 22, fontWeight: "800" },
  qr: { backgroundColor: "#fff", borderRadius: 16, padding: 14 },
  name: { color: "#fff", fontSize: 16, fontWeight: "700" },
  helper: { color: "rgba(255,255,255,.62)", fontSize: 13 },
  error: { color: "#fff", fontSize: 15, lineHeight: 22, textAlign: "center" },
  button: { width: "100%", backgroundColor: "#ff6b2c", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#0c0e12", fontSize: 15, fontWeight: "900" },
});
