import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useCoachMark } from '../hooks/useCoachMark';
import { useTranslation } from 'react-i18next';
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  TextInput,
  Alert,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Dimensions,
  ActivityIndicator,
  Image,
  Share,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { Icon } from './ui/Icon';
import { useToast } from './ToastManager';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { HapticFeedback } from '../utils/hapticFeedback';
import { mixpanelService } from '../services/mixpanelService';
import { logAppsFlyerEvent } from '../services/appsFlyerService';
import SessionViewModal from './SessionViewModal';
import { supabase } from '../services/supabase';
import { COUNTRIES, getDefaultCountryCode, getCountryByCode } from '../constants/countries';
import { CountryData } from '../types/onboarding';
import { CountryPickerOverlay } from './onboarding/CountryPickerModal';
import { usePhoneLookup, useDebouncedValue } from '../hooks/usePhoneLookup';
import { createPendingInvite } from '../services/phoneLookupService';
import { getDisplayName } from '../utils/getDisplayName';
import { useAppStore } from '../store/appStore';
import { useSessionCreationGate } from '../hooks/useSessionCreationGate';
import { CustomPaywallScreen } from './CustomPaywallScreen';
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const SHEET_HEIGHT = screenHeight * 0.88;

// Types
export type SessionType = 'active' | 'sent-invite' | 'received-invite';

export interface Friend {
  id: string;
  name: string;
  username?: string;
  avatar?: string;
  status?: 'online' | 'offline';
}

export interface SessionParticipantDetail {
  id: string;
  name: string;
  avatar?: string;
  hasAccepted: boolean;
}

export interface CollaborationSession {
  id: string;
  name: string;
  initials: string;
  type: SessionType;
  participants?: number;
  participantDetails?: SessionParticipantDetail[];
  createdAt?: Date;
  invitedBy?: {
    id: string;
    name: string;
    username?: string;
    avatar?: string;
  };
}

interface CollaborationSessionsProps {
  sessions: CollaborationSession[];
  currentMode: 'solo' | string;
  selectedSessionId: string | null;
  onSessionSelect: (sessionId: string | null) => void;
  onSoloSelect: () => void;
  onCreateSession: (sessionName: string, selectedFriends: Friend[], phoneInvitees?: { phoneE164: string }[]) => void;
  onAcceptInvite: (sessionId: string) => void;
  onDeclineInvite: (sessionId: string) => void;
  onCancelInvite: (sessionId: string) => void;
  onInviteMoreToSession?: (sessionId: string, friend: Friend) => void;
  onSessionStateChanged?: () => void;
  availableFriends?: Friend[];
  isCreatingSession?: boolean;
  inviteModalTrigger?: {
    sessionId: string;
    nonce: number;
  } | null;
  openSessionId?: string | null;
  onOpenSessionHandled?: () => void;
  /**
   * ORCH-0589 — when true, this component renders ONLY its modals (create / invite /
   * session-view / paywall / country-picker). The pill-bar UI is suppressed because the
   * host (HomePage via GlassTopBar → GlassSessionSwitcher) now renders the pills itself.
   * Existing callers that use the full UI should omit this prop.
   */
  modalsOnlyMode?: boolean;
  /**
   * ORCH-0589 — nonce that, when it changes, programmatically opens the create-session
   * modal. Used by the host to wire GlassSessionSwitcher's "+" pill to the existing
   * create flow without re-implementing it. Null/undefined = no trigger.
   */
  createTriggerNonce?: number | null;
}

// Helper function to generate initials from a name
export const getInitials = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

