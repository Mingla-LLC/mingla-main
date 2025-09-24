import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { useAppStore } from '../store/appStore';
import { authService } from '../services/authService';
import AuthScreen from '../screens/AuthScreen';

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
  const [bypassAuth, setBypassAuth] = useState(false);

  useEffect(() => {
    console.log('SimpleAuthGuard: Starting auth check...');
    
    // Add timeout to prevent indefinite blocking
    const timeoutId = setTimeout(() => {
      if (loading) {
        console.log('SimpleAuthGuard: Auth check timeout - forcing completion');
        setLoading(false);
      }
    }, 3000); // 3 second timeout

    // Add bypass timeout for debugging
    const bypassTimeoutId = setTimeout(() => {
      console.log('SimpleAuthGuard: Bypass timeout - allowing app to proceed');
      setBypassAuth(false);
      setLoading(false);
    }, 10000); // 10 second bypass timeout

    // Check for existing authentication
    const checkAuth = async () => {
      try {
        console.log('SimpleAuthGuard: Checking current user...');
        const { user, error } = await authService.getCurrentUser();
        if (error) {
          console.error('Auth check error:', error);
        }
        console.log('SimpleAuthGuard: Auth check completed');
        setLoading(false);
      } catch (error) {
        console.error('Auth check error:', error);
        setLoading(false);
      }
    };

    checkAuth().finally(() => {
      clearTimeout(timeoutId);
    });

    // Listen for auth state changes
    const { data: { subscription } } = authService.onAuthStateChange((user) => {
      console.log('Auth state changed:', user ? 'User signed in' : 'User signed out');
    });

    return () => {
      clearTimeout(timeoutId);
      clearTimeout(bypassTimeoutId);
      subscription?.unsubscribe();
    };
  }, []);


  if (loading) {
    return <LoadingScreen onBypass={() => {
      console.log('Manual bypass triggered');
      setBypassAuth(true);
      setLoading(false);
    }} />;
  }

  if (isAuthenticated || bypassAuth) {
    console.log('SimpleAuthGuard: Rendering main app', { isAuthenticated, bypassAuth });
    return <>{children}</>;
  }

  console.log('SimpleAuthGuard: Rendering auth screen');
  // Show the proper AuthScreen instead of bypass option
  return <AuthScreen />;
};

const LoadingScreen: React.FC<{ onBypass?: () => void }> = ({ onBypass }) => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#007AFF" />
    <Text style={styles.loadingText}>Loading...</Text>
    {onBypass && (
      <TouchableOpacity 
        style={styles.bypassButton} 
        onPress={onBypass}
      >
        <Text style={styles.bypassButtonText}>Skip Auth (Debug)</Text>
      </TouchableOpacity>
    )}
  </View>
);

const styles = StyleSheet.create({
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
  bypassButton: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#FF6B35',
    borderRadius: 8,
  },
  bypassButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
