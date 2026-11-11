/**
 * #4382 Wave 5 — the Explorer new request (journey 1, steps 3–5). Replaces
 * BetaFeedbackModal.
 *
 *   1 of 3  topic: six tiles in the words people use
 *   2 of 3  type, or record a voice note (the beta recorder, up to 5 min);
 *           either one is enough
 *   3 of 3  up to 10 screenshots (optional), the device line, Send
 *
 * On Send: the voice note and screenshots are registered and uploaded to
 * the private support-attachments bucket against the request id, then
 * issue_4382_create_customer_ticket creates the request with client_meta
 * (app version, OS, OS version, device model, source screen). No location
 * is read or sent. The request id and finished uploads are kept across a
 * retry, so a retry never makes a second request.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useCreateSupportRequest } from '../../hooks/useSupportRequests';
import { getDeviceInfo } from '../../services/deviceInfoService';
import {
  supportVoiceRecorder,
  uploadSupportScreenshot,
  uploadSupportVoiceNote,
} from '../../services/supportTicketService';
import { requestGalleryPermission } from '../../utils/mediaLibraryPermission';
import { createClientMessageId } from '../../utils/mergeMessages';
import {
  EXPLORER_SUPPORT_TOPICS,
  MAX_SUPPORT_SCREENSHOTS,
  MAX_VOICE_NOTE_MS,
  SUPPORT_MESSAGE_MAX,
  addScreenshots,
  formatVoiceDuration,
  supportRoutePath,
  voiceNoteRefusal,
  type ExplorerSupportTopic,
  type SupportScreenshot,
} from '../../utils/supportRequestModel';
import { Icon } from '../ui/Icon';
import { KeyboardAwareView } from '../ui/KeyboardAwareView';
import { toastManager } from '../ui/Toast';
import { ToastContainer } from '../ui/ToastContainer';
import { ScreenshotGrid, SupportHeader, VoiceNotePlayer, SUPPORT_ACCENT, supportStyles } from './supportUi';

type Step = 1 | 2 | 3;

const TOPIC_ICONS: Record<ExplorerSupportTopic, string> = {
  broken: 'alert-triangle',
  bookings_payments: 'card-outline',
  idea: 'sparkles-outline',
  confusing: 'help-circle-outline',
  account: 'person-outline',
  other: 'chatbubble-outline',
};

export function SupportNewRequestScreen(): React.ReactElement {
  const { t } = useTranslation(['feedback', 'common']);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ from?: string | string[] }>();
  const sourceScreen = (Array.isArray(params.from) ? params.from[0] : params.from) || 'help_support';
  const create = useCreateSupportRequest();

  const [step, setStep] = useState<Step>(1);
  const [topic, setTopic] = useState<ExplorerSupportTopic | null>(null);
  const [text, setText] = useState('');
  const [voice, setVoice] = useState<{ uri: string; durationMs: number } | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [screenshots, setScreenshots] = useState<SupportScreenshot[]>([]);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const requestIdRef = useRef<string>(createClientMessageId());
  const uploadedRef = useRef<Map<string, string>>(new Map());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const device = useMemo(() => getDeviceInfo(), []);

  const clearTimers = useCallback((): void => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    timerRef.current = null;
    autoStopRef.current = null;
  }, []);

  // Leaving the screen mid-recording releases the microphone and audio mode.
  useEffect(() => () => {
    clearTimers();
    void supportVoiceRecorder.cancelRecording().finally(() => supportVoiceRecorder.resetAudioMode());
  }, [clearTimers]);

  const close = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace('/support' as never);
  }, [router]);

  const back = useCallback((): void => {
    if (sending) return;
    if (step === 1) close();
    else setStep((step - 1) as Step);
  }, [sending, step, close]);

  const stopRecording = useCallback(async (): Promise<void> => {
    if (!supportVoiceRecorder.isRecording()) return;
    clearTimers();
    setRecording(false);
    const result = await supportVoiceRecorder.stopRecording();
    if (!result) {
      toastManager.show(t('feedback:support.voice_failed'), 'error');
      return;
    }
    const refusal = voiceNoteRefusal(result.durationMs, null);
    if (refusal === 'too_short') {
      toastManager.show(t('feedback:support.voice_too_short'), 'error');
      return;
    }
    setVoice({ uri: result.uri, durationMs: Math.min(result.durationMs, MAX_VOICE_NOTE_MS) });
  }, [clearTimers, t]);

  const startRecording = useCallback(async (): Promise<void> => {
    const started = await supportVoiceRecorder.startRecording();
    if (!started) {
      toastManager.show(t('feedback:support.voice_failed'), 'error');
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVoice(null);
    setRecording(true);
    setElapsedMs(0);
    timerRef.current = setInterval(() => setElapsedMs(supportVoiceRecorder.getElapsedMs()), 250);
    autoStopRef.current = setTimeout(() => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      void stopRecording();
    }, MAX_VOICE_NOTE_MS);
  }, [stopRecording, t]);

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
      if (next.dropped > 0) {
        toastManager.show(t('feedback:support.too_many_screenshots', { max: MAX_SUPPORT_SCREENSHOTS }), 'warning');
      }
    } catch (error) {
      console.warn('[Support] screenshot picker failed:', error);
      toastManager.show(t('feedback:support.photos_permission'), 'error');
    }
  }, [screenshots, t]);

  const send = useCallback(async (): Promise<void> => {
    if (topic === null || sending) return;
    setSending(true);
    try {
      const uploads: Array<{ key: string; run: () => Promise<string> }> = [];
      if (voice !== null) {
        uploads.push({ key: voice.uri, run: () => uploadSupportVoiceNote(requestIdRef.current, voice) });
      }
      for (const shot of screenshots) {
        uploads.push({ key: shot.uri, run: () => uploadSupportScreenshot(requestIdRef.current, shot) });
      }
      const attachmentIds: string[] = [];
      setProgress(uploads.length > 0 ? { done: 0, total: uploads.length } : null);
      for (const [index, upload] of uploads.entries()) {
        let id = uploadedRef.current.get(upload.key);
        if (id === undefined) {
          id = await upload.run();
          uploadedRef.current.set(upload.key, id);
        }
        attachmentIds.push(id);
        setProgress({ done: index + 1, total: uploads.length });
      }
      const ticketId = await create.mutateAsync({
        clientRequestId: requestIdRef.current,
        topic,
        message: text,
        attachmentIds,
        clientMeta: {
          app_version: device.app_version,
          os: device.device_os,
          os_version: device.device_os_version,
          device_model: device.device_model,
          source_screen: sourceScreen,
        },
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`${supportRoutePath(ticketId)}?sent=1` as never);
    } catch (error) {
      console.warn('[Support] sending the request failed:', error);
      toastManager.show(t('feedback:support.send_failed'), 'error');
    } finally {
      setSending(false);
      setProgress(null);
    }
  }, [topic, sending, voice, screenshots, create, text, device, sourceScreen, router, t]);

  const hasWords = text.trim().length > 0;
  const canNext = step === 1 ? topic !== null : step === 2 ? (hasWords || voice !== null) && !recording : true;

  return (
    <View style={supportStyles.screen}>
      <SupportHeader
        title={t('feedback:support.step_of', { step })}
        backLabel={step === 1 ? t('feedback:support.cancel') : t('feedback:support.back')}
        onBack={back}
        topInset={insets.top}
      />
      <KeyboardAwareView dismissOnTap={false} bottomOffset={insets.bottom}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 1 ? (
            <>
              <Text style={styles.title}>{t('feedback:support.step1_title')}</Text>
              <View style={styles.tiles} accessibilityRole="radiogroup">
                {EXPLORER_SUPPORT_TOPICS.map((key) => {
                  const selected = topic === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => {
                        setTopic(key);
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={t(`feedback:support.topic_${key}`)}
                      style={[styles.tile, selected && styles.tileSelected]}
                      testID={`support-topic-${key}`}
                    >
                      <Icon name={TOPIC_ICONS[key]} size={22} color={selected ? '#ffffff' : 'rgba(255,255,255,0.75)'} />
                      <Text style={styles.tileTitle}>{t(`feedback:support.topic_${key}`)}</Text>
                      <Text style={styles.tileHint}>{t(`feedback:support.topic_${key}_hint`)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : step === 2 ? (
            <>
              <Text style={styles.title}>{t('feedback:support.step2_title')}</Text>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={t('feedback:support.step2_placeholder')}
                placeholderTextColor="rgba(255,255,255,0.4)"
                multiline
                maxLength={SUPPORT_MESSAGE_MAX}
                textAlignVertical="top"
                style={styles.textArea}
                accessibilityLabel={t('feedback:support.step2_title')}
                testID="support-text"
              />
              <Text style={styles.or}>{t('feedback:support.step2_or')}</Text>
              {voice !== null && !recording ? (
                <VoiceNotePlayer uri={voice.uri} durationMs={voice.durationMs} onRemove={() => setVoice(null)} />
              ) : (
                <Pressable
                  onPress={() => void (recording ? stopRecording() : startRecording())}
                  accessibilityRole="button"
                  accessibilityLabel={recording ? t('feedback:support.record_stop') : t('feedback:support.record_start')}
                  style={[styles.record, recording && styles.recordActive]}
                  testID="support-record"
                >
                  <Icon name={recording ? 'stop' : 'mic-outline'} size={22} color="#ffffff" />
                  <Text style={styles.recordText}>
                    {recording
                      ? t('feedback:support.recording', { time: formatVoiceDuration(elapsedMs) })
                      : t('feedback:support.record_hint')}
                  </Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              <Text style={styles.title}>{t('feedback:support.step3_title')}</Text>
              <Text style={styles.hint}>{t('feedback:support.step3_hint', { max: MAX_SUPPORT_SCREENSHOTS })}</Text>
              <ScreenshotGrid
                screenshots={screenshots}
                onRemove={(index) => setScreenshots((prev) => prev.filter((_, i) => i !== index))}
                onAdd={() => void pickScreenshots()}
                canAdd={screenshots.length < MAX_SUPPORT_SCREENSHOTS}
                disabled={sending}
              />
              <Text style={styles.deviceNote} testID="support-device-note">
                {t('feedback:support.device_note', {
                  app: device.app_version,
                  device: device.device_model,
                  os: `${device.device_os} ${device.device_os_version}`,
                })}
              </Text>
            </>
          )}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable
            onPress={() => {
              if (step < 3) setStep((step + 1) as Step);
              else void send();
            }}
            disabled={!canNext || sending}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canNext || sending, busy: sending }}
            style={[supportStyles.primaryButton, (!canNext || sending) && supportStyles.primaryButtonDisabled]}
            testID="support-next"
          >
            {sending ? <ActivityIndicator color="#ffffff" /> : null}
            <Text style={supportStyles.primaryButtonText}>
              {step < 3
                ? t('feedback:support.next')
                : sending
                  ? progress !== null && progress.done < progress.total
                    ? t('feedback:support.uploading', { done: progress.done + 1, total: progress.total })
                    : t('feedback:support.sending')
                  : t('feedback:support.send')}
            </Text>
          </Pressable>
        </View>
      </KeyboardAwareView>
      <ToastContainer />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  title: { color: '#f8fafc', fontSize: 22, fontWeight: '700' },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48%',
    flexGrow: 1,
    minHeight: 104,
    padding: 14,
    gap: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  tileSelected: { backgroundColor: 'rgba(235,120,37,0.22)', borderColor: SUPPORT_ACCENT },
  tileTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  tileHint: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  textArea: {
    minHeight: 140,
    maxHeight: 260,
    padding: 14,
    borderRadius: 16,
    color: '#f8fafc',
    fontSize: 15,
    lineHeight: 21,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  or: { alignSelf: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  record: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  recordActive: { backgroundColor: 'rgba(239,68,68,0.30)' },
  recordText: { flex: 1, color: '#f8fafc', fontSize: 14 },
  deviceNote: { color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 17 },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
});
