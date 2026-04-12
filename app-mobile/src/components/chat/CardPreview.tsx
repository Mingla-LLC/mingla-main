import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Icon } from '../ui/Icon';
import { colors } from '../../constants/designSystem';

interface CardPreviewProps {
  title: string;
  category?: string;
  categoryIcon?: string;
  imageUrl?: string;
  onPress: () => void;
}

/**
 * Compact card preview shown inline in discussion messages.
 * Shows image, title, category. Tap opens the expanded card view.
 */
export function CardPreview({
  title,
  category,
  categoryIcon,
  imageUrl,
  onPress,
}: CardPreviewProps): React.ReactElement {
  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.85}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.image, styles.imagePlaceholder]}>
          <Icon name="image-outline" size={24} color={colors.gray[300]} />
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {category && (
          <View style={styles.categoryRow}>
            {categoryIcon && <Text style={styles.categoryIcon}>{categoryIcon}</Text>}
            <Text style={styles.category} numberOfLines={1}>{category}</Text>
          </View>
        )}
        <Text style={styles.tapHint}>Tap to view</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.gray[200],
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: 2,
  },
  image: {
    width: 72,
    height: 72,
  },
  imagePlaceholder: {
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text.primary,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  categoryIcon: {
    fontSize: 12,
  },
  category: {
    fontSize: 11,
    color: colors.text.secondary,
  },
  tapHint: {
    fontSize: 10,
    color: colors.gray[400],
    marginTop: 3,
  },
});
