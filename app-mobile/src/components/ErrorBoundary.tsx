import React from 'react';
import { Text, View, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { logger } from '../utils/logger';
import { breadcrumbs } from '../utils/breadcrumbs';
import i18n from '../i18n';
// #2211 — the consumer app's Dynamic Type ceiling.
import { BUTTON_MAX_FONT_SCALE } from '../constants/dynamicType';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('ErrorBoundary caught', { message: error.message, name: error.name });
    logger.error('Component stack', { stack: errorInfo.componentStack?.slice(0, 500) });
    console.error('Error Boundary caught an error:', error, errorInfo);

    // Add component stack context to breadcrumbs (logger.error above already dumps the trail)
    breadcrumbs.add('error', `ErrorBoundary: ${error.message}`, {
      componentStack: errorInfo.componentStack?.slice(0, 200),
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <View style={styles.container}>
          {/*
            #2211 — this region SCROLLS. `container` was `flex: 1` +
            `justifyContent: "center"` with no scroll container, and this is the
            app's GLOBAL crash screen: it is what three separate branches of
            `app/index.tsx` fall back to. "Try again" is the only way out of it.
            At the largest text size a 40 pt emoji, a 20 pt title and a
            translated message — some locales run considerably longer than
            English — pushed that button off the bottom with nothing to scroll,
            leaving force-quit as the only remaining action. That is exactly
            what #2180 cost us on the 404 screen.
          */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.card}>
              <Text style={styles.icon}>⚠️</Text>
              <Text style={styles.title}>{i18n.t('common:error_boundary_title')}</Text>
              <Text style={styles.message}>
                {i18n.t('common:error_boundary_message')}
              </Text>
            </View>
          </ScrollView>
          {/*
            #2211 — the exit is a `flexShrink: 0` SIBLING of the scroll host,
            never a child, so no measurement surprise inside the card can move
            it. Same structure #2180 rebuilt `+not-found.tsx` with.
          */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.button} onPress={this.handleRetry}>
              <Text
                style={styles.buttonText}
                numberOfLines={1}
                maxFontSizeMultiplier={BUTTON_MAX_FONT_SCALE}
              >
                {i18n.t('common:try_again')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  // #2211 — `container` keeps only the frame; the centring moved into
  // `scrollContent`, where `flexGrow: 1` reproduces it while there is room.
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  scroll: {
    flex: 1,
    // Clip a mis-measurement here rather than letting it push the footer off.
    overflow: 'hidden',
  },
  scrollContent: {
    // EXPLICIT — RN defaults content containers to `flexGrow: 0`.
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  footer: {
    flexShrink: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  icon: {
    fontSize: 40,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#eb7825',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ErrorBoundary;
