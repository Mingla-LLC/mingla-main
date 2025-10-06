import React, { useState } from 'react';
import { Text, View, TouchableOpacity, Image, StyleSheet, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './ui/button';
import { Input } from './ui/input';
import minglaLogo from '../../assets/6850c6540f4158618f67e1fdd72281118b419a35.png';

interface SignInPageProps {
  onSignInRegular: (credentials: { email: string; password: string }) => void;
  onSignUpRegular: (userData: { email: string; password: string; name: string }) => void;
  onSignInCurator: (credentials: { email: string; password: string }) => void;
  onSignUpCurator: (userData: { email: string; password: string; name: string; organization?: string }) => void;
}

type AuthMode = 'welcome' | 'sign-in-regular' | 'sign-up-regular';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  mainContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoContainer: {
    marginBottom: 32,
  },
  logo: {
    height: 100,
    width: 250,
    alignSelf: 'center',
  },
  taglineContainer: {
    marginBottom: 48,
  },
  tagline: {
    color: '#1f2937',
    fontSize: 18,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
  },
  cardContainer: {
    width: '100%',
    maxWidth: 400,
  },
  card: {
    backgroundColor: '#f9fafb',
    borderRadius: 24,
    padding: 32,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconBackground: {
    width: 64,
    height: 64,
    backgroundColor: '#eb7825',
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    color: '#111827',
    fontWeight: 'bold',
    fontSize: 20,
    marginBottom: 8,
    textAlign: 'center',
  },
  cardDescription: {
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  buttonsContainer: {
    gap: 16,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#eb7825',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 18,
  },
  secondaryButton: {
    width: '100%',
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#d1d5db',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#374151',
    fontWeight: '600',
    fontSize: 16,
  },
  footer: {
    marginTop: 32,
    paddingHorizontal: 16,
  },
  footerText: {
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
  // Form styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 50, // Account for status bar
    paddingBottom: 16,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backButtonText: {
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '500',
  },
  logoIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  formWrapper: {
    width: '100%',
    maxWidth: 400,
  },
  formHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  formTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  formSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  form: {
    gap: 16,
  },
  formCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 16,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    color: '#374151',
    fontWeight: '500',
    fontSize: 14,
    marginBottom: 8,
  },
  inputWrapper: {
    position: 'relative',
  },
  passwordToggle: {
    position: 'absolute',
    right: 12,
    top: '50%',
    transform: [{ translateY: -10 }],
    padding: 4,
  },
  submitButton: {
    width: '100%',
    backgroundColor: '#eb7825',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  alternativeAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  alternativeText: {
    color: '#6b7280',
    fontSize: 14,
  },
  alternativeLink: {
    color: '#eb7825',
    fontWeight: '600',
    textDecorationLine: 'underline',
    marginLeft: 4,
  },
});

export default function SignInPage({ onSignInRegular, onSignUpRegular }: SignInPageProps) {
  const [authMode, setAuthMode] = useState<AuthMode>('welcome');
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: ''
  });

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    switch (authMode) {
      case 'sign-in-regular':
        onSignInRegular({ email: formData.email, password: formData.password });
        break;
      case 'sign-up-regular':
        onSignUpRegular({ email: formData.email, password: formData.password, name: formData.name });
        break;
    }
  };

  const resetForm = () => {
    setFormData({ email: '', password: '', name: '' });
    setShowPassword(false);
  };

  const handleBackToWelcome = () => {
    setAuthMode('welcome');
    resetForm();
  };



  if (authMode === 'welcome') {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="white" />
        {/* Main Content */}
        <View style={styles.mainContent}>
          {/* Mingla Logo */}
          <View style={styles.logoContainer}>
            <Image 
              source={minglaLogo} 
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          {/* Tagline */}
          <View style={styles.taglineContainer}>
            <Text style={styles.tagline}>
              The easiest way to figure out what to do on dates and hangouts.
            </Text>
          </View>

          {/* Join as Explorer Card */}
          <View style={styles.cardContainer}>
            <View style={styles.card}>
              {/* Icon */}
              <View style={styles.iconContainer}>
                <View style={styles.iconBackground}>
                  <Ionicons name="people" size={32} color="white" />
                </View>
                <Text style={styles.cardTitle}>Join as Explorer</Text>
                <Text style={styles.cardDescription}>
                  Discover experiences, connect with friends, and explore your city
                </Text>
              </View>

              {/* Buttons */}
              <View style={styles.buttonsContainer}>
                <TouchableOpacity
                  onPress={() => onSignUpRegular({ 
                    email: `explorer${Date.now()}@mingla.temp`, 
                    password: 'temp-password', 
                    name: 'Explorer User' 
                  })}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>Get Started</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  onPress={() => setAuthMode('sign-in-regular')}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>Already have an account? Sign In</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              By continuing, you agree to our Terms of Service and Privacy Policy
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // Form view for all auth modes
  const isSignUp = authMode.includes('sign-up');
  
  const formTitle = isSignUp 
    ? 'Create Explorer Account'
    : 'Explorer Sign In';
  
  const formSubtitle = isSignUp
    ? 'Start your journey of discovery with Mingla'
    : 'Welcome back, explorer!';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      {/* Header with back button and logo */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBackToWelcome}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.logoIcon}>
          <Ionicons name="people" size={20} color="white" />
        </View>
      </View>

      {/* Form Content */}
      <View style={styles.formContainer}>
        <View style={styles.formWrapper}>
          {/* Form Header */}
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>{formTitle}</Text>
            <Text style={styles.formSubtitle}>{formSubtitle}</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <View style={styles.formCard}>
              {/* Name field for sign up */}
              {isSignUp && (
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>
                    Full Name
                  </Text>
                  <Input
                    type="text"
                    value={formData.name}
                    onChangeText={(value) => handleInputChange('name', value)}
                    placeholder="Enter your full name"
                    required
                    style={{
                      backgroundColor: 'white',
                      borderWidth: 1,
                      borderColor: '#d1d5db',
                      borderRadius: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                      fontSize: 16,
                      color: '#111827',
                    }}
                  />
                </View>
              )}

              {/* Email field */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>
                  Email
                </Text>
                <Input
                  type="email"
                  value={formData.email}
                  onChangeText={(value) => handleInputChange('email', value)}
                  placeholder="Enter your email"
                  required
                  style={{
                    backgroundColor: 'white',
                    borderWidth: 1,
                    borderColor: '#d1d5db',
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    fontSize: 16,
                    color: '#111827',
                  }}
                />
              </View>

              {/* Password field */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>
                  Password
                </Text>
                <View style={styles.inputWrapper}>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChangeText={(value) => handleInputChange('password', value)}
                    placeholder="Enter your password"
                    required
                    style={{
                      backgroundColor: 'white',
                      borderWidth: 1,
                      borderColor: '#d1d5db',
                      borderRadius: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                      paddingRight: 48,
                      fontSize: 16,
                      color: '#111827',
                    }}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.passwordToggle}
                  >
                    {showPassword ? <Ionicons name="eye-off" size={20} color="#6b7280" /> : <Ionicons name="eye" size={20} color="#6b7280" />}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                onPress={handleSubmit}
                style={styles.submitButton}
              >
                <Text style={styles.submitButtonText}>{isSignUp ? 'Create Account' : 'Sign In'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Alternative Action */}
          <View style={styles.alternativeAction}>
            <Text style={styles.alternativeText}>
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            </Text>
            <TouchableOpacity
              onPress={() => {
                if (isSignUp) {
                  setAuthMode('sign-in-regular');
                } else {
                  setAuthMode('sign-up-regular');
                }
                resetForm();
              }}
            >
              <Text style={styles.alternativeLink}>{isSignUp ? 'Sign In' : 'Sign Up'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}