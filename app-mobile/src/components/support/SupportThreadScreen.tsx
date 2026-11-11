/**
 * #4382 Wave 5 — one Explorer support request (journey 1, steps 6–7).
 *
 *   banner    where the request stands: waiting on Mingla (with the promised
 *             next update), waiting on you, resolved ("reply to reopen"), or
 *             closed; right after sending, "Sent. We usually reply…"
 *   messages  text, screenshots (full-size in the shared ImageLightbox) and
 *             voice notes, all through one-hour signed links
 *   composer  text and screenshots through support-send; a reply to a
 *             waiting or resolved request reopens it on the server
 *   closed    the composer is replaced with "Start a new request"
 *
 * Opened from Help & Support, after sending, and from the support pushes
 * (explorer.support_reply / _status_changed / _product_update) through
 * deepLinkService → `/support/<ticketId>`.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useSendSupportReply, useSupportThread } from '../../hooks/useSupportRequests';
import {
  SupportReplyError,
  uploadSupportScreenshot,
  type SupportThreadMessage,
} from '../../services/supportTicketService';
import { requestGalleryPermission } from '../../utils/mediaLibraryPermission';
import {
  MAX_SUPPORT_SCREENSHOTS,
  SUPPORT_MESSAGE_MAX,
  addScreenshots,
  formatTicketNumber,
  supportComposerMode,
  supportProductBannerKeys,
  supportStatusKind,
  upcomingNextUpdate,
  type SupportScreenshot,
} from '../../utils/supportRequestModel';
import { ImageLightbox } from '../ImageLightbox';
import { Icon } from '../ui/Icon';
import { KeyboardAwareView } from '../ui/KeyboardAwareView';
import { toastManager } from '../ui/Toast';
import { ToastContainer } from '../ui/ToastContainer';
import {
  ScreenshotGrid,
  SupportHeader,
  SupportStatusPill,
  VoiceNotePlayer,
  SUPPORT_ACCENT,
  supportStyles,
} from './supportUi';

function when(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function SupportThreadScreen({ ticketId }: { ticketId: string }): React.ReactElement {
  const { t } = useTranslation(['feedback', 'common']);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ sent?: string | string[] }>();
  const justSent = (Array.isArray(params.sent) ? params.sent[0] : params.sent) === '1';
  const thread = useSupportThread(ticketId);
  const reply = useSendSupportReply(ticketId);
  const [draft, setDraft] = useState('');
  const [screenshots, setScreenshots] = useState<SupportScreenshot[]>([]);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const data = thread.data ?? null;
  const ticket = data?.ticket ?? null;

  const goBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace('/support' as never);
  }, [router]);

  const pickScreenshots = useCallback(async (): Promise<void> => {
    const remaining = MAX_SUPPORT_SCREENSHOTS - screenshots.length;
    if (remaining <= 0) return;
    const { status } = await requestGalleryPermission();
    if (status !== 'granted') {
      toastManager.show(t('feedback:support.photos_permission'), 'error');
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 1,
        exif: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const next = addScreenshots(
        screenshots,
        result.assets.map((asset) => ({ uri: asset.uri, width: asset.width, height: asset.height })),
      );
      setScreenshots(next.screenshots);
      if (next.dropped > 0) toastManager.show(t('feedback:support.too_many_screenshots', { max: MAX_SUPPORT_SCREENSHOTS }), 'warning');
    } catch (error) {
      console.warn('[Support] screenshot picker failed:', error);
      toastManager.show(t('feedback:support.photos_permission'), 'error');
    }
  }, [screenshots, t]);

  const busy = uploading || reply.isPending;
  const trimmed = draft.trim();
  const canSend = (trimmed.length > 0 || screenshots.length > 0) && trimmed.length <= SUPPORT_MESSAGE_MAX && !busy;

  const send = useCallback(async (): Promise<void> => {
    if (!canSend || ticket === null) return;
    try {
      setUploading(true);
      const attachmentIds: string[] = [];
      for (const shot of screenshots) attachmentIds.push(await uploadSupportScreenshot(ticket.id, shot));
      setUploading(false);
      await reply.mutateAsync({ content: trimmed, attachmentIds });
      setDraft('');
      setScreenshots([]);
    } catch (error) {
      setUploading(false);
      toastManager.show(
        error instanceof SupportReplyError && error.code === 'ticket_closed'
          ? t('feedback:support.reply_closed')
          : error instanceof SupportReplyError && error.message === 'attachment_not_uploaded'
            ? t('feedback:support.not_uploaded')
            : t('feedback:support.reply_failed'),
        'error',
      );
    }
  }, [canSend, ticket, screenshots, reply, trimmed, t]);

  const bubble = useCallback((message: SupportThreadMessage, signed: Record<string, string>, myId: string | null): React.ReactElement => {
    const mine = message.sender_id !== null && message.sender_id === myId;
    const images = message.attachments.filter((a) => a.kind === 'image');
    const imageUrls = images.map((a) => signed[a.storage_path]).filter((url): url is string => typeof url === 'string');
    const voices = message.attachments.filter((a) => a.kind === 'audio');
    return (
      <View key={message.id} style={[styles.bubbleWrap, mine ? styles.bubbleWrapMine : styles.bubbleWrapTheirs]}>
        <Text style={styles.sender} numberOfLines={1}>
          {mine
            ? t('feedback:support.thread_you')
            : message.sender_display_name_snapshot
              ? `${message.sender_display_name_snapshot} · Mingla`
              : t('feedback:support.mingla_support')}
        </Text>
        {message.content.length > 0 ? (
          <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
            <Text style={styles.bubbleText} selectable>{message.content}</Text>
          </View>
        ) : null}
        {voices.map((voice) => (
          <View key={voice.id} style={styles.voiceWrap}>
            <VoiceNotePlayer uri={signed[voice.storage_path] ?? null} durationMs={voice.duration_ms ?? 0} />
          </View>
        ))}
        {images.length > 0 ? (
          <View style={styles.images}>
            {images.map((attachment, index) => {
              const url = signed[attachment.storage_path];
              return (
                <Pressable
                  key={attachment.id}
                  disabled={!url}
                  onPress={() => {
                    if (url) setLightbox({ images: imageUrls, index: Math.max(0, imageUrls.indexOf(url)) });
                  }}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={url ? t('feedback:support.image_open', { index: index + 1 }) : t('feedback:support.image_unavailable')}
                  style={styles.image}
                >
                  {url ? (
                    <Image source={{ uri: url }} style={styles.imageFill} resizeMode="cover" />
                  ) : (
                    <Icon name="images-outline" size={18} color="rgba(255,255,255,0.4)" />
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <Text style={styles.time}>{when(message.created_at)}</Text>
      </View>
    );
  }, [t]);

  const myId = useMemo(() => {
    // The requester is the signed-in person; their messages are "You".
    return ticket?.requester_user_id ?? null;
  }, [ticket]);

  const header = (
    <SupportHeader
      title={ticket?.subject ?? t('feedback:support.title')}
      subtitle={ticket ? [formatTicketNumber(ticket.ticket_number), ticket.topic ? t(`feedback:support.topic_${ticket.topic}`) : null].filter(Boolean).join(' · ') : null}
      backLabel={t('feedback:support.back')}
      onBack={goBack}
      topInset={insets.top}
      right={ticket ? <SupportStatusPill status={ticket.status} /> : null}
    />
  );

  if (thread.isLoading) {
    return (
      <View style={supportStyles.screen}>
        {header}
        <View style={supportStyles.state}><ActivityIndicator color="#ffffff" /></View>
      </View>
    );
  }
  if (thread.isError || data === null) {
    return (
      <View style={supportStyles.screen}>
        {header}
        <View style={supportStyles.state}>
          <Text style={supportStyles.stateText}>{t('feedback:support.thread_load_error')}</Text>
          <Pressable onPress={() => void thread.refetch()} accessibilityRole="button" style={supportStyles.secondaryButton}>
            <Text style={supportStyles.secondaryButtonText}>{t('feedback:support.try_again')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  if (ticket === null) {
    return (
      <View style={supportStyles.screen}>
        {header}
        <View style={supportStyles.state}>
          <Text style={supportStyles.stateText}>{t('feedback:support.thread_not_found')}</Text>
          <Pressable onPress={() => router.replace('/support' as never)} accessibilityRole="button" style={supportStyles.secondaryButton}>
            <Text style={supportStyles.secondaryButtonText}>{t('feedback:support.title')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const kind = supportStatusKind(ticket.status);
  const nextUpdate = upcomingNextUpdate(ticket.next_update_at);
  const bannerText = justSent && kind === 'waiting_mingla' && data.messages.every((m) => m.sender_id === myId)
    ? t('feedback:support.sent_banner')
    : kind === 'resolved'
      ? t('feedback:support.thread_resolved_body')
      : kind === 'closed'
        ? t('feedback:support.thread_closed_body')
        : nextUpdate !== null
          ? t('feedback:support.thread_next_update', { when: when(nextUpdate) })
          : null;
  const composerMode = supportComposerMode(ticket.status);
  const productBanner = data.productStage !== null ? supportProductBannerKeys(data.productStage) : null;

  return (
    <View style={supportStyles.screen}>
      {header}
      <KeyboardAwareView dismissOnTap={false} bottomOffset={insets.bottom}>
        {bannerText !== null ? (
          <View style={[styles.banner, kind === 'resolved' && styles.bannerResolved, kind === 'closed' && styles.bannerClosed]} testID="support-thread-banner">
            <Text style={styles.bannerText}>{bannerText}</Text>
          </View>
        ) : null}
        {productBanner !== null ? (
          <View style={[styles.banner, styles.bannerProduct]} testID="support-thread-product-banner" accessibilityRole="summary">
            <Text style={styles.bannerTitle}>{t(`feedback:${productBanner.title}`)}</Text>
            <Text style={styles.bannerText}>{t(`feedback:${productBanner.body}`)}</Text>
          </View>
        ) : null}
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {data.messages.length === 0 ? (
            <Text style={supportStyles.stateText}>{t('feedback:support.thread_empty')}</Text>
          ) : (
            data.messages.map((message) => bubble(message, data.signed, myId))
          )}
        </ScrollView>
        {composerMode === 'start_new' ? (
          <View style={[styles.closedBox, { paddingBottom: Math.max(insets.bottom, 12) }]} testID="support-thread-closed">
            <Pressable onPress={() => router.replace('/support/new' as never)} accessibilityRole="button" style={supportStyles.primaryButton}>
              <Icon name="add" size={20} color="#ffffff" />
              <Text style={supportStyles.primaryButtonText}>{t('feedback:support.start_new')}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {screenshots.length > 0 ? (
              <ScreenshotGrid
                screenshots={screenshots}
                onRemove={(index) => setScreenshots((prev) => prev.filter((_, i) => i !== index))}
                onAdd={() => void pickScreenshots()}
                canAdd={screenshots.length < MAX_SUPPORT_SCREENSHOTS}
                disabled={busy}
              />
            ) : null}
            <View style={styles.composer}>
              <Pressable
                onPress={() => void pickScreenshots()}
                disabled={busy || screenshots.length >= MAX_SUPPORT_SCREENSHOTS}
                accessibilityRole="button"
                accessibilityLabel={t('feedback:support.attach')}
                style={styles.attach}
              >
                <Icon name="add" size={20} color="#ffffff" />
              </Pressable>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={justSent ? t('feedback:support.add_details_placeholder') : t('feedback:support.reply_placeholder')}
                placeholderTextColor="rgba(255,255,255,0.4)"
                multiline
                style={styles.input}
                accessibilityLabel={t('feedback:support.reply_placeholder')}
                testID="support-thread-input"
              />
              <Pressable
                onPress={() => void send()}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel={t('feedback:support.send_reply')}
                accessibilityState={{ disabled: !canSend, busy }}
                style={[styles.sendButton, !canSend && styles.sendDisabled]}
                testID="support-thread-send"
              >
                {busy ? <ActivityIndicator color="#ffffff" /> : <Icon name="send" size={18} color="#ffffff" />}
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAwareView>
      <ImageLightbox
        images={lightbox?.images ?? []}
        initialIndex={lightbox?.index ?? 0}
        visible={lightbox !== null}
        onClose={() => setLightbox(null)}
      />
      <ToastContainer />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(235,120,37,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(235,120,37,0.35)',
  },
  bannerResolved: { backgroundColor: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.35)' },
  bannerClosed: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)' },
  bannerProduct: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)' },
  bannerTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '700', lineHeight: 19 },
  bannerText: { color: '#f8fafc', fontSize: 13, lineHeight: 18 },
  messages: { flex: 1 },
  messagesContent: { padding: 12, gap: 12 },
  bubbleWrap: { maxWidth: '82%', gap: 4 },
  bubbleWrapMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleWrapTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  sender: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMine: { backgroundColor: SUPPORT_ACCENT, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: 'rgba(255,255,255,0.10)', borderBottomLeftRadius: 6 },
  bubbleText: { color: '#f8fafc', fontSize: 15, lineHeight: 21 },
  voiceWrap: { minWidth: 220 },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  image: {
    width: 84,
    height: 84,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  imageFill: { width: '100%', height: '100%' },
  time: { color: 'rgba(255,255,255,0.35)', fontSize: 11 },
  closedBox: { paddingHorizontal: 12, paddingTop: 8 },
  composerWrap: { paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  attach: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    color: '#f8fafc',
    fontSize: 15,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SUPPORT_ACCENT,
  },
  sendDisabled: { opacity: 0.4 },
});
