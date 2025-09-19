import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuthSimple as useAuth } from '../hooks/useAuthSimple';
import { useAppStore } from '../store/appStore';

interface AuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ 
  children, 
  fallback = <LoadingScreen /> 
}) => {
  const { loading, user } = useAuth();
  const { isAuthenticated } = useAppStore();
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Give a small delay to ensure auth state is properly loaded
    const timer = setTimeout(() => {
      setIsInitialized(true);
    }, 100);

    // Fallback timeout to prevent infinite loading
    const fallbackTimer = setTimeout(() => {
      console.log('AuthGuard fallback timeout - forcing initialization');
      setIsInitialized(true);
    }, 10000);

    return () => {
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
    };
  }, []);

  // Debug logging
  console.log('AuthGuard state:', { loading, isAuthenticated, user: !!user, isInitialized });

  // If we're still loading and not initialized, show loading
  if (loading && !isInitialized) {
    console.log('Showing loading screen - still loading');
    return fallback;
  }

  // If we're not loading but not initialized yet, show loading briefly
  if (!loading && !isInitialized) {
    console.log('Showing loading screen - not initialized yet');
    return fallback;
  }

  // Show children if user is authenticated
  if (isAuthenticated && user) {
    console.log('User authenticated, showing main app');
    return <>{children}</>;
  }

  // Show fallback if not authenticated
  console.log('User not authenticated, showing fallback');
  return fallback;
};

const LoadingScreen: React.FC = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#007AFF" />
  </View>
);

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
});
