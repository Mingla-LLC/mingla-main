import React, { useEffect, useRef, useState } from 'react';
import { Text, View, Image, StyleSheet, Alert, Clipboard, Share, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { TrackedTouchableOpacity } from './TrackedTouchableOpacity';
import { BaseBottomSheet } from './ui/BaseBottomSheet';
import { Icon } from './ui/Icon';
import { WhatsAppLogo, InstagramLogo, TwitterLogo } from './ui/BrandIcons';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { useAppState } from './AppStateManager';
import { parseAndFormatDistance } from './utils/formatters';
import { colors } from '../constants/colors';
import { mixpanelService } from '../services/mixpanelService';
import { logAppsFlyerEvent } from '../services/appsFlyerService';
import { buildReferralLink, type ShareEntity } from '../services/oneLinkShare';
import { createSharedCard, type SharedCardCreateResult } from '../services/sharedCardService';
import { externalSharedCardUrl } from '../services/sharedCardLinks';
import { canonicalDiscoveryPriceDetail } from '../utils/priceTiers';
// ISSUE-1001 — the real wordmark replaces the red-dot + "Mingla" text badge.
import { MINGLA_WORDMARK } from '@mingla/brand-assets';


interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  experienceData: any;
  dateTimePreferences: any;
  userPreferences?: any;
  accountPreferences?: any;
}

