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
} from 'react-native';
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
  type FeedbackCategory,
  type SubmitFeedbackRequest,
} from '../services/betaFeedbackService';
import { getDeviceInfo } from '../services/deviceInfoService';
import { getSessionDurationMs } from '../services/sessionTracker';
import { useSubmitFeedback } from '../hooks/useBetaFeedback';
import { useAppStore } from '../store/appStore';

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

const CATEGORIES: CategoryOption[] = [
  { key: 'bug', label: 'Bug', icon: 'alert-circle' },
  { key: 'feature_request', label: 'Feature Request', icon: 'star' },
  { key: 'ux_issue', label: 'UX Issue', icon: 'alert-triangle' },
  { key: 'general', label: 'General', icon: 'chatbubble-outline' },
];

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
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
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

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Cleanup on close ────────────────────────────────────────────────────

  const resetState = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    timerRef.current = null;
    autoStopRef.current = null;

    if (feedbackRecorder.isRecording()) {
      await feedbackRecorder.cancelRecording();
    }

    if (playbackSound) {
      try { await playbackSound.unloadAsync(); } catch (e) { console.warn('[BetaFeedbackModal] Sound unload failed:', e); }
      setPlaybackSound(null);
    }

    setStep('category');
    setSelectedCategory(null);
    setElapsedMs(0);
    setRecordedUri(null);
    setRecordedDurationMs(0);
    setErrorMessage('');
    setIsPlaying(false);
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
    };
  }, []);

  // ── Recording Logic ─────────────────────────────────────────────────────

  const startRecording = async () => {
    const started = await feedbackRecorder.startRecording();
    if (!started) {
      setErrorMessage('Could not start recording. Please check microphone permissions.');
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
      setErrorMessage('Recording failed. Please try again.');
      setStep('error');
      return;
    }

    // Enforce minimum duration
    if (result.durationMs < MIN_FEEDBACK_DURATION_MS) {
      setErrorMessage('Recording too short — please record at least 3 seconds.');
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

  // ── Submit Logic ────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!recordedUri || !selectedCategory || !user?.id) return;

    setStep('submitting');

    try {
      // Upload audio
      const audioPath = await betaFeedbackService.uploadFeedbackAudio(user.id, recordedUri);

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
      };

      await submitMutation.mutateAsync(params);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep('success');

      // Auto-close after 2 seconds
      setTimeout(() => {
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
      <Text style={styles.stepTitle}>What kind of feedback?</Text>
      <Text style={styles.stepSubtitle}>Select a category, then record your thoughts</Text>

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
        <Text style={styles.primaryButtonText}>Start Recording</Text>
      </TouchableOpacity>
    </View>
  );

  const renderRecording = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Recording...</Text>

      <View style={styles.timerContainer}>
        <View style={styles.recordingDot} />
        <Text style={styles.timerText}>{formatTimer(elapsedMs)}</Text>
        <Text style={styles.timerLimit}> / 05:00</Text>
      </View>

      <View style={styles.recordingActions}>
        <TouchableOpacity style={styles.secondaryButton} onPress={cancelRecording} activeOpacity={0.7}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.stopButton} onPress={stopRecording} activeOpacity={0.7}>
          <View style={styles.stopSquare} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderReview = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Review your feedback</Text>
      <Text style={styles.stepSubtitle}>{formatTimer(recordedDurationMs)} recorded</Text>

      <TouchableOpacity style={styles.playButton} onPress={togglePlayback} activeOpacity={0.7}>
        <Icon name={isPlaying ? 'pause' : 'play'} size={24} color={colors.primary[500]} />
        <Text style={styles.playButtonText}>{isPlaying ? 'Pause' : 'Play'}</Text>
      </TouchableOpacity>

      <View style={styles.reviewActions}>
        <TouchableOpacity style={styles.secondaryButton} onPress={reRecord} activeOpacity={0.7}>
          <Text style={styles.secondaryButtonText}>Re-record</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.primaryButton} onPress={handleSubmit} activeOpacity={0.7}>
          <Text style={styles.primaryButtonText}>Submit</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSubmitting = () => (
    <View style={styles.centeredStep}>
      <ActivityIndicator size="large" color={colors.primary[500]} />
      <Text style={styles.submittingText}>Submitting feedback...</Text>
    </View>
  );

  const renderSuccess = () => (
    <View style={styles.centeredStep}>
      <Icon name="checkmark-circle" size={56} color={colors.success[500]} />
      <Text style={styles.successText}>Thank you!</Text>
      <Text style={styles.stepSubtitle}>Your feedback has been submitted</Text>
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
        <Text style={styles.secondaryButtonText}>Try Again</Text>
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
              <Text style={styles.headerTitle}>Share Feedback</Text>
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
