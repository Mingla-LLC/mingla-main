import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  Share,
  ActivityIndicator,
  Image,
  Animated,
  Easing,
  StyleSheet,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { Icon } from '../ui/Icon'
import { getDisplayName } from '../../utils/getDisplayName'

import { PhoneInput } from './PhoneInput'
import { usePhoneLookup, useDebouncedValue } from '../../hooks/usePhoneLookup'
import { createPendingInvite } from '../../services/phoneLookupService'
import { supabase } from '../../services/supabase'
import { AddedFriend, OnboardingPairAction } from '../../types/onboarding'
import { FriendRequest } from '../../services/friendsService'
import { PairRequest } from '../../services/pairingService'
import { useSendPairRequest, useAcceptPairRequest, useDeclinePairRequest, useIncomingPairRequests } from '../../hooks/usePairings'
import { getDefaultCountryCode, getCountryByCode } from '../../constants/countries'
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  touchTargets,
  shadows,
} from '../../constants/designSystem'

// Shared static scale value for non-animatable friends (invited, no userId)
const STATIC_SCALE = new Animated.Value(1)

// ─── Pair Pill States ───

type PairPillState = 'unpaired' | 'sending' | 'pending' | 'paired' | 'disabled' | 'queued'

function getPairPillState(
  friend: AddedFriend,
  pairActions: OnboardingPairAction[],
  sendingForUserId: string | null,
  queuedPairPhones: Set<string>,
): PairPillState {
  // Check pair actions for existing users or invited users by phone
  const action = pairActions.find(a =>
    (a.targetUserId != null && a.targetUserId === friend.userId) ||
    (a.targetPhoneE164 != null && a.targetPhoneE164 === friend.phoneE164)
  )

  if (action) {
    if (action.type === 'accepted' || action.pairingId) return 'paired'
    if (action.type === 'sent') return 'pending'
    if (action.type === 'queued') return 'queued'
  }

  // Currently sending (for existing users by userId, for invited by phoneE164)
  if (sendingForUserId === friend.userId) return 'sending'
  if (sendingForUserId === friend.phoneE164) return 'sending'

  // Invited users with queued pair intent
  if (queuedPairPhones.has(friend.phoneE164)) return 'queued'

  // Invited users without userId — tappable for pair queueing
  if (friend.type === 'invited' && !friend.userId) return 'unpaired'

  // No userId at all (shouldn't happen for existing users)
  if (!friend.userId && friend.type !== 'invited') return 'disabled'

  return 'unpaired'
}

// ─── Props ───

interface OnboardingFriendsAndPairingStepProps {
  userId: string
  userPhoneE164: string
  // Friend state (persisted by parent)
  addedFriends: AddedFriend[]
  onAddFriend: (friend: AddedFriend) => void
  onRemoveFriend: (phoneE164: string) => void
  // Pair state (persisted by parent)
  pairActions: OnboardingPairAction[]
  onPairAction: (action: OnboardingPairAction) => void
  // Navigation
  onContinue: () => void
  onSkip: () => void
  // Friend requests
  incomingRequests: FriendRequest[]
  onAcceptRequest: (requestId: string) => Promise<void>
  onDeclineRequest: (requestId: string) => Promise<void>
}

