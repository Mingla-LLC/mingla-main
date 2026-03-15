import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Image,
  Share,
  Alert,
  Platform,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { KeyboardAwareScrollView } from './ui/KeyboardAwareScrollView';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useNavigation } from '../contexts/NavigationContext';
import { useAppStore } from '../store/appStore';
import { useFriends } from '../hooks/useFriends';
import { supabase } from '../services/supabase';
import { BoardInviteService } from '../services/boardInviteService';
import { realtimeService } from '../services/realtimeService';
import { BoardPreferencesForm, BoardPreferences } from './board/BoardPreferencesForm';
import { InviteMethodSelector, InviteMethod } from './board/InviteMethodSelector';
import { InviteLinkShare } from './board/InviteLinkShare';
import { QRCodeDisplay } from './board/QRCodeDisplay';
import { InviteCodeDisplay } from './board/InviteCodeDisplay';
import FriendSelectionModal from './FriendSelectionModal';
import { CountryPickerModal, CountryPickerOverlay } from './onboarding/CountryPickerModal';
import { CountryData } from '../types/onboarding';
import { usePhoneLookup, useDebouncedValue } from '../hooks/usePhoneLookup';
import { createPendingInvite, createPendingSessionInvite } from '../services/phoneLookupService';
import { getCountryByCode, getDefaultCountryCode } from '../constants/countries';
import {
  colors,
  spacing,
  radius,
  typography,
  fontWeights,
  shadows,
  touchTargets,
} from '../constants/designSystem';

// ─── Types ──────────────────────────────────────────────────────────
type SessionType = 'board' | 'collaboration';
type Step = 'type' | 'basic' | 'friends' | 'preferences' | 'invite' | 'review' | 'success';

interface SelectedFriend {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  avatar_url?: string;
}

export interface CreateSessionContentProps {
  preSelectedFriend?: {
    id: string;
    name: string;
    username?: string;
    avatar?: string;
  } | null;
  onCreateSession?: (sessionData: {
    id: string;
    name: string;
    status: string;
    createdBy: string;
    createdAt: string;
  }) => void;
  onNavigateToInvites?: () => void;
  isEmbedded?: boolean;
  /**
   * When provided, the country picker opens as an overlay rendered by the
   * PARENT (outside overflow:hidden, no nested Dialog) instead of its own
   * <Modal>. Required when isEmbedded=true inside another Modal.
   */
  onOpenCountryPicker?: (config: {
    selectedCode: string;
    onSelect: (code: string) => void;
  }) => void;
}

// ─── Embedded step config ───────────────────────────────────────────
const EMBEDDED_STEPS: Step[] = ['basic', 'friends', 'review'];
const EMBEDDED_STEP_LABELS = ['Name', 'Crew', 'Review'];

// ─── Progress Indicator ─────────────────────────────────────────────
const StepProgress: React.FC<{ steps: string[]; currentIndex: number }> = ({
  steps,
  currentIndex,
}) => (
  <View style={styles.progressContainer}>
    {steps.map((label, i) => {
      const isCompleted = i < currentIndex;
      const isCurrent = i === currentIndex;
      const isLast = i === steps.length - 1;
      return (
        <React.Fragment key={label}>
          <View style={styles.progressStep}>
            <View
              style={[
                styles.progressDot,
                isCompleted && styles.progressDotCompleted,
                isCurrent && styles.progressDotCurrent,
              ]}
            >
              {isCompleted ? (
                <Ionicons name="checkmark" size={10} color={colors.text.inverse} />
              ) : (
                <Text
                  style={[
                    styles.progressDotText,
                    isCurrent && styles.progressDotTextCurrent,
                  ]}
                >
                  {i + 1}
                </Text>
              )}
            </View>
            <Text
              style={[
                styles.progressLabel,
                (isCompleted || isCurrent) && styles.progressLabelActive,
              ]}
            >
              {label}
            </Text>
          </View>
          {!isLast && (
            <View
              style={[
                styles.progressLine,
                isCompleted && styles.progressLineCompleted,
              ]}
            />
          )}
        </React.Fragment>
      );
    })}
  </View>
);

