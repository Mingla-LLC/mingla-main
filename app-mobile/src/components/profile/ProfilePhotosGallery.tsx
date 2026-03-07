import React from 'react';
import {
  View,
  TouchableOpacity,
  Alert,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ImageWithFallback } from '../figma/ImageWithFallback';

interface ProfilePhotosGalleryProps {
  photos: string[];
  isOwnProfile: boolean;
  onAddPhoto?: (position: number) => void;
  onRemovePhoto?: (position: number) => void;
}

const SLOT_COUNT = 3;
const GAP = 8;
const HORIZONTAL_PADDING = 24;

const ProfilePhotosGallery: React.FC<ProfilePhotosGalleryProps> = ({
  photos,
  isOwnProfile,
  onAddPhoto,
  onRemovePhoto,
}) => {
  const { width } = useWindowDimensions();
  const slotSize = (width - HORIZONTAL_PADDING * 2 - GAP * (SLOT_COUNT - 1)) / SLOT_COUNT;

  const handleLongPress = (position: number) => {
    if (!isOwnProfile) return;
    Alert.alert('Remove Photo', 'Remove this photo from your profile?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onRemovePhoto?.(position) },
    ]);
  };

  const slots = Array.from({ length: SLOT_COUNT }, (_, i) => {
    const photoUrl = photos[i];
    const hasPhoto = !!photoUrl;

    if (!hasPhoto && !isOwnProfile) return null;

    return (
      <View key={i} style={[styles.slot, { width: slotSize, height: slotSize }]}>
        {hasPhoto ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onLongPress={() => handleLongPress(i)}
            disabled={!isOwnProfile}
            style={styles.filledSlot}
          >
            <ImageWithFallback
              source={{ uri: photoUrl }}
              style={styles.photo}
            />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.emptySlot}
            onPress={() => onAddPhoto?.(i)}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={28} color="#9ca3af" />
          </TouchableOpacity>
        )}
      </View>
    );
  });

  return (
    <View style={styles.container}>
      {slots}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: GAP,
    marginTop: 8,
  },
  slot: { borderRadius: 12, overflow: 'hidden' },
  filledSlot: { flex: 1 },
  photo: { width: '100%', height: '100%', borderRadius: 12 },
  emptySlot: {
    flex: 1,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#d1d5db',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ProfilePhotosGallery;
