/**
 * #4490 — the full-screen Host venue routes' screens, inside the Host venue
 * owner (venueHostScreens.ts). Each route file under app/venue/[venueId]/ is a
 * thin shell that reads its params and renders the matching screen through
 * LazyVenueHostRoutes.tsx, so the Till, Close the day, Kitchen and bar,
 * Selling in person and the offer editors ship in the one Host venue chunk
 * instead of each route chunk (which put everything they share into the
 * eager web `__common` chunk). Opaque ids only in the address.
 */
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useNavigation, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DayCloseGate } from "../close/DayCloseGate";
import { EntryEditor } from "../features/offers/EntryEditor";
import { HireEditor } from "../features/offers/HireEditor";
import { HourEditor } from "../features/offers/HourEditor";
import { PackageEditor } from "../features/offers/PackageEditor";
import { StationScreen } from "../station/StationScreen";
import { parseStationChoice } from "../station/stationModel";
import { TillGate } from "../till/TillGate";
import { TillSettingsScreen } from "../till/TillSettingsScreen";
import { tillPrefillFrom, tillUuid } from "../till/tillModel";
import type { VenueModuleLeaveHandle } from "../venueLeaveContract";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { color } from "../../../constants/designSystem";
import { useVenueListing } from "../../../hooks/useVenueListings";
import type { VenueHostRouteProps } from "./venueHostRouteProps";

/**
 * /venue/[venueId]/till (spec 08 O1). Optional params (opaque ids only):
 * `tab=entry`, `offer`, `option`, `count`, `entry` (a guest-list name sold at
 * the reduced price, spec 07 §11 B3); `checks=1` opens on Open checks.
 * A Till device login opens on "Who's selling?" (TillGate, O5); `signout=1`
 * opens on the device sign-out step (O5 part B).
 */
export function VenueTillRouteScreen({ params }: VenueHostRouteProps): React.ReactElement | null {
  const venueId = tillUuid(params.venueId);
  if (venueId === null) return null;
  const checks = Array.isArray(params.checks) ? params.checks[0] : params.checks;
  const signout = Array.isArray(params.signout) ? params.signout[0] : params.signout;
  return <TillGate venueId={venueId} prefill={tillPrefillFrom(params)} openChecksOnStart={checks === "1"}
    startSigningOut={signout === "1"} />;
}

/** /venue/[venueId]/close (spec 08 O5 part B): a Till device login switches someone in first. */
export function VenueDayCloseRouteScreen({ params }: VenueHostRouteProps): React.ReactElement | null {
  const venueId = tillUuid(params.venueId);
  if (venueId === null) return null;
  return <DayCloseGate venueId={venueId} />;
}

/** /venue/[venueId]/till-settings (spec 08 O5 part B): Settings › Selling in person. */
export function VenueTillSettingsRouteScreen({ params }: VenueHostRouteProps): React.ReactElement | null {
  const venueId = tillUuid(params.venueId);
  if (venueId === null) return null;
  return <TillSettingsScreen venueId={venueId} />;
}

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * /venue/[venueId]/station/[station] (spec 08 O3), station = kitchen | bar | all.
 * `started=1` (set by Start service) keeps the board after a reload; the
 * browser then needs a tap for sound (spec 08 §11 T17).
 */
export function VenueStationRouteScreen({ params }: VenueHostRouteProps): React.ReactElement | null {
  const venueId = tillUuid(params.venueId);
  if (venueId === null) return null;
  const station = parseStationChoice(first(params.station)) ?? "kitchen";
  return <StationScreen venueId={venueId} initialStation={station} startedOnLoad={first(params.started) === "1"} />;
}

/**
 * /venue/[venueId]/offer/[offerId] (#4490 P2-4) — the offer editor as a pushed
 * screen on the native apps (`new` = a new Entry offer). On web the Offers
 * module opens the same editor in place, so this route is the phone app's path
 * and a deep link. Leaving with unsaved changes asks first.
 */
function paramValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function VenueOfferEditorRouteScreen({ params }: VenueHostRouteProps): React.ReactElement {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  // #4490 P3 — `?kind=group_package` opens the group package editor.
  const isPackage = paramValue(params.kind) === "group_package";
  // #4490 P4 — `?kind=private_hire` opens the private hire editor.
  const isHire = paramValue(params.kind) === "private_hire";
  // #4490 P5 — `?kind=by_the_hour` opens the By the hour editor.
  const isHour = paramValue(params.kind) === "by_the_hour";
  const venueId = paramValue(params.venueId);
  const rawOffer = paramValue(params.offerId);
  const offerId = rawOffer === null || rawOffer === "new" ? null : rawOffer;
  const venue = useVenueListing(venueId).data ?? null;
  const editorRef = useRef<VenueModuleLeaveHandle | null>(null);
  const allowLeave = useRef(false);
  const [pending, setPending] = useState<{ action: unknown } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove" as never, (raw: unknown) => {
      if (allowLeave.current || editorRef.current?.isDirty() !== true) return;
      const event = raw as { preventDefault: () => void; data: { action: unknown } };
      event.preventDefault();
      setError(null);
      setPending({ action: event.data.action });
    });
    return unsubscribe;
  }, [navigation]);

  const leave = (): void => {
    allowLeave.current = true;
    if (router.canGoBack()) router.back();
    else if (venueId !== null) router.replace(`/venue/${venueId}?module=offers` as never);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {isHour ? (
        <HourEditor
          ref={editorRef}
          brandId={venue?.brandId ?? null}
          venueId={venueId}
          venueName={venue?.name ?? "your venue"}
          offerId={offerId}
          onOpenSpaces={venueId !== null ? () => router.push(`/venue/${venueId}?module=spaces` as never) : undefined}
          onClose={() => {
            if (editorRef.current?.isDirty() === true) {
              setPending({ action: null });
              return;
            }
            leave();
          }}
        />
      ) : isHire ? (
        <HireEditor
          ref={editorRef}
          brandId={venue?.brandId ?? null}
          venueId={venueId}
          venueName={venue?.name ?? "your venue"}
          offerId={offerId}
          onOpenPayments={venue?.brandId ? () => router.push(`/brand/${venue.brandId}/payments` as never) : undefined}
          onOpenSpaces={venueId !== null ? () => router.push(`/venue/${venueId}?module=spaces` as never) : undefined}
          onClose={() => {
            if (editorRef.current?.isDirty() === true) {
              setPending({ action: null });
              return;
            }
            leave();
          }}
        />
      ) : isPackage ? (
        <PackageEditor
          ref={editorRef}
          brandId={venue?.brandId ?? null}
          venueId={venueId}
          venueName={venue?.name ?? "your venue"}
          offerId={offerId}
          onOpenPayments={venue?.brandId ? () => router.push(`/brand/${venue.brandId}/payments` as never) : undefined}
          onClose={() => {
            if (editorRef.current?.isDirty() === true) {
              setPending({ action: null });
              return;
            }
            leave();
          }}
        />
      ) : (
        <EntryEditor
          ref={editorRef}
          brandId={venue?.brandId ?? null}
          venueId={venueId}
          venueName={venue?.name ?? "your venue"}
          offerId={offerId}
          onClose={() => {
            if (editorRef.current?.isDirty() === true) {
              setPending({ action: null });
              return;
            }
            leave();
          }}
        />
      )}
      {pending !== null ? (
        <ConfirmDialog
          visible
          variant="leave"
          title="Save your offer changes?"
          description="You changed this step. If you leave without saving, those changes are gone."
          onClose={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            leave();
          }}
          onDiscard={() => {
            editorRef.current?.discard();
            setPending(null);
            leave();
          }}
          onSave={async () => {
            setSaving(true);
            try {
              await editorRef.current?.save();
              setPending(null);
              leave();
            } catch {
              setError("Couldn't save your changes. They're still here, so try again.");
            } finally {
              setSaving(false);
            }
          }}
          saveDisabled={editorRef.current?.isValid() === false}
          confirmLoading={saving}
          errorMessage={error}
          testID="offer-route-leave"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
});
