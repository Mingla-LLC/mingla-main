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

const { height: screenHeight } = Dimensions.get('window');

interface DismissedCardsSheetProps {
  visible: boolean;
  onClose: () => void;
  dismissedCards: Recommendation[];
  onReconsider: (card: Recommendation) => void;
  onSave: (card: Recommendation) => void;
  onCardPress: (card: Recommendation) => void;
}

export const DismissedCardsSheet: React.FC<DismissedCardsSheetProps> = ({
  visible,
  onClose,
  dismissedCards,
  onReconsider,
  onSave,
  onCardPress,
}) => {
  const { measurementSystem } = useLocalePreferences();
  const handleReconsider = (card: Recommendation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onReconsider(card);
  };

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
                {dismissedCards.length} Dismissed Card{dismissedCards.length !== 1 ? 's' : ''}
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
            bounces={dismissedCards.length > 4}
          >
            {dismissedCards.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No dismissed cards</Text>
              </View>
            ) : (
              dismissedCards.map((card, index) => (
                <React.Fragment key={card.id}>
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
                      <Text style={styles.distanceText}>
                        {card.distance
                          ? parseAndFormatDistance(card.distance, measurementSystem)
                          : card.travelTime}
                      </Text>
                    </View>
                    <View style={styles.actionsColumn}>
                      <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => handleReconsider(card)}
                        activeOpacity={0.6}
                      >
                        <Icon name="refresh-outline" size={16} color="#eb7825" />
                        <Text style={styles.actionText}>Reconsider</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => handleSave(card)}
                        activeOpacity={0.6}
                      >
                        <Icon name="bookmark-outline" size={16} color="#eb7825" />
                        <Text style={styles.actionText}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                  {index < dismissedCards.length - 1 && <View style={styles.separator} />}
                </React.Fragment>
              ))
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
});
