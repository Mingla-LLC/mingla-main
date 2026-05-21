import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Image,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Icon } from './ui/Icon';
import * as Haptics from 'expo-haptics';
import { Recommendation } from '../contexts/RecommendationsContext';
import { getReadableCategoryName } from '../utils/categoryUtils';
import { useLocalePreferences } from '../hooks/useLocalePreferences';
import { parseAndFormatDistance } from './utils/formatters';
import { useTranslation } from 'react-i18next';
import type { CollabDismissalRow } from '../hooks/useSessionDismissedCards';

const { height: screenHeight } = Dimensions.get('window');

interface DismissedCardsSheetProps {
  visible: boolean;
  onClose: () => void;
  dismissedCards: Recommendation[];
  sessionSwipedCards: Recommendation[];
  /**
   * ORCH-0902 CR-6 (visible-but-not-binding dismissal): server-sourced list of
   * left-swipes by ALL participants in the current collab session, attributed
   * by display name. Empty array in solo mode. Cards passed by OTHER
   * participants are rendered in a separate "Also passed by your group"
   * section below the user's own swiped cards — they remain in the deck for
   * the current viewer (not removed), per the social-signal-not-veto contract.
   */
  collabDismissedRows?: CollabDismissalRow[];
  onSave: (card: Recommendation) => void;
  onCardPress: (card: Recommendation) => void;
}

// ORCH-0902 CR-6: minimum subset of card_data JSONB shape that this sheet
// needs to render a row. Other fields exist on the JSONB (~27 keys built by
// buildCardDataPayload) but only these are read here.
interface DismissalCardData {
  id?: string;
  title?: string;
  image?: string;
  images?: string[];
  category?: string;
  categoryIcon?: string;
  rating?: number;
}

interface OtherParticipantDismissal {
  experience_id: string;
  card_data: DismissalCardData | null;
  passers: Array<{ user_id: string; display_name: string; swiped_at: string }>;
  most_recent_at: string;
}

