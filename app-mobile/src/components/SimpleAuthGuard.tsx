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


  if (loading) {
    return fallback;
  }

  if (isAuthenticated) {
    return <>{children}</>;
  }

  // Show the proper AuthScreen instead of bypass option
  return <AuthScreen />;
};

const LoadingScreen: React.FC = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#007AFF" />
    <Text style={styles.loadingText}>Loading...</Text>
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
});
