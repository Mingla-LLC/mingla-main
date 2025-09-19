import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Experience } from '../types';
import { useExperiences } from '../hooks/useExperiences';
import { useAppStore } from '../store/appStore';

interface ExperienceCardProps {
  experience: Experience;
  onPress?: () => void;
  showSaveButton?: boolean;
  showLocation?: boolean;
  compact?: boolean;
}

export const ExperienceCard: React.FC<ExperienceCardProps> = ({
  experience,
  onPress,
  showSaveButton = true,
  showLocation = true,
  compact = false,
}) => {
  const [isSaved, setIsSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const { saveExperience, unsaveExperience } = useExperiences();
  const { user } = useAppStore();

  const handleSave = async () => {
    if (!user) {
      Alert.alert('Error', 'Please sign in to save experiences');
      return;
    }

    setSaving(true);
    try {
      if (isSaved) {
        const { error } = await unsaveExperience(experience.id);
        if (error) {
          Alert.alert('Error', error.message);
        } else {
          setIsSaved(false);
        }
      } else {
        const { error } = await saveExperience(experience.id, 'liked');
        if (error) {
          Alert.alert('Error', error.message);
        } else {
          setIsSaved(true);
        }
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const formatPrice = (min: number, max: number) => {
    if (min === 0 && max === 0) return 'Free';
    if (min === max) return `$${min}`;
    return `$${min}-$${max}`;
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) return `${hours}h`;
    return `${hours}h ${remainingMinutes}m`;
  };

  return (
    <TouchableOpacity
      style={[styles.container, compact && styles.compactContainer]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.imageContainer}>
        <Image
          source={{
            uri: experience.image_url || 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085',
          }}
          style={[styles.image, compact && styles.compactImage]}
          resizeMode="cover"
        />
        {showSaveButton && (
          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleSave}
            disabled={saving}
          >
            <Ionicons
              name={isSaved ? 'heart' : 'heart-outline'}
              size={20}
              color={isSaved ? '#FF3B30' : 'white'}
            />
          </TouchableOpacity>
        )}
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryText}>{experience.category}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <Text style={[styles.title, compact && styles.compactTitle]} numberOfLines={2}>
          {experience.title}
        </Text>

        <View style={styles.metaInfo}>
          <View style={styles.metaItem}>
            <Ionicons name="cash-outline" size={14} color="#666" />
            <Text style={styles.metaText}>
              {formatPrice(experience.price_min, experience.price_max)}
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={14} color="#666" />
            <Text style={styles.metaText}>
              {formatDuration(experience.duration_min)}
            </Text>
          </View>
          {showLocation && experience.lat && experience.lng && (
            <View style={styles.metaItem}>
              <Ionicons name="location-outline" size={14} color="#666" />
              <Text style={styles.metaText}>Nearby</Text>
            </View>
          )}
        </View>

        {!compact && (
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionButton}>
              <Text style={styles.actionButtonText}>View Details</Text>
              <Ionicons name="chevron-forward" size={16} color="#007AFF" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'white',
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  compactContainer: {
    marginBottom: 12,
  },
  imageContainer: {
    position: 'relative',
    height: 200,
  },
  compactImage: {
    height: 120,
  },
  image: {
    width: '100%',
    height: '100%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  saveButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 20,
    padding: 8,
  },
  categoryBadge: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  categoryText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  content: {
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 12,
    lineHeight: 24,
  },
  compactTitle: {
    fontSize: 16,
    marginBottom: 8,
  },
  metaInfo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 14,
    color: '#666',
  },
  actions: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#007AFF',
  },
});