// ─── Avatar helper ──────────────────────────────────────────────────
const Avatar: React.FC<{
  uri?: string | null;
  name: string;
  size?: number;
}> = ({ uri, name, size = 40 }) => {
  const safeName = name || '?';
  const initials = safeName
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
  const borderRadius = size * 0.25;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius }}
        accessibilityLabel={`${safeName}'s avatar`}
      />
    );
  }
  return (
    <View
      style={[
        styles.avatarPlaceholder,
        { width: size, height: size, borderRadius },
      ]}
      accessibilityLabel={`${safeName}'s avatar`}
    >
      <Text style={[styles.avatarInitials, { fontSize: size * 0.35 }]}>
        {initials}
      </Text>
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════════
// CreateSessionContent
// ═══════════════════════════════════════════════════════════════════
export const CreateSessionContent: React.FC<CreateSessionContentProps> = ({
  preSelectedFriend,
  onCreateSession,
  onNavigateToInvites,
  isEmbedded = false,
  onOpenCountryPicker,
}) => {
  // ── Step management ───────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState<Step>(
    isEmbedded ? 'basic' : 'type',
  );
  const [sessionType, setSessionType] = useState<SessionType | null>(
    isEmbedded ? 'collaboration' : null,
  );

  // ── Basic info ────────────────────────────────────────────────────
  const [sessionName, setSessionName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [maxParticipants, setMaxParticipants] = useState<string>('');

  // ── Friends ───────────────────────────────────────────────────────
  const [selectedFriends, setSelectedFriends] = useState<SelectedFriend[]>(
    preSelectedFriend
      ? [
          {
            id: preSelectedFriend.id,
            name: preSelectedFriend.name,
            username: preSelectedFriend.username || '',
            avatar_url: preSelectedFriend.avatar,
          },
        ]
      : [],
  );

  // H5 FIX: Sync selectedFriends when preSelectedFriend prop changes.
  useEffect(() => {
    if (preSelectedFriend) {
      setSelectedFriends((prev) => {
        const alreadySelected = prev.some((f) => f.id === preSelectedFriend.id);
        if (alreadySelected) return prev;
        return [
          ...prev,
          {
            id: preSelectedFriend.id,
            name: preSelectedFriend.name,
            username: preSelectedFriend.username || '',
            avatar_url: preSelectedFriend.avatar,
          },
        ];
      });
    }
  }, [preSelectedFriend?.id]);

  const [showFriendModal, setShowFriendModal] = useState(false);
  const { friends, fetchFriends } = useFriends();

  // ── Preferences (board only) ──────────────────────────────────────
  const [preferences, setPreferences] = useState<BoardPreferences | null>(null);
  const [inviteMethod, setInviteMethod] = useState<InviteMethod>(
    isEmbedded ? 'friends_list' : null,
  );

  // ── Creation state ────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  const isSubmittingRef = useRef(false); // re-entrancy guard for double-tap
  const phoneResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inviteLinkData, setInviteLinkData] = useState<{
    inviteCode: string;
    inviteLink: string;
  } | null>(null);

  // ── Phone lookup (AddFriendView pattern) ─────────────────────────
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<CountryData>(
    () =>
      getCountryByCode(getDefaultCountryCode()) ?? {
        code: 'US',
        name: 'United States',
        dialCode: '+1',
        flag: '🇺🇸',
      },
  );
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [phoneActionStatus, setPhoneActionStatus] = useState<
    'idle' | 'sending' | 'sent' | 'error'
  >('idle');
  const [phoneActionError, setPhoneActionError] = useState('');
  const [phoneInvitees, setPhoneInvitees] = useState<
    Array<{ type: 'phone'; phoneE164: string; displayName: string }>
  >([]);
  const [referralCode, setReferralCode] = useState<string | null>(null);

  // Build E.164 phone (AddFriendView pattern)
  const phoneRawDigits = phoneNumber.replace(/\D/g, '');
  const phoneE164 = useMemo(() => {
    if (!phoneRawDigits) return '';
    return `${selectedCountry.dialCode}${phoneRawDigits}`;
  }, [phoneRawDigits, selectedCountry]);

  const debouncedPhoneE164 = useDebouncedValue(phoneE164, 500);
  const debouncedPhoneDigitCount = useDebouncedValue(phoneRawDigits.length, 500);

  const isPhoneValid = useMemo(() => {
    // Match usePhoneLookup's viability: E.164 must be >= 11 chars
    const e164Length = selectedCountry.dialCode.length + phoneRawDigits.length;
    return phoneRawDigits.length >= 7 && phoneRawDigits.length <= 15 && e164Length >= 11;
  }, [phoneRawDigits, selectedCountry]);

  const {
    data: phoneLookupResult,
    isLoading: phoneLookupLoading,
  } = usePhoneLookup(debouncedPhoneE164, debouncedPhoneDigitCount >= 7);

  const { createCollaborativeSession } = useSessionManagement();
  const { user } = useAppStore();

  // ── Side effects ──────────────────────────────────────────────────
  useEffect(() => {
    if (currentStep === 'friends') fetchFriends();
  }, [currentStep, fetchFriends]);

  useEffect(() => {
    if (user) {
      supabase
        .from('profiles')
        .select('referral_code')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.referral_code) setReferralCode(data.referral_code);
        })
        .catch(() => {});
    }
  }, [user]);

  // Clean up phone reset timer on unmount
  useEffect(() => {
    return () => {
      if (phoneResetTimerRef.current) clearTimeout(phoneResetTimerRef.current);
    };
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────
  const resetState = useCallback(() => {
    setCurrentStep(isEmbedded ? 'basic' : 'type');
    setSessionType(isEmbedded ? 'collaboration' : null);
    setSessionName('');
    setNameError(null);
    setMaxParticipants('');
    setSelectedFriends(
      preSelectedFriend
        ? [
            {
              id: preSelectedFriend.id,
              name: preSelectedFriend.name,
              username: preSelectedFriend.username || '',
              avatar_url: preSelectedFriend.avatar,
            },
          ]
        : [],
    );
    setPreferences(null);
    setInviteMethod(isEmbedded ? 'friends_list' : null);
    setInviteLinkData(null);
    setPhoneNumber('');
    setPhoneActionStatus('idle');
    setPhoneActionError('');
    setShowCountryPicker(false);
    if (phoneResetTimerRef.current) {
      clearTimeout(phoneResetTimerRef.current);
      phoneResetTimerRef.current = null;
    }
    setPhoneInvitees([]);
    setCreationError(null);
  }, [isEmbedded, preSelectedFriend]);

  const totalPeople = selectedFriends.length + phoneInvitees.length;
  const embeddedStepIndex = EMBEDDED_STEPS.indexOf(currentStep);

  // ── canProceed ────────────────────────────────────────────────────
  const canProceed = (): boolean => {
    switch (currentStep) {
      case 'type':
        return sessionType !== null;
      case 'basic':
        return sessionName.trim().length > 0;
      case 'friends':
        return sessionType === 'collaboration'
          ? selectedFriends.length > 0 || phoneInvitees.length > 0
          : true;
      case 'preferences':
        return true;
      case 'invite':
        return inviteMethod !== null;
      case 'review':
        return sessionType === 'collaboration'
          ? selectedFriends.length > 0 || phoneInvitees.length > 0
          : true;
      case 'success':
        return false;
      default:
        return false;
    }
  };

  // ── Navigation handlers ───────────────────────────────────────────
  const handleSelectSessionType = (type: SessionType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSessionType(type);
    setCurrentStep('basic');
  };

  const handleNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCreationError(null);

    if (currentStep === 'basic') {
      if (!sessionName.trim()) {
        setNameError('Give your session a name so your crew can find it');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      setNameError(null);
      setCurrentStep('friends');
    } else if (currentStep === 'friends') {
      if (
        sessionType === 'collaboration' &&
        selectedFriends.length === 0 &&
        phoneInvitees.length === 0
      ) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      if (isEmbedded) {
        setCurrentStep('review');
      } else if (sessionType === 'board') {
        setCurrentStep('preferences');
      } else {
        setCurrentStep('invite');
      }
    } else if (currentStep === 'preferences') {
      setCurrentStep('invite');
    } else if (currentStep === 'invite') {
      if (!inviteMethod) return;
      setCurrentStep('review');
    } else if (currentStep === 'review') {
      handleCreateSession();
    }
  };

  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCreationError(null);
    if (currentStep === 'basic' && !isEmbedded) {
      setCurrentStep('type');
    } else if (currentStep === 'friends') {
      setCurrentStep('basic');
    } else if (currentStep === 'preferences') {
      setCurrentStep('friends');
    } else if (currentStep === 'invite') {
      setCurrentStep(sessionType === 'board' ? 'preferences' : 'friends');
    } else if (currentStep === 'review') {
      setCurrentStep(isEmbedded ? 'friends' : 'invite');
    }
  };

  // ── Session creation ──────────────────────────────────────────────
  const handleCreateSession = async () => {
    // Re-entrancy guard: prevent double-tap from creating duplicate sessions
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    if (!user) {
      setCreationError('You need to be logged in to create a session');
      isSubmittingRef.current = false;
      return;
    }
    if (
      sessionType === 'collaboration' &&
      selectedFriends.length === 0 &&
      phoneInvitees.length === 0
    ) {
      setCreationError('Add at least one person to your session');
      isSubmittingRef.current = false;
      return;
    }

    setLoading(true);
    setCreationError(null);
    try {
      let sessionId: string | null = null;

      if (sessionType === 'board') {
        const { data: sessionData, error: sessionError } = await supabase
          .from('collaboration_sessions')
          .insert({
            name: sessionName.trim(),
            created_by: user.id,
            session_type: 'board',
            status: 'pending',
            is_active: true,
            max_participants: maxParticipants
              ? Math.max(1, parseInt(maxParticipants, 10) || 0) || null
              : null,
            last_activity_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (sessionError) throw sessionError;
        const boardSessionId = sessionData.id;
        sessionId = boardSessionId;

        if (preferences) {
          await supabase.from('board_session_preferences').insert({
            session_id: boardSessionId,
            categories: preferences.categories || [],
            budget_min: preferences.budgetMin,
            budget_max: preferences.budgetMax,
            experience_types: preferences.experienceTypes || [],
          });
        }

        await supabase.from('session_participants').insert({
          session_id: boardSessionId,
          user_id: user.id,
          has_accepted: true,
          joined_at: new Date().toISOString(),
        });

        if (selectedFriends.length > 0 && inviteMethod === 'friends_list') {
          const friendIds = selectedFriends.map((f) => f.id);
          await BoardInviteService.sendFriendInvites(
            boardSessionId,
            friendIds,
            user.id,
          );
        }

        const linkData =
          await BoardInviteService.generateInviteLink(boardSessionId);
        if (linkData) {
          setInviteLinkData({
            inviteCode: linkData.inviteCode,
            inviteLink: linkData.inviteLink,
          });
        }

        await realtimeService.markOnline(boardSessionId, user.id);
      } else {
        // Collaboration session
        const friendsWithUsername = selectedFriends.filter(
          (f) => f.username && f.username.trim() !== '',
        );
        const friendsWithoutUsername = selectedFriends.filter(
          (f) => !f.username || f.username.trim() === '',
        );

        const participantUsernames = friendsWithUsername.map((f) => f.username);
        sessionId = await createCollaborativeSession(
          participantUsernames,
          sessionName.trim(),
        );

        // Fallback: add friends without usernames directly by user ID
        if (sessionId && friendsWithoutUsername.length > 0) {
          for (const friend of friendsWithoutUsername) {
            try {
              const { data: friendship } = await supabase
                .from('friends')
                .select('id')
                .eq('status', 'accepted')
                .or(
                  `and(user_id.eq.${user.id},friend_user_id.eq.${friend.id}),and(user_id.eq.${friend.id},friend_user_id.eq.${user.id})`,
                )
                .limit(1)
                .maybeSingle();

              let isFriend = !!friendship;

              if (!isFriend) {
                const { data: acceptedRequest } = await supabase
                  .from('friend_requests')
                  .select('id')
                  .eq('status', 'accepted')
                  .or(
                    `and(sender_id.eq.${user.id},receiver_id.eq.${friend.id}),and(sender_id.eq.${friend.id},receiver_id.eq.${user.id})`,
                  )
                  .limit(1)
                  .maybeSingle();
                isFriend = !!acceptedRequest;
              }

              await supabase.from('session_participants').insert({
                session_id: sessionId,
                user_id: friend.id,
                has_accepted: false,
              });

              const { data: inviteData } = await supabase
                .from('collaboration_invites')
                .insert({
                  session_id: sessionId,
                  inviter_id: user.id,
                  invited_user_id: friend.id,
                  status: 'pending',
                  pending_friendship: !isFriend,
                })
                .select('id')
                .single();

              if (!isFriend) {
                await supabase.from('friend_requests').upsert(
                  {
                    sender_id: user.id,
                    receiver_id: friend.id,
                    status: 'pending',
                  },
                  { onConflict: 'sender_id,receiver_id' },
                );
              }

              if (isFriend && inviteData) {
                const { data: friendProfile } = await supabase
                  .from('profiles')
                  .select('email')
                  .eq('id', friend.id)
                  .single();

                await supabase.functions.invoke('send-collaboration-invite', {
                  body: {
                    inviterId: user.id,
                    invitedUserId: friend.id,
                    invitedUserEmail: friendProfile?.email,
                    sessionId: sessionId,
                    sessionName: sessionName.trim(),
                    inviteId: inviteData.id,
                  },
                });
              }
            } catch (fallbackErr) {
              console.error(
                `Error adding friend ${friend.name} by ID fallback:`,
                fallbackErr,
              );
            }
          }
        }

        // Handle phone invitees
        if (sessionId && phoneInvitees.length > 0) {
          for (const invitee of phoneInvitees) {
            try {
              await createPendingInvite(user.id, invitee.phoneE164);
              await createPendingSessionInvite(
                sessionId,
                user.id,
                invitee.phoneE164,
              );
            } catch (inviteErr) {
              console.error('Error creating phone session invite:', inviteErr);
            }
          }
        }
      }

      if (sessionId) {
        // H4 FIX: Show success BEFORE calling parent callback.
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setCurrentStep('success');

        if (onCreateSession) {
          onCreateSession({
            id: sessionId,
            name: sessionName.trim(),
            status: 'pending',
            createdBy: user.id,
            createdAt: new Date().toISOString(),
          });
        }
      } else {
        throw new Error('Failed to create session');
      }
    } catch (error: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setCreationError(
        error instanceof Error ? error.message : 'Something went wrong. Give it another shot.',
      );
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  };

  // ── Friend selection ──────────────────────────────────────────────
  const handleSelectFriend = (friend: {
    id: string;
    name?: string;
    display_name?: string;
    username: string;
    avatar?: string;
    avatar_url?: string;
  }) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const isSelected = selectedFriends.some((f) => f.id === friend.id);
    if (isSelected) {
      setSelectedFriends(selectedFriends.filter((f) => f.id !== friend.id));
    } else {
      setSelectedFriends([
        ...selectedFriends,
        {
          id: friend.id,
          name: friend.name || friend.display_name || friend.username,
          username: friend.username,
          avatar: friend.avatar,
          avatar_url: friend.avatar_url || friend.avatar,
        },
      ]);
    }
    setShowFriendModal(false);
  };

  // ── Phone action handler (AddFriendView auto-chain pattern) ──────
  const handlePhoneAction = useCallback(async () => {
    if (!isPhoneValid || !debouncedPhoneE164) return;
    if (!user) {
      setPhoneActionError('Not signed in');
      setPhoneActionStatus('error');
      return;
    }

    setPhoneActionStatus('sending');
    setPhoneActionError('');

    try {
      if (phoneLookupResult?.found && phoneLookupResult.user) {
        // Self-lookup guard
        if (phoneLookupResult.user.id === user.id) {
          Alert.alert("That's you!", "You can't add yourself to a session.");
          setPhoneActionStatus('idle');
          return;
        }

        // Already in selectedFriends guard
        if (selectedFriends.some((f) => f.id === phoneLookupResult.user?.id)) {
          Alert.alert('Already added', 'This person is already in your session.');
          setPhoneActionStatus('idle');
          return;
        }

        if (
          phoneLookupResult.friendship_status === 'none' ||
          phoneLookupResult.friendship_status === 'friends' ||
          phoneLookupResult.friendship_status === 'pending_sent' ||
          phoneLookupResult.friendship_status === 'pending_received'
        ) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

          // Send friend request if not already friends or pending
          if (phoneLookupResult.friendship_status === 'none') {
            await supabase.from('friend_requests').upsert(
              {
                sender_id: user.id,
                receiver_id: phoneLookupResult.user.id,
                status: 'pending',
              },
              { onConflict: 'sender_id,receiver_id' },
            );
          }

          // Add to selectedFriends for session creation
          const friendData: SelectedFriend = {
            id: phoneLookupResult.user.id,
            name:
              phoneLookupResult.user.display_name ||
              phoneLookupResult.user.username,
            username: phoneLookupResult.user.username,
            avatar_url: phoneLookupResult.user.avatar_url || undefined,
          };
          setSelectedFriends((prev) => [...prev, friendData]);

          setPhoneActionStatus('sent');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          phoneResetTimerRef.current = setTimeout(() => {
            setPhoneNumber('');
            setPhoneActionStatus('idle');
          }, 2000);
        }
      } else {
        // Not on Mingla — create pending invite + share
        await createPendingInvite(user.id, debouncedPhoneE164);

        // Share in its own try/catch — dismissal is not an error
        try {
          const inviteLink = referralCode
            ? `https://usemingla.com/invite/${referralCode}`
            : 'https://usemingla.com';
          await Share.share({
            message: `Hey! Join me on Mingla and let's find amazing experiences together. ${inviteLink}`,
          });
        } catch {
          // User dismissed share sheet — not an error
        }

        // Track as phone invitee (skip duplicates)
        setPhoneInvitees((prev) => {
          if (prev.some((i) => i.phoneE164 === debouncedPhoneE164)) return prev;
          return [
            ...prev,
            {
              type: 'phone',
              phoneE164: debouncedPhoneE164,
              displayName: debouncedPhoneE164,
            },
          ];
        });

        setPhoneActionStatus('sent');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        phoneResetTimerRef.current = setTimeout(() => {
          setPhoneNumber('');
          setPhoneActionStatus('idle');
        }, 2000);
      }
    } catch (err) {
      console.error('[CreateSession] Phone action error:', err);
      setPhoneActionError(
        err instanceof Error ? err.message : 'Something went wrong',
      );
      setPhoneActionStatus('error');
    }
  }, [
    isPhoneValid,
    debouncedPhoneE164,
    phoneLookupResult,
    user,
    selectedFriends,
    referralCode,
  ]);

  // ── Phone action button label & disabled state ──────────────────
  const getPhoneActionLabel = (): string => {
    if (phoneLookupLoading) return 'Looking up...';
    if (!isPhoneValid) return 'Enter phone number';
    if (phoneLookupResult?.found) {
      if (phoneLookupResult.user?.id === user?.id) return "That's you";
      if (selectedFriends.some((f) => f.id === phoneLookupResult.user?.id))
        return 'Already added';
      return 'Add to session';
    }
    return 'Invite to Mingla';
  };

  const isPhoneActionDisabled =
    !isPhoneValid ||
    phoneLookupLoading ||
    phoneE164 !== debouncedPhoneE164 || // debounce hasn't settled
    phoneActionStatus === 'sending' ||
    phoneActionStatus === 'sent' ||
    (phoneLookupResult?.found &&
      phoneLookupResult.user?.id === user?.id) ||
    (phoneLookupResult?.found &&
      selectedFriends.some((f) => f.id === phoneLookupResult.user?.id));

  // ── Country select handler ──────────────────────────────────────
  const handleCountrySelect = useCallback((code: string) => {
    const country = getCountryByCode(code);
    if (country) {
      setSelectedCountry(country);
    }
  }, []);

  // ── Back button visibility ────────────────────────────────────────
  const showBackButton = isEmbedded
    ? currentStep !== 'basic' && currentStep !== 'success'
    : currentStep !== 'type' && currentStep !== 'success';

  // ══════════════════════════════════════════════════════════════════
  // STEP CONTENT RENDERING
  // ══════════════════════════════════════════════════════════════════

  const renderStepContent = () => {
    switch (currentStep) {
      // ── TYPE SELECTION (standalone only) ───────────────────────────
      case 'type':
        return (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>Choose Session Type</Text>
            <Text style={styles.stepSubtitle}>
              Select the type of session you want to create
            </Text>

            <TouchableOpacity
              style={[
                styles.typeCard,
                sessionType === 'board' && styles.typeCardSelected,
              ]}
              onPress={() => handleSelectSessionType('board')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Board Session"
              accessibilityState={{ selected: sessionType === 'board' }}
            >
              <View style={[styles.typeIconWrap, sessionType === 'board' && styles.typeIconWrapSelected]}>
                <Ionicons
                  name="grid"
                  size={24}
                  color={sessionType === 'board' ? colors.primary[500] : colors.gray[400]}
                />
              </View>
              <Text
                style={[
                  styles.typeTitle,
                  sessionType === 'board' && styles.typeTitleSelected,
                ]}
              >
                Board Session
              </Text>
              <Text style={styles.typeDesc}>
                Real-time collaboration with voting and discussion
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.typeCard,
                sessionType === 'collaboration' && styles.typeCardSelected,
              ]}
              onPress={() => handleSelectSessionType('collaboration')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Collaboration Session"
              accessibilityState={{ selected: sessionType === 'collaboration' }}
            >
              <View style={[styles.typeIconWrap, sessionType === 'collaboration' && styles.typeIconWrapSelected]}>
                <Ionicons
                  name="people"
                  size={24}
                  color={sessionType === 'collaboration' ? colors.primary[500] : colors.gray[400]}
                />
              </View>
              <Text
                style={[
                  styles.typeTitle,
                  sessionType === 'collaboration' && styles.typeTitleSelected,
                ]}
              >
                Collaboration Session
              </Text>
              <Text style={styles.typeDesc}>
                Plan together in a simple, shared space
              </Text>
            </TouchableOpacity>
          </View>
        );

      // ── BASIC INFO ────────────────────────────────────────────────
      case 'basic':
        return (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>What are we calling this?</Text>
            <Text style={styles.stepSubtitle}>
              Pick a name your crew will recognize instantly
            </Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Session name</Text>
              <View
                style={[styles.inputWrap, nameError ? styles.inputWrapError : null]}
              >
                <TextInput
                  style={styles.input}
                  placeholder="Friday night plans, Birthday crawl..."
                  placeholderTextColor={colors.gray[400]}
                  value={sessionName}
                  onChangeText={(t) => {
                    setSessionName(t);
                    if (nameError) setNameError(null);
                  }}
                  maxLength={50}
                  autoCapitalize="sentences"
                  returnKeyType="done"
                  accessibilityLabel="Session name"
                  accessibilityHint="Enter a name for your collaboration session"
                />
                <Text style={styles.charCount}>
                  {sessionName.length}/50
                </Text>
              </View>
              {nameError && (
                <View style={styles.inlineError}>
                  <Ionicons
                    name="alert-circle"
                    size={14}
                    color={colors.error[500]}
                  />
                  <Text style={styles.inlineErrorText}>{nameError}</Text>
                </View>
              )}
            </View>

            {/* Pre-selected friend indicator */}
            {preSelectedFriend && isEmbedded && (
              <View style={styles.preSelectedCard}>
                <View style={styles.preSelectedRow}>
                  <Avatar
                    uri={preSelectedFriend.avatar}
                    name={preSelectedFriend.name}
                    size={36}
                  />
                  <View style={styles.preSelectedInfo}>
                    <Text style={styles.preSelectedName}>
                      {preSelectedFriend.name}
                    </Text>
                    <Text style={styles.preSelectedHint}>
                      Already on the guest list — you can change this next
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {sessionType === 'board' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Max participants (optional)</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    placeholder="Leave empty for unlimited"
                    placeholderTextColor={colors.gray[400]}
                    value={maxParticipants}
                    onChangeText={setMaxParticipants}
                    keyboardType="numeric"
                    accessibilityLabel="Maximum number of participants"
                  />
                </View>
              </View>
            )}
          </View>
        );

      // ── FRIENDS STEP ──────────────────────────────────────────────
      case 'friends':
        return (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>Who's coming along?</Text>
            <Text style={styles.stepSubtitle}>
              {sessionType === 'board'
                ? 'Add friends to your board — the more the merrier'
                : 'Add at least one person. Great plans need great company.'}
            </Text>

            {/* Selected people summary */}
            {totalPeople > 0 && (
              <View style={styles.crewCount}>
                <Ionicons
                  name="people"
                  size={16}
                  color={colors.primary[500]}
                />
                <Text style={styles.crewCountText}>
                  {totalPeople} {totalPeople === 1 ? 'person' : 'people'} added
                </Text>
              </View>
            )}

            {/* Add from friends */}
            <TouchableOpacity
              style={styles.addFriendBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowFriendModal(true);
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Select friends from your list"
            >
              <View style={styles.addFriendIcon}>
                <Ionicons
                  name="person-add"
                  size={20}
                  color={colors.primary[500]}
                />
              </View>
              <View style={styles.addFriendContent}>
                <Text style={styles.addFriendTitle}>Add from friends</Text>
                <Text style={styles.addFriendHint}>
                  Pick from people you're already connected with
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={colors.gray[400]}
              />
            </TouchableOpacity>

            {/* Selected friends list */}
            {selectedFriends.length > 0 && (
              <View style={styles.selectedList}>
                {selectedFriends.map((friend) => {
                  const isPreSelected =
                    preSelectedFriend?.id === friend.id;
                  return (
                    <View
                      key={friend.id}
                      style={styles.selectedItem}
                      accessibilityLabel={`${friend.name}${isPreSelected ? ', pre-selected' : ''}`}
                    >
                      <Avatar
                        uri={friend.avatar || friend.avatar_url}
                        name={friend.name}
                        size={36}
                      />
                      <Text style={styles.selectedName} numberOfLines={1}>
                        {friend.name}
                      </Text>
                      {isPreSelected && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>invited</Text>
                        </View>
                      )}
                      <TouchableOpacity
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setSelectedFriends(
                            selectedFriends.filter(
                              (f) => f.id !== friend.id,
                            ),
                          );
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.removeBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${friend.name}`}
                      >
                        <Ionicons
                          name="close-circle"
                          size={20}
                          color={colors.gray[400]}
                        />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Phone invitees */}
            {phoneInvitees.length > 0 && (
              <View style={styles.phoneInviteesList}>
                {phoneInvitees.map((invitee) => (
                  <View key={invitee.phoneE164} style={styles.phoneInviteePill}>
                    <Ionicons
                      name="call-outline"
                      size={12}
                      color={colors.primary[600]}
                    />
                    <Text style={styles.phoneInviteeText}>
                      {invitee.phoneE164}
                    </Text>
                    <TouchableOpacity
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setPhoneInvitees((prev) =>
                          prev.filter(
                            (i) => i.phoneE164 !== invitee.phoneE164,
                          ),
                        );
                      }}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${invitee.phoneE164}`}
                    >
                      <Ionicons
                        name="close"
                        size={14}
                        color={colors.primary[600]}
                      />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Phone lookup — AddFriendView pattern */}
            <View style={styles.phoneSection}>
              <Text style={styles.phoneSectionLabel}>Know their number?</Text>
              <Text style={styles.phoneSectionHint}>
                {`We'll check if they're on Mingla`}
              </Text>

              {/* Inline phone input row (AddFriendView pattern) */}
              <View style={styles.phoneLookupRow}>
                <TouchableOpacity
                  style={styles.phoneLookupCountry}
                  onPress={() => {
                    Keyboard.dismiss();
                    if (onOpenCountryPicker) {
                      // Embedded: parent renders the picker as an overlay
                      // (no nested Dialog, no overflow:hidden clipping).
                      onOpenCountryPicker({
                        selectedCode: selectedCountry.code,
                        onSelect: handleCountrySelect,
                      });
                    } else {
                      // Standalone: use <Modal> directly (no parent Modal).
                      setShowCountryPicker(true);
                    }
                  }}
                  activeOpacity={0.6}
                >
                  <Text style={styles.phoneLookupFlag}>{selectedCountry.flag}</Text>
                  <Text style={styles.phoneLookupDial}>{selectedCountry.dialCode}</Text>
                  <Ionicons name="chevron-down" size={14} color={colors.gray[400]} />
                </TouchableOpacity>

                <View style={styles.phoneLookupDivider} />

                <TextInput
                  style={styles.phoneLookupInput}
                  value={phoneNumber}
                  onChangeText={(text) => {
                    setPhoneNumber(text);
                    if (phoneActionStatus !== 'idle' && phoneActionStatus !== 'sending') {
                      setPhoneActionStatus('idle');
                      setPhoneActionError('');
                    }
                  }}
                  placeholder="Phone number"
                  placeholderTextColor={colors.gray[400]}
                  keyboardType="phone-pad"
                  autoCorrect={false}
                  maxLength={15}
                />

                {phoneLookupLoading && (
                  <ActivityIndicator
                    size="small"
                    color={colors.primary[500]}
                    style={styles.phoneLookupSpinner}
                  />
                )}
              </View>

              {/* Lookup result feedback */}
              {isPhoneValid && !phoneLookupLoading && phoneLookupResult && (
                <View style={styles.phoneLookupFeedback}>
                  {phoneLookupResult.found ? (
                    <View style={styles.phoneLookupFeedbackRow}>
                      <Ionicons name="checkmark-circle" size={14} color={colors.success[500]} />
                      <Text style={styles.phoneLookupFoundText}>
                        {phoneLookupResult.user?.display_name ||
                          phoneLookupResult.user?.username ||
                          'User'}{' '}
                        is on Mingla
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.phoneLookupFeedbackRow}>
                      <Ionicons name="person-add-outline" size={14} color={colors.gray[500]} />
                      <Text style={styles.phoneLookupNotFoundText}>
                        Not on Mingla yet
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Status feedback */}
              {phoneActionStatus === 'sent' && (
                <View style={styles.phoneLookupFeedbackRow}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.success[500]} />
                  <Text style={styles.phoneLookupSuccessText}>
                    {phoneLookupResult?.found ? 'Added to session!' : 'Invite sent!'}
                  </Text>
                </View>
              )}
              {phoneActionStatus === 'error' && (
                <View style={styles.phoneLookupFeedbackRow}>
                  <Ionicons name="alert-circle" size={16} color={colors.error[500]} />
                  <Text style={styles.phoneLookupErrorText}>{phoneActionError}</Text>
                </View>
              )}

              {/* Action button */}
              <TouchableOpacity
                style={[
                  styles.phoneLookupActionBtn,
                  isPhoneActionDisabled && styles.phoneLookupActionBtnDisabled,
                ]}
                onPress={handlePhoneAction}
                activeOpacity={0.7}
                disabled={!!isPhoneActionDisabled}
              >
                {phoneActionStatus === 'sending' ? (
                  <ActivityIndicator size="small" color={colors.text.inverse} />
                ) : (
                  <>
                    <Ionicons
                      name={phoneLookupResult?.found ? 'person-add' : 'paper-plane-outline'}
                      size={14}
                      color={colors.text.inverse}
                      style={styles.phoneLookupActionIcon}
                    />
                    <Text style={styles.phoneLookupActionBtnText}>
                      {getPhoneActionLabel()}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Country picker — Modal version for standalone mode only.
                When onOpenCountryPicker is provided (embedded), the parent
                renders the picker as an overlay instead of a nested Dialog. */}
            {!onOpenCountryPicker && showCountryPicker && (
              <CountryPickerOverlay
                selectedCode={selectedCountry.code}
                onSelect={handleCountrySelect}
                onClose={() => setShowCountryPicker(false)}
              />
            )}

            {/* Empty state */}
            {friends.length === 0 &&
              selectedFriends.length === 0 &&
              phoneInvitees.length === 0 &&
              onNavigateToInvites && (
                <View style={styles.emptyState}>
                  <View style={styles.emptyStateIcon}>
                    <Ionicons
                      name="people-outline"
                      size={32}
                      color={colors.gray[300]}
                    />
                  </View>
                  <Text style={styles.emptyStateTitle}>
                    No friends on Mingla yet?
                  </Text>
                  <Text style={styles.emptyStateDesc}>
                    Invite someone by phone above, or head to the Invites tab to
                    send friend requests
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onNavigateToInvites();
                    }}
                    style={styles.emptyStateBtn}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Go to Invites tab"
                  >
                    <Text style={styles.emptyStateBtnText}>Go to Invites</Text>
                  </TouchableOpacity>
                </View>
              )}

            {/* Validation nudge for collaboration */}
            {sessionType === 'collaboration' && totalPeople === 0 && (
              <View style={styles.nudge}>
                <Ionicons
                  name="information-circle-outline"
                  size={16}
                  color={colors.primary[500]}
                />
                <Text style={styles.nudgeText}>
                  You need at least one person to start a collaboration
                </Text>
              </View>
            )}
          </View>
        );

      // ── PREFERENCES (board only) ──────────────────────────────────
      case 'preferences':
        return (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>Board Preferences</Text>
            <Text style={styles.stepSubtitle}>
              Set the vibe for what you want to explore
            </Text>
            <BoardPreferencesForm
              initialPreferences={preferences || undefined}
              onPreferencesChange={setPreferences}
            />
          </View>
        );

      // ── INVITE METHOD (standalone only) ───────────────────────────
      case 'invite':
        return (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>How should we invite?</Text>
            <Text style={styles.stepSubtitle}>
              Pick the easiest way to get everyone on board
            </Text>
            <InviteMethodSelector
              selectedMethod={inviteMethod}
              onMethodSelect={setInviteMethod}
              availableMethods={
                selectedFriends.length > 0
                  ? ['friends_list', 'link', 'qr_code', 'invite_code']
                  : ['link', 'qr_code', 'invite_code']
              }
            />
          </View>
        );

      // ── REVIEW ────────────────────────────────────────────────────
      case 'review':
        return (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>Looking good — let's go!</Text>
            <Text style={styles.stepSubtitle}>
              Double-check the details, then hit create
            </Text>

            {/* Session name */}
            <View style={styles.reviewRow}>
              <View style={styles.reviewIcon}>
                <Ionicons name="text" size={18} color={colors.primary[500]} />
              </View>
              <View style={styles.reviewContent}>
                <Text style={styles.reviewLabel}>Session name</Text>
                <Text style={styles.reviewValue} numberOfLines={1}>
                  {sessionName}
                </Text>
              </View>
            </View>

            {/* People */}
            {totalPeople > 0 && (
              <View style={styles.reviewRow}>
                <View style={styles.reviewIcon}>
                  <Ionicons
                    name="people"
                    size={18}
                    color={colors.primary[500]}
                  />
                </View>
                <View style={styles.reviewContent}>
                  <Text style={styles.reviewLabel}>
                    {totalPeople} {totalPeople === 1 ? 'person' : 'people'} invited
                  </Text>
                  <Text style={styles.reviewValue} numberOfLines={2}>
                    {[
                      ...selectedFriends.map((f) => f.name),
                      ...phoneInvitees.map((i) => i.phoneE164),
                    ].join(', ')}
                  </Text>
                </View>
              </View>
            )}

            {/* Invite method (standalone only) */}
            {!isEmbedded && inviteMethod && (
              <View style={styles.reviewRow}>
                <View style={styles.reviewIcon}>
                  <Ionicons
                    name="mail"
                    size={18}
                    color={colors.primary[500]}
                  />
                </View>
                <View style={styles.reviewContent}>
                  <Text style={styles.reviewLabel}>Invite method</Text>
                  <Text style={styles.reviewValue}>
                    {inviteMethod === 'friends_list'
                      ? 'Friends List'
                      : inviteMethod === 'link'
                        ? 'Share Link'
                        : inviteMethod === 'qr_code'
                          ? 'QR Code'
                          : 'Invite Code'}
                  </Text>
                </View>
              </View>
            )}

            {/* Info banner */}
            <View style={styles.infoBanner}>
              <Ionicons
                name="sparkles"
                size={18}
                color={colors.primary[500]}
              />
              <Text style={styles.infoBannerText}>
                Once everyone accepts, you'll set collaboration preferences
                together — then the real fun begins.
              </Text>
            </View>

            {/* Creation error */}
            {creationError && (
              <View style={styles.creationError}>
                <Ionicons
                  name="alert-circle"
                  size={16}
                  color={colors.error[500]}
                />
                <Text style={styles.creationErrorText}>{creationError}</Text>
              </View>
            )}
          </View>
        );

      // ── SUCCESS ───────────────────────────────────────────────────
      case 'success':
        return (
          <View style={styles.stepBody}>
            <View style={styles.successWrap}>
              <View style={styles.successIconWrap}>
                <Ionicons
                  name="checkmark-circle"
                  size={56}
                  color={colors.success[500]}
                />
              </View>
              <Text style={styles.successTitle}>You're all set!</Text>
              <Text style={styles.successDesc}>
                {selectedFriends.length > 0
                  ? `We've pinged ${selectedFriends.length === 1 ? selectedFriends[0].name : `your ${selectedFriends.length} friends`}. Once they accept, you can start exploring together.`
                  : 'Your session is live. Invite people to start exploring together.'}
              </Text>
            </View>

            {inviteLinkData && (
              <View style={styles.successInvites}>
                <InviteLinkShare
                  inviteLink={inviteLinkData.inviteLink}
                  inviteCode={inviteLinkData.inviteCode}
                />
                <View style={styles.successInviteSection}>
                  <QRCodeDisplay data={inviteLinkData.inviteLink} />
                </View>
                <View style={styles.successInviteSection}>
                  <InviteCodeDisplay inviteCode={inviteLinkData.inviteCode} />
                </View>
              </View>
            )}
          </View>
        );

      default:
        return null;
    }
  };

  // ── CTA button config ─────────────────────────────────────────────
  const getCtaLabel = (): string => {
    if (currentStep === 'review') return 'Create session';
    return 'Continue';
  };

  // ══════════════════════════════════════════════════════════════════
  // EMBEDDED RENDERING
  // ══════════════════════════════════════════════════════════════════
  if (isEmbedded) {
    return (
      <View style={styles.root}>
        {/* Header */}
        {currentStep !== 'success' && (
          <View style={styles.embeddedHeader}>
            {showBackButton ? (
              <TouchableOpacity
                onPress={handleBack}
                style={styles.backBtn}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name="chevron-back"
                  size={20}
                  color={colors.text.secondary}
                />
              </TouchableOpacity>
            ) : (
              <View style={styles.backBtnPlaceholder} />
            )}

            {/* Progress indicator */}
            {embeddedStepIndex >= 0 && (
              <StepProgress
                steps={EMBEDDED_STEP_LABELS}
                currentIndex={embeddedStepIndex}
              />
            )}

            <View style={styles.backBtnPlaceholder} />
          </View>
        )}

        {/* Step content */}
        {renderStepContent()}

        {/* CTA button */}
        {currentStep !== 'success' && (
          <TouchableOpacity
            style={[
              styles.ctaBtn,
              (!canProceed() || loading) && styles.ctaBtnDisabled,
            ]}
            onPress={handleNext}
            disabled={!canProceed() || loading}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={
              loading ? 'Creating session' : getCtaLabel()
            }
            accessibilityState={{ disabled: !canProceed() || loading }}
          >
            {loading ? (
              <ActivityIndicator color={colors.text.inverse} size="small" />
            ) : (
              <Text style={styles.ctaBtnText}>{getCtaLabel()}</Text>
            )}
          </TouchableOpacity>
        )}

        {currentStep === 'success' && (
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              resetState();
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Create another session"
          >
            <Ionicons name="add" size={18} color={colors.primary[500]} />
            <Text style={styles.secondaryBtnText}>Create another</Text>
          </TouchableOpacity>
        )}

        {/* FriendSelectionModal */}
        <FriendSelectionModal
          isOpen={showFriendModal}
          onClose={() => setShowFriendModal(false)}
          onSelectFriend={handleSelectFriend}
          friends={friends.map((f) => ({
            id: f.friend_user_id,
            name: f.display_name || f.username,
            username: f.username,
            avatar: f.avatar_url,
            isOnline: false,
          }))}
        />
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // STANDALONE RENDERING
  // ══════════════════════════════════════════════════════════════════
  return (
    <View style={styles.standaloneRoot}>
      {renderStepContent()}
      {currentStep !== 'success' && (
        <TouchableOpacity
          style={[
            styles.ctaBtn,
            (!canProceed() || loading) && styles.ctaBtnDisabled,
          ]}
          onPress={handleNext}
          disabled={!canProceed() || loading}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={loading ? 'Creating session' : getCtaLabel()}
        >
          {loading ? (
            <ActivityIndicator color={colors.text.inverse} size="small" />
          ) : (
            <Text style={styles.ctaBtnText}>{getCtaLabel()}</Text>
          )}
        </TouchableOpacity>
      )}
      {currentStep === 'success' && (
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            resetState();
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Create another session"
        >
          <Ionicons name="add" size={18} color={colors.primary[500]} />
          <Text style={styles.secondaryBtnText}>Create another</Text>
        </TouchableOpacity>
      )}
      <FriendSelectionModal
        isOpen={showFriendModal}
        onClose={() => setShowFriendModal(false)}
        onSelectFriend={handleSelectFriend}
        friends={friends.map((f) => ({
          id: f.friend_user_id,
          name: f.display_name || f.username,
          username: f.username,
          avatar: f.avatar_url,
          isOnline: false,
        }))}
      />
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════════
// CreateSessionModal — standalone wrapper (preserved for future use)
// ═══════════════════════════════════════════════════════════════════
export const CreateSessionModal: React.FC = () => {
  const { isCreateSessionModalOpen, closeCreateSessionModal } = useNavigation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = windowHeight * 0.88;

  if (!isCreateSessionModalOpen) return null;

  return (
    <Modal
      visible={isCreateSessionModalOpen}
      animationType="slide"
      transparent
      onRequestClose={closeCreateSessionModal}
      statusBarTranslucent
    >
      <View style={styles.sheetOverlay}>
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={closeCreateSessionModal}
          accessibilityRole="button"
          accessibilityLabel="Close modal"
        />
        <View
          style={[
            styles.sheetContent,
            { height: sheetHeight, paddingBottom: Math.max(insets.bottom, spacing.md) },
          ]}
        >
          <View style={styles.dragHandleWrap}>
            <View style={styles.dragHandle} />
          </View>
          <KeyboardAwareScrollView
            style={styles.sheetScroll}
            showsVerticalScrollIndicator={false}
            bottomOffset={76}
          >
            <CreateSessionContent isEmbedded={false} />
          </KeyboardAwareScrollView>
          <View style={styles.sheetFooter}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={closeCreateSessionModal}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.secondaryBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ═══════════════════════════════════════════════════════════════════
// STYLES — 100% design system tokens, zero hardcoded values
// ═══════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  // ── Layout ────────────────────────────────────────────────────────
  root: {
    gap: spacing.md,
  },
  standaloneRoot: {
    flex: 1,
    gap: spacing.md,
    padding: spacing.md,
  },

  // ── Embedded header ───────────────────────────────────────────────
  embeddedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  backBtn: {
    width: touchTargets.minimum,
    height: touchTargets.minimum,
    borderRadius: radius.full,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnPlaceholder: {
    width: touchTargets.minimum,
    height: touchTargets.minimum,
  },

  // ── Progress indicator ────────────────────────────────────────────
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
  progressStep: {
    alignItems: 'center',
    gap: spacing.xxs,
  },
  progressDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDotCurrent: {
    backgroundColor: colors.primary[500],
  },
  progressDotCompleted: {
    backgroundColor: colors.success[500],
  },
  progressDotText: {
    ...typography.xs,
    fontWeight: fontWeights.semibold,
    color: colors.gray[500],
  },
  progressDotTextCurrent: {
    color: colors.text.inverse,
  },
  progressLabel: {
    ...typography.xs,
    fontWeight: fontWeights.medium,
    color: colors.gray[400],
  },
  progressLabelActive: {
    color: colors.text.primary,
    fontWeight: fontWeights.semibold,
  },
  progressLine: {
    width: 28,
    height: 2,
    backgroundColor: colors.gray[200],
    marginHorizontal: spacing.xs,
    marginBottom: spacing.md,
  },
  progressLineCompleted: {
    backgroundColor: colors.success[500],
  },

  // ── Step body ─────────────────────────────────────────────────────
  stepBody: {
    paddingVertical: spacing.sm,
  },
  stepTitle: {
    ...typography.xxl,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  stepSubtitle: {
    ...typography.sm,
    color: colors.text.tertiary,
    marginBottom: spacing.lg,
  },

  // ── Fields ────────────────────────────────────────────────────────
  fieldGroup: {
    marginBottom: spacing.lg,
  },
  fieldLabel: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    paddingHorizontal: spacing.md,
    minHeight: touchTargets.large,
  },
  inputWrapError: {
    borderColor: colors.error[400],
    backgroundColor: colors.error[50],
  },
  input: {
    flex: 1,
    ...typography.md,
    color: colors.text.primary,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
  },
  charCount: {
    ...typography.xs,
    color: colors.gray[400],
    marginLeft: spacing.sm,
  },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  inlineErrorText: {
    ...typography.sm,
    color: colors.error[500],
  },

  // ── Pre-selected card ─────────────────────────────────────────────
  preSelectedCard: {
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  preSelectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  preSelectedInfo: {
    flex: 1,
  },
  preSelectedName: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  preSelectedHint: {
    ...typography.xs,
    color: colors.text.tertiary,
    marginTop: spacing.xxs,
  },

  // ── Type cards ────────────────────────────────────────────────────
  typeCard: {
    backgroundColor: colors.background.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: colors.gray[200],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  typeCardSelected: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  typeIconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeIconWrapSelected: {
    backgroundColor: colors.primary[100],
  },
  typeTitle: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  typeTitleSelected: {
    color: colors.primary[600],
  },
  typeDesc: {
    ...typography.sm,
    color: colors.text.tertiary,
    flex: 1,
  },

  // ── Friends step ──────────────────────────────────────────────────
  crewCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary[50],
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  crewCountText: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.primary[600],
  },
  addFriendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  addFriendIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFriendContent: {
    flex: 1,
  },
  addFriendTitle: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  addFriendHint: {
    ...typography.xs,
    color: colors.text.tertiary,
    marginTop: spacing.xxs,
  },

  // ── Selected list ─────────────────────────────────────────────────
  selectedList: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  selectedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    padding: spacing.sm,
    paddingLeft: spacing.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  selectedName: {
    flex: 1,
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.text.primary,
  },
  badge: {
    backgroundColor: colors.primary[100],
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  badgeText: {
    ...typography.xs,
    fontWeight: fontWeights.medium,
    color: colors.primary[600],
  },
  removeBtn: {
    padding: spacing.xs,
  },

  // ── Avatar ────────────────────────────────────────────────────────
  avatarPlaceholder: {
    backgroundColor: colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },

  // ── Phone invitees ────────────────────────────────────────────────
  phoneInviteesList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  phoneInviteePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary[50],
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  phoneInviteeText: {
    ...typography.xs,
    fontWeight: fontWeights.medium,
    color: colors.primary[700],
  },

  // ── Divider ───────────────────────────────────────────────────────
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.gray[200],
  },
  dividerText: {
    ...typography.xs,
    fontWeight: fontWeights.medium,
    color: colors.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // ── Phone section (AddFriendView pattern) ────────────────────────
  phoneSection: {
    marginBottom: spacing.md,
  },
  phoneSectionLabel: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.xxs,
  },
  phoneSectionHint: {
    ...typography.xs,
    color: colors.text.tertiary,
  },
  phoneLookupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: radius.md,
    height: 46,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  phoneLookupCountry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    height: '100%',
  },
  phoneLookupFlag: {
    fontSize: 16,
    marginRight: 3,
  },
  phoneLookupDial: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginRight: 3,
  },
  phoneLookupDivider: {
    width: 1,
    height: 22,
    backgroundColor: colors.gray[300],
  },
  phoneLookupInput: {
    flex: 1,
    paddingHorizontal: spacing.sm,
    ...typography.md,
    color: colors.text.primary,
    height: '100%',
  },
  phoneLookupFeedback: {
    marginTop: spacing.xs,
  },
  phoneLookupFeedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.xs,
  },
  phoneLookupFoundText: {
    ...typography.xs,
    color: colors.success[600],
    fontWeight: fontWeights.medium,
  },
  phoneLookupNotFoundText: {
    ...typography.xs,
    color: colors.gray[500],
  },
  phoneLookupSuccessText: {
    ...typography.sm,
    color: colors.success[600],
    fontWeight: fontWeights.medium,
  },
  phoneLookupErrorText: {
    ...typography.sm,
    color: colors.error[500],
  },
  phoneLookupActionBtn: {
    flexDirection: 'row',
    backgroundColor: colors.primary[500],
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  phoneLookupActionBtnDisabled: {
    opacity: 0.45,
  },
  phoneLookupActionBtnText: {
    color: colors.text.inverse,
    ...typography.sm,
    fontWeight: fontWeights.semibold,
  },
  phoneLookupSpinner: {
    marginRight: spacing.sm,
  },
  phoneLookupActionIcon: {
    marginRight: spacing.xs,
  },

  // ── Empty state ───────────────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyStateIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyStateTitle: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  emptyStateDesc: {
    ...typography.sm,
    color: colors.text.tertiary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  emptyStateBtn: {
    backgroundColor: colors.primary[500],
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  emptyStateBtnText: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },

  // ── Nudge ─────────────────────────────────────────────────────────
  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  nudgeText: {
    flex: 1,
    ...typography.xs,
    color: colors.primary[700],
  },

  // ── Review step ───────────────────────────────────────────────────
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  reviewIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xxs,
  },
  reviewContent: {
    flex: 1,
  },
  reviewLabel: {
    ...typography.xs,
    fontWeight: fontWeights.medium,
    color: colors.text.tertiary,
    marginBottom: spacing.xxs,
  },
  reviewValue: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  infoBannerText: {
    flex: 1,
    ...typography.sm,
    color: colors.primary[700],
  },

  // ── Creation error ────────────────────────────────────────────────
  creationError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.error[50],
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.error[200],
  },
  creationErrorText: {
    flex: 1,
    ...typography.sm,
    color: colors.error[700],
  },

  // ── Success ───────────────────────────────────────────────────────
  successWrap: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  successIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.success[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  successTitle: {
    ...typography.xxl,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  successDesc: {
    ...typography.sm,
    color: colors.text.tertiary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  successInvites: {
    marginTop: spacing.xl,
  },
  successInviteSection: {
    marginTop: spacing.lg,
  },

  // ── CTA button ────────────────────────────────────────────────────
  ctaBtn: {
    backgroundColor: colors.primary[500],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touchTargets.large,
    ...shadows.sm,
  },
  ctaBtnDisabled: {
    backgroundColor: colors.gray[300],
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaBtnText: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    minHeight: touchTargets.comfortable,
    borderWidth: 1.5,
    borderColor: colors.primary[200],
  },
  secondaryBtnText: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.primary[500],
  },

  // ── Standalone modal ──────────────────────────────────────────────
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheetContent: {
    backgroundColor: colors.background.primary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.xl,
  },
  dragHandleWrap: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray[300],
  },
  sheetScroll: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  sheetFooter: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
    backgroundColor: colors.background.primary,
  },
});
