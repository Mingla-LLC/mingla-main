/**
 * #4347 wave 3 — one stop of the expanded plan, as a card with its photos
 * visible straight away (it replaces StopList's tap-to-open rows for plans).
 *
 *   photo pager   segment bars; the left / right thirds flip photos, the middle
 *                 opens the lightbox on this stop's photos; "Stop N" on it
 *   name          + what it is for, "N min here", and Optional / Shop /
 *                 Customised tags
 *   chips         open / closes / closed AT ARRIVAL, the forecast at the
 *                 arrival hour, "Usually … then", sunset (outdoor, near it)
 *   actions       Directions (by coordinates), Swap stop, More (address, the
 *                 week's hours with today marked, Call, Website)
 *
 * Motion (motionTokens): cards rise 12pt and fade in, 60ms apart; a swapped-in
 * card slides in while the old one fades out (280ms); More grows the card
 * (220ms) on iPhone and Android alike; a navigator jump pulses the card. Under
 * Reduce Motion every one of these is instant.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { FadeOut, LinearTransition } from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { PLAN_SHEET, SPINE } from './spineTokens';
import { PLAN_MOTION } from './motionTokens';
import { useEnterStyle, usePulseStyle } from './planMotion';
import { PhotoPagerBars } from '../deckCard/DeckCardChrome';
import { stepPhotoIndex } from '../deckCard/deckCardModel';

export type StopChipTone = 'neutral' | 'open' | 'warn' | 'closed';

export interface StopChip {
  readonly key: string;
  readonly label: string;
  readonly tone: StopChipTone;
}

export interface StopMore {
  readonly address: string | null;
  /** The week's hours, one line per day. */
  readonly hours: readonly string[];
  /** The line for today, highlighted. */
  readonly todayPrefix: string | null;
  readonly description: string | null;
  readonly phone: { readonly display: string } | null;
  readonly website: string | null;
}

export interface PlanStopCardProps {
  readonly index: number;
  readonly ordinal: number | null;
  readonly name: string;
  readonly purpose: string | null;
  readonly dwell: string | null;
  readonly photos: readonly string[];
  readonly tags: readonly string[];
  readonly chips: readonly StopChip[];
  readonly more: StopMore;
  readonly onDirections: () => void;
  readonly onSwap: (() => void) | null;
  readonly onCall?: () => void;
  readonly onWebsite?: () => void;
  readonly onOpenPhotos: (photoIndex: number) => void;
  /** The alternatives grid while this stop is being swapped. */
  readonly swapPanel?: React.ReactNode;
  readonly reducedMotion: boolean;
  /** True for the card that just replaced a swapped-out stop. */
  readonly swappedIn?: boolean;
  /** Bumps when the navigator jumps here. */
  readonly pulseSeq: number | null;
}

const TONE: Record<StopChipTone, { fill: string; text: string }> = {
  neutral: { fill: PLAN_SHEET.chipFill, text: PLAN_SHEET.chipText },
  open: { fill: PLAN_SHEET.chipOpenFill, text: PLAN_SHEET.chipOpenText },
  warn: { fill: PLAN_SHEET.chipWarnFill, text: PLAN_SHEET.chipWarnText },
  closed: { fill: PLAN_SHEET.chipClosedFill, text: PLAN_SHEET.chipClosedText },
};

