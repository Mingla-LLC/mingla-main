import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../store/appStore';

interface AccountSettingsScreenProps {
  navigation?: any;
}

export default function AccountSettingsScreen({ navigation }: AccountSettingsScreenProps) {
  const { user } = useAppStore();
  
  // Form states
  const [email, setEmail] = useState(user?.email || 'hi@sethogieva.com');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currency, setCurrency] = useState('$ USD - United States Dollar');
  const [measurementSystem, setMeasurementSystem] = useState('Metric (km, m, °C)');
  
  // Collaboration settings
  const [shareLocation, setShareLocation] = useState(true);
  const [shareBudget, setShareBudget] = useState(false);
  const [shareCategories, setShareCategories] = useState(true);
  const [shareDateTime, setShareDateTime] = useState(true);
  
  const [loading, setLoading] = useState(false);

  const handleUpdateEmail = async () => {
    if (!email || email === user?.email) {
      Alert.alert('No Changes', 'Please enter a new email address.');
      return;
    }
    
    setLoading(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      Alert.alert('Confirmation Sent', 'You\'ll receive a confirmation email at your new address. Click the link to complete the change.');
    } catch (error) {
      Alert.alert('Error', 'Failed to send confirmation email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert('Missing Information', 'Please fill in both password fields.');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }
    
    if (newPassword.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters long.');
      return;
    }
    
    setLoading(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      Alert.alert('Success', 'Password updated successfully!');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      Alert.alert('Error', 'Failed to update password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSavePreferences = async () => {
    setLoading(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      Alert.alert('Success', 'Preferences saved successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to save preferences. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (navigation) {
      navigation.goBack();
    }
  };

  const renderSecurityInfo = () => (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Ionicons name="shield" size={20} color="#FF9500" />
        <Text style={styles.sectionTitle}>Security Information</Text>
      </View>
      <View style={styles.bulletList}>
        <Text style={styles.bulletPoint}>• Your password is encrypted and securely stored</Text>
        <Text style={styles.bulletPoint}>• Email changes require confirmation from your new email address</Text>
        <Text style={styles.bulletPoint}>• You'll be signed out from other devices after password changes</Text>
        <Text style={styles.bulletPoint}>• Contact support if you have trouble accessing your account</Text>
      </View>
    </View>
  );

  const renderEmailSection = () => (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Ionicons name="mail" size={20} color="#FF9500" />
        <Text style={styles.sectionTitle}>Email Address</Text>
      </View>
      <Text style={styles.currentEmail}>Current email: {user?.email || 'hi@sethogieva.com'}</Text>
      <TextInput
        style={styles.textInput}
        placeholder="Enter new email address"
        placeholderTextColor="#999"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TouchableOpacity 
        style={[styles.primaryButton, loading && styles.buttonDisabled]}
        onPress={handleUpdateEmail}
        disabled={loading}
      >
        <Text style={styles.primaryButtonText}>Update Email</Text>
      </TouchableOpacity>
      <View style={styles.infoMessage}>
        <Ionicons name="information-circle-outline" size={16} color="#666" />
        <Text style={styles.infoText}>
          You'll receive a confirmation email at your new address. Click the link to complete the change.
        </Text>
      </View>
    </View>
  );

  const renderPasswordSection = () => (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Ionicons name="lock-closed" size={20} color="#FF9500" />
        <Text style={styles.sectionTitle}>Change Password</Text>
      </View>
      <View style={styles.fieldContainer}>
        <Text style={styles.fieldLabel}>New Password</Text>
        <TextInput
          style={styles.textInput}
          placeholder="Enter new password"
          placeholderTextColor="#999"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
        />
      </View>
      <View style={styles.fieldContainer}>
        <Text style={styles.fieldLabel}>Confirm New Password</Text>
        <TextInput
          style={styles.textInput}
          placeholder="Confirm new password"
          placeholderTextColor="#999"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
        />
      </View>
      <TouchableOpacity 
        style={[styles.primaryButton, loading && styles.buttonDisabled]}
        onPress={handleUpdatePassword}
        disabled={loading}
      >
        <Text style={styles.primaryButtonText}>Update Password</Text>
      </TouchableOpacity>
      <View style={styles.infoMessage}>
        <Ionicons name="shield-outline" size={16} color="#666" />
        <Text style={styles.infoText}>
          Password must be at least 6 characters long. Choose a strong password for better security.
        </Text>
      </View>
    </View>
  );

  const renderCurrencySection = () => (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Ionicons name="cash" size={20} color="#FF9500" />
        <Text style={styles.sectionTitle}>Currency Preference</Text>
      </View>
      <Text style={styles.infoText}>Auto-set based on your region (App Store/Play Store)</Text>
      <TouchableOpacity style={styles.dropdown}>
        <Text style={styles.dropdownText}>{currency}</Text>
        <Ionicons name="chevron-down" size={20} color="#666" />
      </TouchableOpacity>
      <Text style={styles.infoText}>All prices shown as "per person" in your selected currency</Text>
      <TouchableOpacity 
        style={[styles.primaryButton, loading && styles.buttonDisabled]}
        onPress={handleSavePreferences}
        disabled={loading}
      >
        <Text style={styles.primaryButtonText}>Save Preferences</Text>
      </TouchableOpacity>
    </View>
  );

  const renderMeasurementSection = () => (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Ionicons name="resize" size={20} color="#FF9500" />
        <Text style={styles.sectionTitle}>Measurement System</Text>
      </View>
      <TouchableOpacity style={styles.dropdown}>
        <Text style={styles.dropdownText}>{measurementSystem}</Text>
        <Ionicons name="chevron-down" size={20} color="#666" />
      </TouchableOpacity>
      <Text style={styles.infoText}>This affects distance calculations and temperature units throughout the app</Text>
      <TouchableOpacity 
        style={[styles.primaryButton, loading && styles.buttonDisabled]}
        onPress={handleSavePreferences}
        disabled={loading}
      >
        <Text style={styles.primaryButtonText}>Save Preferences</Text>
      </TouchableOpacity>
      <Text style={styles.persistText}>Preferences will persist across all sessions and devices</Text>
    </View>
  );

  const renderCollaborationSection = () => (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Ionicons name="people" size={20} color="#FF9500" />
        <Text style={styles.sectionTitle}>Collaboration Defaults</Text>
      </View>
      
      <View style={styles.toggleItem}>
        <View style={styles.toggleLeft}>
          <Ionicons name="eye" size={16} color="#666" />
          <Text style={styles.toggleLabel}>Share Location</Text>
        </View>
        <Switch
          value={shareLocation}
          onValueChange={setShareLocation}
          trackColor={{ false: '#E5E5E7', true: '#FF9500' }}
          thumbColor={shareLocation ? '#fff' : '#f4f3f4'}
        />
      </View>

      <View style={styles.toggleItem}>
        <View style={styles.toggleLeft}>
          <Ionicons name="cash" size={16} color="#666" />
          <Ionicons name="eye-off" size={16} color="#999" />
          <Text style={styles.toggleLabel}>Share Budget</Text>
        </View>
        <Switch
          value={shareBudget}
          onValueChange={setShareBudget}
          trackColor={{ false: '#E5E5E7', true: '#FF9500' }}
          thumbColor={shareBudget ? '#fff' : '#f4f3f4'}
        />
      </View>

      <View style={styles.toggleItem}>
        <View style={styles.toggleLeft}>
          <Ionicons name="apps" size={16} color="#666" />
          <Ionicons name="eye" size={16} color="#666" />
          <Text style={styles.toggleLabel}>Share Categories</Text>
        </View>
        <Switch
          value={shareCategories}
          onValueChange={setShareCategories}
          trackColor={{ false: '#E5E5E7', true: '#FF9500' }}
          thumbColor={shareCategories ? '#fff' : '#f4f3f4'}
        />
      </View>

      <View style={styles.toggleItem}>
        <View style={styles.toggleLeft}>
          <Ionicons name="settings" size={16} color="#666" />
          <Ionicons name="eye" size={16} color="#666" />
          <Text style={styles.toggleLabel}>Share Date & Time</Text>
        </View>
        <Switch
          value={shareDateTime}
          onValueChange={setShareDateTime}
          trackColor={{ false: '#E5E5E7', true: '#FF9500' }}
          thumbColor={shareDateTime ? '#fff' : '#f4f3f4'}
        />
      </View>

      <Text style={styles.infoText}>These settings apply when you join collaborative planning sessions</Text>
      <TouchableOpacity 
        style={[styles.primaryButton, loading && styles.buttonDisabled]}
        onPress={handleSavePreferences}
        disabled={loading}
      >
        <Text style={styles.primaryButtonText}>Save Preferences</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={goBack}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView 
        style={styles.content} 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {renderSecurityInfo()}
        {renderEmailSection()}
        {renderPasswordSection()}
        {renderCurrencySection()}
        {renderMeasurementSection()}
        {renderCollaborationSection()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E7',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 32,
  },
  sectionCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginLeft: 8,
  },
  bulletList: {
    gap: 8,
  },
  bulletPoint: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  currentEmail: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  fieldContainer: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#E5E5E7',
  },
  primaryButton: {
    backgroundColor: '#FF9500',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  infoMessage: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 18,
    flex: 1,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E5E5E7',
    marginBottom: 12,
  },
  dropdownText: {
    fontSize: 16,
    color: '#1a1a1a',
  },
  persistText: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
  },
  toggleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleLabel: {
    fontSize: 16,
    color: '#1a1a1a',
  },
});
