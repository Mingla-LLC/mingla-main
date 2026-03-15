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
import { Ionicons } from '@expo/vector-icons'

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

type PairPillState = 'unpaired' | 'sending' | 'pending' | 'paired' | 'disabled'

function getPairPillState(
  friend: AddedFriend,
  pairActions: OnboardingPairAction[],
  sendingForUserId: string | null,
): PairPillState {
  // Check if we have a pair action for this friend
  const action = pairActions.find(a => a.targetUserId === friend.userId)

  if (action) {
    if (action.type === 'accepted' || action.pairingId) return 'paired'
    if (action.type === 'sent') return 'pending'
  }

  // Currently sending
  if (sendingForUserId === friend.userId) return 'sending'

  // Can't pair invited users or users without userId
  if (friend.type === 'invited' || !friend.userId) return 'disabled'

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
          event: 'INSERT',
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
          displayName: lookupUser.display_name || lookupUser.username || 'User',
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
  }, [processingRequestId, onAcceptRequest])

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
    if (!friend.userId || sendingPairForUserId) return

    setSendingPairForUserId(friend.userId)
    try {
      // Edge function determines tier server-side based on friendship status
      const result = await sendPairMutation.mutateAsync({ friendUserId: friend.userId })

      const action: OnboardingPairAction = {
        type: 'sent',
        targetUserId: friend.userId,
        targetDisplayName: friend.displayName,
        tier: result.tier,
        requestId: result.requestId,
      }
      onPairAction(action)

      // Success animation
      const scale = getPairAnimScale(friend.userId)
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
        Pair with your closest people. You'll discover things to do together, see what they love, and plan the good stuff side by side.
      </Text>

      {/* Section 1: Incoming Friend Requests */}
      {incomingRequests.length > 0 && (
        <View style={styles.section}>
          {renderSectionLabel('Waiting for you', incomingRequests.length)}
          {incomingRequests.map((request) => {
            const status = processedRequests[request.id]
            const isProcessing = processingRequestId === request.id
            const senderName =
              request.sender?.display_name ||
              (request.sender?.first_name && request.sender?.last_name
                ? `${request.sender.first_name} ${request.sender.last_name}`
                : request.sender?.username) ||
              'Someone'
            const senderUsername = request.sender?.username
            const initials = getInitials(senderName)

            if (status === 'accepted') {
              return (
                <View key={request.id} style={[styles.requestCard, styles.requestCardAccepted]}>
                  <Ionicons name="checkmark-circle" size={20} color={colors.success[600]} />
                  <Text style={styles.acceptedText}>Added</Text>
                </View>
              )
            }

            if (status === 'declined') {
              return (
                <View key={request.id} style={[styles.requestCard, styles.requestCardDeclined]}>
                  <Ionicons name="close-circle" size={20} color={colors.gray[500]} />
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
                  {senderUsername && (
                    <Text style={styles.requestUsername} numberOfLines={1}>@{senderUsername}</Text>
                  )}
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
                    <Ionicons name="person" size={18} color={colors.gray[400]} />
                  </View>
                )}
                <Text style={styles.lookupName} numberOfLines={1}>
                  {phoneLookupResult.user.display_name || phoneLookupResult.user.username}
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
            const pillState = getPairPillState(friend, pairActions, sendingPairForUserId)
            const scale = friend.userId ? getPairAnimScale(friend.userId) : STATIC_SCALE

            return (
              <View key={friend.phoneE164} style={styles.friendRow}>
                {/* Avatar */}
                {friend.avatarUrl ? (
                  <Image source={{ uri: friend.avatarUrl }} style={styles.avatar36} />
                ) : (
                  <View style={styles.avatarPlaceholder36}>
                    <Ionicons name="person" size={14} color={colors.gray[400]} />
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
                        <Ionicons
                          name={
                            pillState === 'paired' ? 'checkmark-circle'
                              : pillState === 'pending' ? 'time-outline'
                              : 'people-outline'
                          }
                          size={16}
                          color={
                            pillState === 'paired' ? colors.success[500]
                              : pillState === 'pending' ? colors.primary[400]
                              : pillState === 'disabled' ? colors.gray[300]
                              : colors.gray[400]
                          }
                        />
                        <Text style={[
                          styles.pairPillText,
                          pillState === 'paired' && styles.pairPillTextPaired,
                          pillState === 'pending' && styles.pairPillTextPending,
                          pillState === 'disabled' && styles.pairPillTextDisabled,
                        ]}>
                          {pillState === 'paired' ? 'Paired'
                            : pillState === 'pending' ? 'Pending'
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
                  <Ionicons name="close-circle" size={22} color={colors.gray[400]} />
                </TouchableOpacity>
              </View>
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
                  <Ionicons name="checkmark-circle" size={20} color={colors.success[600]} />
                  <Text style={styles.pairedFeedbackText}>Paired!</Text>
                </View>
              )
            }

            if (status === 'declined') {
              return (
                <View key={request.id} style={[styles.requestCard, styles.requestCardDeclined]}>
                  <Ionicons name="close-circle" size={20} color={colors.gray[500]} />
                  <Text style={styles.declinedText}>Declined</Text>
                </View>
              )
            }

            return (
              <View key={request.id} style={styles.pairRequestCard}>
                {request.senderAvatar ? (
                  <Image source={{ uri: request.senderAvatar }} style={styles.avatar40} />
                ) : (
                  <View style={styles.avatarPlaceholder40}>
                    <Text style={styles.avatarInitials}>{getInitials(request.senderName)}</Text>
                  </View>
                )}
                <View style={styles.pairRequestInfo}>
                  <Text style={styles.pairRequestTitle} numberOfLines={1}>
                    {request.senderName} wants to pair with you
                  </Text>
                  <Text style={styles.pairRequestSubtitle}>
                    See experiences made for both of you.
                  </Text>
                </View>
                <View style={styles.requestButtons}>
                  <TouchableOpacity
                    style={styles.acceptButton}
                    onPress={() => handleAcceptPairRequest(request)}
                    disabled={!!processingPairRequestId}
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
                    onPress={() => handleDeclinePairRequest(request)}
                    disabled={!!processingPairRequestId}
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

      {/* Continue / Skip Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.continueButton}
          onPress={onContinue}
          activeOpacity={0.7}
        >
          <Text style={styles.continueButtonText}>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onSkip} activeOpacity={0.7}>
          <Text style={styles.skipText}>I'll do this later</Text>
        </TouchableOpacity>
      </View>
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
  requestUsername: {
    fontSize: typography.xs.fontSize,
    color: colors.text?.tertiary ?? colors.gray[400],
    marginTop: 1,
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

  // ─── Pair Request Cards (warm treatment) ───
  pairRequestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
    gap: spacing.sm,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  pairRequestCardAccepted: {
    backgroundColor: colors.success[50],
    borderColor: colors.success[200],
    justifyContent: 'center',
  },
  pairRequestInfo: { flex: 1 },
  pairRequestTitle: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.semibold as any,
    color: colors.text?.primary ?? colors.gray[900],
  },
  pairRequestSubtitle: {
    fontSize: typography.xs.fontSize,
    color: colors.text?.tertiary ?? colors.gray[400],
    marginTop: 2,
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

  // ─── Footer ───
  footer: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  continueButton: {
    backgroundColor: colors.primary[500],
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    width: '100%',
    alignItems: 'center',
  },
  continueButtonText: {
    color: '#fff',
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.semibold as any,
  },
  skipText: {
    fontSize: typography.md.fontSize,
    color: colors.gray[400],
  },
})
