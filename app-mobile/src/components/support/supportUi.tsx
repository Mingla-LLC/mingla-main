/**
 * #4382 Wave 5 — shared pieces of the Explorer Help & Support screens:
 * the header, the status pill, the screenshot picker grid and the voice
 * note player (expo-av, already in the binary).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Audio } from 'expo-av';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import {
  formatVoiceDuration,
  supportStatusKind,
  type SupportScreenshot,
} from '../../utils/supportRequestModel';

export const SUPPORT_ACCENT = '#eb7825';
export const SUPPORT_BG = '#0c0e12';

export function SupportHeader({
  title,
  subtitle,
  backLabel,
  onBack,
  topInset,
  right,
}: {
  title: string;
  subtitle?: string | null;
  backLabel: string;
  onBack: () => void;
  topInset: number;
  right?: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={[styles.header, { paddingTop: topInset + 8 }]}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={backLabel} style={styles.iconButton} hitSlop={8}>
        <Icon name="chevron-back" size={24} color="#ffffff" />
      </Pressable>
      <View style={styles.headerCopy}>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={styles.headerRight}>{right}</View>
    </View>
  );
}

export function SupportStatusPill({ status }: { status: string }): React.ReactElement {
  const { t } = useTranslation('feedback');
  const kind = supportStatusKind(status);
  return (
    <View style={[styles.pill, PILL_STYLE[kind]]}>
      <Text style={styles.pillText}>{t(`feedback:support.status_${kind}`)}</Text>
    </View>
  );
}

export function ScreenshotGrid({
  screenshots,
  onRemove,
  onAdd,
  canAdd,
  disabled,
}: {
  screenshots: readonly SupportScreenshot[];
  onRemove: (index: number) => void;
  onAdd: () => void;
  canAdd: boolean;
  disabled?: boolean;
}): React.ReactElement {
  const { t } = useTranslation('feedback');
  return (
    <View style={styles.grid}>
      {screenshots.map((shot, index) => (
        <View key={`${shot.uri}-${index}`} style={styles.thumb}>
          <Image source={{ uri: shot.uri }} style={styles.thumbImage} resizeMode="cover" />
          {!disabled ? (
            <Pressable
              onPress={() => onRemove(index)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('feedback:support.remove_screenshot', { index: index + 1 })}
              style={styles.thumbRemove}
            >
              <Icon name="close" size={14} color="#ffffff" />
            </Pressable>
          ) : null}
        </View>
      ))}
      {canAdd ? (
        <Pressable
          onPress={onAdd}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={t('feedback:support.add_screenshots')}
          style={[styles.addTile, disabled && styles.disabled]}
        >
          <Icon name="add" size={24} color="rgba(255,255,255,0.7)" />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Plays a local recording or a signed link. Unloads on unmount. */
export function VoiceNotePlayer({
  uri,
  durationMs,
  onRemove,
}: {
  uri: string | null;
  durationMs: number;
  onRemove?: () => void;
}): React.ReactElement {
  const { t } = useTranslation('feedback');
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => {
    const sound = soundRef.current;
    soundRef.current = null;
    if (sound) {
      sound.unloadAsync().catch((error: unknown) => console.warn('[Support] voice note unload failed:', error));
    }
  }, []);

  const toggle = useCallback(async (): Promise<void> => {
    if (uri === null) return;
    try {
      if (soundRef.current) {
        if (playing) {
          await soundRef.current.pauseAsync();
          setPlaying(false);
        } else {
          await soundRef.current.playAsync();
          setPlaying(true);
        }
        return;
      }
      setLoading(true);
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true }, (status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlaying(false);
          void sound.setPositionAsync(0);
        }
      });
      soundRef.current = sound;
      setPlaying(true);
    } catch (error) {
      console.warn('[Support] voice note playback failed:', error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [uri, playing]);

  if (uri === null || failed) {
    return (
      <View style={styles.voice}>
        <Icon name="mic-outline" size={18} color="rgba(255,255,255,0.5)" />
        <Text style={styles.voiceText}>{t('feedback:support.voice_unavailable')}</Text>
      </View>
    );
  }
  return (
    <View style={styles.voice}>
      <Pressable
        onPress={() => void toggle()}
        accessibilityRole="button"
        accessibilityLabel={playing ? t('feedback:support.voice_pause') : t('feedback:support.voice_play')}
        style={styles.voicePlay}
      >
        {loading ? <ActivityIndicator color="#ffffff" size="small" /> : <Icon name={playing ? 'pause' : 'play'} size={16} color="#ffffff" />}
      </Pressable>
      <Text style={styles.voiceText}>{t('feedback:support.voice_note', { time: formatVoiceDuration(durationMs) })}</Text>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('feedback:support.voice_remove')}>
          <Icon name="trash-outline" size={18} color="rgba(255,255,255,0.7)" />
        </Pressable>
      ) : null}
    </View>
  );
}

const THUMB = 76;

const PILL_COLORS: Record<ReturnType<typeof supportStatusKind>, string> = {
  waiting_mingla: 'rgba(235,120,37,0.18)',
  waiting_you: 'rgba(245,158,11,0.22)',
  resolved: 'rgba(16,185,129,0.18)',
  closed: 'rgba(255,255,255,0.10)',
};
const PILL_STYLE = StyleSheet.create({
  waiting_mingla: { backgroundColor: PILL_COLORS.waiting_mingla },
  waiting_you: { backgroundColor: PILL_COLORS.waiting_you },
  resolved: { backgroundColor: PILL_COLORS.resolved },
  closed: { backgroundColor: PILL_COLORS.closed },
});

export const supportStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SUPPORT_BG },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  stateTitle: { color: '#ffffff', fontSize: 17, fontWeight: '700', textAlign: 'center' },
  stateText: { color: 'rgba(255,255,255,0.65)', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  primaryButton: {
    minHeight: 50,
    paddingHorizontal: 20,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SUPPORT_ACCENT,
  },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  secondaryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  sectionLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  headerTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '700' },
  headerSubtitle: { marginTop: 2, color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  headerRight: { minWidth: 44, alignItems: 'flex-end' },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { color: '#f8fafc', fontSize: 12, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: THUMB, height: THUMB, borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' },
  thumbImage: { width: '100%', height: '100%' },
  thumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  addTile: {
    width: THUMB,
    height: THUMB,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  voice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  voicePlay: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SUPPORT_ACCENT,
  },
  voiceText: { flex: 1, color: '#f8fafc', fontSize: 14 },
});
