/**
 * #4226 phase 2B — reads what this phone already knows about how the person
 * arrived (held friend invite, held group link, saved referral code) so the
 * sign-up source can be worked out. It reuses the existing held-link stores and
 * invents no new link format. Never throws.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { hydratePendingFriendInvite } from './pendingFriendInvite'
import { hydratePendingGroupInvite } from './pendingGroupInvite'
import { recordSignupSourceOnce, type SourceHints } from './peopleJourneyService'

const REFERRAL_CODE_KEY = '@mingla_referral_code'

export async function collectHeldSourceHints(): Promise<Partial<SourceHints>> {
  const hints: Partial<SourceHints> = {}
  try {
    const friend = await hydratePendingFriendInvite()
    if (friend) hints.friendInvite = true
  } catch (e) {
    console.warn('[signupSourceHints] friend invite unreadable:', e)
  }
  try {
    const group = await hydratePendingGroupInvite()
    if (group) hints.collabInvite = true
  } catch (e) {
    console.warn('[signupSourceHints] group link unreadable:', e)
  }
  try {
    const code = await AsyncStorage.getItem(REFERRAL_CODE_KEY)
    if (code) hints.referralLink = true
  } catch (e) {
    console.warn('[signupSourceHints] referral code unreadable:', e)
  }
  return hints
}

/**
 * Called once the new account has moved past the first onboarding screen (the
 * AppsFlyer answer has had time to arrive). Gathers the held hints plus what
 * the flow already knows, then records the source once. Never throws.
 */
export async function recordSignupSourceFromOnboarding(input: {
  userId: string
  ticketLink: boolean
  collabInvite: boolean
  optedOut: boolean
}): Promise<void> {
  try {
    const held = await collectHeldSourceHints()
    await recordSignupSourceOnce({
      userId: input.userId,
      optedOut: input.optedOut,
      hints: {
        ...held,
        ticketLink: input.ticketLink,
        collabInvite: held.collabInvite === true || input.collabInvite,
      },
    })
  } catch (e) {
    console.warn('[signupSourceHints] record failed:', e)
  }
}
