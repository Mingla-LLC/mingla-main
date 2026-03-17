import React, { useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Icon } from './ui/Icon';
import { colors, spacing, radius, typography, fontWeights } from '../constants/designSystem';
import { useIsBetaTester } from '../hooks/useBetaFeedback';
import BetaFeedbackModal from './BetaFeedbackModal';
import FeedbackHistorySheet from './FeedbackHistorySheet';

// ── Component ───────────────────────────────────────────────────────────────

export default function BetaFeedbackButton() {
  const isBetaTester = useIsBetaTester();
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showHistorySheet, setShowHistorySheet] = useState(false);

  if (!isBetaTester) return null;

  return (
    <>
      <View style={styles.container}>
        <Text style={styles.sectionLabel}>BETA TESTER</Text>

        <TouchableOpacity
          style={styles.feedbackButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setShowFeedbackModal(true);
          }}
          activeOpacity={0.7}
        >
          <Icon name="mic-outline" size={20} color={colors.text.inverse} />
          <Text style={styles.feedbackButtonText}>Share Feedback</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.historyLink}
          onPress={() => setShowHistorySheet(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.historyLinkText}>View History</Text>
          <Icon name="chevron-forward" size={16} color={colors.primary[500]} />
        </TouchableOpacity>
      </View>

      <BetaFeedbackModal
        visible={showFeedbackModal}
        onClose={() => setShowFeedbackModal(false)}
        screenBefore="profile"
      />

      <FeedbackHistorySheet
        visible={showHistorySheet}
        onClose={() => setShowHistorySheet(false)}
      />
    </>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  feedbackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary[500],
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  feedbackButtonText: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  historyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 10,
    marginTop: spacing.xs,
  },
  historyLinkText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.primary[500],
  },
});
