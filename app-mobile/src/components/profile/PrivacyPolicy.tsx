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

interface PrivacyPolicyProps {
  onNavigateBack: () => void;
}

export default function PrivacyPolicy({ onNavigateBack }: PrivacyPolicyProps) {
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
      <ScrollView style={styles.content}>
        <View style={styles.contentContainer}>
          <View style={styles.contentInner}>
            {/* Header */}
            <View style={styles.policyHeader}>
              <Text style={styles.policyTitle}>📜 Mingla Privacy Policy</Text>
              <Text style={styles.effectiveDate}>
                <Text style={styles.boldText}>Effective Date:</Text> 27th
                September 2025
              </Text>
            </View>

            {/* Introduction */}
            <View style={styles.section}>
              <Text style={styles.introText}>
                Mingla ("we," "our," "us") is committed to protecting your
                privacy. This Privacy Policy explains how we collect, use,
                disclose, and protect your information when you use the Mingla
                mobile application and related services ("Services").
              </Text>
            </View>

            {/* Section 1 */}
            <View style={styles.section}>
              <View style={styles.sectionTitle}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>1</Text>
                </View>
                <Text style={styles.sectionTitleText}>
                  Information We Collect
                </Text>
              </View>
              <View style={styles.sectionContent}>
                <View style={styles.subsection}>
                  <Text style={styles.subsectionTitle}>
                    Personal Information You Provide:
                  </Text>
                  <Text style={styles.subsectionText}>
                    When you create an account, update your profile, connect
                    with friends, or interact with features, we may collect your
                    name, username, profile photo, location, email address,
                    preferences, and communications.
                  </Text>
                </View>
                <View style={styles.subsection}>
                  <Text style={styles.subsectionTitle}>
                    Automatically Collected Information:
                  </Text>
                  <Text style={styles.subsectionText}>
                    We may collect device information, IP addresses, geolocation
                    data, and usage patterns to operate and improve the app.
                  </Text>
                </View>
                <View style={styles.subsection}>
                  <Text style={styles.subsectionTitle}>Activity Data:</Text>
                  <Text style={styles.subsectionText}>
                    Cards liked, boards created, RSVPs, calendar entries,
                    messages, and interactions within Mingla.
                  </Text>
                </View>
              </View>
            </View>

            {/* Section 2 */}
            <View style={styles.section}>
              <View style={styles.sectionTitle}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>2</Text>
                </View>
                <Text style={styles.sectionTitleText}>
                  How We Use Information
                </Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.sectionText}>We use information to:</Text>
                <View style={styles.listContainer}>
                  <Text style={styles.listItem}>
                    • Provide, personalize, and improve the Services.
                  </Text>
                  <Text style={styles.listItem}>
                    • Enable collaboration, messaging, and activity planning.
                  </Text>
                  <Text style={styles.listItem}>
                    • Show location-based recommendations.
                  </Text>
                  <Text style={styles.listItem}>
                    • Deliver notifications, updates, and communications.
                  </Text>
                  <Text style={styles.listItem}>
                    • Ensure security, detect fraud, and comply with legal
                    obligations.
                  </Text>
                </View>
              </View>
            </View>

            {/* Section 3 */}
            <View style={styles.section}>
              <View style={styles.sectionTitle}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>3</Text>
                </View>
                <Text style={styles.sectionTitleText}>
                  Sharing of Information
                </Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.sectionText}>
                  We may share information:
                </Text>
                <View style={styles.listContainer}>
                  <Text style={styles.listItem}>
                    • <Text style={styles.boldText}>With other users:</Text> As
                    necessary to enable collaboration, boards, invitations, and
                    messaging.
                  </Text>
                  <Text style={styles.listItem}>
                    •{" "}
                    <Text style={styles.boldText}>With service providers:</Text>{" "}
                    For hosting, analytics, and app functionality.
                  </Text>
                  <Text style={styles.listItem}>
                    • <Text style={styles.boldText}>For legal reasons:</Text> To
                    comply with applicable law, enforce our Terms of Service, or
                    protect the rights and safety of Mingla and its users.
                  </Text>
                  <Text style={styles.listItem}>
                    •{" "}
                    <Text style={styles.boldText}>
                      In case of business transfer:
                    </Text>{" "}
                    If Mingla is acquired, merged, or undergoes reorganization.
                  </Text>
                </View>
              </View>
            </View>

            {/* Section 4 */}
            <View style={styles.section}>
              <View style={styles.sectionTitle}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>4</Text>
                </View>
                <Text style={styles.sectionTitleText}>Data Retention</Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.sectionText}>
                  We retain information for as long as your account is active or
                  as needed to provide Services. You may request account
                  deletion, after which we will delete your data except where
                  retention is required by law.
                </Text>
              </View>
            </View>

            {/* Section 5 */}
            <View style={styles.section}>
              <View style={styles.sectionTitle}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>5</Text>
                </View>
                <Text style={styles.sectionTitleText}>Your Choices</Text>
              </View>
              <View style={styles.sectionContent}>
                <View style={styles.listContainer}>
                  <Text style={styles.listItem}>
                    • You can edit your profile, settings, and preferences at
                    any time.
                  </Text>
                  <Text style={styles.listItem}>
                    • You may opt in/out of notifications.
                  </Text>
                  <Text style={styles.listItem}>
                    • You can delete your account permanently in Account
                    Settings.
                  </Text>
                </View>
              </View>
            </View>

            {/* Section 6 */}
            <View style={styles.section}>
              <View style={styles.sectionTitle}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>6</Text>
                </View>
                <Text style={styles.sectionTitleText}>Children's Privacy</Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.sectionText}>
                  Mingla is not intended for children under 13. We do not
                  knowingly collect data from children under 13.
                </Text>
              </View>
            </View>

            {/* Section 7 */}
            <View style={styles.section}>
              <View style={styles.sectionTitle}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>7</Text>
                </View>
                <Text style={styles.sectionTitleText}>Security</Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.sectionText}>
                  We implement safeguards to protect your information, but no
                  system is 100% secure.
                </Text>
              </View>
            </View>

            {/* Section 8 */}
            <View style={styles.section}>
              <View style={styles.sectionTitle}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>8</Text>
                </View>
                <Text style={styles.sectionTitleText}>Your Rights</Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.sectionText}>
                  Depending on your state, you may have privacy rights under
                  laws like the California Consumer Privacy Act (CCPA). These
                  may include the right to access, delete, or opt out of certain
                  data uses.
                </Text>
              </View>
            </View>

            {/* Section 9 */}
            <View style={styles.section}>
              <View style={styles.sectionTitle}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>9</Text>
                </View>
                <Text style={styles.sectionTitleText}>Updates to Policy</Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.sectionText}>
                  We may update this policy periodically. Continued use of
                  Mingla constitutes acceptance of the updated policy.
                </Text>
              </View>
            </View>

            {/* Section 10 */}
            <View style={styles.section}>
              <View style={styles.sectionTitle}>
                <View style={styles.sectionNumber}>
                  <Text style={styles.sectionNumberText}>10</Text>
                </View>
                <Text style={styles.sectionTitleText}>Contact Us</Text>
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.sectionText}>
                  For questions, contact:{" "}
                  <Text
                    style={styles.linkText}
                    onPress={() => Linking.openURL("mailto:privacy@mingla.app")}
                  >
                    privacy@mingla.app
                  </Text>
                </Text>
              </View>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
              <View style={styles.footerContainer}>
                <Text style={styles.footerText}>
                  <Text style={styles.boldText}>Last Updated:</Text> September
                  27, 2025. This policy is automatically updated to reflect the
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
  contentContainer: {
    maxWidth: 800,
    alignSelf: "center",
    padding: 16,
    backgroundColor: "white",
    borderRadius: 16,
  },
  contentInner: {
    gap: 24,
  },
  policyHeader: {
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingBottom: 24,
  },
  policyTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 8,
    textAlign: "center",
  },
  effectiveDate: {
    fontSize: 14,
    color: "#6b7280",
  },
  boldText: {
    fontWeight: "bold",
  },
  section: {
    gap: 16,
  },
  sectionTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionNumber: {
    backgroundColor: "#eb7825",
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionNumberText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },
  sectionTitleText: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111827",
  },
  sectionContent: {
    paddingLeft: 32,
  },
  sectionText: {
    color: "#374151",
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 8,
  },
  introText: {
    color: "#374151",
    fontSize: 16,
    lineHeight: 24,
  },
  subsection: {
    marginBottom: 12,
  },
  subsectionTitle: {
    fontWeight: "500",
    color: "#111827",
    fontSize: 16,
    marginBottom: 4,
  },
  subsectionText: {
    color: "#374151",
    fontSize: 16,
    lineHeight: 24,
  },
  listContainer: {
    gap: 4,
  },
  listItem: {
    color: "#374151",
    fontSize: 16,
    lineHeight: 24,
  },
  linkText: {
    color: "#eb7825",
    textDecorationLine: "underline",
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 24,
    marginTop: 32,
  },
  footerContainer: {
    backgroundColor: "#fef3e2",
    borderWidth: 1,
    borderColor: "#fed7aa",
    borderRadius: 8,
    padding: 16,
  },
  footerText: {
    fontSize: 14,
    color: "#ea580c",
    lineHeight: 20,
  },
});
