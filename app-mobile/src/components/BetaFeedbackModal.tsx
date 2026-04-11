import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  Platform,
  Image,
  ScrollView,
  Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { Icon } from './ui/Icon';
import { colors, spacing, radius, typography, fontWeights } from '../constants/designSystem';
import {
  feedbackRecorder,
  betaFeedbackService,
  MAX_FEEDBACK_DURATION_MS,
  MIN_FEEDBACK_DURATION_MS,
  MAX_SCREENSHOTS,
  type FeedbackCategory,
  type SubmitFeedbackRequest,
} from '../services/betaFeedbackService';
import { getDeviceInfo } from '../services/deviceInfoService';
import { getSessionDurationMs } from '../services/sessionTracker';
import { useSubmitFeedback } from '../hooks/useBetaFeedback';
import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';

// ── Types ───────────────────────────────────────────────────────────────────

interface BetaFeedbackModalProps {
  visible: boolean;
  onClose: () => void;
  screenBefore: string;
}

type ModalStep = 'category' | 'recording' | 'review' | 'submitting' | 'success' | 'error';

interface CategoryOption {
  key: FeedbackCategory;
  label: string;
  icon: string;
}

// Category labels resolved via i18n inside component
const CATEGORY_ICONS: Record<FeedbackCategory, string> = {
  bug: 'alert-circle',
  feature_request: 'star',
  ux_issue: 'alert-triangle',
  general: 'chatbubble-outline',
};
const CATEGORY_KEYS: FeedbackCategory[] = ['bug', 'feature_request', 'ux_issue', 'general'];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTimer(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function BetaFeedbackModal({
  visible,
  onClose,
  screenBefore,
}: BetaFeedbackModalProps) {
  const { t } = useTranslation(['feedback', 'common']);
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);

  const CATEGORY_LABEL_MAP: Record<FeedbackCategory, string> = {
    bug: t('feedback:modal.category_bug'),
    feature_request: t('feedback:modal.category_feature'),
    ux_issue: t('feedback:modal.category_ux'),
    general: t('feedback:modal.category_general'),
  };
  const CATEGORIES: CategoryOption[] = CATEGORY_KEYS.map((key) => ({
    key,
    label: CATEGORY_LABEL_MAP[key],
    icon: CATEGORY_ICONS[key],
  }));
  const submitMutation = useSubmitFeedback();

  // State
  const [step, setStep] = useState<ModalStep>('category');
  const [selectedCategory, setSelectedCategory] = useState<FeedbackCategory | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [playbackSound, setPlaybackSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedScreenshots, setSelectedScreenshots] = useState<
    Array<{ uri: string; width: number; height: number }>
  >([]);
  const [permissionMessage, setPermissionMessage] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Cleanup on close ────────────────────────────────────────────────────

  const resetState = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    if (successCloseRef.current) clearTimeout(successCloseRef.current);
    timerRef.current = null;
    autoStopRef.current = null;
    successCloseRef.current = null;

    if (feedbackRecorder.isRecording()) {
      await feedbackRecorder.cancelRecording();
    }

    if (playbackSound) {
      try { await playbackSound.unloadAsync(); } catch (e) { console.warn('[BetaFeedbackModal] Sound unload failed:', e); }
      setPlaybackSound(null);
    }

    // Always revert audio mode, even if we weren't actively recording.
    // Handles the case where initialize() set allowsRecordingIOS:true but recording failed.
    await feedbackRecorder.resetAudioMode();

    setStep('category');
    setSelectedCategory(null);
    setElapsedMs(0);
    setRecordedUri(null);
    setRecordedDurationMs(0);
    setErrorMessage('');
    setIsPlaying(false);
    setSelectedScreenshots([]);
    setPermissionMessage('');
  }, [playbackSound]);

  const handleClose = useCallback(async () => {
    await resetState();
    onClose();
  }, [resetState, onClose]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      if (successCloseRef.current) clearTimeout(successCloseRef.current);
    };
  }, []);

  // Clean up when modal is hidden externally (e.g., tab switch auto-close).
  // handleClose() normally runs resetState() before calling onClose(), but when
  // visible becomes false through other paths (isTabVisible effect), resetState()
  // is skipped. This catches all close paths.
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (prevVisibleRef.current && !visible) {
      resetState();
    }
    prevVisibleRef.current = visible;
  }, [visible, resetState]);

  // ── Recording Logic ─────────────────────────────────────────────────────

  const startRecording = async () => {
    const started = await feedbackRecorder.startRecording();
    if (!started) {
      setErrorMessage(t('feedback:modal.error_recording_failed'));
      setStep('error');
      return;
    }

    setStep('recording');
    setElapsedMs(0);

    // Timer tick every 250ms for smooth display
    timerRef.current = setInterval(() => {
      setElapsedMs(feedbackRecorder.getElapsedMs());
    }, 250);

    // Auto-stop at max duration
    autoStopRef.current = setTimeout(async () => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await stopRecording();
    }, MAX_FEEDBACK_DURATION_MS);
  };

  const stopRecording = async () => {
    // Guard: if recorder already stopped (e.g. auto-stop raced with manual tap), bail out
    if (!feedbackRecorder.isRecording()) return;

    if (timerRef.current) clearInterval(timerRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    timerRef.current = null;
    autoStopRef.current = null;

    const result = await feedbackRecorder.stopRecording();
    if (!result) {
      setErrorMessage(t('feedback:modal.error_recording_failed'));
      setStep('error');
      return;
    }

    // Enforce minimum duration
    if (result.durationMs < MIN_FEEDBACK_DURATION_MS) {
      setErrorMessage(t('feedback:modal.error_too_short'));
      setStep('error');
      return;
    }

    setRecordedUri(result.uri);
    setRecordedDurationMs(result.durationMs);
    setStep('review');
  };

  const cancelRecording = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    timerRef.current = null;
    autoStopRef.current = null;

    await feedbackRecorder.cancelRecording();
    setStep('category');
    setElapsedMs(0);
  };

  // ── Playback Logic ──────────────────────────────────────────────────────

  const togglePlayback = async () => {
    if (!recordedUri) return;

    if (isPlaying && playbackSound) {
      await playbackSound.pauseAsync();
      setIsPlaying(false);
      return;
    }

    if (playbackSound) {
      await playbackSound.playAsync();
      setIsPlaying(true);
      return;
    }

    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: recordedUri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlaying(false);
          }
        },
      );
      setPlaybackSound(sound);
      setIsPlaying(true);
    } catch (error) {
      console.error('[BetaFeedbackModal] Playback error:', error);
    }
  };

  const reRecord = async () => {
    if (playbackSound) {
      try { await playbackSound.unloadAsync(); } catch (e) { console.warn('[BetaFeedbackModal] Sound unload failed:', e); }
      setPlaybackSound(null);
    }
    setIsPlaying(false);
    setRecordedUri(null);
    setRecordedDurationMs(0);
    setStep('category');
  };

  // ── Screenshot Logic ─────────────────────────────────────────────────────

  const pickScreenshots = async (): Promise<void> => {
    const remaining = MAX_SCREENSHOTS - selectedScreenshots.length;
    if (remaining <= 0) return;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setPermissionMessage(t('feedback:modal.permission_photos'));
      return;
    }
    setPermissionMessage('');

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
      exif: false,
    });

    if (result.canceled || !result.assets?.length) return;

    const newImages = result.assets.map((asset) => ({
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
    }));

    setSelectedScreenshots((prev) => [...prev, ...newImages].slice(0, MAX_SCREENSHOTS));
  };

  const removeScreenshot = (index: number): void => {
    setSelectedScreenshots((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Submit Logic ────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!recordedUri || !selectedCategory || !user?.id) return;

    setStep('submitting');

    try {
      // Upload audio
      const audioPath = await betaFeedbackService.uploadFeedbackAudio(user.id, recordedUri);

      // Upload screenshots (only if any selected)
      let screenshotPaths: string[] | undefined;
      if (selectedScreenshots.length > 0) {
        screenshotPaths = await betaFeedbackService.uploadFeedbackScreenshots(
          user.id,
          selectedScreenshots,
        );
      }

      // Collect metadata
      const deviceInfo = getDeviceInfo();
      const sessionDurationMs = getSessionDurationMs();

      // Try to get location (best-effort)
      let latitude: number | undefined;
      let longitude: number | undefined;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getLastKnownPositionAsync();
          if (loc) {
            latitude = loc.coords.latitude;
            longitude = loc.coords.longitude;
          }
        }
      } catch {
        // Location is optional — proceed without it
      }

      const params: SubmitFeedbackRequest = {
        category: selectedCategory,
        audio_path: audioPath,
        audio_duration_ms: recordedDurationMs,
        device_os: deviceInfo.device_os,
        device_os_version: deviceInfo.device_os_version,
        device_model: deviceInfo.device_model,
        app_version: deviceInfo.app_version,
        screen_before: screenBefore,
        session_duration_ms: sessionDurationMs,
        latitude,
        longitude,
        screenshot_paths: screenshotPaths,
      };

      await submitMutation.mutateAsync(params);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep('success');

      // Auto-close after 2 seconds — store ref so resetState() can cancel it
      // if the modal is closed/reopened before the timer fires.
      successCloseRef.current = setTimeout(() => {
        handleClose();
      }, 2000);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Something went wrong';
      setErrorMessage(msg);
      setStep('error');
    }
  };

  // ── Render Helpers ──────────────────────────────────────────────────────

  const renderCategory = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>{t('feedback:modal.category_title')}</Text>
      <Text style={styles.stepSubtitle}>{t('feedback:modal.category_subtitle')}</Text>

      <View style={styles.categoryGrid}>
        {CATEGORIES.map((cat) => {
          const isSelected = selectedCategory === cat.key;
          return (
            <TouchableOpacity
              key={cat.key}
              style={[styles.categoryPill, isSelected && styles.categoryPillSelected]}
              onPress={() => {
                setSelectedCategory(cat.key);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              activeOpacity={0.7}
            >
              <Icon
                name={cat.icon}
                size={20}
                color={isSelected ? colors.text.inverse : colors.text.secondary}
              />
              <Text style={[styles.categoryLabel, isSelected && styles.categoryLabelSelected]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, !selectedCategory && styles.primaryButtonDisabled]}
        onPress={startRecording}
        disabled={!selectedCategory}
        activeOpacity={0.7}
      >
        <Icon name="mic-outline" size={20} color={colors.text.inverse} />
        <Text style={styles.primaryButtonText}>{t('feedback:modal.start_recording')}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderRecording = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>{t('feedback:modal.recording_title')}</Text>

      <View style={styles.timerContainer}>
        <View style={styles.recordingDot} />
        <Text style={styles.timerText}>{formatTimer(elapsedMs)}</Text>
        <Text style={styles.timerLimit}> {t('feedback:modal.timer_limit')}</Text>
      </View>

      <View style={styles.recordingActions}>
        <TouchableOpacity style={styles.secondaryButton} onPress={cancelRecording} activeOpacity={0.7}>
          <Text style={styles.secondaryButtonText}>{t('common:cancel')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.stopButton} onPress={stopRecording} activeOpacity={0.7}>
          <View style={styles.stopSquare} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderReview = () => {
    const thumbWidth = (Dimensions.get('window').width - spacing.lg * 2 - spacing.sm * 2) / 3;
    return (
      <View style={styles.stepContainer}>
        <ScrollView style={styles.reviewScrollContainer} showsVerticalScrollIndicator={false}>
          <Text style={styles.stepTitle}>{t('feedback:modal.review_title')}</Text>
          <Text style={styles.stepSubtitle}>{t('feedback:modal.recorded_duration', { duration: formatTimer(recordedDurationMs) })}</Text>

          <TouchableOpacity style={styles.playButton} onPress={togglePlayback} activeOpacity={0.7}>
            <Icon name={isPlaying ? 'pause' : 'play'} size={24} color={colors.primary[500]} />
            <Text style={styles.playButtonText}>{isPlaying ? t('common:pause') : t('common:play')}</Text>
          </TouchableOpacity>

          {/* ── Screenshots Section (optional) ─────────────────────────── */}
          <View style={styles.screenshotSectionDivider}>
            <Text style={styles.screenshotSectionTitle}>
              {selectedScreenshots.length > 0
                ? t('feedback:modal.screenshots_count', { count: selectedScreenshots.length, max: MAX_SCREENSHOTS })
                : t('feedback:modal.screenshots_title')}
            </Text>
            <Text style={styles.screenshotSectionHint}>{t('feedback:modal.screenshots_hint')}</Text>
          </View>

          {permissionMessage !== '' && (
            <Text style={styles.permissionMessage}>{permissionMessage}</Text>
          )}

          {selectedScreenshots.length > 0 && (
            <View style={styles.screenshotGrid}>
              {selectedScreenshots.map((img, index) => (
                <View
                  key={`${img.uri}-${index}`}
                  style={[styles.screenshotThumb, { width: thumbWidth, height: thumbWidth }]}
                >
                  <Image
                    source={{ uri: img.uri }}
                    style={styles.screenshotImage}
                    resizeMode="cover"
                  />
                  <TouchableOpacity
                    style={styles.screenshotRemove}
                    onPress={() => removeScreenshot(index)}
                    hitSlop={8}
                    accessibilityLabel={`Remove screenshot ${index + 1}`}
                  >
                    <Icon name="close-circle" size={22} color={colors.error[500]} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {selectedScreenshots.length < MAX_SCREENSHOTS && (
            <TouchableOpacity
              style={styles.addScreenshotButton}
              onPress={pickScreenshots}
              activeOpacity={0.7}
              accessibilityLabel={t('feedback:modal.add_screenshots_accessibility')}
            >
              <Icon name="images-outline" size={20} color={colors.primary[500]} />
              <Text style={styles.addScreenshotText}>
                {selectedScreenshots.length === 0 ? t('feedback:modal.add_from_library') : t('feedback:modal.add_more')}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* ── Action Buttons (always visible at bottom) ──────────────── */}
        <View style={styles.reviewActions}>
          <TouchableOpacity style={styles.secondaryButton} onPress={reRecord} activeOpacity={0.7}>
            <Text style={styles.secondaryButtonText}>{t('feedback:modal.re_record')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.primaryButton} onPress={handleSubmit} activeOpacity={0.7}>
            <Text style={styles.primaryButtonText}>{t('common:submit')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderSubmitting = () => (
    <View style={styles.centeredStep}>
      <ActivityIndicator size="large" color={colors.primary[500]} />
      <Text style={styles.submittingText}>{t('feedback:modal.submitting')}</Text>
    </View>
  );

  const renderSuccess = () => (
    <View style={styles.centeredStep}>
      <Icon name="checkmark-circle" size={56} color={colors.success[500]} />
      <Text style={styles.successText}>{t('feedback:modal.success_title')}</Text>
      <Text style={styles.stepSubtitle}>{t('feedback:modal.success_body')}</Text>
    </View>
  );

  const renderError = () => (
    <View style={styles.centeredStep}>
      <Icon name="alert-circle" size={48} color={colors.error[500]} />
      <Text style={styles.errorText}>{errorMessage}</Text>
      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => setStep(recordedUri ? 'review' : 'category')}
        activeOpacity={0.7}
      >
        <Text style={styles.secondaryButtonText}>{t('common:try_again')}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderStep = () => {
    switch (step) {
      case 'category': return renderCategory();
      case 'recording': return renderRecording();
      case 'review': return renderReview();
      case 'submitting': return renderSubmitting();
      case 'success': return renderSuccess();
      case 'error': return renderError();
    }
  };

  // ── Main Render ─────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={step === 'recording' ? undefined : handleClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
          onPress={() => {}} // Prevent backdrop press propagation
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>{t('feedback:modal.header')}</Text>
              {step !== 'submitting' && step !== 'success' && (
                <TouchableOpacity onPress={handleClose} hitSlop={8}>
                  <Icon name="close" size={24} color={colors.gray[400]} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Content */}
          {renderStep()}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background.primary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    minHeight: 320,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray[300],
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  headerTitle: {
    ...typography.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },

  // Steps
  stepContainer: {
    paddingVertical: spacing.md,
  },
  centeredStep: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  stepTitle: {
    ...typography.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  stepSubtitle: {
    ...typography.sm,
    color: colors.text.tertiary,
    marginBottom: spacing.md,
  },

  // Category
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.gray[200],
    backgroundColor: colors.background.secondary,
  },
  categoryPillSelected: {
    backgroundColor: colors.primary[500],
    borderColor: colors.primary[500],
  },
  categoryLabel: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
  },
  categoryLabelSelected: {
    color: colors.text.inverse,
  },

  // Buttons
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary[500],
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryButtonText: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[300],
  },
  secondaryButtonText: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.secondary,
  },

  // Recording
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.xs,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.error[500],
    marginRight: spacing.sm,
  },
  timerText: {
    fontSize: 40,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    fontVariant: ['tabular-nums'],
  },
  timerLimit: {
    ...typography.md,
    color: colors.text.tertiary,
    alignSelf: 'flex-end',
    marginBottom: 6,
  },
  recordingActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xl,
  },
  stopButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.error[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSquare: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: colors.error[500],
  },

  // Review
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
  },
  playButtonText: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.primary[500],
  },
  reviewActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },

  // Review scroll (content scrolls, buttons stay pinned below)
  reviewScrollContainer: {
    maxHeight: 340,
  },

  // Screenshots (inline on review step)
  screenshotSectionDivider: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray[200],
    marginBottom: spacing.sm,
  },
  screenshotSectionTitle: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: 2,
  },
  screenshotSectionHint: {
    ...typography.xs,
    color: colors.text.tertiary,
    marginBottom: spacing.sm,
  },
  screenshotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  screenshotThumb: {
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative' as const,
  },
  screenshotImage: {
    width: '100%',
    height: '100%',
  },
  screenshotRemove: {
    position: 'absolute' as const,
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 11,
  },
  addScreenshotButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary[200],
    borderStyle: 'dashed' as const,
    backgroundColor: colors.primary[50],
  },
  addScreenshotText: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.primary[500],
  },
  permissionMessage: {
    ...typography.xs,
    color: colors.warning[600],
    marginBottom: spacing.sm,
  },

  // Status
  submittingText: {
    ...typography.md,
    color: colors.text.secondary,
  },
  successText: {
    ...typography.xl,
    fontWeight: fontWeights.semibold,
    color: colors.success[600],
  },
  errorText: {
    ...typography.sm,
    color: colors.error[600],
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
});
