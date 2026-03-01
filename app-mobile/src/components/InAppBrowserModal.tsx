import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface InAppBrowserModalProps {
  visible: boolean;
  url: string;
  title: string;
  onClose: () => void;
}

export default function InAppBrowserModal({
  visible,
  url,
  title,
  onClose,
}: InAppBrowserModalProps) {
  const [loading, setLoading] = useState(true);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.overlayBackground}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color="#ffffff" />
            </TouchableOpacity>
          </View>

          {/* WebView */}
          <View style={styles.webviewContainer}>
            {loading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#eb7825" />
              </View>
            )}
            <WebView
              source={{ uri: url }}
              style={styles.webview}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  overlayBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContainer: {
    width: '95%',
    maxWidth: 600,
    height: SCREEN_HEIGHT * 0.85,
    maxHeight: SCREEN_HEIGHT * 0.85,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  webviewContainer: {
    flex: 1,
    position: 'relative',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
    zIndex: 10,
  },
  webview: {
    flex: 1,
  },
});
