import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';

import App from './app';

// Keep the native splash visible until the JS bridge signals it's ready.
// SplashScreen.hideAsync() is called inside AnimatedSplashScreen's own useEffect,
// guaranteeing the animated replacement is committed to screen before the native splash hides.
SplashScreen.preventAutoHideAsync().catch(() => {
  // preventAutoHideAsync can throw on web; safe to ignore
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
