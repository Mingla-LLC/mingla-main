import React, { useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, Modal, ScrollView, Alert, Clipboard, Share, Linking } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { useAppState } from './AppStateManager';
import { formatPriceRange } from './utils/formatters';
import { colors } from '../constants/colors';

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
  const [messageCopied, setMessageCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  // const { accountPreferences } = useAppState();
  
  if (!isOpen) return null;
  
  // Guard against missing data
  if (!experienceData) {
    return (
      <Modal
        visible={isOpen}
        transparent={true}
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <View style={styles.modalContainer}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Share Experience</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <Ionicons name="close" size={20} color="#111827" />
              </TouchableOpacity>
            </View>
            <View style={{ padding: 20, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No experience data available</Text>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // Extract data with fallbacks
  const title = experienceData.title || experienceData.name || 'Experience';
  const image = experienceData.image || experienceData.images?.[0] || '';
  const distance = experienceData.distance || experienceData.travelTime || '3.8 km away';
  const priceRange = formatPriceRange(experienceData.priceRange, accountPreferences?.currency) || experienceData.price || '';
  const rating = experienceData.rating || experienceData.ratingValue || '4.8';
  const address = experienceData.address || experienceData.location?.address || experienceData.location || '';
  const description = experienceData.description || experienceData.fullDescription || '';
  const shortDescription = description.split('.')[0] || 'Amazing experience';

  // Debug logging
  console.log('[ShareModal] Received experienceData:', {
    hasTitle: !!experienceData.title,
    hasImage: !!image,
    title,
    image,
    distance,
    priceRange,
    rating,
  });

  // Generate personalized message
  const generatePersonalizedMessage = () => {
    const timeOfDay = dateTimePreferences?.timeOfDay || 'Afternoon';
    const dayOfWeek = dateTimePreferences?.dayOfWeek || 'Weekend';
    const timeframe = dateTimePreferences?.planningTimeframe || 'This month';
    
    return `What do you think about ${title}${address ? ` at ${address}` : ''}? It has a ${rating} star rating and costs ${priceRange}. I'm thinking we could go ${timeOfDay} on ${dayOfWeek} (${timeframe}). ${shortDescription} Let me know if you're interested!`;
  };

  const personalizedMessage = generatePersonalizedMessage();

  const handleCopyMessage = async () => {
    try {
      await Clipboard.setString(personalizedMessage);
      setMessageCopied(true);
      setTimeout(() => setMessageCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy message:', err);
      Alert.alert('Error', 'Failed to copy message to clipboard');
    }
  };

  const handleSocialShare = async (platform: string) => {
    setIsSharing(true);
    try {
      const message = personalizedMessage;
      
      switch (platform) {
        case 'messages':
          // iOS Messages
          const messagesUrl = `sms:?body=${encodeURIComponent(message)}`;
          const canOpenMessages = await Linking.canOpenURL(messagesUrl);
          if (canOpenMessages) {
            await Linking.openURL(messagesUrl);
          } else {
            // Fallback to native share
            await Share.share({ message });
          }
          break;
          
        case 'whatsapp':
          // WhatsApp: try deep link first, then gracefully fall back to native share
          try {
            const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;
            const canOpenWhatsApp = await Linking.canOpenURL(whatsappUrl);
            if (canOpenWhatsApp) {
              await Linking.openURL(whatsappUrl);
            } else {
              // Fallback to native share (works on web / emulators / devices without WhatsApp)
              await Share.share({ message });
            }
          } catch {
            // Final fallback
            await Share.share({ message });
          }
          break;
          
        case 'instagram':
          // Instagram - use native share since direct sharing requires different approach
          await Share.share({
            message: personalizedMessage,
            title: experienceData.title,
          });
          break;
          
        case 'twitter':
          // Twitter/X
          const twitterUrl = `twitter://post?message=${encodeURIComponent(message)}`;
          const canOpenTwitter = await Linking.canOpenURL(twitterUrl);
          if (canOpenTwitter) {
            await Linking.openURL(twitterUrl);
          } else {
            // Fallback to web
            const twitterWebUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`;
            await Linking.openURL(twitterWebUrl);
          }
          break;
          
        default:
          await Share.share({ message: personalizedMessage });
      }
    } catch (error) {
      console.error('Error sharing:', error);
      Alert.alert('Error', 'Failed to share. Please try again.');
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
              <Ionicons name="close" size={20} color="#111827" />
            </TouchableOpacity>
          </View>

          <ScrollView 
            style={styles.scrollView} 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Experience Card with Orange Border */}
            <View style={styles.cardPreview}>
              <View style={styles.cardWrapper}>
                <View style={styles.card}>
                  {/* Experience Image */}
                  <View style={styles.imageContainer}>
                    <ImageWithFallback
                      src={image}
                      alt={title}
                      style={styles.experienceImage}
                    />
                    {/* Mingla Badge */}
                    <View style={styles.minglaBadge}>
                      <View style={styles.minglaDot} />
                      <Text style={styles.minglaText}>Mingla</Text>
                    </View>
                    {/* Rating Badge */}
                    <View style={styles.ratingBadge}>
                      <Ionicons name="star" size={12} color="#fbbf24" />
                      <Text style={styles.ratingText}>{rating}</Text>
                    </View>
                  </View>

                  {/* Experience Details */}
                  <View style={styles.experienceDetails}>
                    <Text style={styles.experienceTitle}>{title}</Text>
                    
                    <View style={styles.experienceMeta}>
                      <View style={styles.metaItem}>
                        <Ionicons name="location-outline" size={14} color="#6b7280" />
                        <Text style={styles.metaText}>{distance}</Text>
                      </View>
                      <View style={styles.metaItem}>
                        <Ionicons name="person-outline" size={14} color="#6b7280" />
                        <Text style={styles.metaText}>{priceRange}</Text>
                      </View>
                    </View>

                    {/* Suggested Schedule */}
                    <View style={styles.scheduleContainer}>
                      <View style={styles.scheduleHeader}>
                        <Ionicons name="calendar-outline" size={14} color="#eb7825" />
                        <Text style={styles.scheduleTitle}>Suggested Schedule</Text>
                      </View>
                      <View style={styles.scheduleDetails}>
                        <Text style={styles.scheduleText}>
                          {dateTimePreferences?.timeOfDay || 'Afternoon'}
                        </Text>
                        <Text style={styles.scheduleText}>
                          {dateTimePreferences?.dayOfWeek || 'Weekend'}
                        </Text>
                        <Text style={styles.scheduleText}>
                          {dateTimePreferences?.planningTimeframe || 'This month'}
                        </Text>
                      </View>
                    </View>

                    {/* Price */}
                    <View style={styles.priceContainer}>
                      <Text style={styles.priceText}>{priceRange}</Text>
                      <Text style={styles.priceSubtext}>per person</Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Personalized Message Box */}
              <View style={styles.messageBox}>
                <Text style={styles.messageText}>{personalizedMessage}</Text>
                <TouchableOpacity 
                  onPress={handleCopyMessage}
                  style={styles.copyMessageButton}
                >
                  <Ionicons 
                    name={messageCopied ? "checkmark" : "copy-outline"} 
                    size={18} 
                    color={messageCopied ? "#eb7825" : "#6b7280"} 
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Share Options */}
            <View style={styles.shareOptions}>
              <Text style={styles.shareTitle}>Share to:</Text>
              
              {/* Social Media Buttons */}
              <View style={styles.socialButtons}>
                <TouchableOpacity
                  onPress={() => handleSocialShare('messages')}
                  style={[styles.socialButton, {backgroundColor: '#dfeeff'}]}
                  disabled={isSharing}
                >
                  <View style={[styles.socialButtonIconWrapper, styles.messagesButton]}>
                    <Ionicons name="chatbubble" size={20} color="white" />
                  </View>
                  <Text style={styles.socialText}>Messages</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleSocialShare('whatsapp')}
                  style={[styles.socialButton, {backgroundColor: '#cdf8dd'}]}
                  disabled={isSharing}
                >
                  <View style={[styles.socialButtonIconWrapper, styles.whatsappButton]}>
                    <Ionicons name="logo-whatsapp" size={20} color="white" />
                  </View>
                  <Text style={styles.socialText}>WhatsApp</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleSocialShare('instagram')}
                  style={[styles.socialButton, {backgroundColor: '#fcd5ce'}]}
                  disabled={isSharing}
                >
                  <View style={[styles.socialButtonIconWrapper, styles.instagramButton]}>
                    <Ionicons name="logo-instagram" size={20} color="white" />
                  </View>
                  <Text style={styles.socialText}>Instagram</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleSocialShare('twitter')}
                  style={[styles.socialButton, {backgroundColor: '#d0e7ff'}]}
                  disabled={isSharing}
                >
                  <View style={[styles.socialButtonIconWrapper, styles.twitterButton]}>
                    <Ionicons name="logo-twitter" size={20} color="white" />
                  </View>
                  <Text style={styles.socialText}>Twitter</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.bottomButtonsContainer}>
                <TouchableOpacity style={[styles.bottomButtons, {borderWidth: 0, backgroundColor: '#f9f4f1', marginBottom: 10}]}>
                  <Feather name='share-2' size={24} color="black"/>
                  <Text>More sharing options</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.bottomButtons]}>
                  <Feather name='copy' size={24} color="black"/>
                  <Text>Copy link</Text>
                </TouchableOpacity>
                <TouchableOpacity
                onPress={handleCopyMessage}
                style={[styles.bottomButtons]}>
                  <Feather name='copy' size={24} color="black"/>
                  <Text>Copy Message</Text>
                </TouchableOpacity>
              </View>
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
  },
  modalContainer: {
    backgroundColor: 'white',
    borderRadius: 20,
    maxHeight: '90%',
    width: '90%',
    maxWidth: 400,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
    flexDirection: 'column',
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
    maxHeight: 600,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  cardPreview: {
    padding: 16,
  },
  cardWrapper: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#eb7825', // Orange border
    overflow: 'hidden',
    marginBottom: 16,
  },
  card: {
    backgroundColor: 'white',
    overflow: 'hidden',
  },
  imageContainer: {
    position: 'relative',
    height: 200,
    backgroundColor: '#f3f4f6',
  },
  experienceImage: {
    width: '100%',
    height: '100%',
  },
  minglaBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  minglaDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  minglaText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#111827',
  },
  ratingBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'white',
    borderRadius: 12,
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
    fontSize: 20,
    fontWeight: '700',
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
    marginBottom: 12,
    backgroundColor: colors.lightOrange,
    borderRadius: 8,
    padding: 12,
  },
  scheduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
    gap: 12,
    flexWrap: 'wrap',
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
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  priceSubtext: {
    fontSize: 14,
    color: '#6b7280',
  },
  messageBox: {
    backgroundColor: '#eb7825',
    borderRadius: 12,
    padding: 16,
    position: 'relative',
  },
  messageText: {
    fontSize: 14,
    color: 'white',
    lineHeight: 20,
    paddingRight: 40,
  },
  copyMessageButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareOptions: {
    padding: 16,
    paddingTop: 0,
  },
  shareTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
  },
  socialButtons: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  socialButton: {
    width: 70,
    height: 70,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  socialButtonIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messagesButton: {
    backgroundColor: '#007AFF', // iOS Messages blue
  },
  whatsappButton: {
    backgroundColor: '#25D366', // WhatsApp green
  },
  instagramButton: {
    backgroundColor: '#E4405F', // Instagram pink/purple
  },
  twitterButton: {
    backgroundColor: '#1DA1F2', // Twitter blue
  },
  helpButton: {
    backgroundColor: '#eb7825', // Orange
    width: 70,
    height: 70,
    borderRadius: 35, // Circular
  },
  socialText: {
    fontSize: 11,
    color: 'black',
    fontWeight: '500',
    marginTop: 2,
  },
  bottomButtonsContainer: {
    gap: 2,
    marginTop: 16,
  },
  bottomButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  }
});
