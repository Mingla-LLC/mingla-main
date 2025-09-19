import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

// Import screens
import HomeScreen from './src/screens/HomeScreen';
import ConnectionsScreen from './src/screens/ConnectionsScreenTest';
import ActivityScreen from './src/screens/ActivityScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ProfileSettingsScreen from './src/screens/ProfileSettingsScreen';
import AuthScreen from './src/screens/AuthScreen';

// Import components
import { AuthGuard } from './src/components/AuthGuard';
import { SimpleAuthGuard } from './src/components/SimpleAuthGuard';
import { NavigationProvider } from './src/contexts/NavigationContext';
import { SessionSwitcher } from './src/components/SessionSwitcher';
import { CreateSessionModal } from './src/components/CreateSessionModal';
import { NotificationBar } from './src/components/NotificationBar';
import { PreferencesSheet } from './src/components/PreferencesSheet';
import { MobileFeaturesProvider } from './src/components/MobileFeaturesProvider';

// Import store
import { useAppStore } from './src/store/appStore';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Profile Stack Navigator
function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} />
      <Stack.Screen name="ProfileSettings" component={ProfileSettingsScreen} />
    </Stack.Navigator>
  );
}

function MainTabsWithNavigation() {
  const navigation = useNavigation();
  
  return (
    <>
      <NavigationProvider navigation={navigation}>
        <MainTabs />
        <SessionSwitcher />
        <CreateSessionModal />
        <NotificationBar />
        <PreferencesSheet />
      </NavigationProvider>
    </>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap;

          if (route.name === 'Home') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Connections') {
            iconName = focused ? 'people' : 'people-outline';
          } else if (route.name === 'Activity') {
            iconName = focused ? 'calendar' : 'calendar-outline';
          } else if (route.name === 'Profile') {
            iconName = focused ? 'person' : 'person-outline';
          } else {
            iconName = 'help-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: 'gray',
        headerShown: false,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Connections" component={ConnectionsScreen} />
      <Tab.Screen name="Activity" component={ActivityScreen} />
      <Tab.Screen name="Profile" component={ProfileStack} />
    </Tab.Navigator>
  );
}

export default function App() {
  const { isAuthenticated } = useAppStore();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MobileFeaturesProvider>
          <NavigationContainer>
            <StatusBar style="auto" />
            <SimpleAuthGuard fallback={<AuthScreen />}>
              <MainTabsWithNavigation />
            </SimpleAuthGuard>
          </NavigationContainer>
        </MobileFeaturesProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}