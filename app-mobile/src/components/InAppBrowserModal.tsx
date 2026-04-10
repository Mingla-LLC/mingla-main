import React, { useState, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Icon } from './ui/Icon';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

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
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [currentTitle, setCurrentTitle] = useState(title);

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);
    setCanGoForward(navState.canGoForward);
    if (navState.title && navState.title.length > 0 && navState.title !== navState.url) {
      setCurrentTitle(navState.title);
    }
  }, []);

  // Keep all navigation inside the WebView — never open external browser
  const handleShouldStartLoad = useCallback(() => {
    return true;
  }, []);

  const handleError = useCallback(() => {
    // Show error state instead of falling back to external browser
    setLoading(false);
  }, []);

  const goBack = useCallback(() => {
    webViewRef.current?.goBack();
  }, []);

  const goForward = useCallback(() => {
    webViewRef.current?.goForward();
  }, []);

  // Reset nav state when modal opens — loading is managed by WebView callbacks
  const handleShow = useCallback(() => {
    setCanGoBack(false);
    setCanGoForward(false);
    setCurrentTitle(title);
  }, [title]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
      onShow={handleShow}
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
              {currentTitle || title}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.7}>
              <Icon name="close" size={20} color="#ffffff" />
            </TouchableOpacity>
          </View>

          {/* Navigation bar — back / forward */}
          <View style={styles.navBar}>
            <TouchableOpacity
              onPress={goBack}
              disabled={!canGoBack}
              style={[styles.navButton, !canGoBack && styles.navButtonDisabled]}
              activeOpacity={0.7}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <Icon name="chevron-back" size={20} color={canGoBack ? '#111827' : '#d1d5db'} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={goForward}
              disabled={!canGoForward}
              style={[styles.navButton, !canGoForward && styles.navButtonDisabled]}
              activeOpacity={0.7}
              accessibilityLabel="Go forward"
              accessibilityRole="button"
            >
              <Icon name="chevron-forward" size={20} color={canGoForward ? '#111827' : '#d1d5db'} />
            </TouchableOpacity>
            <View style={styles.navUrlContainer}>
              <Icon name="lock-closed" size={11} color="#9ca3af" />
              <Text style={styles.navUrlText} numberOfLines={1}>{url}</Text>
            </View>
          </View>

          {/* WebView */}
          <View style={styles.webviewContainer}>
            {loading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#eb7825" />
              </View>
            )}
            <WebView
              ref={webViewRef}
              source={{ uri: url }}
              style={styles.webview}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              onNavigationStateChange={handleNavigationStateChange}
              onShouldStartLoadWithRequest={handleShouldStartLoad}
              onError={handleError}
              onHttpError={handleError}
              setSupportMultipleWindows={false}
              javaScriptCanOpenWindowsAutomatically={false}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction
              startInLoadingState
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
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 4,
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonDisabled: {
    opacity: 0.4,
  },
  navUrlContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 4,
    gap: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  navUrlText: {
    flex: 1,
    fontSize: 12,
    color: '#9ca3af',
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
