import React from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
const minglaLogo = require("../../../assets/6850c6540f4158618f67e1fdd72281118b419a35.png");

interface SignUpAsStepProps {
  onSelectAccountType: (accountType: string) => void;
  onBack: () => void;
}

type AccountType = "explorer" | "curator" | "business" | "qa_manager" | "admin";

interface AccountTypeOption {
  id: AccountType;
  title: string;
  description: string;
  sampleEmail: string;
  icon: {
    name: keyof typeof Ionicons.glyphMap;
    color: string;
    bgColor?: string;
    style: "solid" | "outline";
  };
}

const accountTypes: AccountTypeOption[] = [
  {
    id: "explorer",
    title: "Explorer (General User)",
    description: "General user who discovers and plans experiences",
    sampleEmail: "jordan.explorer@mingla.com",
    icon: {
      name: "square",
      color: "#eb7825",
      bgColor: "#eb7825",
      style: "solid",
    },
  },
  {
    id: "curator",
    title: "Curator",
    description: "Create experience cards for your city",
    sampleEmail: "maria.curator@mingla.com",
    icon: {
      name: "square",
      color: "#eb7825",
      bgColor: "#eb7825",
      style: "solid",
    },
  },
  {
    id: "business",
    title: "Business",
    description: "Manage your business experiences and revenue",
    sampleEmail: "sunset.business@mingla.com",
    icon: {
      name: "layers",
      color: "#10b981",
      style: "outline",
    },
  },
  {
    id: "qa_manager",
    title: "QA Manager",
    description: "Handle support, edit API content, moderate platform",
    sampleEmail: "sam.qa@mingla.com",
    icon: {
      name: "shield-checkmark",
      color: "#3b82f6",
      style: "outline",
    },
  },
  {
    id: "admin",
    title: "Admin",
    description: "Full platform management and analytics",
    sampleEmail: "admin@mingla.com",
    icon: {
      name: "shield",
      color: "#6b7280",
      style: "outline",
    },
  },
];

const SignUpAsStep = ({ onSelectAccountType, onBack }: SignUpAsStepProps) => {
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "white",
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 16,
      paddingBottom: 32,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 24,
    },
    backButton: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    backButtonText: {
      color: "#6b7280",
      fontSize: 16,
      fontWeight: "500",
      marginLeft: 4,
    },
    headerCenter: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      position: "absolute",
      left: 0,
      right: 0,
    },
    logoContainer: {
      alignItems: "center",
      marginBottom: 8,
    },
    logo: {
      width: 24,
      height: 24,
      resizeMode: "contain",
      opacity: 0.6,
    },
    titleSection: {
      alignItems: "center",
      marginBottom: 32,
    },
    title: {
      fontSize: 32,
      fontWeight: "bold",
      color: "#111827",
      textAlign: "center",
      marginBottom: 12,
    },
    subtitle: {
      fontSize: 16,
      color: "#6b7280",
      textAlign: "center",
      lineHeight: 22,
      paddingHorizontal: 16,
    },
    accountTypesList: {
      gap: 12,
      marginBottom: 32,
    },
    accountTypeCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "white",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#e5e7eb",
      padding: 16,
    },
    iconContainer: {
      width: 48,
      height: 48,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 16,
    },
    iconContainerSolid: {
      backgroundColor: "#eb7825",
    },
    iconContainerOutline: {
      backgroundColor: "transparent",
    },
    cardContent: {
      flex: 1,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: "#111827",
      marginBottom: 4,
    },
    cardDescription: {
      fontSize: 14,
      color: "#6b7280",
      lineHeight: 20,
      marginBottom: 4,
    },
    cardEmail: {
      fontSize: 12,
      color: "#9ca3af",
    },
    footer: {
      alignItems: "center",
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: "#f3f4f6",
    },
    footerText: {
      fontSize: 14,
      color: "#6b7280",
      textAlign: "center",
    },
    footerPassword: {
      fontSize: 14,
      fontWeight: "600",
      color: "#eb7825",
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Ionicons name="arrow-back" size={20} color="#6b7280" />
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <View style={styles.logoContainer}>
              <Image
                source={minglaLogo}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
          </View>

          <View style={{ width: 80 }} />
        </View>

        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Sign Up as...</Text>
          <Text style={styles.subtitle}>
            Choose a user type to sign up (Explorers & Curators will go through
            onboarding)
          </Text>
        </View>

        {/* Account Type Cards */}
        <View style={styles.accountTypesList}>
          {accountTypes.map((accountType) => (
            <TouchableOpacity
              key={accountType.id}
              style={styles.accountTypeCard}
              onPress={() => onSelectAccountType(accountType.id)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.iconContainer,
                  accountType.icon.style === "solid"
                    ? styles.iconContainerSolid
                    : styles.iconContainerOutline,
                ]}
              >
                {accountType.icon.style === "solid" ? (
                  <Ionicons
                    name={accountType.icon.name}
                    size={24}
                    color="white"
                  />
                ) : (
                  <Ionicons
                    name={accountType.icon.name}
                    size={24}
                    color={accountType.icon.color}
                  />
                )}
              </View>
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle}>{accountType.title}</Text>
                <Text style={styles.cardDescription}>
                  {accountType.description}
                </Text>
                <Text style={styles.cardEmail}>{accountType.sampleEmail}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            All test accounts use the password:{" "}
            <Text style={styles.footerPassword}>Mingla2025!</Text>
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default SignUpAsStep;
