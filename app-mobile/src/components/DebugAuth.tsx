import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAuthSimple as useAuth } from '../hooks/useAuthSimple';
import { useAppStore } from '../store/appStore';
import { supabase } from '../services/supabase';

export const DebugAuth: React.FC = () => {
  const { loading, user } = useAuth();
  const { isAuthenticated } = useAppStore();
  const [connectionStatus, setConnectionStatus] = useState<string>('Testing...');

  useEffect(() => {
    // Test Supabase connection
    const testConnection = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('count')
          .limit(1);
        
        if (error) {
          setConnectionStatus(`Error: ${error.message}`);
        } else {
          setConnectionStatus('Connected');
        }
      } catch (err) {
        setConnectionStatus(`Connection failed: ${err}`);
      }
    };

    testConnection();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Debug Auth State</Text>
      <Text style={styles.text}>Supabase: {connectionStatus}</Text>
      <Text style={styles.text}>Loading: {loading ? 'Yes' : 'No'}</Text>
      <Text style={styles.text}>User: {user ? 'Exists' : 'None'}</Text>
      <Text style={styles.text}>Is Authenticated: {isAuthenticated ? 'Yes' : 'No'}</Text>
      <Text style={styles.text}>User Email: {user?.email || 'N/A'}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 16,
    borderRadius: 8,
    zIndex: 1000,
  },
  title: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  text: {
    color: 'white',
    fontSize: 14,
    marginBottom: 4,
  },
});