export const OnboardingFriendsAndPairingStep: React.FC<OnboardingFriendsAndPairingStepProps> = ({
  userId,
  userPhoneE164,
  addedFriends,
  onAddFriend,
  onRemoveFriend,
  pairActions,
  onPairAction,
  onContinue,
  onSkip,
  incomingRequests,
  onAcceptRequest,
  onDeclineRequest,
}) => {
  // ─── Phone Input State ───
  const [phoneDigits, setPhoneDigits] = useState('')
  const [phoneCountry, setPhoneCountry] = useState(getDefaultCountryCode())
  const [actionLoading, setActionLoading] = useState(false)

  // ─── Friend Request Processing State ───
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null)
  const [processedRequests, setProcessedRequests] = useState<Record<string, 'accepted' | 'declined'>>({})

  // ─── Pair Request State ───
  const [sendingPairForUserId, setSendingPairForUserId] = useState<string | null>(null)
  const [queuedPairPhones, setQueuedPairPhones] = useState<Set<string>>(new Set())
  const [processingPairRequestId, setProcessingPairRequestId] = useState<string | null>(null)
  const [processedPairRequests, setProcessedPairRequests] = useState<Record<string, 'accepted' | 'declined'>>({})

  // ─── Pair Pill Animations ───
  const pairAnimScales = useRef<Record<string, Animated.Value>>({}).current
  const getPairAnimScale = (key: string): Animated.Value => {
    if (!pairAnimScales[key]) {
      pairAnimScales[key] = new Animated.Value(1)
    }
    return pairAnimScales[key]
  }

  // ─── Pair Mutations (REAL production hooks) ───
  const sendPairMutation = useSendPairRequest()
  const acceptPairMutation = useAcceptPairRequest()
  const declinePairMutation = useDeclinePairRequest()

  // ─── Incoming Pair Requests (REAL query) ───
  const { data: incomingPairRequests, refetch: refetchPairRequests } = useIncomingPairRequests(userId)

  // ─── Real-time pair request listener ───
  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel(`onboarding-pair-requests:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pair_requests',
          filter: `receiver_id=eq.${userId}`,
        },
        () => {
          refetchPairRequests()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  // ─── Phone Lookup ───
  const countryData = getCountryByCode(phoneCountry)
  const rawDigits = phoneDigits.replace(/\D/g, '')
  const phoneE164 = countryData ? `${countryData.dialCode}${rawDigits}` : `+${rawDigits}`
  const debouncedPhoneE164 = useDebouncedValue(phoneE164, 500)
  const isPhoneValid = /^\+[1-9]\d{6,14}$/.test(debouncedPhoneE164)

  const {
    data: phoneLookupResult,
    isLoading: phoneLookupLoading,
  } = usePhoneLookup(debouncedPhoneE164, isPhoneValid)

  // ─── Phone Action (Add Friend / Invite) ───
  const handlePhoneAction = useCallback(async () => {
    if (!isPhoneValid || actionLoading) return
    setActionLoading(true)

    try {
      if (debouncedPhoneE164 === userPhoneE164) {
        Alert.alert("That's you", "You can't add yourself as a friend.")
        return
      }

      if (addedFriends.some(f => f.phoneE164 === debouncedPhoneE164)) {
        Alert.alert('Already added', 'This person is already in your list.')
        return
      }

      if (phoneLookupResult?.found && phoneLookupResult.user) {
        const lookupUser = phoneLookupResult.user
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

        await supabase
          .from('friend_requests')
          .upsert(
            { sender_id: userId, receiver_id: lookupUser.id, status: 'pending' },
            { onConflict: 'sender_id,receiver_id' }
          )

        onAddFriend({
          type: 'existing',
          userId: lookupUser.id,
          username: lookupUser.username,
          phoneE164: debouncedPhoneE164,
          displayName: getDisplayName(lookupUser, 'User'),
          avatarUrl: lookupUser.avatar_url,
          friendshipStatus: phoneLookupResult.friendship_status === 'friends'
            ? 'friends'
            : 'pending_sent',
        })

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setPhoneDigits('')
      } else {
        await createPendingInvite(userId, debouncedPhoneE164)

        onAddFriend({
          type: 'invited',
          phoneE164: debouncedPhoneE164,
          displayName: debouncedPhoneE164,
          friendshipStatus: 'none',
        })

        await Share.share({
          message: `Hey! Join me on Mingla and let's find amazing experiences together. https://usemingla.com`,
        })

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setPhoneDigits('')
      }
    } catch (err) {
      console.error('[OnboardingFriendsAndPairingStep] Phone action error:', err)
      Alert.alert('Error', err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setActionLoading(false)
    }
  }, [isPhoneValid, actionLoading, debouncedPhoneE164, userPhoneE164, phoneLookupResult, userId, addedFriends, onAddFriend])

  // ─── Friend Request Handlers ───
  const handleAcceptFriendRequest = useCallback(async (requestId: string) => {
    if (processingRequestId) return
    setProcessingRequestId(requestId)
    try {
      await onAcceptRequest(requestId)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setProcessedRequests(prev => ({ ...prev, [requestId]: 'accepted' }))

      // Refetch pair requests — accepting a friend request may reveal
      // a hidden pair request via the DB trigger
      refetchPairRequests()

      setTimeout(() => {
        setProcessedRequests(prev => {
          const next = { ...prev }
          delete next[requestId]
          return next
        })
      }, 800)
    } catch {
      Alert.alert('Something went wrong', "Couldn't process the request. Try again.")
    } finally {
      setProcessingRequestId(null)
    }
  }, [processingRequestId, onAcceptRequest, refetchPairRequests])

  const handleDeclineFriendRequest = useCallback(async (requestId: string) => {
    if (processingRequestId) return
    setProcessingRequestId(requestId)
    try {
      await onDeclineRequest(requestId)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      setProcessedRequests(prev => ({ ...prev, [requestId]: 'declined' }))
      setTimeout(() => {
        setProcessedRequests(prev => {
          const next = { ...prev }
          delete next[requestId]
          return next
        })
      }, 800)
    } catch {
      Alert.alert('Something went wrong', "Couldn't process the request. Try again.")
    } finally {
      setProcessingRequestId(null)
    }
  }, [processingRequestId, onDeclineRequest])

  // ─── Send Pair Request ───
  const handleSendPairRequest = useCallback(async (friend: AddedFriend) => {
    if (sendingPairForUserId) return

    // Determine whether to send by userId (existing user) or phoneE164 (invited)
    const params = friend.userId
      ? { friendUserId: friend.userId }
      : { phoneE164: friend.phoneE164 }

    const trackingId = friend.userId || friend.phoneE164
    setSendingPairForUserId(trackingId)

    try {
      const result = await sendPairMutation.mutateAsync(params)

      if (result.tier === 3) {
        // Tier 3: invited user — mark as queued
        setQueuedPairPhones(prev => new Set(prev).add(friend.phoneE164))
        const action: OnboardingPairAction = {
          type: 'queued',
          targetUserId: undefined,
          targetPhoneE164: friend.phoneE164,
          targetDisplayName: friend.displayName,
          tier: 3,
          inviteId: result.inviteId,
        }
        onPairAction(action)
      } else {
        // Tier 1 or 2: existing user
        const action: OnboardingPairAction = {
          type: 'sent',
          targetUserId: friend.userId!,
          targetDisplayName: friend.displayName,
          tier: result.tier,
          requestId: result.requestId,
        }
        onPairAction(action)
      }

      // Success animation
      const animKey = friend.userId || friend.phoneE164
      const scale = getPairAnimScale(animKey)
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.08, tension: 200, friction: 12, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, tension: 200, friction: 12, useNativeDriver: true }),
      ]).start()

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (err) {
      console.error('[OnboardingFriendsAndPairingStep] Pair request error:', err)
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not send pair request')
    } finally {
      setSendingPairForUserId(null)
    }
  }, [sendingPairForUserId, sendPairMutation, onPairAction])

  // ─── Accept Pair Request ───
  const handleAcceptPairRequest = useCallback(async (request: PairRequest) => {
    if (processingPairRequestId) return
    setProcessingPairRequestId(request.id)
    try {
      const result = await acceptPairMutation.mutateAsync(request.id)

      const action: OnboardingPairAction = {
        type: 'accepted',
        targetUserId: request.senderId,
        targetDisplayName: request.senderName,
        tier: 1,
        requestId: request.id,
        pairingId: result.pairingId,
      }
      onPairAction(action)

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setProcessedPairRequests(prev => ({ ...prev, [request.id]: 'accepted' }))
      setTimeout(() => {
        setProcessedPairRequests(prev => {
          const next = { ...prev }
          delete next[request.id]
          return next
        })
      }, 800)
    } catch {
      Alert.alert('Something went wrong', "Couldn't accept the pair request. Try again.")
    } finally {
      setProcessingPairRequestId(null)
    }
  }, [processingPairRequestId, acceptPairMutation, onPairAction])

  // ─── Decline Pair Request ───
  const handleDeclinePairRequest = useCallback(async (request: PairRequest) => {
    if (processingPairRequestId) return
    setProcessingPairRequestId(request.id)
    try {
      await declinePairMutation.mutateAsync(request.id)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      setProcessedPairRequests(prev => ({ ...prev, [request.id]: 'declined' }))
      setTimeout(() => {
        setProcessedPairRequests(prev => {
          const next = { ...prev }
          delete next[request.id]
          return next
        })
      }, 800)
    } catch {
      Alert.alert('Something went wrong', "Couldn't decline the pair request. Try again.")
    } finally {
      setProcessingPairRequestId(null)
    }
  }, [processingPairRequestId, declinePairMutation])

  // ─── Derived State ───
  const isButtonDisabled =
    !isPhoneValid ||
    phoneLookupLoading ||
    actionLoading ||
    debouncedPhoneE164 === userPhoneE164 ||
    addedFriends.some(f => f.phoneE164 === debouncedPhoneE164)

  const visiblePairRequests = (incomingPairRequests ?? []).filter(
    r => r.status === 'pending' && r.visibility === 'visible'
  )

  // ─── Render Helpers ───

  const renderSectionLabel = (label: string, count?: number) => (
    <Text style={styles.sectionLabel}>
      {label.toUpperCase()}{count != null ? ` (${count})` : ''}
    </Text>
  )

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  // ─── Render ───

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <Text style={styles.headline}>Your inner circle</Text>
      <Text style={styles.subtitle}>
        Add your closest people, then pair up. You'll discover things to do together, see what they love, and plan the good stuff side by side.
      </Text>

      {/* Section 1: Incoming Friend Requests */}
      {incomingRequests.length > 0 && (
        <View style={styles.section}>
          {renderSectionLabel('Waiting for you', incomingRequests.length)}
          {incomingRequests.map((request) => {
            const status = processedRequests[request.id]
            const isProcessing = processingRequestId === request.id
            const senderName = getDisplayName(request.sender)
            const initials = getInitials(senderName)

            if (status === 'accepted') {
              return (
                <View key={request.id} style={[styles.requestCard, styles.requestCardAccepted]}>
                  <Icon name="checkmark-circle" size={20} color={colors.success[600]} />
                  <Text style={styles.acceptedText}>Added</Text>
                </View>
              )
            }

            if (status === 'declined') {
              return (
                <View key={request.id} style={[styles.requestCard, styles.requestCardDeclined]}>
                  <Icon name="close-circle" size={20} color={colors.gray[500]} />
                  <Text style={styles.declinedText}>Declined</Text>
                </View>
              )
            }

            return (
              <View key={request.id} style={styles.requestCard}>
                {request.sender?.avatar_url ? (
                  <Image source={{ uri: request.sender.avatar_url }} style={styles.avatar40} />
                ) : (
                  <View style={styles.avatarPlaceholder40}>
                    <Text style={styles.avatarInitials}>{initials}</Text>
                  </View>
                )}
                <View style={styles.requestInfo}>
                  <Text style={styles.requestName} numberOfLines={1}>{senderName}</Text>
                </View>
                <View style={styles.requestButtons}>
                  <TouchableOpacity
                    style={styles.acceptButton}
                    onPress={() => handleAcceptFriendRequest(request.id)}
                    disabled={!!processingRequestId}
                    activeOpacity={0.7}
                  >
                    {isProcessing ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.acceptButtonText}>Accept</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.declineButton}
                    onPress={() => handleDeclineFriendRequest(request.id)}
                    disabled={!!processingRequestId}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.declineButtonText}>Decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )
          })}
        </View>
      )}

      {/* Section 2: Phone Input (Add/Invite) */}
      <View style={styles.section}>
        {renderSectionLabel('Add friends')}
        <View style={styles.phoneRow}>
          <View style={styles.phoneInputWrapper}>
            <PhoneInput
              value={phoneDigits}
              countryCode={phoneCountry}
              onChangePhone={setPhoneDigits}
              onChangeCountry={setPhoneCountry}
              error={null}
              disabled={false}
            />
          </View>
        </View>

        {isPhoneValid && (
          <View style={styles.lookupRow}>
            {phoneLookupLoading ? (
              <ActivityIndicator size="small" color={colors.primary[500]} />
            ) : phoneLookupResult?.found && phoneLookupResult.user ? (
              <View style={styles.lookupUserRow}>
                {phoneLookupResult.user.avatar_url ? (
                  <Image source={{ uri: phoneLookupResult.user.avatar_url }} style={styles.avatar32} />
                ) : (
                  <View style={styles.avatarPlaceholder32}>
                    <Icon name="person" size={18} color={colors.gray[400]} />
                  </View>
                )}
                <Text style={styles.lookupName} numberOfLines={1}>
                  {getDisplayName(phoneLookupResult.user)}
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.actionButton, isButtonDisabled && styles.actionButtonDisabled]}
              onPress={handlePhoneAction}
              disabled={isButtonDisabled}
              activeOpacity={0.7}
            >
              {actionLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.actionButtonText}>
                  {phoneLookupResult?.found ? 'Add' : 'Invite'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Section 3: Your Friends List (with Pair Pill) */}
      {addedFriends.length > 0 ? (
        <View style={styles.section}>
          {renderSectionLabel('Your people', addedFriends.length)}
          {addedFriends.map((friend) => {
            const pillState = getPairPillState(friend, pairActions, sendingPairForUserId, queuedPairPhones)
            const animKey = friend.userId || friend.phoneE164
            const scale = animKey ? getPairAnimScale(animKey) : STATIC_SCALE

            return (
              <React.Fragment key={friend.phoneE164}>
              <View style={styles.friendRow}>
                {/* Avatar */}
                {friend.avatarUrl ? (
                  <Image source={{ uri: friend.avatarUrl }} style={styles.avatar36} />
                ) : (
                  <View style={styles.avatarPlaceholder36}>
                    <Icon name="person" size={14} color={colors.gray[400]} />
                  </View>
                )}

                {/* Info */}
                <View style={styles.friendTextCol}>
                  <Text style={styles.friendName} numberOfLines={1}>
                    {friend.displayName}
                  </Text>
                  <Text style={styles.friendStatus}>
                    {friend.friendshipStatus === 'friends' ? 'Friends'
                      : friend.friendshipStatus === 'pending_sent' ? 'Request sent'
                      : friend.type === 'invited' ? 'Invited'
                      : ''}
                  </Text>
                </View>

                {/* Pair Pill */}
                <Animated.View style={{ transform: [{ scale }] }}>
                  <TouchableOpacity
                    style={[
                      styles.pairPill,
                      pillState === 'unpaired' && styles.pairPillUnpaired,
                      pillState === 'sending' && styles.pairPillSending,
                      pillState === 'pending' && styles.pairPillPending,
                      pillState === 'paired' && styles.pairPillPaired,
                      pillState === 'disabled' && styles.pairPillDisabled,
                      pillState === 'queued' && styles.pairPillQueued,
                    ]}
                    onPress={() => {
                      if (pillState === 'unpaired') handleSendPairRequest(friend)
                    }}
                    disabled={pillState !== 'unpaired'}
                    activeOpacity={0.7}
                  >
                    {pillState === 'sending' ? (
                      <ActivityIndicator size="small" color={colors.primary[500]} />
                    ) : (
                      <>
                        <Icon
                          name={
                            pillState === 'paired' ? 'checkmark-circle'
                              : pillState === 'pending' ? 'time-outline'
                              : pillState === 'queued' ? 'time-outline'
                              : 'people-outline'
                          }
                          size={16}
                          color={
                            pillState === 'paired' ? colors.success[500]
                              : pillState === 'pending' ? colors.primary[400]
                              : pillState === 'queued' ? colors.gray[400]
                              : pillState === 'disabled' ? colors.gray[300]
                              : colors.gray[400]
                          }
                        />
                        <Text style={[
                          styles.pairPillText,
                          pillState === 'paired' && styles.pairPillTextPaired,
                          pillState === 'pending' && styles.pairPillTextPending,
                          pillState === 'queued' && styles.pairPillTextQueued,
                          pillState === 'disabled' && styles.pairPillTextDisabled,
                        ]}>
                          {pillState === 'paired' ? 'Paired'
                            : pillState === 'pending' ? 'Pending'
                            : pillState === 'queued' ? 'Queued'
                            : 'Pair'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </Animated.View>

                {/* Remove button */}
                <TouchableOpacity
                  onPress={() => onRemoveFriend(friend.phoneE164)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={styles.removeButton}
                >
                  <Icon name="close-circle" size={22} color={colors.gray[400]} />
                </TouchableOpacity>
              </View>
              {pillState === 'queued' && (
                <Text style={styles.queuedHint}>Activates when they join</Text>
              )}
              </React.Fragment>
            )
          })}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>
            No friends here yet. Add someone you'd actually make plans with.
          </Text>
        </View>
      )}

      {/* Section 4: Incoming Pair Requests */}
      {visiblePairRequests.length > 0 && (
        <View style={styles.section}>
          {renderSectionLabel('Pair requests', visiblePairRequests.length)}
          {visiblePairRequests.map((request) => {
            const status = processedPairRequests[request.id]
            const isProcessing = processingPairRequestId === request.id

            if (status === 'accepted') {
              return (
                <View key={request.id} style={[styles.pairRequestCard, styles.pairRequestCardAccepted]}>
                  <Icon name="checkmark-circle" size={20} color={colors.success[600]} />
                  <Text style={styles.pairedFeedbackText}>Paired!</Text>
                </View>
              )
            }

            if (status === 'declined') {
              return (
                <View key={request.id} style={[styles.requestCard, styles.requestCardDeclined]}>
                  <Icon name="close-circle" size={20} color={colors.gray[500]} />
                  <Text style={styles.declinedText}>Declined</Text>
                </View>
              )
            }

            return (
              <View key={request.id} style={styles.pairRequestCard}>
                <View style={styles.pairRequestHeader}>
                  {request.senderAvatar ? (
                    <Image source={{ uri: request.senderAvatar }} style={styles.avatar48} />
                  ) : (
                    <View style={styles.avatarPlaceholder48}>
                      <Text style={styles.avatarInitials48}>{getInitials(request.senderName)}</Text>
                    </View>
                  )}
                  <View style={styles.pairRequestInfo}>
                    <Text style={styles.pairRequestName} numberOfLines={1}>
                      {request.senderName}
                    </Text>
                    <Text style={styles.pairRequestSubtitle}>
                      Wants to pair with you
                    </Text>
                  </View>
                </View>
                <Text style={styles.pairRequestBody}>
                  See experiences curated for both of you.
                </Text>
                <View style={styles.pairRequestActions}>
                  <TouchableOpacity
                    style={styles.pairAcceptButton}
                    onPress={() => handleAcceptPairRequest(request)}
                    disabled={!!processingPairRequestId}
                    activeOpacity={0.7}
                  >
                    {isProcessing ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.pairAcceptButtonText}>Accept</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.pairDeclineButton}
                    onPress={() => handleDeclinePairRequest(request)}
                    disabled={!!processingPairRequestId}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.pairDeclineButtonText}>Decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )
          })}
        </View>
      )}

    </ScrollView>
  )
}

// ─── Styles ───

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headline: {
    fontSize: typography.xxl.fontSize,
    lineHeight: typography.xxl.lineHeight,
    fontWeight: fontWeights.bold as any,
    color: colors.gray[900],
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.md.fontSize,
    lineHeight: typography.md.lineHeight,
    color: colors.gray[500],
    marginBottom: spacing.lg,
  },

  // ─── Sections ───
  section: {
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.semibold as any,
    color: colors.gray[600],
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },

  // ─── Friend Request Cards ───
  requestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    backgroundColor: colors.background?.primary ?? '#ffffff',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  requestCardAccepted: {
    backgroundColor: colors.success[50],
    borderColor: colors.success[200],
    justifyContent: 'center',
  },
  requestCardDeclined: {
    backgroundColor: colors.gray[50],
    borderColor: colors.gray[200],
    justifyContent: 'center',
  },
  acceptedText: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.semibold as any,
    color: colors.success[600],
  },
  declinedText: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.semibold as any,
    color: colors.gray[500],
  },

  // ─── Avatars ───
  avatar40: { width: 40, height: 40, borderRadius: 20 },
  avatarPlaceholder40: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primary[500],
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: { color: '#ffffff', fontSize: 16, fontWeight: '600' as any },
  avatar36: { width: 36, height: 36, borderRadius: 18 },
  avatarPlaceholder36: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.gray[100],
    alignItems: 'center', justifyContent: 'center',
  },
  avatar32: { width: 32, height: 32, borderRadius: 16 },
  avatarPlaceholder32: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.gray[100],
    alignItems: 'center', justifyContent: 'center',
  },

  // ─── Request Info ───
  requestInfo: { flex: 1 },
  requestName: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.semibold as any,
    color: colors.text?.primary ?? colors.gray[900],
  },
  requestButtons: { flexDirection: 'row', gap: spacing.xs },
  acceptButton: {
    backgroundColor: colors.primary[500],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    minHeight: touchTargets.minimum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButtonText: {
    color: '#ffffff',
    fontSize: typography.xs.fontSize,
    fontWeight: fontWeights.semibold as any,
  },
  declineButton: {
    backgroundColor: colors.gray[100],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    minHeight: touchTargets.minimum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineButtonText: {
    color: colors.gray[600],
    fontSize: typography.xs.fontSize,
    fontWeight: fontWeights.semibold as any,
  },

  // ─── Phone Input ───
  phoneRow: { marginBottom: spacing.md },
  phoneInputWrapper: { width: '100%' },
  lookupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  lookupUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  lookupName: {
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.medium as any,
    color: colors.gray[800],
    flex: 1,
  },
  actionButton: {
    backgroundColor: colors.primary[500],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    minWidth: 80,
    alignItems: 'center',
  },
  actionButtonDisabled: { opacity: 0.5 },
  actionButtonText: {
    color: '#fff',
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.semibold as any,
  },

  // ─── Friend Row ───
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
    gap: spacing.sm,
  },
  friendTextCol: { flex: 1 },
  friendName: {
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.medium as any,
    color: colors.gray[800],
  },
  friendStatus: {
    fontSize: typography.xs.fontSize,
    color: colors.gray[400],
    marginTop: 2,
  },
  removeButton: {
    marginLeft: spacing.xs,
  },

  // ─── Pair Pill ───
  pairPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    minHeight: touchTargets.minimum,
    gap: spacing.xs,
  },
  pairPillUnpaired: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.gray[300],
  },
  pairPillSending: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.gray[300],
  },
  pairPillPending: {
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  pairPillPaired: {
    backgroundColor: colors.success[50],
    borderWidth: 1,
    borderColor: colors.success[200],
  },
  pairPillDisabled: {
    backgroundColor: colors.gray[50],
    opacity: 0.5,
  },
  pairPillQueued: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  pairPillText: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.medium as any,
    color: colors.gray[600],
  },
  pairPillTextPaired: {
    color: colors.success[600],
  },
  pairPillTextPending: {
    color: colors.primary[600] ?? colors.primary[500],
  },
  pairPillTextDisabled: {
    color: colors.gray[400],
  },
  pairPillTextQueued: {
    color: colors.gray[500],
  },
  queuedHint: {
    ...typography.xs,
    color: colors.text?.tertiary ?? colors.gray[400],
    marginTop: spacing.xxs ?? 2,
    textAlign: 'right' as const,
  },

  // ─── Pair Request Cards (premium warm treatment) ───
  pairRequestCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
    marginBottom: spacing.sm,
    ...shadows.md,
  },
  pairRequestCardAccepted: {
    backgroundColor: colors.success[50],
    borderColor: colors.success[200],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  pairRequestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  avatar48: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder48: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.primary[500],
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials48: { color: '#ffffff', fontSize: 18, fontWeight: '700' as any },
  pairRequestInfo: { flex: 1 },
  pairRequestName: {
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.semibold as any,
    color: colors.text?.primary ?? colors.gray[900],
  },
  pairRequestSubtitle: {
    fontSize: typography.sm.fontSize,
    color: colors.primary[600] ?? colors.primary[500],
    marginTop: 2,
  },
  pairRequestBody: {
    fontSize: typography.sm.fontSize,
    lineHeight: typography.sm.lineHeight,
    color: colors.text?.secondary ?? colors.gray[600],
    marginBottom: spacing.md,
  },
  pairRequestActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pairAcceptButton: {
    flex: 1,
    backgroundColor: colors.primary[500],
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairAcceptButtonText: {
    color: '#ffffff',
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.semibold as any,
  },
  pairDeclineButton: {
    flex: 1,
    backgroundColor: colors.background?.primary ?? '#ffffff',
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairDeclineButtonText: {
    color: colors.gray[600],
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.medium as any,
  },
  pairedFeedbackText: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.semibold as any,
    color: colors.success[600],
  },

  // ─── Empty State ───
  emptyState: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: typography.sm.fontSize,
    color: colors.gray[400],
    textAlign: 'center',
  },

})
