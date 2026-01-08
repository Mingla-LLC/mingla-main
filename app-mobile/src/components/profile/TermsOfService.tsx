import React from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Linking,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

interface TermsOfServiceProps {
  onNavigateBack: () => void;
}

export default function TermsOfService({
  onNavigateBack,
}: TermsOfServiceProps) {
  const handleEmailPress = () => {
    Linking.openURL("mailto:support@mingla.app");
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="dark-content" />
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <TouchableOpacity onPress={onNavigateBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={true}>
        <View style={styles.contentContainer}>
          <View style={styles.sectionsContainer}>
            {/* Header */}
            <View style={styles.headerSection}>
              <Text style={styles.mainTitle}>⚖️ Mingla Terms of Service</Text>
              <Text style={styles.effectiveDate}>
                <Text style={styles.bold}>Effective Date:</Text> 27th September
                2025
              </Text>
            </View>

            {/* Introduction */}
            <View style={styles.section}>
              <Text style={styles.paragraph}>
                Welcome to Mingla! By using our app and services ("Services"),
                you agree to these Terms of Service.
              </Text>
            </View>

            {/* Section 1 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>1</Text>
                </View>
                <Text style={styles.sectionTitle}>Eligibility</Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.paragraph}>
                  You must be at least 18 years old (or 13 with parental
                  consent) to use Mingla.
                </Text>
              </View>
            </View>

            {/* Section 2 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>2</Text>
                </View>
                <Text style={styles.sectionTitle}>Use of Services</Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.paragraph}>
                  You agree to use Mingla only for lawful purposes and in
                  accordance with these Terms. Prohibited activities include:
                </Text>
                <View style={styles.bulletList}>
                  <Text style={styles.bulletItem}>
                    • Misuse of invitations, collaborations, or messaging.
                  </Text>
                  <Text style={styles.bulletItem}>
                    • Uploading offensive, harmful, or infringing content.
                  </Text>
                  <Text style={styles.bulletItem}>
                    • Reverse engineering or disrupting the Services.
                  </Text>
                </View>
              </View>
            </View>

            {/* Section 3 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>3</Text>
                </View>
                <Text style={styles.sectionTitle}>
                  Account Responsibilities
                </Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.paragraph}>
                  You are responsible for maintaining the confidentiality of
                  your account and all activities under it.
                </Text>
              </View>
            </View>

            {/* Section 4 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>4</Text>
                </View>
                <Text style={styles.sectionTitle}>Content</Text>
              </View>
              <View style={styles.sectionContent}>
                <View style={styles.subsection}>
                  <Text style={styles.subsectionTitle}>Your Content:</Text>
                  <Text style={styles.paragraph}>
                    You retain ownership of content you post but grant Mingla a
                    non-exclusive, worldwide license to use it for providing
                    Services.
                  </Text>
                </View>
                <View style={styles.subsection}>
                  <Text style={styles.subsectionTitle}>Mingla Content:</Text>
                  <Text style={styles.paragraph}>
                    All app content, code, and design remain property of Mingla.
                  </Text>
                </View>
              </View>
            </View>

            {/* Section 5 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>5</Text>
                </View>
                <Text style={styles.sectionTitle}>
                  Subscriptions & Payments (if applicable)
                </Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.paragraph}>
                  All purchases are final unless required by law.
                </Text>
              </View>
            </View>

            {/* Section 6 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>6</Text>
                </View>
                <Text style={styles.sectionTitle}>Disclaimers</Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.paragraph}>
                  Mingla is provided "as is" without warranties of any kind. We
                  do not guarantee availability, accuracy of recommendations, or
                  specific outcomes of planned activities.
                </Text>
              </View>
            </View>

            {/* Section 7 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>7</Text>
                </View>
                <Text style={styles.sectionTitle}>Limitation of Liability</Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.paragraph}>
                  To the maximum extent permitted by law, Mingla is not liable
                  for indirect, incidental, or consequential damages arising
                  from use of the Services.
                </Text>
              </View>
            </View>

            {/* Section 8 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>8</Text>
                </View>
                <Text style={styles.sectionTitle}>Indemnification</Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.paragraph}>
                  You agree to indemnify and hold Mingla harmless from claims
                  related to your misuse of the Services.
                </Text>
              </View>
            </View>

            {/* Section 9 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>9</Text>
                </View>
                <Text style={styles.sectionTitle}>Termination</Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.paragraph}>
                  We may suspend or terminate your account if you violate these
                  Terms. You may delete your account anytime in Account
                  Settings.
                </Text>
              </View>
            </View>

            {/* Section 10 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>10</Text>
                </View>
                <Text style={styles.sectionTitle}>
                  Governing Law & Dispute Resolution
                </Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.paragraph}>
                  These Terms are governed by the laws of the United States and
                  the State of Delaware. Any disputes must be resolved through
                  binding arbitration under the rules of the American
                  Arbitration Association (AAA).
                </Text>
              </View>
            </View>

            {/* Section 11 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>11</Text>
                </View>
                <Text style={styles.sectionTitle}>Changes to Terms</Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.paragraph}>
                  We may update these Terms at any time. Continued use of Mingla
                  after updates means you accept the revised Terms.
                </Text>
              </View>
            </View>

            {/* Section 12 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>12</Text>
                </View>
                <Text style={styles.sectionTitle}>Contact Us</Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.paragraph}>
                  For questions, contact:{" "}
                  <Text style={styles.emailLink} onPress={handleEmailPress}>
                    support@mingla.app
                  </Text>
                </Text>
              </View>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
              <View style={styles.footerCard}>
                <Text style={styles.footerText}>
                  <Text style={styles.bold}>Last Updated:</Text> September 27,
                  2025. These terms are automatically updated to reflect the
                  most current version. By continuing to use Mingla, you agree
                  to the terms outlined above.
                </Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "white",
  },
  header: {
    paddingHorizontal: 16,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    paddingTop: 8,
    borderRadius: 20,
  },
  titleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111827",
  },
  content: {
    flex: 1,
  },

  sectionsContainer: {
    backgroundColor: "white",

    padding: 16,
  },
  headerSection: {
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingBottom: 24,
    marginBottom: 24,
  },
  mainTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 8,
    textAlign: "center",
  },
  effectiveDate: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
  },
  bold: {
    fontWeight: "bold",
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  sectionNumber: {
    backgroundColor: "#eb7825",
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  sectionNumberText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
    flex: 1,
  },
  sectionContent: {
    paddingLeft: 32,
  },
  subsection: {
    marginBottom: 12,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
    marginBottom: 4,
  },
  paragraph: {
    fontSize: 16,
    color: "#374151",
    lineHeight: 24,
    marginBottom: 8,
  },
  bulletList: {
    marginTop: 8,
  },
  bulletItem: {
    fontSize: 16,
    color: "#374151",
    lineHeight: 24,
    marginBottom: 4,
  },
  emailLink: {
    color: "#eb7825",
    textDecorationLine: "underline",
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 24,
    marginTop: 32,
  },
  footerCard: {
    backgroundColor: "#fef3e2",
    borderWidth: 1,
    borderColor: "#fed7aa",
    borderRadius: 8,
    padding: 16,
  },
  footerText: {
    fontSize: 14,
    color: "#92400e",
    lineHeight: 20,
  },
});
