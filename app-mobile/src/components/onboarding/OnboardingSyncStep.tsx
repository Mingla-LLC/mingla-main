import React, { useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
  Share,
  StyleSheet,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'

import { PhoneInput } from './PhoneInput'
import { usePhoneLookup, useDebouncedValue } from '../../hooks/usePhoneLookup'
import { createPendingInvite } from '../../services/phoneLookupService'
import { supabase } from '../../services/supabase'
import { getCountryByCode, getDefaultCountryCode } from '../../constants/countries'
import { AddedFriend } from '../../types/onboarding'
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  shadows,
} from '../../constants/designSystem'

interface OnboardingSyncStepProps {
  userId: string
  userPhoneE164?: string
  addedFriends: AddedFriend[]
  initialSelectedIds?: string[]
  onContinue: (selectedFriends: AddedFriend[], newFriends: AddedFriend[]) => void
}

export const OnboardingSyncStep: React.FC<OnboardingSyncStepProps> = ({
  userId,
  userPhoneE164,
  addedFriends,
  initialSelectedIds,
  onContinue,
}) => {
  // Phone input state
  const [phoneDigits, setPhoneDigits] = useState('')
  const [phoneCountry, setPhoneCountry] = useState(getDefaultCountryCode())

  // Selection state — set of userId or phoneE164 keys
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(initialSelectedIds ?? [])
  )

  // Friends added via phone input on THIS screen
  const [newFriends, setNewFriends] = useState<AddedFriend[]>([])

  // All friends = passed-in friends + newly added on this screen
  const allFriends = [...addedFriends, ...newFriends]

  // Referral code
  const [referralCode, setReferralCode] = useState<string | null>(null)

  // Invite loading
  const [inviteLoading, setInviteLoading] = useState(false)

  // Build E.164 phone
  const country = getCountryByCode(phoneCountry)
  const rawDigits = phoneDigits.replace(/\D/g, '')
  const phoneE164 = country ? country.dialCode + rawDigits : '+1' + rawDigits

  // Debounce phone input
  const debouncedPhone = useDebouncedValue(phoneE164, 500)
  const debouncedDigitCount = useDebouncedValue(rawDigits.length, 500)

  // Prevent self-lookup
  const isSelfLookup = Boolean(userPhoneE164 && debouncedPhone === userPhoneE164)

  // Phone lookup
  const {
    data: lookupResult,
    isLoading: lookupLoading,
    isError: lookupError,
  } = usePhoneLookup(debouncedPhone, debouncedDigitCount >= 7 && !isSelfLookup)

  // Check if phone is already added
  const isAlreadyAdded = allFriends.some((f) => f.phoneE164 === debouncedPhone)

  // Can continue — at least 1 friend selected
  const canContinue = selectedIds.size > 0

  // Load referral code
  useEffect(() => {
    const fetchReferralCode = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('referral_code')
          .eq('id', userId)
          .single()

        if (!error && data?.referral_code) {
          setReferralCode(data.referral_code)
        }
      } catch (err) {
        console.error('Error fetching referral code:', err)
      }
    }
    fetchReferralCode()
  }, [userId])

  // Get the key for a friend (for selection tracking)
  const getFriendKey = useCallback((friend: AddedFriend): string => {
    return friend.userId || friend.phoneE164
  }, [])

  // Toggle selection
  const handleToggleSelect = useCallback(
    (friend: AddedFriend) => {
      const key = getFriendKey(friend)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(key)) {
          next.delete(key)
        } else {
          next.add(key)
        }
        return next
      })
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    },
    [getFriendKey]
  )

  // Clear input helper
  const clearInput = useCallback(() => {
    setPhoneDigits('')
  }, [])

  // Handle add existing user
  const handleAddExisting = useCallback(() => {
    if (!lookupResult?.found || !lookupResult.user) return

    const friend: AddedFriend = {
      type: 'existing',
      userId: lookupResult.user.id,
      username: lookupResult.user.username,
      phoneE164: debouncedPhone,
      displayName:
        lookupResult.user.display_name ||
        (lookupResult.user.first_name && lookupResult.user.last_name
          ? `${lookupResult.user.first_name} ${lookupResult.user.last_name}`
          : lookupResult.user.username),
      avatarUrl: lookupResult.user.avatar_url,
      friendshipStatus: lookupResult.friendship_status,
    }

    // Check for duplicates across all friends
    const isDuplicate = allFriends.some(
      (f) => (friend.userId && f.userId === friend.userId) || f.phoneE164 === friend.phoneE164
    )

    if (!isDuplicate) {
      setNewFriends((prev) => [...prev, friend])
      // Auto-select the newly added friend
      setSelectedIds((prev) => new Set([...prev, getFriendKey(friend)]))
    }

    clearInput()
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }, [lookupResult, debouncedPhone, clearInput, allFriends, getFriendKey])

  // Handle invite non-user
  const handleInvite = useCallback(async () => {
    setInviteLoading(true)
    try {
      await createPendingInvite(userId, debouncedPhone)

      const inviteLink = referralCode
        ? `https://usemingla.com/invite/${referralCode}`
        : 'https://usemingla.com'

      await Share.share({
        message: `Hey! Join me on Mingla and let's find amazing experiences together. ${inviteLink}`,
      })

      // Add as invited regardless of share result
      const friend: AddedFriend = {
        type: 'invited',
        phoneE164: debouncedPhone,
        displayName: debouncedPhone,
        avatarUrl: null,
        friendshipStatus: 'none',
      }

      const isDuplicate = allFriends.some((f) => f.phoneE164 === friend.phoneE164)

      if (!isDuplicate) {
        setNewFriends((prev) => [...prev, friend])
        // Auto-select the newly added friend
        setSelectedIds((prev) => new Set([...prev, getFriendKey(friend)]))
      }

      clearInput()
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    } catch (err) {
      console.error('Error creating invite:', err)
    } finally {
      setInviteLoading(false)
    }
  }, [userId, debouncedPhone, referralCode, clearInput, allFriends, getFriendKey])

  // Handle continue
  const handleContinue = useCallback(() => {
    const selected = allFriends.filter((f) => selectedIds.has(getFriendKey(f)))
    onContinue(selected, newFriends)
  }, [allFriends, selectedIds, getFriendKey, newFriends, onContinue])

  // Determine action button state
  const renderActionButton = () => {
    if (lookupLoading || inviteLoading) {
      return (
        <View style={styles.actionButton}>
          <ActivityIndicator size="small" color={colors.primary[500]} />
        </View>
      )
    }

    if (isAlreadyAdded) {
      return (
        <View style={[styles.actionButton, styles.actionButtonDone]}>
          <Ionicons name="checkmark" size={20} color={colors.success[500]} />
        </View>
      )
    }

    if (rawDigits.length < 7) {
      return null
    }

    if (lookupResult?.found && lookupResult.user) {
      return (
        <Pressable
          style={[styles.actionButton, styles.actionButtonAdd]}
          onPress={handleAddExisting}
        >
          <Ionicons name="add" size={22} color={colors.text.inverse} />
        </Pressable>
      )
    }

    return (
      <Pressable
        style={[styles.actionButton, styles.actionButtonInvite]}
        onPress={handleInvite}
      >
        <Text style={styles.actionButtonInviteText}>Invite</Text>
      </Pressable>
    )
  }

  const hasNoFriends = allFriends.length === 0

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={styles.headline}>Who are you syncing with?</Text>
      <Text style={styles.body}>
        {hasNoFriends
          ? 'Add a friend to sync with'
          : "Pick the people who matter most. We'll learn what they love \u2014 and you'll never run out of ideas for them."}
      </Text>

      {/* Selectable friend pills */}
      {allFriends.length > 0 && (
        <View style={styles.pillsSection}>
          <View style={styles.pillsWrap}>
            {allFriends.map((friend) => {
              const key = getFriendKey(friend)
              const isSelected = selectedIds.has(key)

              return (
                <Pressable
                  key={key}
                  style={[
                    styles.pill,
                    isSelected ? styles.pillSelected : styles.pillUnselected,
                  ]}
                  onPress={() => handleToggleSelect(friend)}
                >
                  {friend.avatarUrl && (
                    <Image
                      source={{ uri: friend.avatarUrl }}
                      style={styles.pillAvatar}
                    />
                  )}
                  <Text
                    style={[
                      styles.pillText,
                      isSelected ? styles.pillTextSelected : styles.pillTextUnselected,
                    ]}
                    numberOfLines={1}
                  >
                    {friend.type === 'existing'
                      ? friend.displayName
                      : friend.phoneE164}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      )}

      {/* Phone input row */}
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
        {renderActionButton()}
      </View>

      {/* Lookup result dropdown */}
      {rawDigits.length >= 7 &&
        !lookupLoading &&
        !isAlreadyAdded &&
        lookupResult?.found &&
        lookupResult.user && (
          <Pressable style={styles.lookupResult} onPress={handleAddExisting}>
            <View style={styles.lookupAvatar}>
              {lookupResult.user.avatar_url ? (
                <Image
                  source={{ uri: lookupResult.user.avatar_url }}
                  style={styles.lookupAvatarImage}
                />
              ) : (
                <View style={styles.lookupAvatarPlaceholder}>
                  <Ionicons name="person" size={16} color={colors.text.inverse} />
                </View>
              )}
            </View>
            <View style={styles.lookupInfo}>
              <Text style={styles.lookupName} numberOfLines={1}>
                {lookupResult.user.display_name ||
                  (lookupResult.user.first_name && lookupResult.user.last_name
                    ? `${lookupResult.user.first_name} ${lookupResult.user.last_name}`
                    : lookupResult.user.username)}
              </Text>
            </View>
            <Ionicons name="add-circle" size={24} color={colors.primary[500]} />
          </Pressable>
        )}

      {/* Self-lookup hint */}
      {isSelfLookup && rawDigits.length >= 7 && (
        <Text style={styles.hintText}>That's your number! Try a friend's instead.</Text>
      )}

      {/* Lookup error */}
      {lookupError && !isSelfLookup && rawDigits.length >= 7 && (
        <Text style={styles.errorText}>Couldn't find that one. You can still invite them.</Text>
      )}

      {/* Empty state */}
      {hasNoFriends && rawDigits.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons
            name="people-outline"
            size={48}
            color={colors.gray[300]}
          />
          <Text style={styles.emptyStateText}>
            Add a friend to sync with
          </Text>
        </View>
      )}

      {/* Continue button */}
      <Pressable
        style={[
          styles.continueButton,
          !canContinue && styles.continueButtonDisabled,
        ]}
        onPress={handleContinue}
        disabled={!canContinue}
      >
        <Text
          style={[
            styles.continueButtonText,
            !canContinue && styles.continueButtonTextDisabled,
          ]}
        >
          Continue
        </Text>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headline: {
    ...typography.xxl,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.md,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    marginBottom: spacing.lg,
  },
  pillsSection: {
    marginBottom: spacing.lg,
  },
  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    gap: spacing.xs,
    maxWidth: '100%',
  },
  pillSelected: {
    backgroundColor: colors.primary[500],
  },
  pillUnselected: {
    backgroundColor: colors.background.primary,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  pillAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  pillText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    maxWidth: 150,
  },
  pillTextSelected: {
    color: colors.text.inverse,
  },
  pillTextUnselected: {
    color: colors.text.primary,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  phoneInputWrapper: {
    flex: 1,
  },
  actionButton: {
    width: 48,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  actionButtonAdd: {
    backgroundColor: colors.primary[500],
  },
  actionButtonInvite: {
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[300],
  },
  actionButtonDone: {
    backgroundColor: colors.success[50],
    borderWidth: 1,
    borderColor: colors.success[300],
  },
  actionButtonInviteText: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.primary[600],
  },
  lookupResult: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  lookupAvatar: {
    marginRight: spacing.sm,
  },
  lookupAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  lookupAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary[400],
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookupInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  lookupName: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  lookupUsername: {
    ...typography.xs,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  hintText: {
    ...typography.sm,
    color: colors.text.secondary,
    marginBottom: spacing.md,
  },
  errorText: {
    ...typography.sm,
    color: colors.error[500],
    marginBottom: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  emptyStateText: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    textAlign: 'center',
  },
  continueButton: {
    backgroundColor: colors.primary[500],
    borderRadius: radius.lg,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.xxl,
  },
  continueButtonDisabled: {
    backgroundColor: colors.gray[200],
  },
  continueButtonText: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  continueButtonTextDisabled: {
    color: colors.gray[400],
  },
})