export default function CollaborationSessions({
  sessions,
  currentMode,
  selectedSessionId,
  onSessionSelect,
  onSoloSelect,
  onCreateSession,
  onAcceptInvite,
  onDeclineInvite,
  onCancelInvite,
  onInviteMoreToSession,
  onSessionStateChanged,
  availableFriends = [],
  isCreatingSession = false,
  inviteModalTrigger = null,
  openSessionId = null,
  onOpenSessionHandled,
  modalsOnlyMode = false,
  createTriggerNonce = null,
}: CollaborationSessionsProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['modals', 'common']);
  const { showToast } = useToast();
  const scrollViewRef = useRef<ScrollView>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  // ORCH-0635 fix: coach-mark hooks for steps 4 (create pill) and 5 (solo pill) were
  // moved to HomePage.tsx and forwarded through GlassSessionSwitcher. This component
  // runs in `modalsOnlyMode` on Home, so its internal pill bar never mounts — the
  // refs here never attached. Hooks removed to prevent duplicate step-ID registration
  // and spurious __DEV__ warnings.
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSessionViewModal, setShowSessionViewModal] = useState(false);
  const [sessionToView, setSessionToView] = useState<CollaborationSession | null>(null);
  const [inviteModalSession, setInviteModalSession] = useState<CollaborationSession | null>(null);

  // Keep modal session in sync with live sessions data so newly added
  // participants appear immediately without closing/reopening the modal.
  useEffect(() => {
    if (inviteModalSession && showInviteModal) {
      const updated = sessions.find(s => s.id === inviteModalSession.id);
      if (updated && updated !== inviteModalSession) {
        setInviteModalSession(updated);
      }
    }
  }, [sessions, inviteModalSession?.id, showInviteModal]);

  // ORCH-0444: Detect when a session disappears (deleted by another participant).
  // Case 2: User is a member but viewing a different session — show toast + pill disappears.
  // Case 1 (user ON the deleted session) is handled by RecommendationsContext.onSessionLost.
  const prevSessionIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(sessions.map(s => s.id));
    const prevIds = prevSessionIdsRef.current;

    if (prevIds.size > 0) {
      for (const id of prevIds) {
        if (!currentIds.has(id) && id !== selectedSessionId) {
          showToast({ message: 'A session was ended', type: 'info', duration: 2000 });
          break; // One toast is enough even if multiple sessions disappeared
        }
      }
    }

    prevSessionIdsRef.current = currentIds;
  }, [sessions, selectedSessionId, showToast]);

  const [newSessionName, setNewSessionName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<Friend[]>([]);
  const [contentWidth, setContentWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const lastHandledInviteTriggerNonce = useRef<number | null>(null);
  const createSessionInputRef = useRef<TextInput>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  // Deferred focus: autoFocus inside Modal crashes on iOS Fabric.
  useEffect(() => {
    if (showCreateModal) {
      const timer = setTimeout(() => createSessionInputRef.current?.focus(), 400);
      return () => clearTimeout(timer);
    }
  }, [showCreateModal]);

  // ORCH-0589 trigger ref — consumed by the useEffect declared lower, after useSessionCreationGate.
  const lastCreateTriggerRef = useRef<number | string | null>(null);

  // Phone input state
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<CountryData>(
    () => getCountryByCode(getDefaultCountryCode()) ?? COUNTRIES[0]
  );
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [phoneActionStatus, setPhoneActionStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [phoneActionError, setPhoneActionError] = useState('');
  const [phoneInvitees, setPhoneInvitees] = useState<{ phoneE164: string }[]>([]);

  const { user } = useAppStore();

  // Session creation gate — tier-based limit enforcement
  const { canCreateSession: gateAllows, maxSessions, isUnlimited } = useSessionCreationGate();

  // ORCH-0589 — open the create-session modal when the host signals via nonce change.
  // ORCH-0610 fix: the initial nonce from HomePage is 0 (not null), so the previous
  // `== null` guard let mount through and opened the modal on cold start. Reject any
  // falsy nonce (null / undefined / 0) — only positive nonces indicate a real trigger.
  useEffect(() => {
    if (!createTriggerNonce) return;
    if (lastCreateTriggerRef.current === createTriggerNonce) return;
    lastCreateTriggerRef.current = createTriggerNonce;
    HapticFeedback.buttonPress();
    if (!gateAllows && !isUnlimited) {
      setShowPaywall(true);
      return;
    }
    setShowCreateModal(true);
  }, [createTriggerNonce, gateAllows, isUnlimited]);

  // Build E.164 phone
  const phoneRawDigits = phoneNumber.replace(/\D/g, '');
  const phoneE164 = useMemo(() => {
    if (!phoneRawDigits) return '';
    return `${selectedCountry.dialCode}${phoneRawDigits}`;
  }, [phoneRawDigits, selectedCountry]);

  const debouncedPhoneE164 = useDebouncedValue(phoneE164, 500);
  const debouncedDigitCount = useDebouncedValue(phoneRawDigits.length, 500);

  const {
    data: phoneLookupResult,
    isLoading: phoneLookupLoading,
  } = usePhoneLookup(debouncedPhoneE164, debouncedDigitCount >= 7);

  const isPhoneValid = useMemo(() => {
    return phoneRawDigits.length >= 7 && phoneRawDigits.length <= 15;
  }, [phoneRawDigits]);


  const isSoloMode = currentMode === 'solo';

  const toggleFriendSelection = (friend: Friend) => {
    setSelectedFriends(prev => {
      const isSelected = prev.some(f => f.id === friend.id);
      if (isSelected) {
        return prev.filter(f => f.id !== friend.id);
      } else {
        return [...prev, friend];
      }
    });
  };

  // Sort sessions: active first, invites last
  const sortedSessions = [...sessions].sort((a, b) => {
    const inviteTypes: SessionType[] = ['sent-invite', 'received-invite'];
    const aIsInvite = inviteTypes.includes(a.type);
    const bIsInvite = inviteTypes.includes(b.type);
    if (!aIsInvite && bIsInvite) return -1;
    if (aIsInvite && !bIsInvite) return 1;
    return 0;
  });

  // Update scroll indicators
  useEffect(() => {
    const hasOverflow = contentWidth > containerWidth;
    setShowRightArrow(hasOverflow);
  }, [contentWidth, containerWidth]);

  useEffect(() => {
    if (!inviteModalTrigger) return;
    if (lastHandledInviteTriggerNonce.current === inviteModalTrigger.nonce) return;

    const sessionToOpen = sessions.find(
      (session) =>
        session.id === inviteModalTrigger.sessionId &&
        session.type === 'received-invite'
    );

    if (!sessionToOpen) return;

    setInviteModalSession(sessionToOpen);
    setShowInviteModal(true);
    lastHandledInviteTriggerNonce.current = inviteModalTrigger.nonce;
  }, [inviteModalTrigger, sessions]);

  // Auto-open a session modal when triggered by notifications or deep links
  useEffect(() => {
    if (!openSessionId || !onOpenSessionHandled) return;

    const session = sessions.find(s => s.id === openSessionId);
    if (!session) {
      // Session not found yet — may still be loading. Don't clear trigger.
      return;
    }

    if (session.type === 'received-invite' || session.type === 'sent-invite') {
      setInviteModalSession(session);
      setShowInviteModal(true);
    } else {
      setSessionToView(session);
      setShowSessionViewModal(true);
      onSessionSelect(session.id);
    }

    onOpenSessionHandled();
  }, [openSessionId, sessions, onOpenSessionHandled, onSessionSelect]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const scrollX = contentOffset.x;
    const maxScrollX = contentSize.width - layoutMeasurement.width;

    setShowLeftArrow(scrollX > 10);
    setShowRightArrow(scrollX < maxScrollX - 10);
  };

  const handlePillClick = (session: CollaborationSession) => {
    HapticFeedback.buttonPress();
    if (session.type === 'sent-invite' || session.type === 'received-invite') {
      setInviteModalSession(session);
      setShowInviteModal(true);
    } else {
      // Active session - open the session view modal and select it
      setSessionToView(session);
      setShowSessionViewModal(true);
      onSessionSelect(session.id);
      mixpanelService.trackSessionSwitched({ mode: 'session', sessionName: session.name });
      mixpanelService.registerSuperProperties({ session_mode: 'session' });
      logAppsFlyerEvent('session_switched', { mode: 'session' });
    }
  };

  const handleCreateSession = () => {
    // Re-check tier gate in case limit changed while modal was open
    if (!gateAllows && !isUnlimited) {
      const limitLabel = maxSessions === 1 ? '1 session' : `${maxSessions} sessions`;
      Alert.alert(
        t('modals:collaboration.session_limit_title'),
        t('modals:collaboration.session_limit_body', { limit: limitLabel }),
        [
          { text: t('common:cancel'), style: 'cancel' },
          { text: t('modals:collaboration.upgrade'), onPress: () => { setShowCreateModal(false); setShowPaywall(true); } },
        ],
      );
      return;
    }

    if (!newSessionName.trim()) {
      Alert.alert(t('modals:collaboration.session_name_required_title'), t('modals:collaboration.session_name_required_body'));
      return;
    }

    if (selectedFriends.length === 0) {
      Alert.alert(
        t('modals:collaboration.add_collaborator_title'),
        t('modals:collaboration.add_collaborator_body')
      );
      return;
    }

    if (newSessionName.trim()) {
      mixpanelService.trackCollaborationSessionCreated({
        sessionName: newSessionName.trim(),
        invitedFriendsCount: selectedFriends.length,
      });
      logAppsFlyerEvent('collaboration_session_created', { invited_count: selectedFriends.length });
      onCreateSession(newSessionName.trim(), selectedFriends, phoneInvitees.length > 0 ? phoneInvitees : undefined);
      setNewSessionName('');
      setSelectedFriends([]);
      setPhoneNumber('');
      setPhoneActionStatus('idle');
      setPhoneInvitees([]);
      setShowCreateModal(false);
    }
  };

  const handleCloseCreateModal = () => {
    setNewSessionName('');
    setSelectedFriends([]);
    setPhoneNumber('');
    setPhoneActionStatus('idle');
    setPhoneActionError('');
    setPhoneInvitees([]);
    setShowCreateModal(false);
  };

  // Handle phone action — context-aware for session creation
  const handlePhoneAction = useCallback(async () => {
    if (!isPhoneValid || !debouncedPhoneE164) return;

    setPhoneActionStatus('sending');
    setPhoneActionError('');

    try {
      if (phoneLookupResult?.found && phoneLookupResult.user) {
        const lookupUser = phoneLookupResult.user;

        // Guard: can't add yourself
        if (user && lookupUser.id === user.id) {
          Alert.alert(t('modals:collaboration.thats_you_title'), t('modals:collaboration.thats_you_body'));
          setPhoneActionStatus('idle');
          return;
        }

        // Add any Mingla user to session — friendship is handled at the
        // invite/activation layer, not at the UI selection layer.
        const alreadySelected = selectedFriends.some(f => f.id === lookupUser.id);
        if (alreadySelected) {
          Alert.alert(t('modals:collaboration.already_selected_title'), t('modals:collaboration.already_selected_body'));
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          const friendData: Friend = {
            id: lookupUser.id,
            name: getDisplayName(lookupUser, 'User'),
            username: lookupUser.username,
            avatar: lookupUser.avatar_url || undefined,
          };
          setSelectedFriends(prev => [...prev, friendData]);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        setPhoneActionStatus('sent');
        setTimeout(() => {
          setPhoneNumber('');
          setPhoneActionStatus('idle');
        }, 1500);
      } else {
        // Not on Mingla — save pending invite + track for session + native share
        if (user) {
          await createPendingInvite(user.id, debouncedPhoneE164);
        }

        // Track this phone invitee for session creation (dedup)
        const alreadyInvited = phoneInvitees.some(i => i.phoneE164 === debouncedPhoneE164);
        if (!alreadyInvited) {
          setPhoneInvitees(prev => [...prev, { phoneE164: debouncedPhoneE164 }]);
        }

        await Share.share({
          message: `Hey! Join me on Mingla and let's find amazing experiences together. https://usemingla.com`,
        });
        setPhoneActionStatus('sent');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => {
          setPhoneNumber('');
          setPhoneActionStatus('idle');
        }, 2000);
      }
    } catch (err) {
      console.error('[CollaborationSessions] Phone action error:', err);
      setPhoneActionError(err instanceof Error ? err.message : 'Something went wrong');
      setPhoneActionStatus('error');
    }
  }, [isPhoneValid, debouncedPhoneE164, phoneLookupResult, user, selectedFriends, phoneInvitees]);

  // ORCH-0437: Invite more people to an existing pending session
  const handleInviteMorePhoneAction = useCallback(async () => {
    if (!isPhoneValid || !debouncedPhoneE164 || !inviteModalSession) return;

    setPhoneActionStatus('sending');
    setPhoneActionError('');

    try {
      if (phoneLookupResult?.found && phoneLookupResult.user) {
        const lookupUser = phoneLookupResult.user;

        if (user && lookupUser.id === user.id) {
          Alert.alert(t('modals:collaboration.thats_you_title'), t('modals:collaboration.thats_you_body'));
          setPhoneActionStatus('idle');
          return;
        }

        // Invite this user to the existing session
        if (onInviteMoreToSession) {
          const friendData: Friend = {
            id: lookupUser.id,
            name: getDisplayName(lookupUser, 'User'),
            username: lookupUser.username,
            avatar: lookupUser.avatar_url || undefined,
          };
          onInviteMoreToSession(inviteModalSession.id, friendData);
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPhoneActionStatus('sent');
        setTimeout(() => {
          setPhoneNumber('');
          setPhoneActionStatus('idle');
        }, 1500);
      } else {
        // Not on Mingla — create pending invite + share
        if (user) {
          await createPendingInvite(user.id, debouncedPhoneE164);
        }

        await Share.share({
          message: `Hey! Join me on Mingla and let's find amazing experiences together. https://usemingla.com`,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPhoneActionStatus('sent');
        setTimeout(() => {
          setPhoneNumber('');
          setPhoneActionStatus('idle');
        }, 2000);
      }
    } catch (err) {
      console.error('[CollaborationSessions] Invite-more phone action error:', err);
      setPhoneActionError(err instanceof Error ? err.message : 'Something went wrong');
      setPhoneActionStatus('error');
    }
  }, [isPhoneValid, debouncedPhoneE164, phoneLookupResult, user, inviteModalSession, onInviteMoreToSession]);

  const getPhoneActionLabel = (): string => {
    if (phoneLookupLoading) return t('modals:collaboration.looking_up');
    if (!isPhoneValid) return t('modals:collaboration.enter_phone_number');
    if (phoneLookupResult?.found) {
      const alreadySelected = selectedFriends.some(f => f.id === phoneLookupResult.user?.id);
      return alreadySelected ? t('modals:collaboration.added_as_collaborator') : t('modals:collaboration.add_to_session');
    }
    return t('modals:collaboration.invite_to_mingla');
  };

  const isPhoneActionDisabled =
    !isPhoneValid ||
    phoneLookupLoading ||
    phoneActionStatus === 'sending' ||
    phoneActionStatus === 'sent' ||
    (phoneLookupResult?.found &&
      selectedFriends.some(f => f.id === phoneLookupResult.user?.id));

  const uiChecksPass = newSessionName.trim().length > 0 && (selectedFriends.length > 0 || phoneInvitees.length > 0) && !isCreatingSession;
  const canCreateSession = uiChecksPass && gateAllows;

  const scrollLeft = () => {
    scrollViewRef.current?.scrollTo({ x: 0, animated: true });
  };

  const scrollRight = () => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  };

  const renderPill = (session: CollaborationSession) => {
    const isSelected = selectedSessionId === session.id && !isSoloMode;
    const isSentInvite = session.type === 'sent-invite';
    const isReceivedInvite = session.type === 'received-invite';
    const isInvite = isSentInvite || isReceivedInvite;

    return (
      <TouchableOpacity
        key={session.id}
        style={[
          styles.pill,
          isInvite && styles.pillInvite,
          isSentInvite && styles.pillSentInvite,
          isSelected && styles.pillSelected,
        ]}
        onPress={() => handlePillClick(session)}
        activeOpacity={isSentInvite ? 0.5 : 0.7}
      >
        <Text
          style={[
            styles.pillText,
            isInvite && styles.pillTextInvite,
            isSelected && styles.pillTextSelected,
          ]}
        >
          {session.initials}
        </Text>
        {isInvite && (
          <View style={[styles.inviteBadge, isSentInvite && styles.inviteBadgePending]}>
            <Icon
              name={isReceivedInvite ? 'mail' : 'time-outline'}
              size={7}
              color="#fff"
            />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // ORCH-0589 — legacy pill-bar UI (preserved for callers that don't use the new
  // floating GlassSessionSwitcher). When modalsOnlyMode, we skip this whole block
  // and render only the modal sub-tree below.
  const pillBar = modalsOnlyMode ? null : (
    <>
      {/* Fixed pills */}
      <View collapsable={false}>
        <TouchableOpacity
          style={[styles.pill, isSoloMode && styles.soloPill]}
          onPress={() => {
            onSoloSelect();
            mixpanelService.trackSessionSwitched({ mode: 'solo' });
            mixpanelService.registerSuperProperties({ session_mode: 'solo' });
            logAppsFlyerEvent('session_switched', { mode: 'solo' });
          }}
          activeOpacity={0.7}
        >
          <Text style={[styles.pillText, isSoloMode && styles.soloPillText]}>
            {t('modals:collaboration.solo')}
          </Text>
        </TouchableOpacity>
      </View>

      <View collapsable={false}>
        <TouchableOpacity
          style={[styles.pill, styles.createPill]}
          onPress={() => {
            HapticFeedback.buttonPress();
            if (!gateAllows && !isUnlimited) {
              setShowPaywall(true);
              return;
            }
            setShowCreateModal(true);
          }}
          activeOpacity={0.7}
        >
          <Icon name="add" size={16} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Left scroll indicator — after fixed pills, before scrollable area */}
      {showLeftArrow && (
        <TouchableOpacity style={styles.scrollArrowLeft} onPress={scrollLeft}>
          <Icon name="chevron-back" size={16} color="#6B7280" />
        </TouchableOpacity>
      )}

      {/* Scrollable session pills */}
      <View style={styles.scrollViewWrapper}>
        <ScrollView
          ref={scrollViewRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onContentSizeChange={(w) => setContentWidth(w)}
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
        {sortedSessions.map(renderPill)}
        </ScrollView>
      </View>

      {/* Right scroll indicator */}
      {showRightArrow && (
        <TouchableOpacity style={styles.scrollArrowRight} onPress={scrollRight}>
          <Icon name="chevron-forward" size={16} color="#6B7280" />
        </TouchableOpacity>
      )}
    </>
  );

  return (
    <View style={modalsOnlyMode ? styles.modalsOnlyContainer : styles.container}>
      {pillBar}

      {/* Create Session Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={handleCloseCreateModal}
        statusBarTranslucent
      >
        <View style={styles.createSheetOverlay}>
          <TouchableOpacity
            style={styles.createSheetBackdrop}
            activeOpacity={1}
            onPress={handleCloseCreateModal}
          />
          <View style={[styles.createSheetContent, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            {/* Drag Handle */}
            <View style={styles.createDragHandleContainer}>
              <View style={styles.createDragHandle} />
            </View>

            <View style={styles.createSheetHeader}>
              <View style={styles.modalCloseButtonPlaceholder} />
              <Text style={styles.modalTitle}>{t('modals:collaboration.create_new_session')}</Text>
              <View style={styles.modalCloseButtonPlaceholder} />
            </View>

            <ScrollView style={styles.modalScrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Session Name Input */}
              <Text style={styles.modalLabel}>{t('modals:collaboration.session_name')}</Text>
              <TextInput
                ref={createSessionInputRef}
                style={styles.modalInput}
                placeholder="e.g., Weekend Plans, Date Night..."
                value={newSessionName}
                onChangeText={setNewSessionName}
                maxLength={30}
              />

              {/* Invite by phone */}
              <View style={styles.friendSelectionSection}>
                <Text style={styles.modalLabel}>{t('modals:collaboration.add_by_phone')}</Text>

                <View style={styles.csPhoneRow}>
                  <TouchableOpacity
                    style={styles.csCountryPicker}
                    onPress={() => setShowCountryPicker(true)}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.csCountryFlag}>{selectedCountry.flag}</Text>
                    <Text style={styles.csCountryDial}>{selectedCountry.dialCode}</Text>
                    <Icon name="chevron-down" size={14} color="#9ca3af" />
                  </TouchableOpacity>

                  <View style={styles.csPhoneDivider} />

                  <TextInput
                    style={styles.csPhoneInput}
                    value={phoneNumber}
                    onChangeText={(text) => {
                      setPhoneNumber(text);
                      if (phoneActionStatus !== 'idle' && phoneActionStatus !== 'sending') {
                        setPhoneActionStatus('idle');
                        setPhoneActionError('');
                      }
                    }}
                    placeholder={t('modals:collaboration.phone_placeholder')}
                    placeholderTextColor="#9ca3af"
                    keyboardType="phone-pad"
                    autoCorrect={false}
                    maxLength={15}
                  />

                  {phoneLookupLoading && (
                    <ActivityIndicator size="small" color="#eb7825" style={{ marginRight: 10 }} />
                  )}
                </View>

                {/* Lookup result */}
                {isPhoneValid && !phoneLookupLoading && phoneLookupResult && (
                  <View style={styles.csLookupResult}>
                    {phoneLookupResult.found ? (
                      <View style={styles.csLookupRow}>
                        <Icon name="checkmark-circle" size={14} color="#22c55e" />
                        <Text style={styles.csLookupTextGreen}>
                          {t('modals:collaboration.is_on_mingla', { name: getDisplayName(phoneLookupResult.user, 'Someone') })}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.csLookupRow}>
                        <Icon name="person-add-outline" size={14} color="#6b7280" />
                        <Text style={styles.csLookupTextMuted}>{t('modals:collaboration.not_on_mingla')}</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Status */}
                {phoneActionStatus === 'sent' && (
                  <View style={styles.csStatusRow}>
                    <Icon name="checkmark-circle" size={16} color="#22c55e" />
                    <Text style={styles.csStatusSuccess}>
                      {phoneLookupResult?.found
                        ? phoneLookupResult.friendship_status === 'friends'
                          ? t('modals:collaboration.added_as_collaborator')
                          : t('modals:collaboration.friend_request_sent')
                        : t('modals:collaboration.invite_shared')}
                    </Text>
                  </View>
                )}
                {phoneActionStatus === 'error' && (
                  <View style={styles.csStatusRow}>
                    <Icon name="alert-circle" size={16} color="#ef4444" />
                    <Text style={styles.csStatusError}>{phoneActionError}</Text>
                  </View>
                )}

                {/* Action button */}
                <TouchableOpacity
                  style={[styles.csActionButton, isPhoneActionDisabled && styles.csActionButtonDisabled]}
                  onPress={handlePhoneAction}
                  activeOpacity={0.7}
                  disabled={!!isPhoneActionDisabled}
                >
                  {phoneActionStatus === 'sending' ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <>
                      <Icon
                        name={phoneLookupResult?.found ? 'person-add' : 'paper-plane-outline'}
                        size={14}
                        color="#ffffff"
                        style={{ marginRight: 5 }}
                      />
                      <Text style={styles.csActionButtonText}>{getPhoneActionLabel()}</Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* Phone invitees (not on Mingla) */}
                {phoneInvitees.length > 0 && (
                  <View style={styles.csPhoneInviteesContainer}>
                    <Text style={styles.csPhoneInviteesLabel}>{t('modals:collaboration.pending_invites')}</Text>
                    <View style={styles.csPhoneInviteesList}>
                      {phoneInvitees.map((invitee) => (
                        <View key={invitee.phoneE164} style={styles.csPhoneInviteePill}>
                          <Text style={styles.csPhoneInviteePillText}>{invitee.phoneE164}</Text>
                          <TouchableOpacity
                            onPress={() => setPhoneInvitees(prev => prev.filter(i => i.phoneE164 !== invitee.phoneE164))}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Icon name="close-circle" size={16} color="#9CA3AF" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>

              {/* Select existing friends as collaborators */}
              <View style={styles.friendSelectionSection}>
                <Text style={styles.modalLabel}>{t('modals:collaboration.select_collaborators')}</Text>

                {/* Selected Friends */}
                {selectedFriends.length > 0 && (
                  <View style={styles.selectedFriendsContainer}>
                    {selectedFriends.map((friend) => (
                      <View key={friend.id} style={styles.selectedFriendTag}>
                        <View style={styles.selectedFriendAvatar}>
                          {friend.avatar ? (
                            <Image
                              source={{ uri: friend.avatar }}
                              style={styles.selectedFriendAvatarImage}
                            />
                          ) : (
                            <Text style={styles.selectedFriendAvatarText}>
                              {friend.name[0]}
                            </Text>
                          )}
                        </View>
                        <Text style={styles.selectedFriendName} numberOfLines={1}>
                          {friend.name}
                        </Text>
                        <TouchableOpacity
                          onPress={() => toggleFriendSelection(friend)}
                          style={styles.removeFriendButton}
                        >
                          <Icon name="close" size={12} color="#6B7280" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {/* Friends List */}
                {availableFriends.length === 0 ? (
                  <View style={styles.noFriendsContainer}>
                    <Icon name="people-outline" size={32} color="#D1D5DB" />
                    <Text style={styles.noFriendsText}>{t('modals:collaboration.no_friends_yet')}</Text>
                    <Text style={styles.noFriendsSubtext}>
                      {t('modals:collaboration.invite_by_phone_hint')}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.friendsList}>
                    {availableFriends.map((friend) => {
                      const isSelected = selectedFriends.some(f => f.id === friend.id);
                      return (
                        <TouchableOpacity
                          key={friend.id}
                          style={[
                            styles.friendItem,
                            isSelected && styles.friendItemSelected,
                          ]}
                          onPress={() => toggleFriendSelection(friend)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.friendAvatar}>
                            {friend.avatar ? (
                              <Image
                                source={{ uri: friend.avatar }}
                                style={styles.friendAvatarImage}
                              />
                            ) : (
                              <Text style={styles.friendAvatarText}>
                                {friend.name[0]}
                              </Text>
                            )}
                          </View>
                          <View style={styles.friendInfo}>
                            <Text style={styles.friendName}>{friend.name}</Text>
                          </View>
                          {isSelected && (
                            <View style={styles.friendCheckmark}>
                              <Icon name="checkmark" size={16} color="#FFFFFF" />
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            </ScrollView>

            {/* Actions */}
            <View style={styles.modalActionsFixed}>
              <TouchableOpacity
                style={[
                  styles.modalCreateButton,
                  !canCreateSession && styles.modalCreateButtonDisabled,
                ]}
                onPress={handleCreateSession}
                disabled={!canCreateSession}
              >
                {isCreatingSession ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalCreateButtonText}>
                    {selectedFriends.length > 0
                      ? t('modals:collaboration.invite_count', { count: selectedFriends.length })
                      : t('modals:collaboration.create')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Country picker overlay — rendered INSIDE the parent Modal (fills
            the entire Modal window) but OUTSIDE createSheetContent (bypasses
            overflow:hidden). No nested Android Dialog. Instant open. */}
        {showCountryPicker && (
          <CountryPickerOverlay
            selectedCode={selectedCountry.code}
            onSelect={(code) => {
              const match = getCountryByCode(code);
              if (match) setSelectedCountry(match);
              setShowCountryPicker(false);
            }}
            onClose={() => setShowCountryPicker(false)}
          />
        )}
      </Modal>

      {/* Invite Action Modal */}

      <Modal
        visible={showInviteModal}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowInviteModal(false); setPhoneNumber(''); setPhoneActionStatus('idle'); setPhoneActionError(''); }}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          style={styles.inviteSheetOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={styles.inviteSheetBackdrop}
            activeOpacity={1}
            onPress={() => setShowInviteModal(false)}
          />
          <View style={[styles.inviteSheetContent, { paddingBottom: Math.max(insets.bottom, 16) }]} onStartShouldSetResponder={() => { Keyboard.dismiss(); return false; }}>
            <View style={styles.inviteDragHandleContainer}>
              <View style={styles.inviteDragHandle} />
            </View>

            <View style={styles.inviteSheetHeader}>
              <View style={styles.modalCloseButtonPlaceholder} />
              <Text style={styles.inviteSheetTitle}>
                {inviteModalSession?.type === 'received-invite'
                  ? t('modals:collaboration.received_invite')
                  : t('modals:collaboration.pending_invite')}
              </Text>
              <TouchableOpacity
                onPress={() => setShowInviteModal(false)}
                style={styles.modalCloseButton}
              >
                <Icon name="close" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.inviteDetails}>
              <View style={styles.inviteAvatarLarge}>
                {inviteModalSession?.invitedBy?.avatar ? (
                  <Image
                    source={{ uri: inviteModalSession.invitedBy.avatar }}
                    style={styles.inviteAvatarImage}
                  />
                ) : (
                  <Text style={styles.inviteAvatarText}>
                    {inviteModalSession?.initials}
                  </Text>
                )}
              </View>
              <Text style={styles.inviteSessionName}>
                {inviteModalSession?.name}
              </Text>
              {inviteModalSession?.type === 'received-invite' && (
                <Text style={styles.inviteFromText}>
                  {t('modals:collaboration.invited_to_collaborate', { name: inviteModalSession?.invitedBy?.name || 'Someone' })}
                </Text>
              )}
              {inviteModalSession?.type === 'sent-invite' && (
                <>
                  <Text style={styles.inviteFromText}>
                    {t('modals:collaboration.waiting_for_response')}
                  </Text>
                  {inviteModalSession.participantDetails && inviteModalSession.participantDetails.length > 0 && (
                    <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      {inviteModalSession.participantDetails.map((p, i) => (
                        <View key={p.id} style={{ alignItems: 'center', marginHorizontal: i > 0 ? -4 : 0 }}>
                          <View style={{
                            width: 40, height: 40, borderRadius: 20,
                            backgroundColor: p.hasAccepted ? '#D1FAE5' : '#F3F4F6',
                            alignItems: 'center', justifyContent: 'center',
                            borderWidth: 2, borderColor: p.hasAccepted ? '#059669' : '#D1D5DB',
                          }}>
                            {p.avatar ? (
                              <Image source={{ uri: p.avatar }} style={{ width: 36, height: 36, borderRadius: 18 }} />
                            ) : (
                              <Text style={{ fontSize: 13, fontWeight: '700', color: p.hasAccepted ? '#059669' : '#6B7280' }}>
                                {p.name.substring(0, 2).toUpperCase()}
                              </Text>
                            )}
                          </View>
                        </View>
                      ))}
                      {inviteModalSession.participantDetails.some(p => !p.hasAccepted) && (
                        <View style={{
                          paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
                          backgroundColor: '#FEF3C7', marginLeft: 8,
                        }}>
                          <Text style={{ fontSize: 11, fontWeight: '600', color: '#D97706' }}>Pending</Text>
                        </View>
                      )}
                    </View>
                  )}
                </>
              )}
            </View>

            {inviteModalSession?.type === 'received-invite' ? (
              <View style={styles.inviteActions}>
                <TouchableOpacity
                  style={styles.modalDeclineButton}
                  onPress={() => {
                    if (inviteModalSession) {
                      onDeclineInvite(inviteModalSession.id);
                    }
                    setShowInviteModal(false);
                  }}
                >
                  <Icon name="person-remove" size={14} color="#DC2626" style={{ marginRight: 5 }} />
                  <Text style={styles.modalDeclineButtonText}>{t('modals:collaboration.decline_invite')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalAcceptButton}
                  onPress={() => {
                    if (inviteModalSession) {
                      onAcceptInvite(inviteModalSession.id);
                    }
                    setShowInviteModal(false);
                  }}
                >
                  <Icon name="checkmark-circle" size={14} color="#FFFFFF" style={{ marginRight: 5 }} />
                  <Text style={styles.modalAcceptButtonText}>{t('modals:collaboration.accept_invite')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={[styles.inviteActions, { flexDirection: 'column' }]}>
                <TouchableOpacity
                  style={[styles.modalCancelInviteButton, { flex: 0 }]}
                  onPress={() => {
                    if (inviteModalSession) {
                      onCancelInvite(inviteModalSession.id);
                    }
                    setShowInviteModal(false);
                  }}
                >
                  <Text style={styles.modalCancelInviteButtonText}>{t('modals:collaboration.cancel_invite')}</Text>
                </TouchableOpacity>

                {/* ORCH-0437: Invite more people by phone to existing pending session */}
                <View style={[styles.friendSelectionSection, { marginTop: 20 }]}>
                  <Text style={styles.modalLabel}>Add more participants</Text>
                  <View style={styles.csPhoneRow}>
                    <TouchableOpacity
                      style={styles.csCountryPicker}
                      onPress={() => setShowCountryPicker(true)}
                      activeOpacity={0.6}
                    >
                      <Text style={styles.csCountryFlag}>{selectedCountry.flag}</Text>
                      <Text style={styles.csCountryDial}>{selectedCountry.dialCode}</Text>
                      <Icon name="chevron-down" size={14} color="#9ca3af" />
                    </TouchableOpacity>
                    <View style={styles.csPhoneDivider} />
                    <TextInput
                      style={styles.csPhoneInput}
                      value={phoneNumber}
                      onChangeText={(text) => {
                        setPhoneNumber(text);
                        if (phoneActionStatus !== 'idle' && phoneActionStatus !== 'sending') {
                          setPhoneActionStatus('idle');
                          setPhoneActionError('');
                        }
                      }}
                      placeholder={t('modals:collaboration.phone_placeholder')}
                      placeholderTextColor="#9ca3af"
                      keyboardType="phone-pad"
                      autoCorrect={false}
                      maxLength={15}
                    />
                    {phoneLookupLoading && (
                      <ActivityIndicator size="small" color="#eb7825" style={{ marginRight: 10 }} />
                    )}
                  </View>

                  {isPhoneValid && !phoneLookupLoading && phoneLookupResult && (
                    <View style={styles.csLookupResult}>
                      {phoneLookupResult.found ? (
                        <View style={styles.csLookupRow}>
                          <Icon name="checkmark-circle" size={14} color="#22c55e" />
                          <Text style={styles.csLookupTextGreen}>
                            {t('modals:collaboration.is_on_mingla', { name: getDisplayName(phoneLookupResult.user, 'Someone') })}
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.csLookupRow}>
                          <Icon name="person-add-outline" size={14} color="#6b7280" />
                          <Text style={styles.csLookupTextMuted}>{t('modals:collaboration.not_on_mingla')}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {phoneActionStatus === 'sent' && (
                    <View style={styles.csStatusRow}>
                      <Icon name="checkmark-circle" size={16} color="#22c55e" />
                      <Text style={styles.csStatusSuccess}>
                        {phoneLookupResult?.found
                          ? t('modals:collaboration.added_as_collaborator')
                          : t('modals:collaboration.invite_shared')}
                      </Text>
                    </View>
                  )}
                  {phoneActionStatus === 'error' && (
                    <View style={styles.csStatusRow}>
                      <Icon name="alert-circle" size={16} color="#ef4444" />
                      <Text style={styles.csStatusError}>{phoneActionError}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[styles.csActionButton, isPhoneActionDisabled && styles.csActionButtonDisabled]}
                    onPress={handleInviteMorePhoneAction}
                    activeOpacity={0.7}
                    disabled={!!isPhoneActionDisabled}
                  >
                    {phoneActionStatus === 'sending' ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <>
                        <Icon
                          name={phoneLookupResult?.found ? 'person-add' : 'paper-plane-outline'}
                          size={14}
                          color="#ffffff"
                          style={{ marginRight: 5 }}
                        />
                        <Text style={styles.csActionButtonText}>{getPhoneActionLabel()}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Session View Modal */}
      {sessionToView && (
        <SessionViewModal
          visible={showSessionViewModal}
          sessionId={sessionToView.id}
          sessionName={sessionToView.name}
          sessionInitials={sessionToView.initials}
          onClose={() => {
            setShowSessionViewModal(false);
            setSessionToView(null);
          }}
          onSessionDeleted={() => {
            setShowSessionViewModal(false);
            setSessionToView(null);
            onSoloSelect();
            onSessionStateChanged?.();
          }}
          onSessionExited={() => {
            setShowSessionViewModal(false);
            setSessionToView(null);
            onSoloSelect();
            onSessionStateChanged?.();
          }}
        />
      )}

      <CustomPaywallScreen
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        userId={user?.id ?? ''}
        feature="session_creation"
      />

    </View>
  );
}

const styles = StyleSheet.create({
  // ORCH-0589: when modalsOnlyMode is true, the component is a pure modal host — no layout footprint.
  modalsOnlyContainer: {
    width: 0,
    height: 0,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: 'transparent',
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginHorizontal: 12,
    gap: 6,
  },
  scrollViewWrapper: {
    flex: 1,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  scrollArrowLeft: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  scrollArrowRight: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  pill: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: '#FEF3E7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
  },
  soloPill: {
    paddingHorizontal: 16,
    backgroundColor: '#eb7825',
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  createPill: {
    backgroundColor: '#eb7825',
    minWidth: 36,
    paddingHorizontal: 0,
    width: 36,
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  pillSelected: {
    backgroundColor: '#eb7825',
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  pillInvite: {
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
  },
  pillSentInvite: {
    opacity: 0.6,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  soloPillText: {
    fontWeight: '600',
    color: '#FFFFFF',
  },
  pillTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  pillTextInvite: {
    color: '#9CA3AF',
  },
  inviteBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#6B7280',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  inviteBadgePending: {
    backgroundColor: '#9CA3AF',
  },
  // Create session bottom sheet styles
  createSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'flex-end',
  },
  createSheetBackdrop: {
    flex: 1,
  },
  createSheetContent: {
    height: SHEET_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
  },
  createDragHandleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  createDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
  },
  createSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  inviteSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'flex-end',
  },
  inviteSheetBackdrop: {
    flex: 1,
  },
  inviteSheetContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
  },
  inviteDragHandleContainer: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 8,
  },
  inviteDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
  },
  inviteSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    paddingBottom: 12,
    marginBottom: 12,
  },
  inviteSheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: '#1e293b',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    flex: 1,
    textAlign: 'center',
  },
  modalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseButtonPlaceholder: {
    width: 36,
    height: 36,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },
  modalHint: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 12,
    marginBottom: 20,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  modalCancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7280',
  },
  modalCreateButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#eb7825',
    alignItems: 'center',
  },
  modalCreateButtonDisabled: {
    backgroundColor: '#FDDCAB',
  },
  modalCreateButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // Invite modal styles
  inviteDetails: {
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 18,
  },
  inviteAvatarLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  inviteAvatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#374151',
  },
  inviteAvatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  inviteSessionName: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.15,
    color: '#111827',
    marginBottom: 4,
  },
  inviteFromText: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 18,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    marginBottom: 14,
  },
  modalDeclineButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDeclineButtonText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.15,
    color: '#DC2626',
  },
  modalAcceptButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalAcceptButtonText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.15,
    color: '#FFFFFF',
  },
  modalCancelInviteButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelInviteButtonText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.15,
    color: '#DC2626',
  },
  // Extended modal for create session with friends
  modalContentLarge: {
    width: screenWidth - 32,
    maxWidth: 400,
    maxHeight: '80%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  modalScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  modalActionsFixed: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  // Friend selection styles
  friendSelectionSection: {
    marginTop: 20,
  },
  // Inline phone input styles
  csPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    height: 46,
    overflow: 'hidden',
  },
  csCountryPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 6,
    height: '100%',
  },
  csCountryFlag: {
    fontSize: 16,
    marginRight: 3,
  },
  csCountryDial: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginRight: 3,
  },
  csPhoneDivider: {
    width: 1,
    height: 22,
    backgroundColor: '#d1d5db',
  },
  csPhoneInput: {
    flex: 1,
    paddingHorizontal: 10,
    fontSize: 15,
    color: '#111827',
    height: '100%',
  },
  csLookupResult: {
    marginTop: 6,
  },
  csLookupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  csLookupTextGreen: {
    fontSize: 12,
    color: '#16a34a',
    fontWeight: '500',
  },
  csLookupTextMuted: {
    fontSize: 12,
    color: '#6b7280',
  },
  csStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  csStatusSuccess: {
    fontSize: 13,
    color: '#16a34a',
    fontWeight: '500',
  },
  csStatusError: {
    fontSize: 13,
    color: '#dc2626',
  },
  csActionButton: {
    flexDirection: 'row',
    backgroundColor: '#eb7825',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  csActionButtonDisabled: {
    opacity: 0.45,
  },
  csActionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  csPhoneInviteesContainer: {
    marginTop: 10,
  },
  csPhoneInviteesLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#9CA3AF',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  csPhoneInviteesList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  csPhoneInviteePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    gap: 4,
  },
  csPhoneInviteePillText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
  },
  selectedFriendsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  selectedFriendTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3E7',
    borderWidth: 1,
    borderColor: '#FDDCAB',
    borderRadius: 16,
    paddingLeft: 4,
    paddingRight: 8,
    paddingVertical: 4,
    gap: 6,
  },
  selectedFriendAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  selectedFriendAvatarImage: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  selectedFriendAvatarText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  selectedFriendName: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
    maxWidth: 80,
  },
  removeFriendButton: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noFriendsContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  noFriendsText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
    marginTop: 8,
  },
  noFriendsSubtext: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 4,
    textAlign: 'center',
  },
  friendsList: {
    gap: 8,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  friendItemSelected: {
    borderColor: '#eb7825',
    backgroundColor: '#FEF3E7',
  },
  friendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    overflow: 'hidden',
  },
  friendAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  friendAvatarText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  friendInfo: {
    flex: 1,
  },
  friendName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  friendUsername: {
    fontSize: 12,
    color: '#6B7280',
  },
  friendCheckmark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
