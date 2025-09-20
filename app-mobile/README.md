# Mingla Mobile App

A cross-platform mobile application for collaborative experience discovery and planning, built with React Native and Expo. This mobile app mirrors the web application functionality while providing native mobile features and optimized user experience.

## 🚀 Features

### Core Features
- **AI-Powered Recommendations**: Weather-aware and personalized experience suggestions with 18+ recommendations
- **Real-time Collaboration**: Live session management and board collaboration
- **Location Services**: GPS tracking with city name display (not raw coordinates)
- **Tinder-style Interface**: Swipeable experience cards for intuitive discovery
- **Board Management**: Create, manage, and collaborate on experience boards
- **Authentication**: Real Supabase authentication with profile sync

### Mobile-Specific Features
- **Cross-platform**: Works seamlessly on iOS and Android
- **Responsive Design**: Optimized for all screen sizes with dynamic layouts
- **Native Integration**: Camera, location, notifications, and calendar
- **Geocoding Service**: Converts coordinates to readable city names
- **Performance Optimized**: Efficient rendering with caching and fallbacks

## 📱 Screens

### Home Screen
- **AI Recommendations**: Intelligent experience suggestions with Tinder-style swipe interface
- **Location Discovery**: Real-time location-based discovery with city name display
- **Quick Actions**: Easy access to connections, collaborate, saved items, and scheduling
- **Session Status**: Current collaboration session information
- **Time-specific Greetings**: Personalized greetings based on time of day

### Connections Screen
- **Friends Tab**: Add friends, search, and manage friend relationships
- **Inbox Tab**: Message conversations with search functionality
- **Real-time Updates**: Live friend status and message notifications
- **Demo Data**: Comprehensive demo data for testing and development

### Activity Screen
- **Board Management**: Create and manage collaborative boards
- **Saved Experiences**: View and manage saved experiences with full details
- **Calendar Integration**: Schedule and view planned experiences
- **Session Integration**: Connect boards to collaboration sessions

### Profile Screen
- **User Statistics**: View activity and engagement metrics
- **Settings Management**: Configure app preferences and notifications
- **Account Management**: Update profile information and preferences
- **Profile Settings**: Detailed settings page with comprehensive options

## 🏗️ Architecture

### Technology Stack
- **React Native**: Cross-platform mobile development
- **Expo**: Development platform and build tools
- **TypeScript**: Type-safe development
- **Supabase**: Backend as a Service (database, auth, real-time)
- **Zustand**: State management with AsyncStorage persistence
- **React Navigation**: Bottom tab and stack navigation
- **React Native Gesture Handler**: Swipe gestures for Tinder-style interface

### Project Structure
```
src/
├── components/          # Reusable UI components
│   ├── ui/             # Base UI components (shadcn/ui)
│   ├── AuthGuard.tsx   # Authentication guard
│   ├── SimpleAuthGuard.tsx # Simplified auth guard
│   ├── SwipeableExperienceCard.tsx # Tinder-style cards
│   ├── AIRecommendationEngine.tsx
│   ├── LocationAwareDiscovery.tsx
│   ├── SessionSwitcher.tsx
│   ├── CreateSessionModal.tsx
│   └── ...
├── screens/            # Screen components
│   ├── HomeScreen.tsx
│   ├── ConnectionsScreenTest.tsx # Connections with demo data
│   ├── ActivityScreen.tsx
│   ├── ProfileScreen.tsx
│   ├── ProfileSettingsScreen.tsx
│   └── AuthScreen.tsx
├── hooks/              # Custom React hooks
│   ├── useAuth.ts
│   ├── useUserProfile.ts # Real user profile management
│   ├── useExperiences.ts
│   ├── useBoards.ts
│   ├── useEnhancedBoards.ts
│   ├── useRealtimeSession.ts
│   ├── useFriends.ts
│   ├── useMessages.ts
│   └── ...
├── services/           # External service integrations
│   ├── supabase.ts
│   ├── authService.ts # Real authentication service
│   ├── geocodingService.ts # Coordinate to city name conversion
│   ├── realtimeService.ts
│   ├── enhancedLocationService.ts
│   ├── enhancedNotificationService.ts
│   ├── aiReasoningService.ts # Fixed AI recommendations
│   ├── experienceService.ts # Direct experience fetching
│   └── cameraService.ts
├── store/              # State management
│   └── appStore.ts
├── types/              # TypeScript type definitions
│   └── index.ts
├── constants/          # App constants
│   └── categories.ts
└── contexts/           # React contexts
    ├── NavigationContext.tsx
    └── MobileFeaturesProvider.tsx
```

