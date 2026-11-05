/**
 * Issue #4265 — the coach-mark step 3 illustration (CoachMark.dc.html): two
 * mini saved cards (4:3 tiles, one with the filled heart) with tiny
 * "Schedule" / "Tickets" buttons and a share square. Decorative — hidden from
 * screen readers, which already hear the step's title and description.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Heart } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { glass } from '../constants/designSystem';

const L = glass.likes;
const P = L.coachPreview;

export default function CoachLikesPreview(): React.ReactElement {
  const { t } = useTranslation(['activity']);
  const tiles = [
    { key: 'a', color: P.tileA, heart: true, label: t('activity:savedTab.schedule') },
    { key: 'b', color: P.tileB, heart: false, label: t('activity:savedTab.tickets') },
  ];
  return (
    <View
      style={styles.row}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {tiles.map((tile) => (
        <View key={tile.key} style={styles.card}>
          <View style={[styles.tile, { backgroundColor: tile.color }]}>
            {tile.heart ? (
              <View style={styles.heartCircle}>
                <Heart size={11} color={L.accent} fill={L.accent} strokeWidth={2} />
              </View>
            ) : null}
          </View>
          <View style={styles.actions}>
            <View style={styles.button}>
              <Text style={styles.buttonText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                {tile.label}
              </Text>
            </View>
            <View style={styles.square} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  card: {
    flex: 1,
    gap: 6,
  },
  tile: {
    aspectRatio: 4 / 3,
    borderRadius: P.tileRadius,
  },
  heartCircle: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: P.heartCircle,
    height: P.heartCircle,
    borderRadius: P.heartCircle / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: P.heartCircleBg,
  },
  actions: {
    flexDirection: 'row',
    gap: 4,
  },
  button: {
    flex: 1,
    height: P.buttonHeight,
    borderRadius: P.buttonRadius,
    backgroundColor: L.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  buttonText: {
    color: L.textPrimary,
    fontSize: 10,
    fontWeight: '700',
  },
  square: {
    width: P.buttonHeight,
    height: P.buttonHeight,
    borderRadius: P.buttonRadius,
    borderWidth: 1,
    borderColor: P.squareBorder,
  },
});
