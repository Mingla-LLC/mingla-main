import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Icon } from './ui/Icon';
import type { DeckBatch } from '../store/appStore';

interface DeckHistorySheetProps {
  visible: boolean;
  onClose: () => void;
  deckBatches: DeckBatch[];
  currentDeckBatchIndex: number;
  navigateToDeckBatch: (index: number) => void;
  totalDeckCardsViewed: number;
}

function getRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const DeckHistorySheet: React.FC<DeckHistorySheetProps> = ({
  visible,
  onClose,
  deckBatches,
  currentDeckBatchIndex,
  navigateToDeckBatch,
  totalDeckCardsViewed,
}) => {
  const handleBatchPress = (index: number) => {
    navigateToDeckBatch(index);
    onClose();
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
          {/* Handle bar */}
          <View style={styles.handleBar} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Your Card History</Text>
              <Text style={styles.subtitle}>
                {totalDeckCardsViewed} cards across {deckBatches.length} batch{deckBatches.length !== 1 ? 'es' : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {/* Batch list */}
          <ScrollView
            style={styles.list}
            showsVerticalScrollIndicator={false}
            bounces={deckBatches.length > 4}
          >
            {deckBatches.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name="layers-outline" size={36} color="#d1d5db" />
                <Text style={styles.emptyText}>No batches yet</Text>
              </View>
            ) : (
              deckBatches.map((batch, index) => {
                const isActive = index === currentDeckBatchIndex;
                const pillLabels = batch.activePills.slice(0, 3).join(', ');
                const extraPills = batch.activePills.length > 3
                  ? ` +${batch.activePills.length - 3}`
                  : '';

                return (
                  <TouchableOpacity
                    key={batch.batchSeed}
                    style={[styles.batchItem, isActive && styles.batchItemActive]}
                    onPress={() => handleBatchPress(index)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.batchLeft}>
                      <View style={[styles.batchNumber, isActive && styles.batchNumberActive]}>
                        <Text style={[styles.batchNumberText, isActive && styles.batchNumberTextActive]}>
                          {index + 1}
                        </Text>
                      </View>
                      <View style={styles.batchInfo}>
                        <Text style={[styles.batchTitle, isActive && styles.batchTitleActive]}>
                          Batch {index + 1}
                        </Text>
                        <Text style={styles.batchMeta}>
                          {batch.cards.length} cards{pillLabels ? ` · ${pillLabels}${extraPills}` : ''}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.batchRight}>
                      <Text style={styles.batchTime}>
                        {getRelativeTime(batch.timestamp)}
                      </Text>
                      {isActive && (
                        <View style={styles.activeBadge}>
                          <Text style={styles.activeBadgeText}>Current</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })
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
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
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
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 2,
  },
  closeButton: {
    padding: 4,
    marginLeft: 12,
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 8,
  },
  batchItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: '#f9fafb',
  },
  batchItemActive: {
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fdba74',
  },
  batchLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  batchNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e5e7eb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  batchNumberActive: {
    backgroundColor: '#eb7825',
  },
  batchNumberText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6b7280',
  },
  batchNumberTextActive: {
    color: '#ffffff',
  },
  batchInfo: {
    marginLeft: 12,
    flex: 1,
  },
  batchTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  batchTitleActive: {
    color: '#eb7825',
  },
  batchMeta: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  batchRight: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  batchTime: {
    fontSize: 12,
    color: '#9ca3af',
  },
  activeBadge: {
    backgroundColor: '#eb7825',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
  },
  activeBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ffffff',
  },
});