## 🔧 Setup & Installation

### Prerequisites
- Node.js (v20.19.4+)
- npm or yarn
- Expo CLI
- iOS Simulator (for iOS development)
- Android Studio (for Android development)

### Installation
1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd app-mobile
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   - Update Supabase configuration in `src/services/supabase.ts`
   - Configure Expo project settings in `app.json`
   - Ensure Supabase project is properly configured

4. **Start development server**
   ```bash
   npm start
   # or
   npx expo start
   ```

5. **Run on device/simulator**
   - iOS: Press `i` in terminal or scan QR code with Camera app
   - Android: Press `a` in terminal or scan QR code with Expo Go app
   - Web: Press `w` in terminal for web development

## 🐛 Recent Fixes & Improvements

### Authentication & Data Sync
- ✅ **Real Authentication**: Implemented proper Supabase authentication
- ✅ **Profile Sync**: User profiles now sync between web and mobile apps
- ✅ **Profile Pictures**: Avatar images display correctly from web app
- ✅ **User Data**: Real user data instead of mock data

### AI Recommendations
- ✅ **Fixed AI Errors**: Resolved "FunctionsHttpError" issues
- ✅ **18+ Recommendations**: App now shows same number of recommendations as web app
- ✅ **Fallback System**: Robust fallback when AI service is unavailable
- ✅ **Performance**: Improved loading times and error handling

### Database & Queries
- ✅ **Fixed Board Queries**: Resolved "PGRST200" relationship errors
- ✅ **Simplified Queries**: Optimized database queries for better performance
- ✅ **Error Handling**: Graceful handling of database connection issues

### Location Services
- ✅ **City Names**: Location now shows "New York, NY, USA" instead of coordinates
- ✅ **Geocoding Service**: Reverse geocoding with caching and fallbacks
- ✅ **Common Locations**: Pre-defined locations for major cities
- ✅ **Permission Handling**: Improved location permission management

### UI/UX Improvements
- ✅ **Tinder Interface**: Swipeable experience cards with proper sizing
- ✅ **Responsive Layout**: Dynamic layouts that work on all screen sizes
- ✅ **Action Buttons**: Properly positioned action buttons below cards
- ✅ **Time Greetings**: Personalized greetings based on time of day
- ✅ **Loading States**: Better loading indicators and error states

## 📱 Mobile Features

### Location Services
- **GPS Tracking**: Real-time location monitoring with city name display
- **Geocoding**: Automatic conversion of coordinates to readable locations
- **Permission Management**: Comprehensive location permission handling
- **Caching**: 24-hour cache for geocoding results to improve performance

### Authentication
- **Real Supabase Auth**: Full authentication with sign-in/sign-up
- **Profile Management**: Real-time profile updates and sync
- **Session Management**: Automatic session refresh and management
- **Secure Storage**: Encrypted local storage for user data

### AI Integration
- **Weather-aware Recommendations**: AI suggestions based on current weather
- **Personalized Suggestions**: User preference-based recommendations
- **Fallback System**: Robust fallback when AI service is unavailable
- **Performance**: Optimized with caching and timeout handling

### Tinder-style Interface
- **Swipeable Cards**: Intuitive swipe left/right interface
- **Dynamic Sizing**: Cards adapt to different screen sizes
- **Action Buttons**: Like, pass, and save actions
- **Smooth Animations**: Fluid swipe animations and transitions

## 🔄 Real-time Features

### Collaboration Sessions
- **Live Session Management**: Real-time participant updates
- **Session Messaging**: Live chat functionality
- **Session Switching**: Seamless switching between solo and collaborative modes
- **Invite Management**: Real-time collaboration invitations

### Board Collaboration
- **Live Board Updates**: Real-time board modifications
- **Experience Sharing**: Live experience additions and removals
- **Collaborator Management**: Real-time collaborator updates
- **Activity Tracking**: Live activity monitoring

## 🎨 UI/UX Features

### Design System
- **Mobile-first Design**: Optimized for mobile devices
- **Consistent Theming**: Unified color scheme and typography
- **Responsive Layout**: Adapts to different screen sizes
- **Tinder-style Interface**: Intuitive swipe-based discovery

