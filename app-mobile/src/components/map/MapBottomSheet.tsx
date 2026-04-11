import React, { forwardRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { BlurView } from 'expo-blur';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { Recommendation } from '../../types/recommendation';
import { getReadableCategoryName } from '../../utils/categoryUtils';
import { formatTierLabel, type PriceTierSlug } from '../../constants/priceTiers';
import { getCurrencySymbol } from '../../utils/currency';
import { getCurrencyRate } from '../utils/formatters';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface MapBottomSheetProps {
  card: Recommendation | null;
  onExpand: (card: Recommendation) => void;
  onNext: () => void;
  onClose: () => void;
  accountPreferences: { currency?: string; measurementSystem?: string };
}

const snapPoints = ['45%', '90%'];

function isPriceTierSlug(value: string): value is PriceTierSlug {
  return ['chill', 'comfy', 'bougie', 'lavish'].includes(value);
}

export const MapBottomSheet = forwardRef<BottomSheet, MapBottomSheetProps>(
  ({ card, onExpand, onNext, onClose, accountPreferences }, ref) => {
    const { t } = useTranslation(['map', 'common']);
    const currency = accountPreferences?.currency || 'USD';
    const currencySymbol = getCurrencySymbol(currency);
    const currencyRate = getCurrencyRate(currency);

    return (
      <BottomSheet
        ref={ref}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        onClose={onClose}
        handleIndicatorStyle={styles.handle}
        backgroundStyle={styles.sheetBackground}
      >
        <BottomSheetScrollView contentContainerStyle={styles.scrollContent}>
          {card && (
            <>
              {card.image ? (
                <Image source={{ uri: card.image }} style={styles.cardImage} />
              ) : (
                <View style={[styles.cardImage, styles.imagePlaceholder]}>
                  <Icon name="image-outline" size={40} color="#d1d5db" />
                </View>
              )}

              <View style={styles.cardContent}>
                <Text style={styles.title} numberOfLines={2}>{card.title}</Text>

                <View style={styles.metaRow}>
                  <Text style={styles.categoryChip}>
                    {getReadableCategoryName(card.category)}
                  </Text>
                  {card.priceTier && isPriceTierSlug(card.priceTier) && (
                    <Text style={styles.tierChip}>
                      {formatTierLabel(card.priceTier, currencySymbol, currencyRate)}
                    </Text>
                  )}
                  {card.rating > 0 && (
                    <View style={styles.ratingRow}>
                      <Icon name="star" size={13} color="#F59E0B" />
                      <Text style={styles.ratingText}>{card.rating.toFixed(1)}</Text>
                    </View>
                  )}
                </View>

                {card.description ? (
                  <Text style={styles.description} numberOfLines={3}>{card.description}</Text>
                ) : null}

                {card.address ? (
                  <View style={styles.addressRow}>
                    <Icon name="location-outline" size={14} color="#9ca3af" />
                    <Text style={styles.addressText} numberOfLines={1}>{card.address}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.buttonWrapper} onPress={() => onExpand(card)} activeOpacity={0.8}>
                  <View style={styles.solidButtonDetails}>
                    <Icon name="information-circle-outline" size={17} color="#FFF" />
                    <Text style={styles.solidButtonDetailsText}>{t('map:details')}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={styles.buttonWrapper} onPress={onNext} activeOpacity={0.8}>
                  <BlurView intensity={60} tint="dark" style={styles.glassButtonNext}>
                    <Text style={styles.glassButtonNextText}>{t('map:next')}</Text>
                    <Icon name="arrow-forward" size={15} color="#FFF" />
                  </BlurView>
                </TouchableOpacity>
              </View>
            </>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  }
);

MapBottomSheet.displayName = 'MapBottomSheet';

const styles = StyleSheet.create({
  handle: {
    backgroundColor: '#d1d5db',
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  sheetBackground: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  cardImage: {
    width: SCREEN_WIDTH,
    height: 200,
    backgroundColor: '#f3f4f6',
  },
  imagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  categoryChip: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  tierChip: {
    fontSize: 12,
    fontWeight: '600',
    color: '#eb7825',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  description: {
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 20,
    marginBottom: 8,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addressText: {
    fontSize: 13,
    color: '#9ca3af',
    flex: 1,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  buttonWrapper: {
    flex: 1,
  },
  solidButtonDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: '#eb7825',
  },
  solidButtonDetailsText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.3,
  },
  glassButtonNext: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  glassButtonNextText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.3,
  },
});
