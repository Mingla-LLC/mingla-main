/**
 * Navigation Routes Configuration
 * Defines all app routes and navigation structure
 */

export type RouteNames = 
  | 'home'
  | 'connections'
  | 'messages'
  | 'activity'
  | 'profile'
  | 'profile-settings'
  | 'account-settings'
  | 'privacy-policy'
  | 'terms-of-service'
  | 'auth'
  | 'onboarding';

export interface Route {
  name: RouteNames;
  path: string;
  title: string;
  showInBottomNav?: boolean;
  icon?: string;
  requiresAuth?: boolean;
}

export const routes: Route[] = [
  {
    name: 'auth',
    path: '/auth',
    title: 'Sign In',
    requiresAuth: false,
  },
  {
    name: 'onboarding',
    path: '/onboarding',
    title: 'Get Started',
    requiresAuth: true,
  },
  {
    name: 'home',
    path: '/',
    title: 'Home',
    showInBottomNav: true,
    icon: 'Home',
    requiresAuth: true,
  },
  {
    name: 'connections',
    path: '/connections',
    title: 'Connections',
    showInBottomNav: true,
    icon: 'Users',
    requiresAuth: true,
  },
  {
    name: 'messages',
    path: '/messages',
    title: 'Messages',
    showInBottomNav: true,
    icon: 'MessageCircle',
    requiresAuth: true,
  },
  {
    name: 'activity',
    path: '/activity',
    title: 'Activity',
    showInBottomNav: true,
    icon: 'Calendar',
    requiresAuth: true,
  },
  {
    name: 'profile',
    path: '/profile',
    title: 'Profile',
    showInBottomNav: true,
    icon: 'User',
    requiresAuth: true,
  },
  {
    name: 'profile-settings',
    path: '/profile/settings',
    title: 'Profile Settings',
    requiresAuth: true,
  },
  {
    name: 'account-settings',
    path: '/profile/account',
    title: 'Account Settings',
    requiresAuth: true,
  },
  {
    name: 'privacy-policy',
    path: '/legal/privacy',
    title: 'Privacy Policy',
    requiresAuth: false,
  },
  {
    name: 'terms-of-service',
    path: '/legal/terms',
    title: 'Terms of Service',
    requiresAuth: false,
  },
];

export const getRouteByName = (name: RouteNames): Route | undefined => {
  return routes.find(route => route.name === name);
};

export const getBottomNavRoutes = (): Route[] => {
  return routes.filter(route => route.showInBottomNav);
};