### User Experience
- **Intuitive Navigation**: Bottom tab navigation with clear hierarchy
- **Smooth Animations**: Fluid transitions and micro-interactions
- **Loading States**: Clear feedback during data loading
- **Error Handling**: User-friendly error messages and recovery

## 🚀 Performance

### Optimization Features
- **Efficient Rendering**: Optimized component rendering
- **Memory Management**: Proper cleanup and memory optimization
- **Network Optimization**: Efficient API calls and caching
- **Bundle Optimization**: Code splitting and lazy loading

### Caching Strategy
- **Geocoding Cache**: 24-hour cache for location names
- **AI Recommendations**: 5-minute cache for recommendations
- **User Data**: Persistent storage with AsyncStorage
- **Image Caching**: Optimized image loading and caching

## 🔐 Security

### Authentication
- **Supabase Auth**: Secure authentication with JWT tokens
- **Session Management**: Automatic session refresh and management
- **Permission-based Access**: Role-based access control
- **Secure Storage**: Encrypted local storage for sensitive data

### Data Protection
- **HTTPS**: All network communications encrypted
- **Input Validation**: Comprehensive input sanitization
- **SQL Injection Prevention**: Parameterized queries
- **XSS Protection**: Content Security Policy implementation

## 🧪 Testing

### Current Status
- **Manual Testing**: Comprehensive manual testing across features
- **Error Handling**: Robust error handling and fallback systems
- **Cross-platform**: Tested on iOS and Android
- **Performance**: Optimized for smooth user experience

### Quality Assurance
- **TypeScript**: Compile-time type checking
- **ESLint**: Code quality and consistency
- **Error Logging**: Comprehensive error logging and debugging
- **User Feedback**: Real-time user experience monitoring

## 🚀 Deployment

### Build Process
- **Expo Build**: Optimized production builds
- **Code Signing**: Automatic iOS and Android code signing
- **Asset Optimization**: Image and asset optimization
- **Bundle Analysis**: Bundle size optimization

### Distribution
- **App Store**: iOS App Store deployment ready
- **Google Play**: Android Play Store deployment ready
- **Over-the-Air Updates**: Instant updates via Expo Updates
- **Beta Testing**: Internal and external beta distribution

## 📈 Current Status

### ✅ Completed Features
- Real authentication with Supabase
- AI-powered recommendations (18+ experiences)
- Location services with city name display
- Tinder-style swipeable interface
- Board management and collaboration
- Profile management and settings
- Real-time data sync with web app
- Comprehensive error handling
- Performance optimizations

### 🔄 In Progress
- Advanced search filters
- Enhanced real-time chat
- Push notifications
- Offline mode capabilities
- Advanced analytics

### 📋 Roadmap
- **Phase 1**: Core functionality (✅ Complete)
- **Phase 2**: Advanced features (🔄 In Progress)
- **Phase 3**: Polish and optimization (📋 Planned)

## 🤝 Contributing

### Development Guidelines
- **Code Style**: Follow established coding conventions
- **Commit Messages**: Use conventional commit format
- **Pull Requests**: Comprehensive PR descriptions
- **Testing**: Ensure all features work before merging

### Getting Started
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly on both iOS and Android
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

### Documentation
- **API Documentation**: Comprehensive API reference
- **Component Library**: UI component documentation
- **Setup Guide**: Step-by-step setup instructions
- **Troubleshooting**: Common issues and solutions

### Community
- **GitHub Issues**: Bug reports and feature requests
- **Discord**: Community discussions and support
- **Stack Overflow**: Technical questions and answers
- **Email**: Direct support for critical issues

---

**Built with ❤️ using React Native, Expo, and Supabase**

## 🎯 Key Achievements

- ✅ **Mirrored Web App**: Mobile app now matches web app functionality
- ✅ **Real Data Sync**: User profiles and data sync between platforms
- ✅ **18+ Recommendations**: Same number of experiences as web app
- ✅ **City Name Display**: User-friendly location names instead of coordinates
- ✅ **Tinder Interface**: Intuitive swipe-based experience discovery
- ✅ **Error-free Operation**: Resolved all major database and API errors
- ✅ **Cross-platform**: Works seamlessly on iOS and Android
- ✅ **Performance Optimized**: Fast loading with caching and fallbacks