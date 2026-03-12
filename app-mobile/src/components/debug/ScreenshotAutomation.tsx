import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useScreenshotStore } from '../../store/screenshotStore';

/**
 * ScreenshotAutomation — cycles through every screen/modal in the app
 * and logs "SCREENSHOT_READY:<filename>" to the console so the ADB
 * capture script on the PC can take a screenshot at each step.
 *
 * The modal CLOSES ITSELF before capturing begins.
 */

interface ScreenshotStep {
  filename: string;
  label: string;
  navigate: (nav: NavigationActions) => void;
  extraDelay?: number;
}

interface NavigationActions {
  setCurrentPage: (page: string) => void;
  setShowPreferences: (show: boolean) => void;
  setShowCollaboration: (show: boolean) => void;
  setShowCollabPreferences: (show: boolean) => void;
  setShowTermsOfService: (show: boolean) => void;
  setShowPrivacyPolicy: (show: boolean) => void;
  setShowAccountSettings: (show: boolean) => void;
  setShowProfileSettings: (show: boolean) => void;
  setShowShareModal: (show: boolean) => void;
  setShowOnboardingFlow: (show: boolean) => void;
  setShowPaywall: (show: boolean) => void;
  resetOverlays: () => void;
}

interface Props {
  isVisible: boolean;
  onClose: () => void;
  navigationActions: NavigationActions;
}

// Helper to trigger child-component modals via the screenshot store
const trigger = (key: string) => {
  useScreenshotStore.getState().setTrigger(key, true);
};

