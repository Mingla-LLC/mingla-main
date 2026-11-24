/**
 * NATIVE ONLY (`.native.tsx`) — the screen behind /venue/[venueId]/check-in/scan (#4490 P2-5) — the venue door camera on the
 * native apps (`ph-scan`, `ph-scan-ok`, `ph-scan-id`, `ph-scan-wrong`,
 * `ph-sell`). Camera first, with the gate numbers under the frame; Type a
 * code and Sell at the gate are pinned. Results come up in a short sheet from
 * `venueCheckInResult`, with haptics. The permission gate and CameraView set-up
 * follow the event scanner; the check-in itself is the venue edge function.
 * The web build resolves `scan.web.tsx` instead (no camera dependency there).
 */
import React, { useCallback, useRef, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";

import { Button } from "../../../ui/Button";
import { Banner } from "../../../ui/Banner";
import { IconChrome } from "../../../ui/IconChrome";
import { Input } from "../../../ui/Input";
import { Sheet } from "../../../ui/Sheet";
import { SheetScrollLayout } from "../../../ui/SheetScrollLayout";
import { VenueGateSale } from "./VenueGateSale";
import { doorSaleEntry } from "./doorSaleEntry";
import {
  checkInResultView,
  doorErrorCopy,
  matchTypedCode,
  type CheckInAction,
} from "./venueCheckInResult";
import { color, radius, scrim, space, type } from "../../../../constants/designSystem";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useTillReleased } from "../../../../hooks/useTillReleased";
import { useVenueFeatures } from "../../../../hooks/useVenueFeatures";
import { useDoorAction, useVenueCheckIns } from "../../../../hooks/useVenueCheckIns";
import { useVenueDay } from "../../../../hooks/useVenueDay";
import { useVenueListing } from "../../../../hooks/useVenueListings";
import { useVenueOffers } from "../../../../hooks/useVenueOffers";
import { toVenueOfferError } from "../../../../services/venueOffersService";
import type { ScanOutcome } from "../../../../types/venueOffers";

function paramValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default function VenueCheckInScanScreen(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ venueId?: string | string[] }>();
  const venueId = paramValue(params.venueId);
  const venue = useVenueListing(venueId).data ?? null;
  const brandId = venue?.brandId ?? null;
  const currency = useBrandCurrency(brandId);
  // #4490 spec 08 §13: door sales work with or without the Till, by the one
  // switch (venueOrderEntry): Till off → the gate sale sheet as before O1;
  // Till on → the Till's Entry tab.
  const tillReleased = useTillReleased();
  const tillFeatureOn = useVenueFeatures(brandId, venueId).data?.features.till?.enabled === true;
  const doorSale = doorSaleEntry({ tillReleased, tillFeatureOn });
  // [TRANSITIONAL] the gate sale sheet while the Till is off; exits when every venue is on the Till.
  const [sale, setSale] = useState<{ open: boolean; offerId: string | null }>({ open: false, offerId: null });
  const sellAtDoor = (offerId: string | null): void => {
    if (doorSale === "gate_sale") {
      setSale({ open: true, offerId });
      return;
    }
    if (venueId === null) return;
    router.push(`/venue/${venueId}/till?tab=entry${offerId !== null ? `&offer=${offerId}` : ""}`);
  };
  const listQuery = useVenueCheckIns(brandId, venueId);
  const dayQuery = useVenueDay(brandId, venueId, null, { live: true });
  const offersQuery = useVenueOffers(brandId, venueId);
  const door = useDoorAction(brandId, venueId);
  const [permission, requestPermission] = useCameraPermissions();

  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [lastQr, setLastQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState("");
  const busy = useRef(false);
  const lastScan = useRef<{ value: string; at: number }>({ value: "", at: 0 });

  const liveOffers = (offersQuery.data?.offers ?? []).filter((o) => o.status === "live" && o.kind === "entry");
  const pool = dayQuery.data?.pools[0] ?? null;
  const admitted = dayQuery.data?.checkIn.admitted ?? 0;
  const timezone = listQuery.data?.timezone ?? dayQuery.data?.timezone;

  const run = useCallback(
    (action: Parameters<typeof door.mutate>[0]): void => {
      if (busy.current) return;
      busy.current = true;
      setError(null);
      door.mutate(action, {
        onSuccess: (o) => {
          setOutcome(o);
          const tone = checkInResultView(o, timezone).tone;
          void Haptics.notificationAsync(
            tone === "success"
              ? Haptics.NotificationFeedbackType.Success
              : tone === "danger"
                ? Haptics.NotificationFeedbackType.Error
                : Haptics.NotificationFeedbackType.Warning,
          ).catch(() => undefined);
        },
        onError: (e) => {
          const err = toVenueOfferError(e);
          setError(doorErrorCopy(err.code, err.detail));
        },
        onSettled: () => {
          busy.current = false;
        },
      });
    },
    [door, timezone],
  );

  const onScanned = useCallback(
    (result: BarcodeScanningResult): void => {
      if (outcome !== null || typing || sale.open) return;
      const now = Date.now();
      if (result.data === lastScan.current.value && now - lastScan.current.at < 3000) return;
      lastScan.current = { value: result.data, at: now };
      setLastQr(result.data);
      run({ kind: "scan", qrPayload: result.data });
    },
    [outcome, run, sale.open, typing],
  );

  const submitCode = (): void => {
    const match = matchTypedCode(code, listQuery.data?.passes ?? []);
    if (match.kind === "none") {
      setError("Type a code, a booking code like VB-1A2B, or a name.");
      return;
    }
    if (match.kind === "many") {
      setError(`${match.count} guests match. Type more of the name or the booking code.`);
      return;
    }
    setTyping(false);
    setCode("");
    if (match.kind === "qr") {
      setLastQr(match.payload);
      run({ kind: "scan", qrPayload: match.payload });
    } else {
      setLastQr(null);
      run({ kind: "admit", passId: match.pass.passId });
    }
  };

  const onAction = (action: CheckInAction): void => {
    if (outcome === null) return;
    if (action === "scan_next" || action === "close") {
      setOutcome(null);
      setError(null);
      return;
    }
    if (action === "undo" && outcome.logId !== null) {
      run({ kind: "undo", logId: outcome.logId });
      return;
    }
    if (action === "id_seen") {
      if (lastQr !== null) run({ kind: "scan", qrPayload: lastQr, idChecked: true });
      else if (outcome.pass !== null) run({ kind: "admit", passId: outcome.pass.passId, idChecked: true });
      return;
    }
    if (action === "sell_walk_in") {
      setOutcome(null);
      const walkIn = liveOffers.find((o) => o.entryStyle === "walk_in") ?? liveOffers[0] ?? null;
      sellAtDoor(walkIn?.id ?? null);
    }
  };

  const close = (): void => {
    if (router.canGoBack()) router.back();
    else if (venueId !== null) router.replace(`/venue/${venueId}?module=checkin` as never);
  };

  const view = outcome !== null ? checkInResultView(outcome, timezone) : null;
  const label = (a: CheckInAction): string =>
    a === "undo" ? "Undo" : a === "scan_next" ? "Scan next" : a === "id_seen" ? "ID seen · check in" : a === "sell_walk_in" ? "Sell walk-in entry" : "Close";

  return (
    <View style={styles.root} testID="venue-scan-screen">
      {permission?.granted === true ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={outcome === null ? onScanned : undefined}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.gate]}>
          <Text style={styles.gateTitle}>Scan passes with the camera</Text>
          <Text style={styles.gateBody}>
            {permission?.canAskAgain === false
              ? "Camera access is off for Mingla Host. Turn it on in Settings, or type the code."
              : "Allow the camera to scan guests' passes. You can also type the code."}
          </Text>
          {permission?.canAskAgain === false ? (
            <Button label="Open Settings" variant="primary" size="lg" onPress={() => void Linking.openSettings()} />
          ) : (
            <Button label="Allow camera" variant="primary" size="lg" onPress={() => void requestPermission()} />
          )}
        </View>
      )}

      <View style={[styles.top, { paddingTop: insets.top + space[2] }]}>
        <IconChrome icon="close" size={44} accessibilityLabel="Close the scanner" onPress={close} />
        <Text style={styles.topTitle} accessibilityRole="header">Scan a pass</Text>
        <View style={styles.topSpacer} />
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space[3] }]}>
        <Text style={styles.count}>
          {admitted} in{pool !== null ? ` · ${pool.walkInLeft} kept for walk-ins left` : ""}
        </Text>
        {error !== null && outcome === null ? <Banner tone="danger" title="That didn't go through" body={error} /> : null}
        <View style={styles.bar}>
          <View style={styles.grow}>
            <Button label="Type a code" variant="secondary" size="lg" fullWidth onPress={() => { setError(null); setTyping(true); }} testID="venue-scan-type" />
          </View>
          <View style={styles.grow}>
            <Button
              label="Sell at the gate"
              variant="secondary"
              size="lg"
              fullWidth
              onPress={() => sellAtDoor(null)}
              disabled={liveOffers.length === 0}
              testID="venue-scan-sell"
            />
          </View>
        </View>
      </View>

      <Sheet visible={view !== null} onClose={() => setOutcome(null)} snapPoint={0.55} testID="venue-scan-result">
        {view !== null ? (
          <View style={styles.sheetBody}>
            <SheetScrollLayout
              footer={
                <View style={styles.bar}>
                  {view.secondary !== null && !(view.secondary === "sell_walk_in" && liveOffers.length === 0) ? (
                    <View style={styles.grow}>
                      <Button label={label(view.secondary)} variant="secondary" size="lg" fullWidth onPress={() => onAction(view.secondary as CheckInAction)} disabled={door.isPending} />
                    </View>
                  ) : null}
                  <View style={styles.grow}>
                    <Button label={label(view.primary)} variant="primary" size="lg" fullWidth onPress={() => onAction(view.primary)} loading={door.isPending} />
                  </View>
                </View>
              }
            >
              <Text style={styles.resultTitle} accessibilityRole="header" accessibilityLiveRegion="assertive">{view.title}</Text>
              {view.subject !== null ? <Text style={styles.resultSubject}>{view.subject}</Text> : null}
              {view.body !== null ? (
                view.state === "needs_id" || view.state === "wrong_day" ? (
                  <Banner tone={view.tone === "danger" ? "danger" : "warning"} title={view.body} />
                ) : (
                  <Text style={styles.resultBody}>{view.body}</Text>
                )
              ) : null}
              {error !== null ? <Banner tone="danger" title="That didn't go through" body={error} /> : null}
            </SheetScrollLayout>
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={typing} onClose={() => setTyping(false)} snapPoint={0.5} testID="venue-scan-type-sheet">
        <View style={styles.sheetBody}>
          <SheetScrollLayout
            keyboardAware
            footer={<Button label="Check" variant="primary" size="lg" fullWidth onPress={submitCode} loading={door.isPending} />}
          >
            <Text style={styles.resultTitle}>Type a code</Text>
            <Text style={styles.resultBody}>The code under their QR, their booking code (VB-…) or their name.</Text>
            <Input value={code} onChangeText={setCode} placeholder="Code, booking code or name" accessibilityLabel="Pass code, booking code or name" autoFocus onSubmitEditing={submitCode} returnKeyType="go" />
            {error !== null ? <Text style={styles.error}>{error}</Text> : null}
          </SheetScrollLayout>
        </View>
      </Sheet>

      {/* [TRANSITIONAL] #4490 spec 08 §13: the gate sale sheet while the Till is off; exits when every venue is on the Till. */}
      <VenueGateSale
        visible={sale.open}
        onClose={() => setSale({ open: false, offerId: null })}
        brandId={brandId}
        venueId={venueId}
        offers={liveOffers}
        settings={offersQuery.data?.settings ?? null}
        currency={currency}
        walkInLine={pool !== null && pool.keptForWalkIns > 0 ? `${pool.walkInLeft} of the ${pool.keptForWalkIns} kept for walk-ins are left today.` : null}
        initialOfferId={sale.offerId}
        onSold={(result) => {
          if (result.method !== "pay_link") setSale({ open: false, offerId: null });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.ink },
  gate: { alignItems: "center", justifyContent: "center", gap: space[3], padding: space[6] },
  gateTitle: { ...type.h1, color: color.textOnPhoto, textAlign: "center" },
  gateBody: { ...type.body, color: color.textOnPhoto2, textAlign: "center" },
  top: { position: "absolute", left: 0, right: 0, top: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: space[4], gap: space[2] },
  topTitle: { ...type.h2, color: color.textOnPhoto, flex: 1, textAlign: "center" },
  topSpacer: { width: 44 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space[4], gap: space[3], backgroundColor: scrim.modal, paddingTop: space[3], borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  count: { ...type.body, color: color.textOnPhoto2, textAlign: "center" },
  bar: { flexDirection: "row", gap: space[2] },
  grow: { flex: 1 },
  sheetBody: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2] },
  resultTitle: { ...type.h1, color: color.text1 },
  resultSubject: { ...type.row, color: color.text1 },
  resultBody: { ...type.body, color: color.text2 },
  error: { ...type.caption, color: color.errorText },
});
