import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
} from 'react-native';
import { Icon } from '../ui/Icon';

interface CardData {
  id?: string;
  title?: string;
  name?: string;
  category?: string;
  categoryIcon?: string;
  image?: string;
  images?: string[];
}

interface SavedCard {
  id: string;
  card_data?: CardData;
  experience_data?: CardData;
}

interface CardTagPopoverProps {
  cards: SavedCard[];
  onSelectCard: (card: SavedCard) => void;
  onClose: () => void;
  visible: boolean;
  keyboardHeight?: number;
}

export const CardTagPopover: React.FC<CardTagPopoverProps> = ({
  cards,
  onSelectCard,
  onClose,
  visible,
  keyboardHeight,
}) => {
  if (!visible || cards.length === 0) {
    return null;
  }

  // When keyboardHeight is 0, the popover is rendered inside a relative anchor
  // above the input bar — no offset needed. Otherwise, use legacy absolute positioning.
  const bottomOffset = keyboardHeight ? keyboardHeight + 48 + 8 : 0;

  const getCardTitle = (card: SavedCard): string => {
    const data = card.card_data || card.experience_data || {};
    return data.title || data.name || 'Untitled';
  };

  const getCardCategory = (card: SavedCard): string => {
    const data = card.card_data || card.experience_data || {};
    return data.category || 'Experience';
  };

  const getCardImage = (card: SavedCard): string | undefined => {
    const data = card.card_data || card.experience_data || {};
    return data.image || data.images?.[0];
  };

  return (
    <View style={[styles.container, { bottom: bottomOffset }]}>
      <View style={styles.popover}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Icon name="pricetag" size={16} color="#eb7825" />
            <Text style={styles.headerText}>Tag a card</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Icon name="close" size={20} color="#666" />
          </TouchableOpacity>
        </View>
        <FlatList
          data={cards}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const imageUri = getCardImage(item);
            return (
              <TouchableOpacity
                style={styles.cardItem}
                onPress={() => {
                  onSelectCard(item);
                  onClose();
                }}
                activeOpacity={0.6}
              >
                {imageUri ? (
                  <Image
                    source={{ uri: imageUri }}
                    style={styles.cardThumbnail}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.cardThumbnail, styles.cardThumbnailFallback]}>
                    <Icon name="image-outline" size={18} color="#9CA3AF" />
                  </View>
                )}
                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {getCardTitle(item)}
                  </Text>
                  <Text style={styles.cardCategory} numberOfLines={1}>
                    {getCardCategory(item)}
                  </Text>
                </View>
                <Icon name="arrow-forward" size={14} color="#D1D5DB" />
              </TouchableOpacity>
            );
          }}
          style={styles.list}
          showsVerticalScrollIndicator={false}
        />
        {cards.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No cards saved yet</Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 64,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  popover: {
    backgroundColor: 'white',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    borderBottomWidth: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  closeButton: {
    padding: 4,
  },
  list: {
    maxHeight: 250,
  },
  cardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F9FAFB',
    gap: 12,
  },
  cardThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  cardThumbnailFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 2,
  },
  cardCategory: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '400',
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
});
