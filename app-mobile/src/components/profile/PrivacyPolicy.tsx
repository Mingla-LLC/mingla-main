import React, { useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Linking,
  StatusBar,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Feather from "@expo/vector-icons/Feather";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

interface PrivacyPolicyProps {
  onNavigateBack: () => void;
}

// --- Reusable section number badge ---
const SectionBadge: React.FC<{ num: number }> = ({ num }) => (
  <LinearGradient colors={["#eb7825", "#f5a623"]} style={styles.badge}>
    <Text style={styles.badgeText}>{num}</Text>
  </LinearGradient>
);

// --- Bullet item with orange dot ---
const Bullet: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <View style={styles.bulletRow}>
    <View style={styles.bulletDot} />
    <Text style={styles.bulletText}>{children}</Text>
  </View>
);

export default function PrivacyPolicy({ onNavigateBack }: PrivacyPolicyProps) {
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;

  const headerShadowOpacity = scrollY.interpolate({
    inputRange: [0, 10],
    outputRange: [0, 0.1],
    extrapolate: "clamp",
  });

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="dark-content" />

      {/* Fixed header */}
      <Animated.View style={[styles.header, {
        shadowOpacity: headerShadowOpacity,
      }]}>
        <TouchableOpacity
          onPress={onNavigateBack}
          style={styles.backButton}
          activeOpacity={0.7}
          accessibilityLabel="Close"
          accessibilityRole="button"
        >
          <Ionicons name="arrow-back" size={20} color="#374151" />
        </TouchableOpacity>
        <View style={styles.titleCluster}>
          <Feather name="shield" size={18} color="#eb7825" />
          <Text style={styles.headerTitle}>Privacy Policy</Text>
        </View>
        <View style={styles.headerSpacer} />
      </Animated.View>

      {/* Scrollable content */}
      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingTop: 72, paddingBottom: Math.max(insets.bottom, 16), paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        scrollEventThrottle={16}
      >
        {/* Document header */}
        <View style={styles.docHeader}>
          <Text style={styles.docTitle}>Mingla Privacy Policy</Text>
          <Text style={styles.effectiveDate}>Effective September 27, 2025</Text>
        </View>
        <View style={styles.divider} />

        {/* Introduction */}
        <Text style={styles.bodyText}>
          Mingla ("we," "our," "us") is committed to protecting your privacy. This Privacy Policy
          explains how we collect, use, disclose, and protect your information when you use the
          Mingla mobile application and related services ("Services").
        </Text>

        {/* Section 1 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={1} />
            <Text style={styles.sectionTitle}>Information We Collect</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.subTitle}>Personal Information You Provide:</Text>
            <Text style={styles.bodyText}>
              When you create an account, update your profile, connect with friends, or interact
              with features, we may collect your name, username, profile photo, location, email
              address, preferences, and communications.
            </Text>
            <Text style={styles.subTitle}>Automatically Collected Information:</Text>
            <Text style={styles.bodyText}>
              We may collect device information, IP addresses, geolocation data, and usage patterns
              to operate and improve the app.
            </Text>
            <Text style={styles.subTitle}>Activity Data:</Text>
            <Text style={styles.bodyText}>
              Cards liked, boards created, RSVPs, calendar entries, messages, and interactions
              within Mingla.
            </Text>
          </View>
        </View>

        {/* Section 2 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={2} />
            <Text style={styles.sectionTitle}>How We Use Information</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>We use information to:</Text>
            <Bullet>Provide, personalize, and improve the Services.</Bullet>
            <Bullet>Enable collaboration, messaging, and activity planning.</Bullet>
            <Bullet>Show location-based recommendations.</Bullet>
            <Bullet>Deliver notifications, updates, and communications.</Bullet>
            <Bullet>Ensure security, detect fraud, and comply with legal obligations.</Bullet>
          </View>
        </View>

        {/* Section 3 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={3} />
            <Text style={styles.sectionTitle}>Sharing of Information</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>We may share information:</Text>
            <Bullet><Text style={styles.bold}>With other users:</Text> As necessary to enable collaboration, boards, invitations, and messaging.</Bullet>
            <Bullet><Text style={styles.bold}>With service providers:</Text> For hosting, analytics, and app functionality.</Bullet>
            <Bullet><Text style={styles.bold}>For legal reasons:</Text> To comply with applicable law, enforce our Terms of Service, or protect the rights and safety of Mingla and its users.</Bullet>
            <Bullet><Text style={styles.bold}>In case of business transfer:</Text> If Mingla is acquired, merged, or undergoes reorganization.</Bullet>
          </View>
        </View>

        {/* Section 4 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={4} />
            <Text style={styles.sectionTitle}>Data Retention</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              We retain information for as long as your account is active or as needed to provide
              Services. You may request account deletion, after which we will delete your data except
              where retention is required by law.
            </Text>
          </View>
        </View>

        {/* Section 5 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={5} />
            <Text style={styles.sectionTitle}>Your Choices</Text>
          </View>
          <View style={styles.sectionBody}>
            <Bullet>You can edit your profile, settings, and preferences at any time.</Bullet>
            <Bullet>You may opt in/out of notifications.</Bullet>
            <Bullet>You can delete your account permanently in Account Settings.</Bullet>
          </View>
        </View>

        {/* Section 6 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={6} />
            <Text style={styles.sectionTitle}>Children's Privacy</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              Mingla is not intended for children under 13. We do not knowingly collect data from
              children under 13.
            </Text>
          </View>
        </View>

        {/* Section 7 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={7} />
            <Text style={styles.sectionTitle}>Security</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              We implement safeguards to protect your information, but no system is 100% secure.
            </Text>
          </View>
        </View>

        {/* Section 8 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={8} />
            <Text style={styles.sectionTitle}>Your Rights</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              Depending on your state, you may have privacy rights under laws like the California
              Consumer Privacy Act (CCPA). These may include the right to access, delete, or opt
              out of certain data uses.
            </Text>
          </View>
        </View>

        {/* Section 9 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={9} />
            <Text style={styles.sectionTitle}>Updates to Policy</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              We may update this policy periodically. Continued use of Mingla constitutes acceptance
              of the updated policy.
            </Text>
          </View>
        </View>

        {/* Section 10 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={10} />
            <Text style={styles.sectionTitle}>Contact Us</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              For questions, contact:{" "}
              <Text style={styles.link} onPress={() => Linking.openURL("mailto:privacy@mingla.app")}>
                privacy@mingla.app
              </Text>
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerCard}>
            <Text style={styles.footerText}>
              <Text style={styles.bold}>Last Updated:</Text> September 27, 2025. This policy is
              automatically updated to reflect the most current version. By continuing to use Mingla,
              you agree to the terms outlined above.
            </Text>
          </View>
        </View>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "white" },
  // Fixed header
  header: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
    height: 56, backgroundColor: "#ffffff",
    borderBottomWidth: 1, borderBottomColor: "#f3f4f6",
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3, elevation: 2,
  },
  backButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "#f3f4f6",
    alignItems: "center", justifyContent: "center",
  },
  titleCluster: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8,
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#111827" },
  headerSpacer: { width: 40 },
  scroll: { flex: 1 },
  // Document header
  docHeader: { alignItems: "center", marginBottom: 0 },
  docTitle: { fontSize: 28, fontWeight: "800", color: "#111827", textAlign: "center" },
  effectiveDate: { fontSize: 13, fontWeight: "500", color: "#6b7280", textAlign: "center", marginTop: 6 },
  divider: { height: 1, backgroundColor: "#e5e7eb", marginTop: 24, marginBottom: 32 },
  // Sections
  section: { marginBottom: 28 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  badge: {
    width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1, shadowRadius: 2, elevation: 2,
  },
  badgeText: { fontSize: 13, fontWeight: "700", color: "#ffffff" },
  sectionTitle: { fontSize: 19, fontWeight: "700", color: "#111827", letterSpacing: -0.2, flex: 1 },
  sectionBody: { paddingLeft: 40 },
  subTitle: { fontSize: 15, fontWeight: "600", color: "#1f2937", marginBottom: 4, marginTop: 8 },
  bodyText: { fontSize: 15, color: "#4b5563", lineHeight: 24, marginBottom: 8 },
  bold: { fontWeight: "700" },
  // Bullets
  bulletRow: { flexDirection: "row", marginBottom: 6, paddingRight: 8 },
  bulletDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: "#eb7825",
    marginTop: 9, marginRight: 10,
  },
  bulletText: { fontSize: 15, color: "#4b5563", lineHeight: 24, flex: 1 },
  // Links
  link: { color: "#eb7825", textDecorationLine: "underline" },
  // Footer
  footer: { borderTopWidth: 1, borderTopColor: "#e5e7eb", paddingTop: 24, marginTop: 20 },
  footerCard: {
    backgroundColor: "#fef3e2", borderWidth: 1, borderColor: "#fed7aa",
    borderRadius: 12, padding: 16,
  },
  footerText: { fontSize: 13, color: "#92400e", lineHeight: 20 },
});
