import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Text,
  TouchableOpacity,
} from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";

interface GoogleOAuthWebViewProps {
  visible: boolean;
  oauthUrl: string;
  onSuccess: (accessToken: string, refreshToken: string) => void;
  onError: (error: string) => void;
  onCancel: () => void;
}

export default function GoogleOAuthWebView({
  visible,
  oauthUrl,
  onSuccess,
  onError,
  onCancel,
}: GoogleOAuthWebViewProps) {
  const [loading, setLoading] = useState(true);

  const handleNavigationStateChange = (navState: any) => {
    const { url } = navState;

    // Check if this is our callback URL
    if (url.includes("/auth/callback") || url.includes("access_token") || url.includes("code=")) {
      // Extract tokens from URL
      try {
        const urlObj = new URL(url);
        const hashParams = new URLSearchParams(urlObj.hash.substring(1));
        const searchParams = new URLSearchParams(urlObj.search);

        const accessToken =
          hashParams.get("access_token") || searchParams.get("access_token");
        const refreshToken =
          hashParams.get("refresh_token") || searchParams.get("refresh_token");
        const errorParam = hashParams.get("error") || searchParams.get("error");

        if (errorParam) {
          onError(decodeURIComponent(errorParam));
          return;
        }

        if (accessToken && refreshToken) {
          // Success! Extract tokens and close modal
          onSuccess(accessToken, refreshToken);
        } else if (url.includes("code=")) {
          // Authorization code flow - Supabase will exchange it
          // Wait for the redirect with tokens
          return;
        }
      } catch (error) {
        console.error("Error parsing OAuth callback:", error);
      }
    }

    // Check if redirected to Supabase callback
    if (url.includes("supabase.co/auth/v1/callback")) {
      setLoading(true);
      // Wait for Supabase to process and redirect
      return;
    }

    setLoading(false);
  };

  const handleError = (syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    console.error("WebView error:", nativeEvent);
    onError("Failed to load OAuth page. Please try again.");
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#0f172a" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Sign in with Google</Text>
          <View style={styles.closeButton} />
        </View>

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#eb7825" />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        )}

        <WebView
          source={{ uri: oauthUrl }}
          onNavigationStateChange={handleNavigationStateChange}
          onError={handleError}
          onHttpError={handleError}
          style={styles.webview}
          startInLoadingState={true}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#eb7825" />
            </View>
          )}
          onLoadEnd={() => setLoading(false)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    paddingTop: 50, // Account for status bar
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0f172a",
  },
  webview: {
    flex: 1,
  },
  loadingContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#64748b",
  },
});

