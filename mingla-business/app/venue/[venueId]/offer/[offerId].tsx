/**
 * /venue/[venueId]/offer/[offerId] (#4490 P2-4) — the offer editor as a
 * pushed screen on the native apps (`new` = a new Entry offer). On web the
 * Offers module opens the same editor in place, so this route is the phone
 * app's path and a deep link. Leaving with unsaved changes asks first.
 */
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EntryEditor } from "../../../../src/components/venue/features/offers/EntryEditor";
import type { VenueModuleLeaveHandle } from "../../../../src/components/venue/venueLeaveContract";
import { ConfirmDialog } from "../../../../src/components/ui/ConfirmDialog";
import { color } from "../../../../src/constants/designSystem";
import { useVenueListing } from "../../../../src/hooks/useVenueListings";

function paramValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default function VenueOfferEditorRoute(): React.ReactElement {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ venueId?: string | string[]; offerId?: string | string[] }>();
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
