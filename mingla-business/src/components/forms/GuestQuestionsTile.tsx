/**
 * #4514 — the "Guest questions" tile on the event, experience, trip and RSVP
 * manage pages (after Guests / Spots / Travelers and before Orders; third row,
 * first cell on an RSVP). The existing ActionTile anatomy: icon, name and one
 * line; no badge, no chevron.
 *
 * States (Design v4): Not set up, "{n} to answer", "{n} answered", Closed,
 * Not published, Loading…, Unable to load. The full count is in the
 * accessibility label. Hidden for scanner roles; a marketing manager reads
 * the answers but cannot attach, so with no form on the page there is nothing
 * for them to do and the cell stays empty.
 *
 * This file (the data hook, the sheet, the state rules) is loaded on demand by
 * GuestQuestionsTileSlot, so none of it is in the eager web bundle.
 */

import React, { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import { useGuestQuestionsTileData } from "../../hooks/useBrandForms";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import {
  canAttachGuestQuestions,
  canReadGuestQuestions,
  tileAccessibilityLabel,
  tileLine,
  tileState,
  tileTarget,
  type GuestQuestionsPageKind,
  type TileData,
} from "../../utils/guestQuestionsModel";
import { ActionTile } from "../event/ActionTile";
import { modeLabel, TILE_COPY } from "./brandFormsCopy";
import { GuestQuestionsSheet } from "./GuestQuestionsSheet";

export interface GuestQuestionsTileProps {
  eventId: string;
  brandId: string;
  kind: GuestQuestionsPageKind;
  testID?: string;
}

export const GuestQuestionsTile: React.FC<GuestQuestionsTileProps> = ({
  eventId,
  brandId,
  kind,
  testID = "guest-questions-tile",
}) => {
  const router = useRouter();
  const role = useCurrentBrandRole(brandId);
  const readable = canReadGuestQuestions(role.rank);
  const query = useGuestQuestionsTileData(eventId, readable);
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);

  const data: TileData | undefined =
    query.data === undefined
      ? undefined
      : query.data === null
        ? null
        : {
            formName: query.data.form.name,
            formStatus: query.data.form.status,
            mode: query.data.attachment.mode,
            published: query.data.published,
            answered: query.data.answered,
            notAnswered: query.data.notAnswered,
          };
  const state = tileState({ isError: query.isError, data });
  const canAttach = canAttachGuestQuestions(role.rank);

  const handlePress = useCallback((): void => {
    const target = tileTarget(state);
    switch (target.to) {
      case "sheet":
        setSheetOpen(true);
        return;
      case "builder":
        if (query.data !== undefined && query.data !== null) {
          router.push(`/(tabs)/marketing/forms/${query.data.form.id}` as never);
        }
        return;
      case "responses":
        if (query.data !== undefined && query.data !== null) {
          router.push(
            `/(tabs)/marketing/forms/${query.data.form.id}/responses?eventId=${eventId}&tab=${target.tab}` as never,
          );
        }
        return;
      case "retry":
        void query.refetch();
        return;
      default: {
        const never: never = target;
        void never;
      }
    }
  }, [state, query, router, eventId]);

  // Scanners never see the tile (the page also keeps it out of the grid).
  if (!readable) return null;
  // A marketing manager cannot attach: with no form on the page there is no
  // tap that would do anything, so the cell stays empty (same width).
  if (state.kind === "none" && !canAttach) return <View style={styles.pad} />;

  const sub = tileLine(state);
  const mode = query.data?.attachment.mode ?? null;
  return (
    <>
      <ActionTile
        fill
        icon="list"
        label={TILE_COPY.label}
        sub={sub}
        accessibilityLabel={tileAccessibilityLabel(
          state,
          data,
          mode !== null ? modeLabel(mode, kind === "rsvp") : null,
        )}
        onPress={handlePress}
        testID={testID}
      />
      {sheetOpen ? (
        <GuestQuestionsSheet
          visible
          onClose={() => setSheetOpen(false)}
          brandId={brandId}
          eventId={eventId}
          kind={kind}
          current={query.data === undefined || query.data === null ? null : { attachment: query.data.attachment, form: query.data.form }}
        />
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  pad: { flexBasis: 0, flexGrow: 1 },
});

export default GuestQuestionsTile;
