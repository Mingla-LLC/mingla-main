import React, { useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, Modal, ScrollView, Image, Alert, Clipboard, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { formatCurrency } from './utils/formatters';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  experienceData: any;
  dateTimePreferences: any;
  userPreferences?: any;
  accountPreferences?: any;
}

export default function ShareModal({ 
  isOpen, 
  onClose, 
  experienceData, 
  dateTimePreferences,
  userPreferences,
  accountPreferences 
}: ShareModalProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  
  if (!isOpen) return null;

  // Generate shareable link
  const shareableLink = `https://mingla.app/experience/${experienceData.id}?date=${encodeURIComponent(JSON.stringify(dateTimePreferences))}`;

  const handleCopyLink = async () => {
    try {
      await Clipboard.setString(shareableLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
      Alert.alert('Error', 'Failed to copy link to clipboard');
    }
  };

  const handleSocialShare = async (platform: string) => {
    const text = `Check out this amazing experience I found on Mingla! ${experienceData.title} - Join me for ${dateTimePreferences.timeOfDay} on ${dateTimePreferences.dayOfWeek}`;
    const url = shareableLink;
    
    setIsSharing(true);
    try {
      // Use React Native's built-in Share API
      const result = await Share.share({
        message: `${text}\n\n${url}`,
        title: `Check out ${experienceData.title} on Mingla!`,
        url: url
      });
      
      if (result.action === Share.sharedAction) {
      } else if (result.action === Share.dismissedAction) {
      }
    } catch (error) {
      console.error('Error sharing:', error);
      // Fallback to copy link if sharing fails
      handleCopyLink();
    } finally {
      setIsSharing(false);
    }
  };

  const handleNativeShare = async () => {
    const text = `Check out this amazing experience I found on Mingla! Join me for ${dateTimePreferences.timeOfDay} on ${dateTimePreferences.dayOfWeek}`;
    
    setIsSharing(true);
    try {
      // Use React Native's built-in Share API
      const result = await Share.share({
        message: `${text}\n\n${shareableLink}`,
        title: `Check out ${experienceData.title} on Mingla!`,
        url: shareableLink
      });
      
      if (result.action === Share.sharedAction) {
      } else if (result.action === Share.dismissedAction) {
      }
    } catch (error) {
      console.error('Error with native share:', error);
      // Fallback to copy link if sharing fails
      handleCopyLink();
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Share Experience</Text>
            <TouchableOpacity 
              onPress={onClose}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={16} color="#6b7280" />
            </TouchableOpacity>
          </View>

        <ScrollView style={styles.scrollView}>
          {/* Card Preview */}
          <View style={styles.cardPreview}>
            <View style={styles.cardWrapper}>
              <View style={styles.card}>
                {/* Experience Image */}
                <View style={styles.imageContainer}>
                  <Image
                    source={{ uri: experienceData.image }}
                    style={styles.experienceImage}
                    resizeMode="cover"
                  />
                  {/* Mingla Badge */}
                  <View style={styles.minglaBadge}>
                    <View style={styles.minglaBadgeContent}>
                      <View style={styles.minglaDot} />
                      <Text style={styles.minglaText}>Mingla</Text>
                    </View>
                  </View>
                  {/* Rating */}
                  <View style={styles.ratingBadge}>
                    <Ionicons name="star" size={12} color="#fbbf24" />
                    <Text style={styles.ratingText}>{experienceData.rating}</Text>
                  </View>
                </View>

                {/* Experience Details */}
                <View style={styles.experienceDetails}>
                  <Text style={styles.experienceTitle}>{experienceData.title}</Text>
                  
                  <View style={styles.experienceMeta}>
                    <View style={styles.metaItem}>
                      <Ionicons name="location" size={16} color="#6b7280" />
                      <Text style={styles.metaText}>{experienceData.distance} away</Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Ionicons name="people" size={16} color="#6b7280" />
                      <Text style={styles.metaText}>{experienceData.groupSize || experienceData.priceRange}</Text>
                    </View>
                  </View>

                  {/* Scheduled Date/Time */}
                  <View style={styles.scheduleContainer}>
                    <View style={styles.scheduleHeader}>
                      <Ionicons name="calendar" size={16} color="#eb7825" />
                      <Text style={styles.scheduleTitle}>Suggested Schedule</Text>
                    </View>
                    <View style={styles.scheduleDetails}>
                      <View style={styles.scheduleItem}>
                        <Ionicons name="time" size={12} color="#6b7280" />
                        <Text style={styles.scheduleText}>{dateTimePreferences.timeOfDay}</Text>
                      </View>
                      <View style={styles.scheduleItem}>
                        <Text style={styles.scheduleText}>{dateTimePreferences.dayOfWeek}</Text>
                      </View>
                      <View style={styles.scheduleItem}>
                        <Text style={styles.scheduleText}>{dateTimePreferences.planningTimeframe}</Text>
                      </View>
                    </View>
                  </View>

                  {/* Price */}
                  <View style={styles.priceContainer}>
                    <Text style={styles.priceText}>
                      {experienceData.priceRange}
                    </Text>
                    <Text style={styles.priceSubtext}>per person</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Join Mingla CTA */}
            <View style={styles.ctaContainer}>
              <Text style={styles.ctaTitle}>Join Mingla to Experience This!</Text>
              <Text style={styles.ctaSubtitle}>Discover amazing local experiences and connect with others</Text>
            </View>
          </View>

          {/* Share Options */}
          <View style={styles.shareOptions}>
            <Text style={styles.shareTitle}>Share to:</Text>
            
            {/* Social Media Buttons */}
            <View style={styles.socialButtons}>
              <TouchableOpacity
                onPress={() => handleSocialShare('messages')}
                style={[styles.socialButton, isSharing && styles.socialButtonDisabled]}
                disabled={isSharing}
              >
                <View style={styles.socialIcon}>
                  <Text style={styles.socialEmoji}>💬</Text>
                </View>
                <Text style={styles.socialText}>Messages</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleSocialShare('whatsapp')}
                style={[styles.socialButton, isSharing && styles.socialButtonDisabled]}
                disabled={isSharing}
              >
                <View style={styles.socialIcon}>
                  <Text style={styles.socialEmoji}>📱</Text>
                </View>
                <Text style={styles.socialText}>WhatsApp</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleSocialShare('instagram')}
                style={[styles.socialButton, isSharing && styles.socialButtonDisabled]}
                disabled={isSharing}
              >
                <View style={styles.socialIcon}>
                  <Text style={styles.socialEmoji}>📷</Text>
                </View>
                <Text style={styles.socialText}>Instagram</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleSocialShare('twitter')}
                style={[styles.socialButton, isSharing && styles.socialButtonDisabled]}
                disabled={isSharing}
              >
                <View style={styles.socialIcon}>
                  <Text style={styles.socialEmoji}>🐦</Text>
                </View>
                <Text style={styles.socialText}>Twitter</Text>
              </TouchableOpacity>
            </View>

            {/* Native Share Button */}
            <TouchableOpacity
              onPress={handleNativeShare}
              style={[styles.nativeShareButton, isSharing && styles.socialButtonDisabled]}
              disabled={isSharing}
            >
              <Ionicons name="share" size={16} color="#6b7280" />
              <Text style={styles.nativeShareText}>More sharing options</Text>
            </TouchableOpacity>

            {/* Copy Link */}
            <TouchableOpacity
              onPress={handleCopyLink}
              style={styles.copyButton}
            >
              {linkCopied ? (
                <>
                  <Ionicons name="checkmark" size={16} color="#eb7825" />
                  <Text style={styles.copyButtonTextActive}>Link Copied!</Text>
                </>
              ) : (
                <>
                  <Ionicons name="copy" size={16} color="#6b7280" />
                  <Text style={styles.copyButtonText}>Copy Link</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: 'white',
    borderRadius: 16,
    maxWidth: 400,
    width: '100%',
    maxHeight: '90%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  cardPreview: {
    padding: 16,
  },
  cardWrapper: {
    backgroundColor: '#FF7043',
    borderRadius: 12,
    padding: 4,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 8,
    overflow: 'hidden',
  },
  imageContainer: {
    position: 'relative',
    height: 192,
  },
  experienceImage: {
    width: '100%',
    height: '100%',
  },
  minglaBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  minglaBadgeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  minglaDot: {
    width: 12,
    height: 12,
    backgroundColor: '#FF7043',
    borderRadius: 6,
  },
  minglaText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#111827',
  },
  ratingBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#111827',
  },
  experienceDetails: {
    padding: 16,
  },
  experienceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  experienceMeta: {
    flexDirection: 'row',
    alignItems: 'center',
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
    color: '#6b7280',
  },
  scheduleContainer: {
    backgroundColor: 'rgba(235, 120, 37, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  scheduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  scheduleTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#eb7825',
  },
  scheduleDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  scheduleText: {
    fontSize: 14,
    color: '#374151',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  priceText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#eb7825',
  },
  priceSubtext: {
    fontSize: 14,
    color: '#6b7280',
  },
  ctaContainer: {
    marginTop: 16,
    backgroundColor: '#FF7043',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  ctaTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 4,
  },
  ctaSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
  },
  shareOptions: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  shareTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
    marginBottom: 12,
  },
  socialButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  socialButton: {
    flex: 1,
    minWidth: '22%',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f9fafb',
  },
  socialButtonDisabled: {
    opacity: 0.5,
    backgroundColor: '#e5e7eb',
  },
  socialIcon: {
    width: 32,
    height: 32,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialEmoji: {
    fontSize: 16,
    color: 'white',
    fontWeight: 'bold',
  },
  socialText: {
    fontSize: 12,
    color: '#374151',
  },
  nativeShareButton: {
    width: '100%',
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nativeShareText: {
    fontSize: 14,
    color: '#374151',
  },
  copyButton: {
    width: '100%',
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  copyButtonText: {
    fontSize: 14,
    color: '#374151',
  },
  copyButtonTextActive: {
    fontSize: 14,
    color: '#eb7825',
    fontWeight: '500',
  },
});
