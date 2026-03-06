import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { startRecording, stopRecording, getSignedAudioUrl } from '../../services/personAudioService';
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  shadows,
  touchTargets,
} from '../../constants/designSystem';

type RecorderState = 'idle' | 'recording' | 'preview' | 'done' | 'loading';

interface OnboardingAudioRecorderProps {
  onClipReady: (uri: string, duration: number) => void;
  onClipCleared?: () => void;
  onSkip?: () => void;
  maxDuration?: number; // default 60
  minDuration?: number; // minimum seconds required — hides skip, disables confirm if below
  /** When provided, component starts in "done" state and fetches a signed URL for playback. */
  initialClip?: { storagePath: string; duration: number };
}

export const OnboardingAudioRecorder: React.FC<OnboardingAudioRecorderProps> = ({
  onClipReady,
  onClipCleared,
  onSkip,
  maxDuration = 60,
  minDuration,
  initialClip,
}) => {
  const [state, setState] = useState<RecorderState>(initialClip ? 'loading' : 'idle');
  const [duration, setDuration] = useState(0);
  const [clipUri, setClipUri] = useState<string | null>(null);
  const [clipDuration, setClipDuration] = useState(initialClip?.duration ?? 0);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  // Restore from persisted clip on mount
  useEffect(() => {
    if (!initialClip) return;
    let cancelled = false;

    (async () => {
      try {
        const signedUrl = await getSignedAudioUrl(initialClip.storagePath);
        if (cancelled) return;
        if (signedUrl) {
          setClipUri(signedUrl);
          setClipDuration(initialClip.duration);
          setState('done');
        } else {
          // File missing from storage — reset to idle
          setState('idle');
          onClipCleared?.();
        }
      } catch {
        if (!cancelled) {
          setState('idle');
          onClipCleared?.();
        }
      }
    })();

    return () => { cancelled = true; };
    // Only run on mount — initialClip identity doesn't change within a key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
      if (pulseLoopRef.current) {
        pulseLoopRef.current.stop();
      }
    };
  }, []);

  // Start pulse animation during recording
  useEffect(() => {
    if (state === 'recording') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      );
      pulseLoopRef.current = loop;
      loop.start();
    } else {
      if (pulseLoopRef.current) {
        pulseLoopRef.current.stop();
        pulseLoopRef.current = null;
      }
      pulseAnim.setValue(1);
    }
  }, [state, pulseAnim]);

  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const handleStartRecording = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const recording = await startRecording();
      recordingRef.current = recording;
      setState('recording');
      setDuration(0);

      // Duration counter
      timerRef.current = setInterval(() => {
        setDuration((prev) => {
          const next = prev + 1;
          if (next >= maxDuration) {
            handleStopRecording();
          }
          return next;
        });
      }, 1000);
    } catch (err) {
      console.error('[OnboardingAudioRecorder] Start recording error:', err);
    }
  }, [maxDuration]);

  const handleStopRecording = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!recordingRef.current) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await stopRecording(recordingRef.current);
      recordingRef.current = null;
      setClipUri(result.uri);
      setClipDuration(result.durationSeconds);
      setPlaybackPosition(0);
      setState('preview');
    } catch (err) {
      console.error('[OnboardingAudioRecorder] Stop recording error:', err);
      setState('idle');
    }
  }, []);

  const handlePlayPause = useCallback(async () => {
    if (!clipUri) return;

    try {
      if (isPlaying && soundRef.current) {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
        return;
      }

      if (soundRef.current) {
        await soundRef.current.playAsync();
        setIsPlaying(true);
        return;
      }

      // Create new sound
      const { sound } = await Audio.Sound.createAsync(
        { uri: clipUri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded) {
            if (status.positionMillis !== undefined && status.durationMillis) {
              setPlaybackPosition(status.positionMillis / status.durationMillis);
            }
            if (status.didJustFinish) {
              setIsPlaying(false);
              setPlaybackPosition(0);
              soundRef.current?.setPositionAsync(0).catch(() => {});
            }
          }
        },
      );
      soundRef.current = sound;
      setIsPlaying(true);
    } catch (err) {
      console.error('[OnboardingAudioRecorder] Playback error:', err);
    }
  }, [clipUri, isPlaying]);

  const handleReRecord = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (soundRef.current) {
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    setIsPlaying(false);
    setPlaybackPosition(0);
    setClipUri(null);
    setClipDuration(0);
    setDuration(0);
    setState('idle');
    onClipCleared?.();
  }, [onClipCleared]);

  const meetsMinDuration = !minDuration || clipDuration >= minDuration;

  const handleConfirm = useCallback(() => {
    if (clipUri && clipDuration > 0 && meetsMinDuration) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setState('done');
      onClipReady(clipUri, clipDuration);
    }
  }, [clipUri, clipDuration, onClipReady, meetsMinDuration]);

  const handleSkip = useCallback(() => {
    if (!onSkip) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSkip();
  }, [onSkip]);

  // Render based on state
  const renderContent = () => {
    switch (state) {
      case 'loading':
        return (
          <View style={styles.centerContent}>
            <ActivityIndicator size="small" color={colors.primary[500]} />
            <Text style={styles.instructionText}>Loading your recording...</Text>
          </View>
        );

      case 'idle':
        return (
          <View style={styles.centerContent}>
            <TouchableOpacity
              style={styles.recordButton}
              onPress={handleStartRecording}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Tap to start recording"
            >
              <Ionicons name="mic-outline" size={32} color={colors.text.inverse} />
            </TouchableOpacity>
            <Text style={styles.instructionText}>Tap to record</Text>
          </View>
        );

      case 'recording':
        return (
          <View style={styles.centerContent}>
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                style={styles.stopButton}
                onPress={handleStopRecording}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Tap to stop recording"
              >
                <Ionicons name="stop" size={24} color={colors.text.inverse} />
              </TouchableOpacity>
            </Animated.View>
            <Text style={styles.durationText}>
              {formatTime(duration)} / {formatTime(maxDuration)}
            </Text>
          </View>
        );

      case 'preview':
      case 'done':
        return (
          <View style={styles.centerContent}>
            {/* Playback bar */}
            <View style={styles.playbackBarContainer}>
              <View style={styles.playbackBarBg}>
                <View
                  style={[
                    styles.playbackBarFill,
                    { width: `${playbackPosition * 100}%` },
                  ]}
                />
              </View>
              <Text style={styles.playbackDuration}>
                {formatTime(clipDuration)}
              </Text>
            </View>

            {/* Play/Pause button */}
            <TouchableOpacity
              style={styles.playPauseButton}
              onPress={handlePlayPause}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? 'Pause playback' : 'Play recording'}
            >
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={24}
                color={colors.primary[500]}
              />
            </TouchableOpacity>

            {state === 'done' && (
              <View style={styles.doneActions}>
                <View style={styles.checkmarkBadge}>
                  <Ionicons
                    name="checkmark-circle"
                    size={24}
                    color={colors.success[500]}
                  />
                </View>
                <TouchableOpacity
                  onPress={handleReRecord}
                  style={styles.startOverButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Delete recording and start over"
                >
                  <Ionicons name="trash-outline" size={16} color={colors.text.tertiary} />
                  <Text style={styles.startOverText}>Start over</Text>
                </TouchableOpacity>
              </View>
            )}

            {state === 'preview' && (
              <View style={styles.previewActions}>
                <TouchableOpacity
                  onPress={handleReRecord}
                  style={styles.reRecordButton}
                  accessibilityRole="button"
                  accessibilityLabel="Re-record"
                >
                  <Text style={styles.reRecordText}>Re-record</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleConfirm}
                  style={[styles.confirmButton, !meetsMinDuration && styles.confirmButtonDisabled]}
                  activeOpacity={0.7}
                  disabled={!meetsMinDuration}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm recording"
                >
                  <Text style={[styles.confirmText, !meetsMinDuration && styles.confirmTextDisabled]}>Use this clip</Text>
                </TouchableOpacity>
              </View>
            )}
            {state === 'preview' && !meetsMinDuration && minDuration && (
              <Text style={styles.minDurationHint}>
                Keep going — we need at least {minDuration} seconds to get it right.
              </Text>
            )}
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {renderContent()}
      {onSkip && !minDuration && (
        <TouchableOpacity
          onPress={handleSkip}
          style={styles.skipButton}
          accessibilityRole="button"
          accessibilityLabel="Skip this step"
        >
          <Text style={styles.skipText}>Skip this step</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 160,
  },
  recordButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  stopButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.error[500],
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  instructionText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
    marginTop: spacing.md,
  },
  durationText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.text.tertiary,
    marginTop: spacing.md,
  },
  playbackBarContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  playbackBarBg: {
    flex: 1,
    height: 4,
    backgroundColor: colors.gray[200],
    borderRadius: radius.full,
    overflow: 'hidden',
    marginRight: spacing.sm,
  },
  playbackBarFill: {
    height: 4,
    backgroundColor: colors.primary[500],
    borderRadius: radius.full,
  },
  playbackDuration: {
    ...typography.xs,
    fontWeight: fontWeights.medium,
    color: colors.text.tertiary,
    minWidth: 36,
    textAlign: 'right',
  },
  playPauseButton: {
    width: touchTargets.comfortable,
    height: touchTargets.comfortable,
    borderRadius: touchTargets.comfortable / 2,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  checkmarkBadge: {
    marginTop: spacing.sm,
  },
  doneActions: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  startOverButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: touchTargets.minimum,
    justifyContent: 'center',
  },
  startOverText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.text.tertiary,
  },
  previewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  reRecordButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: touchTargets.minimum,
    justifyContent: 'center',
  },
  reRecordText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.primary[500],
    textDecorationLine: 'underline',
  },
  confirmButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primary[500],
    borderRadius: radius.md,
    minHeight: touchTargets.minimum,
    justifyContent: 'center',
  },
  confirmText: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  confirmButtonDisabled: {
    backgroundColor: colors.gray[200],
  },
  confirmTextDisabled: {
    color: colors.text.tertiary,
  },
  minDurationHint: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    textAlign: 'center' as const,
    marginTop: spacing.sm,
  },
  skipButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: touchTargets.minimum,
    justifyContent: 'center',
  },
  skipText: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
  },
});