// ═══════════════════════════════════════════════════════════════════
// ALL 57 SCREENS
// ═══════════════════════════════════════════════════════════════════
const STEPS: ScreenshotStep[] = [

  // ═══════════════════════ MAIN TABS (5) ═══════════════════════
  { filename: 'Main Tabs - Home.png', label: 'Home Tab',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home'); } },
  { filename: 'Main Tabs - Discover.png', label: 'Discover Tab',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('discover'); } },
  { filename: 'Main Tabs - Connections.png', label: 'Connections Tab',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('connections'); } },
  { filename: 'Main Tabs - Likes.png', label: 'Likes Tab',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('likes'); } },
  { filename: 'Main Tabs - Profile.png', label: 'Profile Tab',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('profile'); } },

  // ═══════════════════ SECONDARY SCREENS (4) ═══════════════════
  { filename: 'Secondary Screens - Board View.png', label: 'Board View',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('board-view'); } },
  { filename: 'Secondary Screens - Saved Experiences.png', label: 'Saved Experiences',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('saved'); } },
  { filename: 'Secondary Screens - View Friend Profile.png', label: 'View Friend Profile',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('profile'); } },
  { filename: 'Secondary Screens - Paywall.png', label: 'Paywall',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home'); setTimeout(() => n.setShowPaywall(true), 500); },
    extraDelay: 1500 },

  // ═══════════════════ AUTH & ONBOARDING (10) ═══════════════════
  // Note: Welcome screen requires being signed out — will show current home instead
  { filename: 'Auth - Welcome Sign In.png', label: 'Welcome (needs sign-out)',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home'); } },
  // Onboarding flow — each step is controlled by the state machine inside OnboardingLoader
  // We trigger the flow and capture the first step, then subsequent steps auto-advance
  { filename: 'Auth - Onboarding Intent.png', label: 'Onboarding Flow (Step 1)',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home'); setTimeout(() => n.setShowOnboardingFlow(true), 500); },
    extraDelay: 1000 },
  // The remaining onboarding steps can't be individually triggered programmatically
  // because they're controlled by the internal state machine. These will capture whatever
  // step the onboarding is on. User should manually advance through steps.
  { filename: 'Auth - Onboarding Location.png', label: 'Onboarding (visible step)',
    navigate: (n) => { /* keep onboarding open */ } },
  { filename: 'Auth - Onboarding Travel Mode.png', label: 'Onboarding (visible step)',
    navigate: (n) => { /* keep onboarding open */ } },
  { filename: 'Auth - Onboarding Friends.png', label: 'Onboarding (visible step)',
    navigate: (n) => { /* keep onboarding open */ } },
  { filename: 'Auth - Onboarding Consent.png', label: 'Onboarding (visible step)',
    navigate: (n) => { /* keep onboarding open */ } },
  { filename: 'Auth - Onboarding Audio Recorder.png', label: 'Onboarding (visible step)',
    navigate: (n) => { /* keep onboarding open */ } },
  { filename: 'Auth - Onboarding Collaboration.png', label: 'Onboarding (visible step)',
    navigate: (n) => { /* keep onboarding open */ } },
  { filename: 'Auth - Onboarding Sync.png', label: 'Onboarding (visible step)',
    navigate: (n) => { /* keep onboarding open */ } },
  { filename: 'Auth - Onboarding Invite Friends.png', label: 'Onboarding (visible step)',
    navigate: (n) => { n.setShowOnboardingFlow(false); } },

  // ═══════════════════ HOME MODALS (6) ═══════════════════
  { filename: 'Home Modals - Notifications.png', label: 'Notifications Modal',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home');
      setTimeout(() => trigger('triggerNotificationsModal'), 800); },
    extraDelay: 500 },
  { filename: 'Home Modals - Friends List.png', label: 'Friends Modal',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home');
      setTimeout(() => trigger('triggerFriendsModal'), 800); },
    extraDelay: 500 },
  { filename: 'Home Modals - Friend Requests.png', label: 'Friend Requests (in Friends Modal)',
    navigate: (n) => { /* Friends modal should still be open, showing requests tab */ } },
  { filename: 'Home Modals - Expanded Card.png', label: 'Expanded Card',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home');
      setTimeout(() => trigger('triggerExpandedCard'), 800); },
    extraDelay: 1000 },
  { filename: 'Home Modals - Deck History.png', label: 'Deck History',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home');
      setTimeout(() => trigger('triggerDeckHistory'), 800); },
    extraDelay: 500 },
  { filename: 'Home Modals - Dismissed Cards.png', label: 'Dismissed Cards',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home');
      setTimeout(() => trigger('triggerDismissedCards'), 800); },
    extraDelay: 500 },

  // ═══════════════════ COLLABORATION (5) ═══════════════════
  { filename: 'Collaboration - Module Sessions Tab.png', label: 'Collab Sessions Tab',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home');
      setTimeout(() => { n.setShowCollaboration(true); setTimeout(() => trigger('triggerCollabSessionsTab'), 300); }, 500); },
    extraDelay: 500 },
  { filename: 'Collaboration - Module Invites Tab.png', label: 'Collab Invites Tab',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home');
      setTimeout(() => { n.setShowCollaboration(true); setTimeout(() => trigger('triggerCollabInvitesTab'), 300); }, 500); },
    extraDelay: 500 },
  { filename: 'Collaboration - Module Create Tab.png', label: 'Collab Create Tab',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home');
      setTimeout(() => { n.setShowCollaboration(true); setTimeout(() => trigger('triggerCollabCreateTab'), 300); }, 500); },
    extraDelay: 500 },
  { filename: 'Collaboration - Create Session Wizard.png', label: 'Create Session (same as Create Tab)',
    navigate: (n) => { /* Create tab is already the wizard */ } },
  { filename: 'Collaboration - Preferences.png', label: 'Collaboration Preferences',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home');
      setTimeout(() => n.setShowCollabPreferences(true), 500); } },

  // ═══════════════════ DISCOVER MODALS (5) ═══════════════════
  { filename: 'Discover Modals - Add Person Wizard.png', label: 'Add Person Modal',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('discover');
      setTimeout(() => trigger('triggerAddPerson'), 800); },
    extraDelay: 500 },
  { filename: 'Discover Modals - Link Friend Sheet.png', label: 'Link Friend (needs person selected)',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('discover'); } },
  { filename: 'Discover Modals - Person Edit Sheet.png', label: 'Person Edit (needs person selected)',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('discover'); } },
  { filename: 'Discover Modals - Person Holiday View.png', label: 'Person Holiday (needs person selected)',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('discover'); } },
  { filename: 'Discover Modals - Custom Holiday.png', label: 'Custom Holiday (needs person selected)',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('discover'); } },

  // ═══════════════════ CONNECTIONS MODALS (7) ═══════════════════
  { filename: 'Connections Modals - Message Interface.png', label: 'Message Interface',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('connections');
      setTimeout(() => trigger('triggerMessageInterface'), 1000); },
    extraDelay: 1000 },
  { filename: 'Connections Modals - Add To Board.png', label: 'Add To Board (needs chat open)',
    navigate: (n) => { /* MessageInterface should still be open */ } },
  { filename: 'Connections Modals - Report User.png', label: 'Report User (needs chat open)',
    navigate: (n) => { /* MessageInterface should still be open */ } },
  { filename: 'Connections Modals - Block User.png', label: 'Block User (needs chat open)',
    navigate: (n) => { /* MessageInterface should still be open */ } },
  { filename: 'Connections Modals - Add Friend View.png', label: 'Add Friend View',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('connections');
      setTimeout(() => trigger('triggerAddFriendView'), 800); },
    extraDelay: 500 },
  { filename: 'Connections Modals - Requests View.png', label: 'Requests View',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('connections');
      setTimeout(() => trigger('triggerRequestsView'), 800); },
    extraDelay: 500 },
  { filename: 'Connections Modals - Blocked Users.png', label: 'Blocked Users View',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('connections');
      setTimeout(() => trigger('triggerBlockedUsers'), 800); },
    extraDelay: 500 },

  // ═══════════════════ PROFILE MODALS (6) ═══════════════════
  { filename: 'Profile Modals - Account Settings.png', label: 'Account Settings',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('profile');
      setTimeout(() => n.setShowAccountSettings(true), 500); } },
  { filename: 'Profile Modals - Profile Settings.png', label: 'Profile Settings',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('profile');
      setTimeout(() => n.setShowProfileSettings(true), 500); } },
  { filename: 'Profile Modals - Edit Bio.png', label: 'Edit Bio Sheet',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('profile');
      setTimeout(() => trigger('triggerEditBio'), 800); },
    extraDelay: 500 },
  { filename: 'Profile Modals - Edit Interests.png', label: 'Edit Interests Sheet',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('profile');
      setTimeout(() => trigger('triggerEditInterests'), 800); },
    extraDelay: 500 },
  { filename: 'Profile Modals - Terms of Service.png', label: 'Terms of Service',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('profile');
      setTimeout(() => n.setShowTermsOfService(true), 500); } },
  { filename: 'Profile Modals - Privacy Policy.png', label: 'Privacy Policy',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('profile');
      setTimeout(() => n.setShowPrivacyPolicy(true), 500); } },

  // ═══════════════════ BOARD MODALS (5) ═══════════════════
  { filename: 'Board Modals - Settings.png', label: 'Board Settings',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('board-view');
      setTimeout(() => trigger('triggerBoardSettings'), 800); },
    extraDelay: 500 },
  { filename: 'Board Modals - Manage Members.png', label: 'Manage Members',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('board-view');
      setTimeout(() => trigger('triggerManageMembers'), 800); },
    extraDelay: 500 },
  { filename: 'Board Modals - Card Discussion.png', label: 'Card Discussion (needs board)',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('board-view'); } },
  { filename: 'Board Modals - Invite Participants.png', label: 'Invite Participants (needs board)',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('board-view'); } },
  { filename: 'Board Modals - Calendar Prompt.png', label: 'Calendar Prompt (needs board)',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('board-view'); } },

  // ═══════════════════ GLOBAL MODALS (7) ═══════════════════
  { filename: 'Global Modals - Preferences Sheet.png', label: 'Preferences Sheet',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home');
      setTimeout(() => n.setShowPreferences(true), 500); } },
  { filename: 'Global Modals - Share Modal.png', label: 'Share Modal',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home');
      setTimeout(() => n.setShowShareModal(true), 500); } },
  { filename: 'Global Modals - Post Experience Review.png', label: 'Post Experience (needs review data)',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home'); } },
  { filename: 'Global Modals - Debug.png', label: 'Debug Modal',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home'); } },
  { filename: 'Global Modals - Propose DateTime.png', label: 'Propose DateTime (needs saved card)',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('likes'); } },
  { filename: 'Global Modals - Country Picker.png', label: 'Country Picker (needs context)',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home'); } },
  { filename: 'Global Modals - Language Picker.png', label: 'Language Picker (needs context)',
    navigate: (n) => { n.resetOverlays(); n.setCurrentPage('home'); } },
];

const DELAY_BETWEEN_SCREENS = 2500;

export const ScreenshotAutomation: React.FC<Props> = ({
  isVisible,
  onClose,
  navigationActions,
}) => {
  const [statusMessage, setStatusMessage] = useState('Ready. Start the ADB capture script first, then press Start.');
  const navRef = useRef(navigationActions);
  const onCloseRef = useRef(onClose);
  navRef.current = navigationActions;
  onCloseRef.current = onClose;

  const runAutomation = useCallback(async () => {
    setStatusMessage('Closing modal and starting in 2 seconds...');
    onCloseRef.current();
    await sleep(1500);

    console.log('SCREENSHOT_AUTOMATION_START');
    await sleep(1000);

    const nav = navRef.current;

    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i];

      // Reset child modal triggers
      useScreenshotStore.getState().resetAll();

      // Navigate
      step.navigate(nav);

      // Wait for render
      await sleep(DELAY_BETWEEN_SCREENS + (step.extraDelay || 0));

      // Signal ready
      console.log(`SCREENSHOT_READY:${step.filename}`);

      // Wait for ADB capture
      await sleep(1500);
    }

    // Clean up
    useScreenshotStore.getState().resetAll();
    nav.resetOverlays();
    nav.setCurrentPage('home');

    console.log('SCREENSHOT_AUTOMATION_DONE');
    setStatusMessage(`Done! Captured ${STEPS.length} screens.`);
  }, []);

  useEffect(() => {
    if (isVisible) {
      setStatusMessage('Ready. Start the ADB capture script first, then press Start.');
    }
  }, [isVisible]);

  return (
    <Modal visible={isVisible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Screenshot Automation</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statusBar}>
          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>

        <ScrollView style={styles.stepList}>
          <Text style={styles.infoText}>
            This will auto-cycle through {STEPS.length} screens. Some screens
            need specific data (marked with "needs...") and will show their
            default/empty state.
          </Text>

          <View style={styles.divider} />

          {STEPS.map((step, i) => (
            <View key={i} style={styles.stepItem}>
              <Text style={styles.stepIndex}>{i + 1}</Text>
              <View style={styles.stepContent}>
                <Text style={styles.stepLabel}>{step.label}</Text>
                <Text style={styles.stepFile}>{step.filename}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.startButton} onPress={runAutomation}>
            <Text style={styles.buttonText}>Start Automation ({STEPS.length} screens)</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  title: { fontSize: 18, fontWeight: 'bold', color: '#e94560' },
  closeText: { color: '#888', fontSize: 14 },
  statusBar: {
    padding: 12,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  statusText: { color: '#ccc', fontSize: 12 },
  stepList: { flex: 1, padding: 12 },
  infoText: { color: '#aaa', fontSize: 13, marginBottom: 8, lineHeight: 18 },
  divider: { height: 1, backgroundColor: '#333', marginVertical: 12 },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    marginBottom: 4,
    backgroundColor: '#16213e',
    borderRadius: 6,
  },
  stepIndex: { color: '#666', fontSize: 12, width: 24 },
  stepContent: { flex: 1 },
  stepLabel: { color: '#ddd', fontSize: 13, fontWeight: '500' },
  stepFile: { color: '#666', fontSize: 10, marginTop: 2 },
  actions: { padding: 16, borderTopWidth: 1, borderTopColor: '#333' },
  startButton: {
    backgroundColor: '#e94560',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