// META-ORCH-0991 Wave B Batch 3: was a centered card capped at maxHeight 90% →
// a swipe-down sheet at the same height. Module-level const per playbook §2.
const SHARE_SHEET_SNAP_POINTS = ['90%'];

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
  const [shareState, setShareState] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [sharedCard, setSharedCard] = useState<SharedCardCreateResult | null>(null);
  const sharedCardPromiseRef = useRef<Promise<SharedCardCreateResult> | null>(null);
  const { t } = useTranslation(['share', 'common']);

  useEffect(() => {
    if (!isOpen) return;
    setSharedCard(null);
    sharedCardPromiseRef.current = null;
    setShareState('idle');
  }, [isOpen, experienceData?.id, experienceData?.placePoolId, experienceData?.place_pool_id, experienceData?.placeId, experienceData?.googlePlaceId, experienceData?.savedCardId, experienceData?.saved_card_id]);
  
  if (!isOpen) return null;
  
  // Guard against missing data
  if (!experienceData) {
    return (
      <BaseBottomSheet
        visible={isOpen}
        onClose={onClose}
        theme="light"
        snapPoints={SHARE_SHEET_SNAP_POINTS}
        scrollMode="view"
        wrapInRNModal
        accessibilityLabel={t('share:header.title')}
        header={
          <View style={styles.header}>
            <View style={styles.headerSidePlaceholder} />
            <Text style={styles.headerTitle}>{t('share:header.title')}</Text>
            <TrackedTouchableOpacity logComponent="ShareModal" onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={20} color="#111827" />
            </TrackedTouchableOpacity>
          </View>
        }
      >
        <View style={{ padding: 20, alignItems: 'center' }}>
          <Text style={{ color: '#6b7280' }}>{t('share:empty.no_data')}</Text>
        </View>
      </BaseBottomSheet>
    );
  }

  // Extract data with fallbacks
  const title = experienceData.title || experienceData.name || t('common:experience');
  const image = experienceData.image || experienceData.images?.[0] || '';
  const rawDistance = experienceData.distance || experienceData.travelTime;
  const distance = rawDistance
    ? parseAndFormatDistance(rawDistance, accountPreferences?.measurementSystem)
    : '';
  const venuePrice = canonicalDiscoveryPriceDetail(experienceData);
  const isCuratedItinerary =
    experienceData.cardType === 'curated' || Array.isArray(experienceData.stops);
  // Venue shares always lead with exact source money. Curated itinerary
  // estimates remain a separate domain and may use their existing summary.
  const priceRange = venuePrice?.source ??
    (isCuratedItinerary && typeof experienceData.priceRange === 'string'
      ? experienceData.priceRange
      : '');
  const approximatePrice = venuePrice?.approximate
    ? `Approx. ${venuePrice.approximate}${venuePrice.ratesDate ? ` · rates from ${new Date(venuePrice.ratesDate).toLocaleDateString()}` : ''}`
    : '';
  const rating = experienceData.rating || experienceData.ratingValue || '';
  const address = experienceData.address || experienceData.location?.address || experienceData.location || '';
  const description = experienceData.description || experienceData.fullDescription || '';
  const shortDescription = description.split('.')[0] || '';

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
    const schedule = [dateTimePreferences?.timeOfDay, dateTimePreferences?.dayOfWeek, dateTimePreferences?.planningTimeframe]
      .filter((v) => typeof v === 'string' && v.trim()).join(' on ');
    
    const priceSentence = priceRange
      ? ` and costs ${priceRange}${approximatePrice ? ` (${approximatePrice})` : ''}`
      : '';
    return `What do you think about ${title}${address ? ` at ${address}` : ''}?${rating ? ` It has a ${rating} star rating` : ''}${priceSentence}.${schedule ? ` I'm thinking ${schedule}.` : ''}${shortDescription ? ` ${shortDescription}.` : ''} Let me know if you're interested!`;
  };

  const personalizedMessage = generatePersonalizedMessage();

  // ORCH-1318 (SPEC §E.3) — derive the shared entity from experienceData when it
  // carries slugs. Curated/AI cards without a brand entity → undefined → a bare
  // referral/universal link (never a broken /e/brand/undefined). Slug + type
  // fields are optional on the loose experienceData shape, read defensively.
  const buildShareEntity = (): ShareEntity | undefined => {
    const brandSlug = experienceData?.brandSlug;
    if (typeof brandSlug !== 'string' || brandSlug.trim().length === 0) return undefined;
    const eventSlug = experienceData?.eventSlug;
    const tripSlug = experienceData?.tripSlug;
    const experienceSlug = experienceData?.experienceSlug;
    const explicitType = experienceData?.entityType;
    const type: 'brand' | 'event' | 'trip' | 'experience' =
      explicitType === 'brand' ||
      explicitType === 'event' ||
      explicitType === 'trip' ||
      explicitType === 'experience'
        ? explicitType
        : eventSlug
          ? 'event'
          : tripSlug
            ? 'trip'
            : experienceSlug
              ? 'experience'
              : 'brand';
    const entitySlug =
      typeof eventSlug === 'string'
        ? eventSlug
        : typeof tripSlug === 'string'
          ? tripSlug
          : typeof experienceSlug === 'string'
            ? experienceSlug
            : undefined;
    return { type, brandSlug, entitySlug };
  };

  const ensureSharedCard = async (): Promise<SharedCardCreateResult | null> => {
    const businessEntity = buildShareEntity();
    if (businessEntity) return null;
    if (sharedCard) return sharedCard;
    if (sharedCardPromiseRef.current) return sharedCardPromiseRef.current;
    setShareState('generating');
    const createPromise = createSharedCard({
        kind: isCuratedItinerary ? 'curated' : 'place',
        sourceIds: Object.fromEntries([
          ['placePoolId', experienceData.placePoolId || experienceData.place_pool_id],
          ['googlePlaceId', experienceData.placeId || experienceData.googlePlaceId || experienceData.google_place_id],
          ['savedCardId', experienceData.savedCardId || experienceData.saved_card_id],
        ].filter(([, value]) => typeof value === 'string' && value.length > 0)),
        attribution: {
          channel: 'share_modal',
          referralCode: typeof experienceData.referralCode === 'string' ? experienceData.referralCode : undefined,
        },
      });
    sharedCardPromiseRef.current = createPromise;
    try {
      const created = await createPromise;
      setSharedCard(created); setShareState('success'); return created;
    } catch (error) {
      sharedCardPromiseRef.current = null;
      setShareState('error');
      throw error;
    }
  };

  // ORCH-1318 (SPEC §E.3) — the tracked, install-surviving OneLink for this
  // share. referralCode source is the signed-in user's code, once a user-code
  // accessor exists (SPEC §REMAINS #6); until then it is undefined → an
  // entity-only / attribution-via-content link (never an empty clipboard).
  const buildTrackedLink = async (channel: string): Promise<string> => {
    const created = await ensureSharedCard();
    // #1615: Explorer messages must expose the canonical S6 URL so messaging
    // crawlers fetch S5 metadata. Attribution is stored on the snapshot; its
    // S6 CTA owns the install-surviving OneLink. Business entities keep their
    // established direct OneLink behavior.
    if (created) return externalSharedCardUrl(created);
    return buildReferralLink({
      channel,
      entity: buildShareEntity(),
      referralCode:
        typeof experienceData?.referralCode === 'string' ? experienceData.referralCode : undefined,
    });
  };

  const handleCopyLink = async () => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      const link = await buildTrackedLink('copy_link');
      await Clipboard.setString(link);
      mixpanelService.trackExperienceShared({ experienceTitle: title, method: 'copy_link' });
      logAppsFlyerEvent('af_share', { af_content_type: 'copy_link' });
    } catch (e) {
      console.error('[ShareModal] copy link build failed:', e);
      setShareState('error');
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyMessage = async () => {
    try {
      await Clipboard.setString(personalizedMessage);
      setMessageCopied(true);
      setTimeout(() => setMessageCopied(false), 2000);
      mixpanelService.trackExperienceShared({ experienceTitle: title, method: 'copy_message' });
      logAppsFlyerEvent('af_share', { af_content_type: 'copy_message' });
    } catch (err) {
      console.error('Failed to copy message:', err);
      Alert.alert(t('share:alerts.error_title'), t('share:alerts.copy_error'));
    }
  };

  const handleSocialShare = async (platform: string) => {
    setIsSharing(true);
    try {
      // ORCH-1318 (SPEC §E.3) — APPEND the tracked, install-surviving OneLink to
      // the human message so a share both reads well AND is attributable + lands
      // the shared experience after install. buildReferralLink never blocks / never
      // returns empty (static fallback on any SDK failure).
      const trackedLink = await buildTrackedLink(platform);
      const message = `${personalizedMessage}\n\n${trackedLink}`;
      mixpanelService.trackExperienceShared({ experienceTitle: title, method: platform });
      logAppsFlyerEvent('af_share', { af_content_type: platform });
      
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
          // S4 is available only with a real cover. If attachment/export fails,
          // retain the canonical link and disclose the fallback instead of lying.
          const instagramCard = sharedCard ?? await ensureSharedCard();
          if (instagramCard?.s4Url) {
            try {
              const uri = `${FileSystem.cacheDirectory ?? ''}mingla-share-${Date.now()}.png`;
              await FileSystem.downloadAsync(instagramCard.s4Url, uri);
              if (!(await Sharing.isAvailableAsync())) throw new Error('sharing_unavailable');
              await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: message, UTI: 'public.png' });
              break;
            } catch { Alert.alert('Image unavailable', 'Sharing the Mingla link instead.'); }
          }
          await Share.share({ message, title: experienceData.title });
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
            await WebBrowser.openBrowserAsync(twitterWebUrl).catch(() => {
              Linking.openURL(twitterWebUrl);
            });
          }
          break;
          
        default:
          await Share.share({ message });
      }
    } catch (error) {
      console.error('Error sharing:', error);
      Alert.alert(t('share:alerts.error_title'), t('share:alerts.share_error'));
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <BaseBottomSheet
      visible={isOpen}
      onClose={onClose}
      theme="light"
      snapPoints={SHARE_SHEET_SNAP_POINTS}
      scrollMode="scroll"
      wrapInRNModal
      accessibilityLabel="Share Experience"
      scrollProps={{
        style: styles.scrollView,
        contentContainerStyle: styles.scrollContent,
        showsVerticalScrollIndicator: false,
      }}
      header={
        <View style={styles.header}>
          <View style={styles.headerSidePlaceholder} />
          <Text style={styles.headerTitle}>Share Experience</Text>
          <TrackedTouchableOpacity logComponent="ShareModal"
            onPress={onClose}
            style={styles.closeButton}
          >
            <Icon name="close" size={20} color="#111827" />
          </TrackedTouchableOpacity>
        </View>
      }
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
                    {/* Mingla Badge — ISSUE-1001: the real orange wordmark
                        on the fixed white pill (contrast holds over any cover
                        image; identical in dark mode). */}
                    <View style={styles.minglaBadge}>
                      <Image
                        source={MINGLA_WORDMARK}
                        style={styles.minglaWordmark}
                        resizeMode="contain"
                        accessibilityLabel="Mingla"
                      />
                    </View>
                    {rating ? <View style={styles.ratingBadge}>
                      <Icon name="star" size={12} color="#fbbf24" />
                      <Text style={styles.ratingText}>{rating}</Text>
                    </View> : null}
                  </View>

                  {/* Experience Details */}
                  <View style={styles.experienceDetails}>
                    <Text style={styles.experienceTitle}>{title}</Text>
                    
                    <View style={styles.experienceMeta}>
                      {distance ? <View style={styles.metaItem}>
                        <Icon name="location-outline" size={14} color="#6b7280" />
                        <Text style={styles.metaText}>{distance}</Text>
                      </View> : null}
                      {priceRange ? (
                        <View style={styles.metaItem}>
                          <Icon name="cash-outline" size={14} color="#6b7280" />
                          <Text style={styles.metaText}>{priceRange}</Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Suggested Schedule */}
                    {dateTimePreferences?.timeOfDay || dateTimePreferences?.dayOfWeek || dateTimePreferences?.planningTimeframe ? <View style={styles.scheduleContainer}>
                      <View style={styles.scheduleHeader}>
                        <Icon name="calendar-outline" size={14} color="#eb7825" />
                        <Text style={styles.scheduleTitle}>{t('share:card.suggested_schedule')}</Text>
                      </View>
                      <View style={styles.scheduleDetails}>
                        <Text style={styles.scheduleText}>
                          {dateTimePreferences?.timeOfDay || ''}
                        </Text>
                        <Text style={styles.scheduleText}>
                          {dateTimePreferences?.dayOfWeek || ''}
                        </Text>
                        <Text style={styles.scheduleText}>
                          {dateTimePreferences?.planningTimeframe || ''}
                        </Text>
                      </View>
                    </View> : null}

                    {/* Price */}
                    <View style={styles.priceContainer}>
                      {priceRange ? <Text style={styles.priceText}>{priceRange}</Text> : null}
                      {approximatePrice ? (
                        <Text style={styles.priceSubtext}>{approximatePrice}</Text>
                      ) : null}
                      {venuePrice?.attributionUrl ? (
                        <Text
                          accessibilityRole="link"
                          style={styles.priceAttribution}
                          onPress={() => Linking.openURL(venuePrice.attributionUrl as string)}
                        >
                          Rates by ExchangeRate-API
                        </Text>
                      ) : null}
                      {priceRange ? <Text style={styles.priceSubtext}>{t('share:card.per_person')}</Text> : null}
                    </View>
                  </View>
                </View>
              </View>

              {/* Personalized Message Box */}
              <View style={styles.messageBox}>
                <Text style={styles.messageText}>{personalizedMessage}</Text>
                <TrackedTouchableOpacity logComponent="ShareModal" 
                  onPress={handleCopyMessage}
                  style={styles.copyMessageButton}
                >
                  <Icon 
                    name={messageCopied ? "checkmark" : "copy-outline"} 
                    size={18} 
                    color={messageCopied ? "#eb7825" : "#6b7280"} 
                  />
                </TrackedTouchableOpacity>
              </View>
            </View>

            {/* Share Options */}
            <View style={styles.shareOptions}>
              <Text style={styles.shareTitle}>{t('share:share_to')}</Text>
              {shareState === 'generating' ? <Text style={styles.shareStatus}>Creating share link…</Text> : null}
              {shareState === 'error' ? <Text style={styles.shareError}>Couldn’t create the link. Tap a share option to retry.</Text> : null}
              
              {/* Social Media Buttons */}
              <View style={styles.socialButtons}>
                <TrackedTouchableOpacity logComponent="ShareModal"
                  onPress={() => handleSocialShare('messages')}
                  style={[styles.socialButton, {backgroundColor: '#dfeeff'}]}
                  disabled={isSharing}
                >
                  <View style={[styles.socialButtonIconWrapper, styles.messagesButton]}>
                    <Icon name="chatbubble" size={20} color="white" />
                  </View>
                  <Text style={styles.socialText}>{t('share:platform.messages')}</Text>
                </TrackedTouchableOpacity>

                <TrackedTouchableOpacity logComponent="ShareModal"
                  onPress={() => handleSocialShare('whatsapp')}
                  style={[styles.socialButton, {backgroundColor: '#cdf8dd'}]}
                  disabled={isSharing}
                >
                  <View style={[styles.socialButtonIconWrapper, styles.whatsappButton]}>
                    <WhatsAppLogo size={20} color="white" />
                  </View>
                  <Text style={styles.socialText}>{t('share:platform.whatsapp')}</Text>
                </TrackedTouchableOpacity>

                <TrackedTouchableOpacity logComponent="ShareModal"
                  onPress={() => handleSocialShare('instagram')}
                  style={[styles.socialButton, {backgroundColor: '#fcd5ce'}]}
                  disabled={isSharing}
                >
                  <View style={[styles.socialButtonIconWrapper, styles.instagramButton]}>
                    <InstagramLogo size={20} color="white" />
                  </View>
                  <Text style={styles.socialText}>{t('share:platform.instagram')}</Text>
                </TrackedTouchableOpacity>

                <TrackedTouchableOpacity logComponent="ShareModal"
                  onPress={() => handleSocialShare('twitter')}
                  style={[styles.socialButton, {backgroundColor: '#d0e7ff'}]}
                  disabled={isSharing}
                >
                  <View style={[styles.socialButtonIconWrapper, styles.twitterButton]}>
                    <TwitterLogo size={20} color="white" />
                  </View>
                  <Text style={styles.socialText}>{t('share:platform.twitter')}</Text>
                </TrackedTouchableOpacity>
              </View>

              <View style={styles.bottomButtonsContainer}>
                <TrackedTouchableOpacity logComponent="ShareModal" style={[styles.bottomButtons, {borderWidth: 0, backgroundColor: '#f9f4f1', marginBottom: 10}]}
                  onPress={() => {
                    handleSocialShare('more');
                  }}
                  disabled={isSharing}
                >
                  <Icon name='share-2' size={24} color="black"/>
                  <Text>{t('share:actions.more_options')}</Text>
                </TrackedTouchableOpacity>
                <TrackedTouchableOpacity logComponent="ShareModal" style={[styles.bottomButtons]}
                  onPress={handleCopyLink}
                  disabled={isSharing}
                >
                  <Icon name='copy' size={24} color="black"/>
                  <Text>{t('share:actions.copy_link')}</Text>
                </TrackedTouchableOpacity>
                <TrackedTouchableOpacity logComponent="ShareModal"
                onPress={handleCopyMessage}
                style={[styles.bottomButtons]}>
                  <Icon name='copy' size={24} color="black"/>
                  <Text>{t('share:actions.copy_message')}</Text>
                </TrackedTouchableOpacity>
              </View>
            </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'center',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSidePlaceholder: {
    width: 36,
    height: 36,
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
  minglaWordmark: {
    width: 34,
    height: 12,
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
  priceAttribution: {
    color: "#d97706",
    fontSize: 11,
    textDecorationLine: "underline",
    marginTop: 2,
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
  shareStatus: { color: '#6b7280', marginBottom: 10 },
  shareError: { color: '#b91c1c', marginBottom: 10 },
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
