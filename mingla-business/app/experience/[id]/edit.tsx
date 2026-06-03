/**
 * /experience/[id]/edit — status-based dispatch host. META-ORCH-1059 Sub-B.
 *
 * Loads the experience by id, then routes:
 *   - "draft" → ExperienceCreatorWizard in edit-mode (seeds title/stops/modes/
 *       pricing/when/cover from the loaded draft; Publish / Save-as-draft both
 *       call biz_publish_experience against the existing row).
 *   - "scheduled" | "live" → ExperienceCreatorWizard in LIVE-edit mode
 *       (META-ORCH-1059 Sub-E): shows the buyer-protection banner + required
 *       reason, runs the client refund-gate, and routes the single "Save
 *       changes" through biz_update_live_experience (NOT biz_publish_experience)
 *       so existing buyers stay protected (no price/date/capacity/stop regress).
 *   - "ended" | "cancelled" → read-only empty state + "Back to experience".
 *
 * Mirrors app/trip/[id]/edit.tsx's status dispatch.
 */

import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { Button } from "../../../src/components/ui/Button";
import {
  ExperienceCreatorWizard,
  type ExperienceWizardInitialDraft,
} from "../../../src/components/experience/ExperienceCreatorWizard";
import {
  newStopClientId,
  type ExperienceStopDraft,
} from "../../../src/components/experience/experienceWizardTypes";
import { useExperienceDetail } from "../../../src/hooks/useExperienceDetail";
import { useExperienceSoldCount } from "../../../src/hooks/useExperienceSoldCount";
import type { ExperienceDetail } from "../../../src/services/experienceDetailService";
import type { CoverPatch } from "../../../src/components/ui/CoverPicker";
import type {
  MultiDateEntry,
} from "../../../src/store/draftEventStore";

function centsToMajor(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "0.00";
  return (cents / 100).toFixed(2);
}

function isoToLocalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoToLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "00:00";
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

/** Map a loaded ExperienceDetail back into the wizard's edit-mode seed. */
function detailToInitialDraft(
  exp: ExperienceDetail,
): ExperienceWizardInitialDraft {
  const stops: ExperienceStopDraft[] = exp.stops.map((s) => ({
    clientId: newStopClientId(),
    placeId: s.placeId,
    placeName: s.placeName,
    address: s.address,
    city: s.city,
    region: s.region,
    countryCode: s.countryCode,
    lat: s.lat,
    lng: s.lng,
    imageUrls: s.imageUrls,
    startTime: s.startTime,
    priceMajor: centsToMajor(s.priceCents),
    description: s.description,
  }));

  // When seed. META-ORCH-1059 BUG 1 — PREFER the raw persisted When inputs
  // (theme.experience_meta.when_draft) so a DRAFT round-trips its date/time;
  // drafts have NO materialised event_dates, so the old dates-only path showed
  // a blank When. Fall back to event_dates for published rows (or pre-migration
  // drafts that have no when_draft).
  const wd = exp.whenDraft;
  const masterDate = exp.dates.find((d) => d.isMaster) ?? exp.dates[0] ?? null;
  let when: ExperienceWizardInitialDraft["when"];

  if (wd !== null && (wd.when !== null || wd.multiDates !== null || wd.recurrenceRule !== null)) {
    // Hydrate from the saved raw When.
    if (wd.whenMode === "multi_date") {
      const multiDates: MultiDateEntry[] = (wd.multiDates ?? []).map((d, i) => ({
        id: `wd_${i}`,
        date: d.date,
        startTime: d.startTime,
        endTime: d.endTime,
        overrides: {
          title: null,
          description: null,
          venueName: null,
          address: null,
          onlineUrl: null,
        },
      }));
      when = {
        whenMode: "multi_date",
        date: null,
        doorsOpen: null,
        endsAt: null,
        timezone: wd.timezone ?? exp.timezone,
        recurrenceRule: null,
        multiDates,
      };
    } else {
      when = {
        whenMode: wd.whenMode === "recurring" ? "recurring" : "single",
        date: wd.when?.date ?? null,
        doorsOpen: wd.when?.doorsOpen ?? null,
        endsAt: wd.when?.endsAt ?? null,
        timezone: wd.timezone ?? exp.timezone,
        recurrenceRule: wd.recurrenceRule,
        multiDates: null,
      };
    }
  } else if (exp.whenMode === "multi_date") {
    const multiDates: MultiDateEntry[] = exp.dates.map((d) => ({
      id: d.id,
      date: isoToLocalDate(d.startAt),
      startTime: isoToLocalTime(d.startAt),
      endTime: isoToLocalTime(d.endAt),
      overrides: {
        title: null,
        description: null,
        venueName: null,
        address: null,
        onlineUrl: null,
      },
    }));
    when = {
      whenMode: "multi_date",
      date: null,
      doorsOpen: null,
      endsAt: null,
      timezone: exp.timezone,
      recurrenceRule: null,
      multiDates,
    };
  } else {
    when = {
      whenMode: exp.whenMode === "recurring" ? "recurring" : "single",
      date: masterDate !== null ? isoToLocalDate(masterDate.startAt) : null,
      doorsOpen: masterDate !== null ? isoToLocalTime(masterDate.startAt) : null,
      endsAt: masterDate !== null ? isoToLocalTime(masterDate.endAt) : null,
      timezone: exp.timezone,
      recurrenceRule: exp.recurrenceRule,
      multiDates: null,
    };
  }

  return {
    title: exp.title,
    description: exp.description ?? "",
    intents: exp.experienceIntents,
    locationMode: exp.locationMode ?? "single",
    pricingMode: exp.pricingMode ?? "whole",
    stops,
    wholePriceMajor: centsToMajor(
      exp.pricingMode === "whole"
        ? exp.wholePriceCents ?? exp.ticket?.priceCents ?? 0
        : 0,
    ),
    isFree: exp.ticket?.isFree ?? false,
    capacity:
      exp.ticket === null || exp.ticket.isUnlimited || exp.ticket.quantityTotal === null
        ? "20"
        : String(exp.ticket.quantityTotal),
    unlimited: exp.ticket?.isUnlimited ?? false,
    pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
    when,
  };
}

