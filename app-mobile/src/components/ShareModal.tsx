import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View, Image, StyleSheet, Alert, Clipboard, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { TrackedTouchableOpacity } from './TrackedTouchableOpacity';
import { BaseBottomSheet } from './ui/BaseBottomSheet';
import { Icon } from './ui/Icon';
import { WhatsAppLogo, InstagramLogo, TwitterLogo } from './ui/BrandIcons';
import { colors } from '../constants/colors';
import { mixpanelService } from '../services/mixpanelService';
import { logAppsFlyerEvent } from '../services/appsFlyerService';
import { buildFallbackShareUrl, type ShareEntity } from '../services/oneLinkShare';
import { messageForPreparedContentShare, prepareContentShare, shareCanonicalFallback, sharePreparedContent, type PreparedContentShare } from '../services/contentShareAdapter';


interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  experienceData: any;
  dateTimePreferences: any;
  userPreferences?: any;
  accountPreferences?: any;
}

type ShareFlowState = 'idle' | 'validating' | 'creating' | 'reusing' | 'ready' | 'opening' | 'returned' | 'error';

// META-ORCH-0991 Wave B Batch 3: was a centered card capped at maxHeight 90% →
// a swipe-down sheet at the same height. Module-level const per playbook §2.
const SHARE_SHEET_SNAP_POINTS = ['90%'];
type ShareAnalyticsEvent = 'share_sheet_opened' | 'share_link_ready' | 'share_sheet_returned' | 'share_failure';
const trackShareAnalytics = (
  event: ShareAnalyticsEvent,
  properties: Record<string, string | number | boolean>,
): void => {
  mixpanelService.track(event, properties);
  logAppsFlyerEvent(event, properties);
};

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
  const [shareState, setShareState] = useState<ShareFlowState>('idle');
  const [sharedCard, setSharedCard] = useState<PreparedContentShare | null>(null);
  const sharedCardPromiseRef = useRef<Promise<PreparedContentShare> | null>(null);
  const shareActionPromiseRef = useRef<Promise<void> | null>(null);
  const { t } = useTranslation(['share', 'common']);

  useEffect(() => {
    setSharedCard(null);
    sharedCardPromiseRef.current = null;
    setShareState('idle');
  }, [experienceData?.id, experienceData?.placePoolId, experienceData?.place_pool_id, experienceData?.placeId, experienceData?.googlePlaceId, experienceData?.savedCardId, experienceData?.saved_card_id]);

  useEffect(() => {
    if (!isOpen || !experienceData) return;
    void ensureSharedCard('generic').catch((error: unknown) => {
      console.warn('[ShareModal] share link preflight failed:', error);
      trackShareAnalytics('share_failure', { failure_type: 'creation', reason: 'create_failed', producer_app: 'consumer', producer_surface: 'explorer_share_sheet' });
    });
  // The reset effect above keys the authoritative identities; this preflight
  // intentionally runs only when the sheet opens for that reset generation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  
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

  // Extract only the producer identity. The visible preview below is always the
  // exact versioned recipient portrait returned by the sharing contract.
  const title = experienceData.title || experienceData.name || t('common:experience');
  const isCuratedItinerary =
    experienceData.cardType === 'curated' || Array.isArray(experienceData.stops);

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

  async function ensureSharedCard(channel = 'generic'): Promise<PreparedContentShare> {
    const businessEntity = buildShareEntity();
    setShareState('validating');
    if (sharedCard) {
      setShareState('ready');
      return messageForPreparedContentShare(sharedCard, channel, { planningPreference: dateTimePreferences });
    }
    if (sharedCardPromiseRef.current) {
      setShareState('reusing');
      const reused = messageForPreparedContentShare(await sharedCardPromiseRef.current, channel, { planningPreference: dateTimePreferences });
      setShareState('ready');
      return reused;
    }
    setShareState('creating');
    const isBusinessEntity=businessEntity !== undefined && 'brandSlug' in businessEntity;
    const kind = isBusinessEntity ? businessEntity.type : (isCuratedItinerary ? 'curated' : 'place');
    const identity = isBusinessEntity ? {
      brandSlug: businessEntity.brandSlug,
      eventSlug: businessEntity.entitySlug,
    } : Object.fromEntries([
          ['placePoolId', experienceData.placePoolId || experienceData.place_pool_id],
          ['googlePlaceId', experienceData.placeId || experienceData.googlePlaceId || experienceData.google_place_id],
          ['savedCardId', experienceData.savedCardId || experienceData.saved_card_id],
        ].filter(([, value]) => typeof value === 'string' && value.length > 0));
    const createPromise = prepareContentShare(kind, identity, channel, { planningPreference: dateTimePreferences });
    sharedCardPromiseRef.current = createPromise;
    try {
      const created = await createPromise;
      setSharedCard(created);
      setShareState('ready');
      trackShareAnalytics('share_link_ready', created.contract === 'content_share_v1'
        ? { kind, version: created.version, short_code: created.shortCode, channel, producer_app: 'consumer', producer_surface: 'explorer_share_sheet' }
        : { kind, contract: 'legacy_shared_card', channel, producer_app: 'consumer', producer_surface: 'explorer_share_sheet' });
      return created;
    } catch (error) {
      sharedCardPromiseRef.current = null;
      setShareState('error');
      throw error;
    }
  }

  const fallbackShare = (): { url: string; message: string } | null => {
    const entity = buildShareEntity();
    if (entity) {
      const url = buildFallbackShareUrl({ entity, channel: 'fallback' });
      return { url, message: `${title}\n\n${url}` };
    }
    return null;
  };

  // ORCH-1318 (SPEC §E.3) — the tracked, install-surviving OneLink for this
  // share. referralCode source is the signed-in user's code, once a user-code
  // accessor exists (SPEC §REMAINS #6); until then it is undefined → an
  // entity-only / attribution-via-content link (never an empty clipboard).
  const buildTrackedLink = async (channel: string): Promise<string> => {
    return (await ensureSharedCard(channel)).canonicalUrl;
  };

  const runExclusiveShareAction = (work: () => Promise<void>): Promise<void> => {
    if (shareActionPromiseRef.current) return shareActionPromiseRef.current;
    const action = work().finally(() => {
      if (shareActionPromiseRef.current === action) shareActionPromiseRef.current = null;
    });
    shareActionPromiseRef.current = action;
    return action;
  };

  const performCopyLink = async (): Promise<void> => {
    setIsSharing(true);
    try {
      const link = await buildTrackedLink('copy_link');
      await Clipboard.setString(link);
    } catch (e) {
      console.error('[ShareModal] copy link build failed:', e);
      setShareState('error');
      trackShareAnalytics('share_failure', { failure_type: 'creation', reason: 'copy_link_create_failed', producer_app: 'consumer', producer_surface: 'explorer_share_sheet', channel: 'copy_link' });
      const fallback = fallbackShare();
      if (fallback) {
        await Clipboard.setString(fallback.url);
        Alert.alert('Original link copied', 'The new Mingla preview is unavailable, so we copied the original public link. You can retry here later.');
      } else {
        Alert.alert(t('share:alerts.error_title'), 'We couldn’t create this link. Check your connection and try again.');
      }
    } finally {
      setIsSharing(false);
    }
  };
  const handleCopyLink = (): Promise<void> => runExclusiveShareAction(performCopyLink);

  const performCopyMessage = async (): Promise<void> => {
    setIsSharing(true);
    try {
      const prepared=await ensureSharedCard('copy_message');
      await Clipboard.setString(prepared.message);
      setMessageCopied(true);
      setTimeout(() => setMessageCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy message:', err);
      setShareState('error');
      trackShareAnalytics('share_failure', { failure_type: 'creation', reason: 'copy_message_create_failed', producer_app: 'consumer', producer_surface: 'explorer_share_sheet', channel: 'copy_message' });
      const fallback = fallbackShare();
      if (fallback) {
        await Clipboard.setString(fallback.message);
        Alert.alert('Original link copied', 'The new Mingla preview is unavailable, so we copied a simple message with the original public link.');
      } else {
        Alert.alert(t('share:alerts.error_title'), 'We couldn’t create this message. Check your connection and try again.');
      }
    } finally {
      setIsSharing(false);
    }
  };
  const handleCopyMessage = (): Promise<void> => runExclusiveShareAction(performCopyMessage);

  const performSocialShare = async (platform: string): Promise<void> => {
    if (platform === 'instagram') return;
    let opened = false;
    let reachedOpening = false;
    setIsSharing(true);
    try {
      // ORCH-1318 (SPEC §E.3) — APPEND the tracked, install-surviving OneLink to
      // the human message so a share both reads well AND is attributable + lands
      // the shared experience after install. buildReferralLink never blocks / never
      // returns empty (static fallback on any SDK failure).
      const prepared = await ensureSharedCard(platform);
      const message = prepared.message;
      setShareState('opening');
      reachedOpening = true;

      const openNativeShareSheet = async (): Promise<void> => {
        const properties: Record<string, string | number | boolean> = prepared.contract === 'content_share_v1'
          ? { kind: prepared.kind, version: prepared.version, short_code: prepared.shortCode, channel: platform, producer_app: 'consumer', producer_surface: 'explorer_share_sheet' }
          : { kind: prepared.kind, contract: 'legacy_shared_card', channel: platform, producer_app: 'consumer', producer_surface: 'explorer_share_sheet' };
        trackShareAnalytics('share_sheet_opened', properties);
        await sharePreparedContent(prepared);
        trackShareAnalytics('share_sheet_returned', { ...properties, outcome: 'returned' });
      };
      
      switch (platform) {
        case 'messages':
          // iOS Messages
          const messagesUrl = `sms:?body=${encodeURIComponent(message)}`;
          const canOpenMessages = await Linking.canOpenURL(messagesUrl);
          if (canOpenMessages) {
            await Linking.openURL(messagesUrl);
          } else {
            // Fallback to native share
            await openNativeShareSheet();
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
              await openNativeShareSheet();
            }
          } catch {
            // Final fallback
            await openNativeShareSheet();
          }
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
          await openNativeShareSheet();
      }
      opened = true;
    } catch (error) {
      console.error('Error sharing:', error);
      setShareState('error');
      trackShareAnalytics('share_failure', { failure_type: reachedOpening ? 'share_open' : 'creation', reason: reachedOpening ? 'open_failed' : 'create_failed', channel: platform, producer_app: 'consumer', producer_surface: 'explorer_share_sheet' });
      const fallback = fallbackShare();
      if (fallback) {
        try {
          trackShareAnalytics('share_sheet_opened', { channel: platform, producer_app: 'consumer', producer_surface: 'explorer_share_sheet', outcome: 'canonical_fallback' });
          await shareCanonicalFallback({ title, ...fallback });
          trackShareAnalytics('share_sheet_returned', { channel: platform, producer_app: 'consumer', producer_surface: 'explorer_share_sheet', outcome: 'returned_from_canonical_fallback' });
          opened = true;
          Alert.alert('Shared the original link', 'The new Mingla preview is unavailable. We used the original public link instead; you can retry the preview later.');
        } catch (fallbackError) {
          console.error('[ShareModal] original-link fallback failed:', fallbackError);
          Alert.alert(t('share:alerts.error_title'), 'Neither share option opened. Copy the original link or try again.');
        }
      } else {
        Alert.alert(t('share:alerts.error_title'), 'We couldn’t open this share option. Check your connection and try again.');
      }
    } finally {
      if (opened) setShareState('returned');
      setIsSharing(false);
    }
  };

  const handleSocialShare = async (platform: string): Promise<void> => {
    if (platform === 'instagram') return;
    if (isSharing) return;
    await runExclusiveShareAction(() => performSocialShare(platform));
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
            {/* Exact recipient-facing version preview. Never attach this image
                unless a target-specific adapter later proves image + link. */}
            <View style={styles.cardPreview}>
              {sharedCard?.s4Url ? (
                <Image
                  source={{ uri: sharedCard.s4Url }}
                  style={styles.portraitPreview}
                  resizeMode="cover"
                  accessibilityLabel={`${sharedCard.kind.replace('_', ' ')}: ${sharedCard.title}`}
                />
              ) : sharedCard ? (
                <View style={styles.coverlessPreview} accessibilityLabel="No image preview available">
                  <Text style={styles.coverlessKind}>{sharedCard.kind.replace('_', ' ')}</Text>
                  <Text style={styles.coverlessTitle}>{sharedCard.title}</Text>
                  <Text style={styles.coverlessCopy}>No image preview is available. The link still opens the full details.</Text>
                </View>
              ) : (
                <View style={styles.portraitLoading} accessibilityLiveRegion="polite">
                  <ActivityIndicator color="#EB7825" />
                  <Text style={styles.shareStatus}>Preparing the exact 4:5 preview…</Text>
                </View>
              )}

              {/* Personalized Message Box */}
              <View style={styles.messageBox}>
                {sharedCard ? (
                  <>
                    {sharedCard.contract === 'legacy_shared_card' ? <Text style={styles.shareStatus}>Compatibility share link ready</Text> : null}
                    <Text style={styles.messageText}>{sharedCard.message}</Text>
                  </>
                ) : shareState === 'error' ? (
                  <View style={styles.messageState}>
                    <Text style={styles.shareError}>The share preview is unavailable. Your original public link is still available where possible.</Text>
                    <TrackedTouchableOpacity logComponent="ShareModal" accessibilityRole="button" accessibilityLabel="Retry share preview" onPress={() => { sharedCardPromiseRef.current = null; void ensureSharedCard('generic').catch(() => undefined); }} style={styles.retryButton}>
                      <Text style={styles.retryText}>Retry preview</Text>
                    </TrackedTouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.messageState}>
                    <ActivityIndicator color="#EB7825" />
                    <Text style={styles.shareStatus}>{shareState === 'reusing' ? 'Reusing your Mingla link…' : 'Creating the exact share message…'}</Text>
                  </View>
                )}
                <TrackedTouchableOpacity logComponent="ShareModal" 
                  onPress={handleCopyMessage}
                  style={styles.copyMessageButton}
                  disabled={!sharedCard || isSharing}
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
              {['validating', 'creating', 'reusing', 'opening'].includes(shareState) ? <Text style={styles.shareStatus}>{shareState === 'opening' ? 'Opening share destination…' : 'Preparing your share…'}</Text> : null}
              {shareState === 'error' ? <Text style={styles.shareError}>The Mingla preview is unavailable. Retry it, or use the original public link where offered.</Text> : null}
              
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
                  onPress={() => undefined}
                  style={[styles.socialButton, styles.instagramDisabled]}
                  disabled
                  accessibilityState={{ disabled: true }}
                  accessibilityHint="Instagram image sharing is unavailable until attachment behavior is verified on a physical device"
                >
                  <View style={[styles.socialButtonIconWrapper, styles.instagramButton]}>
                    <InstagramLogo size={20} color="white" />
                  </View>
                  <Text style={styles.socialText}>{t('share:platform.instagram')}</Text>
                  <Text style={styles.comingSoon}>Coming soon</Text>
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
                style={[styles.bottomButtons]}
                disabled={isSharing}>
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
  portraitPreview: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: 16,
    backgroundColor: '#111318',
    marginBottom: 16,
  },
  portraitLoading: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    marginBottom: 16,
  },
  coverlessPreview: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: 16,
    backgroundColor: '#0C0E12',
    justifyContent: 'flex-end',
    padding: 24,
    marginBottom: 16,
  },
  coverlessKind: {
    color: '#EB7825',
    textTransform: 'capitalize',
    fontWeight: '700',
    marginBottom: 8,
  },
  coverlessTitle: {
    color: 'white',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
  },
  coverlessCopy: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
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
  messageState: {
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingRight: 36,
  },
  retryButton: {
    backgroundColor: 'white',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryText: {
    color: '#9f3210',
    fontWeight: '700',
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
  instagramDisabled: {
    backgroundColor: '#e5e7eb',
    opacity: 0.62,
  },
  comingSoon: {
    color: '#4b5563',
    fontSize: 9,
    fontWeight: '600',
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
