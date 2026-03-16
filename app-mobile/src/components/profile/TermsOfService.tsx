import React, { useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  Linking,
  StatusBar,
  Animated,
} from "react-native";
import { Icon } from "../ui/Icon";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

interface TermsOfServiceProps {
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

export default function TermsOfService({ onNavigateBack }: TermsOfServiceProps) {
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
          <Icon name="arrow-back" size={20} color="#374151" />
        </TouchableOpacity>
        <View style={styles.titleCluster}>
          <Icon name="file-text" size={18} color="#eb7825" />
          <Text style={styles.headerTitle}>Terms of Service</Text>
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
          <Text style={styles.docTitle}>Mingla Terms of Service</Text>
          <Text style={styles.effectiveDate}>Effective September 27, 2025</Text>
        </View>
        <View style={styles.divider} />

        {/* Introduction */}
        <Text style={styles.bodyText}>
          Welcome to Mingla! By using our app and services ("Services"), you agree to these Terms
          of Service.
        </Text>

        {/* Section 1 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={1} />
            <Text style={styles.sectionTitle}>Eligibility</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              You must be at least 18 years old (or 13 with parental consent) to use Mingla.
            </Text>
          </View>
        </View>

        {/* Section 2 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={2} />
            <Text style={styles.sectionTitle}>Use of Services</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              You agree to use Mingla only for lawful purposes and in accordance with these Terms.
              Prohibited activities include:
            </Text>
            <Bullet>Misuse of invitations, collaborations, or messaging.</Bullet>
            <Bullet>Uploading offensive, harmful, or infringing content.</Bullet>
            <Bullet>Reverse engineering or disrupting the Services.</Bullet>
          </View>
        </View>

        {/* Section 3 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={3} />
            <Text style={styles.sectionTitle}>Account Responsibilities</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              You are responsible for maintaining the confidentiality of your account and all
              activities under it.
            </Text>
          </View>
        </View>

        {/* Section 4 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={4} />
            <Text style={styles.sectionTitle}>Content</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.subTitle}>Your Content:</Text>
            <Text style={styles.bodyText}>
              You retain ownership of content you post but grant Mingla a non-exclusive, worldwide
              license to use it for providing Services.
            </Text>
            <Text style={styles.subTitle}>Mingla Content:</Text>
            <Text style={styles.bodyText}>
              All app content, code, and design remain property of Mingla.
            </Text>
          </View>
        </View>

        {/* Section 5 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={5} />
            <Text style={styles.sectionTitle}>Subscriptions & Payments</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>All purchases are final unless required by law.</Text>
          </View>
        </View>

        {/* Section 6 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={6} />
            <Text style={styles.sectionTitle}>Disclaimers</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              Mingla is provided "as is" without warranties of any kind. We do not guarantee
              availability, accuracy of recommendations, or specific outcomes of planned activities.
            </Text>
          </View>
        </View>

        {/* Section 7 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={7} />
            <Text style={styles.sectionTitle}>Limitation of Liability</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              To the maximum extent permitted by law, Mingla is not liable for indirect, incidental,
              or consequential damages arising from use of the Services.
            </Text>
          </View>
        </View>

        {/* Section 8 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={8} />
            <Text style={styles.sectionTitle}>Indemnification</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              You agree to indemnify and hold Mingla harmless from claims related to your misuse
              of the Services.
            </Text>
          </View>
        </View>

        {/* Section 9 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={9} />
            <Text style={styles.sectionTitle}>Termination</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              We may suspend or terminate your account if you violate these Terms. You may delete
              your account anytime in Account Settings.
            </Text>
          </View>
        </View>

        {/* Section 10 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={10} />
            <Text style={styles.sectionTitle}>Governing Law & Dispute Resolution</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              These Terms are governed by the laws of the United States and the State of Delaware.
              Any disputes must be resolved through binding arbitration under the rules of the
              American Arbitration Association (AAA).
            </Text>
          </View>
        </View>

        {/* Section 11 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={11} />
            <Text style={styles.sectionTitle}>Changes to Terms</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              We may update these Terms at any time. Continued use of Mingla after updates means
              you accept the revised Terms.
            </Text>
          </View>
        </View>

        {/* Section 12 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionBadge num={12} />
            <Text style={styles.sectionTitle}>Contact Us</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.bodyText}>
              For questions, contact:{" "}
              <Text style={styles.link} onPress={() => Linking.openURL("mailto:support@mingla.app")}>
                support@mingla.app
              </Text>
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerCard}>
            <Text style={styles.footerText}>
              <Text style={styles.bold}>Last Updated:</Text> September 27, 2025. These terms are
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
  // Fixed header — identical to PrivacyPolicy
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
  docHeader: { alignItems: "center" },
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