export function PlanStopCard(props: PlanStopCardProps): React.ReactElement {
  const {
    index,
    ordinal,
    name,
    purpose,
    dwell,
    photos,
    tags,
    chips,
    more,
    onDirections,
    onSwap,
    onCall,
    onWebsite,
    onOpenPhotos,
    swapPanel = null,
    reducedMotion,
    swappedIn = false,
    pulseSeq,
  } = props;
  const { t } = useTranslation(['cards', 'expanded_details']);
  const [photo, setPhoto] = React.useState(0);
  const [failed, setFailed] = React.useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = React.useState(false);
  const usable = React.useMemo(() => photos.filter((p) => !failed.has(p)), [photos, failed]);
  const shown = usable[Math.min(photo, Math.max(0, usable.length - 1))] ?? null;

  const enter = useEnterStyle(
    swappedIn
      ? { reduced: reducedMotion, durationMs: PLAN_MOTION.swapMs, fromX: PLAN_MOTION.swapFromX }
      : {
          reduced: reducedMotion,
          durationMs: PLAN_MOTION.cardRiseMs,
          delayMs: index * PLAN_MOTION.cardStaggerMs,
          fromY: PLAN_MOTION.cardRiseFromY,
        },
  );
  const pulse = usePulseStyle(pulseSeq, reducedMotion);

  const flip = (direction: 'prev' | 'next'): void => setPhoto((p) => stepPhotoIndex(p, usable.length, direction));

  return (
    <Reanimated.View
      testID={`plan-stop-${index}`}
      exiting={reducedMotion ? undefined : FadeOut.duration(PLAN_MOTION.swapMs)}
      layout={reducedMotion ? undefined : LinearTransition.duration(PLAN_MOTION.detailsMs)}
    >
      <Reanimated.View style={[styles.card, enter]}>
        {shown ? (
          <View style={styles.photo}>
            <ExpoImage
              source={{ uri: shown }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="disk"
              transition={reducedMotion ? 0 : 180}
              onError={() => setFailed((prev) => (prev.has(shown) ? prev : new Set([...prev, shown])))}
            />
            <PhotoPagerBars count={usable.length} index={Math.min(photo, usable.length - 1)} top={8} />
            <View style={styles.zones}>
              {usable.length > 1 ? (
                <Pressable
                  testID={`plan-stop-${index}-prev`}
                  style={styles.zoneSide}
                  onPress={() => flip('prev')}
                  accessibilityRole="button"
                  accessibilityLabel={t('cards:deck.previous_photo')}
                />
              ) : null}
              <Pressable
                testID={`plan-stop-${index}-photos`}
                style={styles.zoneMiddle}
                onPress={() => onOpenPhotos(usable.indexOf(shown))}
                accessibilityRole="button"
                accessibilityLabel={t('cards:expanded.stop_photos_a11y', { count: usable.length, name })}
              />
              {usable.length > 1 ? (
                <Pressable
                  testID={`plan-stop-${index}-next`}
                  style={styles.zoneSide}
                  onPress={() => flip('next')}
                  accessibilityRole="button"
                  accessibilityLabel={t('cards:deck.next_photo')}
                />
              ) : null}
            </View>
            {ordinal !== null ? (
              <View style={styles.number} pointerEvents="none">
                <Text style={styles.numberText} maxFontSizeMultiplier={1.2}>
                  {t('cards:plan.stop_number', { number: ordinal })}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text testID={`plan-stop-${index}-name`} style={styles.name} maxFontSizeMultiplier={1.4}>
              {name}
            </Text>
          </View>
          {purpose || dwell ? (
            <Text style={styles.what} maxFontSizeMultiplier={1.4}>
              {[purpose, dwell].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          {tags.length > 0 ? (
            <View style={styles.tags}>
              {tags.map((tag) => (
                <View key={tag} style={styles.tag} testID={`plan-stop-${index}-tag`}>
                  <Text style={styles.tagText} maxFontSizeMultiplier={1.3}>
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {chips.length > 0 ? (
            <View style={styles.chips}>
              {chips.map((chip) => (
                <View
                  key={chip.key}
                  testID={`plan-stop-${index}-chip-${chip.key}`}
                  style={[styles.chip, { backgroundColor: TONE[chip.tone].fill }]}
                >
                  <Text style={[styles.chipText, { color: TONE[chip.tone].text }]} maxFontSizeMultiplier={1.3}>
                    {chip.label}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.actions}>
            <Action
              testID={`plan-stop-${index}-directions`}
              label={t('cards:sheet.directions')}
              a11y={t('cards:sheet.directions_a11y', { name })}
              onPress={onDirections}
            />
            {onSwap ? (
              <Action
                testID={`plan-stop-${index}-swap`}
                label={t('cards:plan.swap')}
                a11y={ordinal !== null ? t('cards:plan.swap_title', { number: ordinal }) : t('cards:plan.swap')}
                onPress={onSwap}
              />
            ) : null}
            <Action
              testID={`plan-stop-${index}-more`}
              label={open ? t('cards:expanded.show_less') : t('cards:expanded.show_more')}
              a11y={open ? t('cards:expanded.collapse_stop_details') : t('cards:expanded.expand_stop_details')}
              expanded={open}
              onPress={() => setOpen((v) => !v)}
            />
          </View>

          {open ? (
            <View style={styles.more} testID={`plan-stop-${index}-details`}>
              {more.description ? <Text style={styles.description}>{more.description}</Text> : null}
              {more.address ? <Text style={styles.address}>{more.address}</Text> : null}
              {more.hours.length > 0 ? (
                <View style={styles.hours}>
                  <Text style={styles.hoursHeading}>{t('cards:expanded.weekly_hours')}</Text>
                  {more.hours.map((line) => {
                    const today = more.todayPrefix !== null && line.startsWith(more.todayPrefix);
                    return (
                      <Text
                        key={line}
                        testID={today ? `plan-stop-${index}-hours-today` : undefined}
                        style={[styles.hoursLine, today ? styles.hoursToday : null]}
                      >
                        {line}
                      </Text>
                    );
                  })}
                </View>
              ) : null}
              {(more.phone && onCall) || (more.website && onWebsite) ? (
                <View style={styles.actions}>
                  {more.phone && onCall ? (
                    <Action
                      testID={`plan-stop-${index}-call`}
                      label={t('expanded_details:action_buttons.call', { defaultValue: 'Call' })}
                      a11y={t('expanded_details:action_buttons.call_place', { defaultValue: 'Call {{name}}', name })}
                      onPress={onCall}
                    />
                  ) : null}
                  {more.website && onWebsite ? (
                    <Action
                      testID={`plan-stop-${index}-website`}
                      label={t('expanded_details:action_buttons.website', { defaultValue: 'Website' })}
                      a11y={t('expanded_details:action_buttons.website', { defaultValue: 'Website' })}
                      onPress={onWebsite}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {swapPanel}
        </View>
        <Reanimated.View pointerEvents="none" style={[styles.pulse, pulse]} />
      </Reanimated.View>
    </Reanimated.View>
  );
}

function Action({
  label,
  a11y,
  onPress,
  testID,
  expanded,
}: {
  label: string;
  a11y: string;
  onPress: () => void;
  testID: string;
  expanded?: boolean;
}): React.ReactElement {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
    >
      <Text style={styles.actionText} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: PLAN_SHEET.cardBorder,
    borderRadius: PLAN_SHEET.cardRadius,
    overflow: 'hidden',
    backgroundColor: SPINE.paper,
  },
  photo: {
    height: PLAN_SHEET.cardPhotoHeight,
    backgroundColor: SPINE.chipFill,
  },
  zones: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  zoneSide: {
    width: '30%',
    height: '100%',
  },
  zoneMiddle: {
    flex: 1,
    height: '100%',
  },
  number: {
    position: 'absolute',
    left: 10,
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 99,
    backgroundColor: PLAN_SHEET.stopNumberFill,
  },
  numberText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  body: {
    padding: 12,
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: SPINE.factValue,
  },
  what: {
    fontSize: 13,
    color: SPINE.muted,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: SPINE.hairline,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '700',
    color: SPINE.factLabel,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: PLAN_SHEET.chipRadius,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  action: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: PLAN_SHEET.actionFill,
  },
  actionPressed: {
    opacity: 0.6,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
    color: SPINE.factValue,
  },
  more: {
    gap: 8,
    paddingTop: 4,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: SPINE.prose,
  },
  address: {
    fontSize: 14,
    lineHeight: 20,
    color: SPINE.muted,
  },
  hours: {
    gap: 2,
  },
  hoursHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: SPINE.factValue,
  },
  hoursLine: {
    fontSize: 13,
    lineHeight: 19,
    color: SPINE.prose,
  },
  hoursToday: {
    fontWeight: '700',
    color: SPINE.link,
  },
  pulse: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: PLAN_SHEET.cardRadius,
    borderWidth: 3,
    borderColor: PLAN_MOTION.pulseRing,
  },
});
