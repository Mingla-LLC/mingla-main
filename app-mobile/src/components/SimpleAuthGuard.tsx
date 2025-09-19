import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { useAppStore } from '../store/appStore';
import { authService } from '../services/authService';

interface SimpleAuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const SimpleAuthGuard: React.FC<SimpleAuthGuardProps> = ({ 
  children, 
  fallback = <LoadingScreen /> 
}) => {
  const { isAuthenticated, setAuth } = useAppStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing authentication
    const checkAuth = async () => {
      try {
        const { user, error } = await authService.getCurrentUser();
        if (error) {
          console.error('Auth check error:', error);
        }
        setLoading(false);
      } catch (error) {
        console.error('Auth check error:', error);
        setLoading(false);
      }
    };

    checkAuth();

    // Listen for auth state changes
    const { data: { subscription } } = authService.onAuthStateChange((user) => {
      console.log('Auth state changed:', user ? 'User signed in' : 'User signed out');
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  const handleBypassAuth = () => {
    // Create a mock user for testing
    const mockUser = {
      id: 'test-user-id',
      email: 'test@example.com',
      display_name: 'Test User',
      created_at: new Date().toISOString(),
    };
    setAuth(mockUser as any);
  };

  if (loading) {
    return fallback;
  }

  if (isAuthenticated) {
    return <>{children}</>;
  }

  // Show bypass option for testing
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Authentication Required</Text>
        <Text style={styles.subtitle}>
          The app is stuck in loading. This is a bypass for testing.
        </Text>
        <TouchableOpacity style={styles.button} onPress={handleBypassAuth}>
          <Text style={styles.buttonText}>Bypass Auth (Testing)</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const LoadingScreen: React.FC = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#007AFF" />
    <Text style={styles.loadingText}>Loading...</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 24,
    margin: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
});