export default function ExperienceEditRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;

  const detailQuery = useExperienceDetail(
    typeof eventId === "string" ? eventId : null,
  );
  const experience = detailQuery.data ?? null;

  // META-ORCH-1059 Sub-E — a scheduled/live experience routes through the
  // buyer-protection live-edit path (banner + reason + biz_update_live_experience).
  // Drafts keep the plain wizard flow. Load the confirmed sold count (same RPC
  // the server gate uses) only when this is a live experience.
  const isLive =
    experience !== null &&
    (experience.status === "scheduled" || experience.status === "live");
  const soldCountQuery = useExperienceSoldCount(
    typeof eventId === "string" ? eventId : null,
    isLive,
  );

  const initialDraft = useMemo<ExperienceWizardInitialDraft | null>(
    () => (experience !== null ? detailToInitialDraft(experience) : null),
    [experience],
  );

  const initialCover = useMemo<CoverPatch | undefined>(() => {
    if (experience === null) return undefined;
    return {
      coverMediaUrl: experience.coverMediaUrl,
      coverMediaType: experience.coverMediaType,
      coverMediaProvider: null,
      coverMediaSourceUrl: null,
      coverMediaCredit: null,
      coverMediaCreditUrl: null,
      coverMediaAlt: null,
    };
  }, [experience]);

  if (typeof eventId !== "string" || eventId.length === 0) {
    return (
      <SafeScreen style={styles.host}>
        <Text style={styles.title}>Experience not found</Text>
        <Text style={styles.body}>This experience link is missing or invalid.</Text>
      </SafeScreen>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <SafeScreen style={styles.host}>
        <ActivityIndicator />
        <Text style={styles.body}>Loading experience…</Text>
      </SafeScreen>
    );
  }

  if (detailQuery.isError) {
    return (
      <SafeScreen style={styles.host}>
        <Text style={styles.title}>Couldn&rsquo;t load experience</Text>
        <Text style={styles.body}>
          {detailQuery.error instanceof Error
            ? detailQuery.error.message
            : "Check your connection and try again."}
        </Text>
      </SafeScreen>
    );
  }

  if (experience === null || initialDraft === null) {
    return (
      <SafeScreen style={styles.host}>
        <Text style={styles.title}>Experience not found</Text>
        <Text style={styles.body}>
          This experience may have been deleted or you don&rsquo;t have access.
        </Text>
      </SafeScreen>
    );
  }

  if (experience.status === "ended" || experience.status === "cancelled") {
    return (
      <SafeScreen style={styles.host}>
        <Text style={styles.title}>
          {experience.status === "ended"
            ? "This experience has ended"
            : "This experience is cancelled"}
        </Text>
        <Text style={styles.body}>
          {experience.status === "ended"
            ? "Edits aren't allowed after an experience ends — buyer records stay frozen for accuracy."
            : "Edits aren't allowed once an experience is cancelled."}
        </Text>
        <Button
          label="Back to experience"
          variant="primary"
          size="md"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace(`/experience/${experience.id}` as never);
          }}
          accessibilityLabel="Back to experience"
          testID="experience-edit-readonly-back"
        />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen style={styles.editHost}>
      <ExperienceCreatorWizard
        brandId={experience.brandId}
        existingExperienceId={experience.id}
        initialDraft={initialDraft}
        initialCover={initialCover}
        liveExperience={isLive ? experience : undefined}
        liveSoldCount={isLive ? soldCountQuery.data ?? 0 : undefined}
        onComplete={(id) => router.replace(`/experience/${id}` as never)}
        onCancel={() => {
          if (router.canGoBack()) router.back();
          else router.replace(`/experience/${experience.id}` as never);
        }}
      />
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: canvas.discover,
  },
  editHost: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
});