export const DismissedCardsSheet: React.FC<DismissedCardsSheetProps> = ({
  visible,
  onClose,
  dismissedCards,
  sessionSwipedCards,
  collabDismissedRows = [],
  onSave,
  onCardPress,
}) => {
  const { measurementSystem } = useLocalePreferences();
  const { t } = useTranslation(['modals', 'common']);

  // Build a set of dismissed card IDs for quick lookup
  const dismissedIds = new Set(dismissedCards.map(c => c.id));
  // Build a set of saved card IDs (swiped right = not dismissed)
  const savedIds = new Set(
    sessionSwipedCards
      .filter(c => !dismissedIds.has(c.id))
      .map(c => c.id)
  );

  // Show all swiped cards, most recent first
  const allCards = [...sessionSwipedCards].reverse();

  // ORCH-0902 CR-6: group OTHER participants' lefts by experience_id. Cards
  // the current user has ALREADY swiped (left or right) stay in the existing
  // list above with their normal status — no double-render. Cards passed by
  // others that the viewer has NOT yet seen appear in the dedicated section.
  const ownSwipedIds = new Set(sessionSwipedCards.map(c => c.id));
  const otherDismissalsByCard = new Map<string, OtherParticipantDismissal>();
  for (const row of collabDismissedRows) {
    if (row.is_me) continue; // skip — already in current user's own list
    if (ownSwipedIds.has(row.experience_id)) continue; // already in existing list
    let group = otherDismissalsByCard.get(row.experience_id);
    if (!group) {
      const cd = (row.card_data as DismissalCardData | null) ?? null;
      group = {
        experience_id: row.experience_id,
        card_data: cd,
        passers: [],
        most_recent_at: row.swiped_at,
      };
      otherDismissalsByCard.set(row.experience_id, group);
    }
    group.passers.push({
      user_id: row.user_id,
      display_name: row.display_name,
      swiped_at: row.swiped_at,
    });
    if (row.swiped_at > group.most_recent_at) {
      group.most_recent_at = row.swiped_at;
    }
  }
  // Sort other-dismissals by most-recent pass (descending) so fresh signals
  // surface first. Only include rows where we have at least a title in
  // card_data — anything else is unrenderable.
  const otherDismissals = [...otherDismissalsByCard.values()]
    .filter(g => !!g.card_data?.title)
    .sort((a, b) => b.most_recent_at.localeCompare(a.most_recent_at));

  const handleSave = (card: Recommendation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSave(card);
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          {/* Drag handle */}
          <View style={styles.handleBar} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>
                {t('modals:dismissed_cards.cards_viewed', { count: allCards.length })}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close-outline" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {/* Card list */}
          <ScrollView
            style={styles.list}
            showsVerticalScrollIndicator={false}
            bounces={allCards.length > 4}
          >
            {allCards.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>{t('modals:dismissed_cards.no_cards_viewed')}</Text>
              </View>
            ) : (
              <>
              {allCards.map((card, index) => {
                const isDismissed = dismissedIds.has(card.id);
                const isSaved = savedIds.has(card.id);
                return (
                  <React.Fragment key={`${card.id}-${index}`}>
                    <TouchableOpacity
                      style={styles.cardRow}
                      activeOpacity={0.7}
                      onPress={() => onCardPress(card)}
                    >
                      <Image
                        source={{ uri: card.image || card.images?.[0] }}
                        style={styles.thumbnail}
                      />
                      <View style={styles.infoColumn}>
                        <Text style={styles.cardTitle} numberOfLines={1}>
                          {card.title}
                        </Text>
                        <View style={styles.metaRow}>
                          <Icon
                            name={(card.categoryIcon) || 'location-outline'}
                            size={13}
                            color="#6B7280"
                          />
                          <Text style={styles.metaText}>
                            {getReadableCategoryName(card.category)}
                          </Text>
                          <Icon name="star" size={13} color="#F59E0B" style={styles.starIcon} />
                          <Text style={styles.metaText}>{card.rating?.toFixed(1) ?? '—'}</Text>
                        </View>
                        <View style={styles.statusRow}>
                          {isDismissed ? (
                            <View style={styles.statusBadgeDismissed}>
                              <Icon name="close-circle-outline" size={12} color="#9ca3af" />
                              <Text style={styles.statusTextDismissed}>{t('modals:dismissed_cards.passed')}</Text>
                            </View>
                          ) : isSaved ? (
                            <View style={styles.statusBadgeSaved}>
                              <Icon name="bookmark" size={12} color="#10B981" />
                              <Text style={styles.statusTextSaved}>{t('modals:dismissed_cards.saved')}</Text>
                            </View>
                          ) : (
                            <Text style={styles.distanceText}>
                              {card.distance
                                ? parseAndFormatDistance(card.distance, measurementSystem)
                                : card.travelTime}
                            </Text>
                          )}
                        </View>
                      </View>
                      {/* Save button — only for cards not already saved */}
                      {isDismissed && (
                        <View style={styles.actionsColumn}>
                          <TouchableOpacity
                            style={styles.actionButton}
                            onPress={() => handleSave(card)}
                            activeOpacity={0.6}
                          >
                            <Icon name="bookmark-outline" size={16} color="#eb7825" />
                            <Text style={styles.actionText}>{t('modals:dismissed_cards.save')}</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </TouchableOpacity>
                    {index < allCards.length - 1 && <View style={styles.separator} />}
                  </React.Fragment>
                );
              })}

              {/* ORCH-0902 CR-6: cards passed by OTHER participants in this
                * collab session. Visible-but-not-binding — the card STAYS in
                * the viewer's deck, this is purely social signal. Hidden in
                * solo (otherDismissals will be empty). */}
              {otherDismissals.length > 0 && (
                <View style={styles.groupSection}>
                  <Text style={styles.groupSectionTitle}>
                    {t('modals:dismissed_cards.also_passed_by_group', {
                      defaultValue: 'Also passed by your group',
                    })}
                  </Text>
                  {otherDismissals.map((group, gIndex) => {
                    const cd = group.card_data ?? {};
                    const passerNames = group.passers
                      .map(p => p.display_name)
                      .join(', ');
                    return (
                      <React.Fragment key={`other-${group.experience_id}-${gIndex}`}>
                        <View style={styles.cardRow}>
                          <Image
                            source={{ uri: cd.image || cd.images?.[0] }}
                            style={styles.thumbnail}
                          />
                          <View style={styles.infoColumn}>
                            <Text style={styles.cardTitle} numberOfLines={1}>
                              {cd.title ?? '—'}
                            </Text>
                            <View style={styles.metaRow}>
                              <Icon
                                name={cd.categoryIcon || 'location-outline'}
                                size={13}
                                color="#6B7280"
                              />
                              <Text style={styles.metaText}>
                                {getReadableCategoryName(cd.category ?? '')}
                              </Text>
                              {typeof cd.rating === 'number' && (
                                <>
                                  <Icon
                                    name="star"
                                    size={13}
                                    color="#F59E0B"
                                    style={styles.starIcon}
                                  />
                                  <Text style={styles.metaText}>
                                    {cd.rating.toFixed(1)}
                                  </Text>
                                </>
                              )}
                            </View>
                            <View style={styles.statusRow}>
                              <View style={styles.statusBadgeDismissed}>
                                <Icon
                                  name="people-outline"
                                  size={12}
                                  color="#9ca3af"
                                />
                                <Text
                                  style={styles.statusTextDismissed}
                                  numberOfLines={1}
                                >
                                  {t('modals:dismissed_cards.passed_by', {
                                    defaultValue: 'Passed by {{names}}',
                                    names: passerNames,
                                  })}
                                </Text>
                              </View>
                            </View>
                          </View>
                        </View>
                        {gIndex < otherDismissals.length - 1 && (
                          <View style={styles.separator} />
                        )}
                      </React.Fragment>
                    );
                  })}
                </View>
              )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: screenHeight * 0.8,
    paddingBottom: 34,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  closeButton: {
    padding: 4,
    marginLeft: 12,
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    minHeight: 80,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  infoColumn: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  metaText: {
    fontSize: 13,
    color: '#6B7280',
    marginLeft: 3,
  },
  starIcon: {
    marginLeft: 8,
  },
  statusRow: {
    marginTop: 3,
  },
  statusBadgeSaved: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  statusTextSaved: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: '500',
  },
  statusBadgeDismissed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  statusTextDismissed: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '500',
  },
  distanceText: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  actionsColumn: {
    alignItems: 'flex-end',
    gap: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    fontSize: 13,
    color: '#eb7825',
    fontWeight: '500',
  },
  separator: {
    height: 1,
    backgroundColor: '#F3F4F6',
  },
  // ORCH-0902 CR-6: "Also passed by your group" section styling. Sits below
  // the user's own swiped cards with a subtle visual divider so it reads as
  // a related but distinct signal.
  groupSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  groupSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
});
