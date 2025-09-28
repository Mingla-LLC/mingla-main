# Mingla - AI-Powered Experience Discovery Platform

Mingla is a comprehensive experience discovery platform that uses AI to help users find personalized activities, events, and places. The platform consists of a React Native mobile app, a React web application, and a Supabase backend with AI-powered recommendation engines.

## 🚀 Project Overview

Mingla combines location-based discovery with AI personalization to create a unique experience recommendation system. Users can discover activities, plan with friends, and explore new places based on their preferences, group size, budget, and travel constraints.

## 📱 Architecture

### Mobile App (`app-mobile/`)
- **Framework**: React Native with Expo
- **Navigation**: React Navigation (Bottom Tabs + Stack)
- **State Management**: Zustand
- **Styling**: StyleSheet with custom design system
- **Authentication**: Supabase Auth
- **Real-time**: Supabase Realtime subscriptions

### Web App (`lovable-projects/`)
- **Framework**: React with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **UI Components**: shadcn-ui
- **State Management**: React Query + Zustand

### Backend (`supabase/`)
- **Database**: PostgreSQL with Supabase
- **Edge Functions**: TypeScript functions for AI recommendations
- **Authentication**: Supabase Auth with RLS policies
- **Real-time**: Supabase Realtime for live collaboration
- **AI Integration**: OpenAI GPT-4 for personalized recommendations

## 🎯 Key Features

### 🤖 AI-Powered Recommendations
- **Personalized Discovery**: AI analyzes user preferences and behavior
- **Experience Type Badges**: Romantic, First Date, Group Fun, Solo Adventure, Business, Friendly
- **Smart Filtering**: Budget, group size, travel constraints, time preferences
- **Weather Integration**: Weather-aware recommendations for outdoor activities

### 👥 Social Features
- **Connections**: Add friends, create groups, share experiences
- **Collaborative Planning**: Real-time boards for group decision making
- **Activity Sharing**: Share saved experiences and plan together
- **Smart Context Actions**: Invite to boards, plan dates, share cards

### 🗂️ Activity Management
- **Saved Experiences**: Personal collection of liked activities
- **Scheduled Activities**: Calendar integration for planned events
- **Board Collaboration**: Group voting and discussion threads
- **Activity History**: Track and learn from past experiences

### 🎨 Enhanced User Experience
- **Orange Theme**: Consistent orange color scheme throughout
- **Intuitive Navigation**: Bottom tab navigation with clear icons
- **Real-time Updates**: Live collaboration and notifications
- **Offline Support**: Cached recommendations and offline functionality

## 🛠️ Technology Stack

### Frontend
- **React Native**: Mobile app development
- **React**: Web application
- **TypeScript**: Type-safe development
- **Expo**: Mobile development platform
- **React Navigation**: Navigation system
- **Zustand**: State management
- **Tailwind CSS**: Web styling
- **shadcn-ui**: UI component library

### Backend
- **Supabase**: Backend as a Service
- **PostgreSQL**: Database
- **Edge Functions**: Serverless functions
- **Row Level Security**: Database security
- **Real-time**: Live data synchronization

### AI & APIs
- **OpenAI GPT-4**: AI recommendations and content generation
- **Google Maps API**: Location services and place data
- **Eventbrite API**: Event discovery and ticketing
- **OpenWeather API**: Weather integration

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- Expo CLI (for mobile development)
- Supabase CLI (for backend development)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/your-username/Mingla.git
cd Mingla
```

2. **Install dependencies**
```bash
# Mobile app
cd app-mobile
npm install

# Web app
cd ../lovable-projects
npm install

# Backend (if needed)
cd ../supabase
supabase start
```

3. **Environment Setup**
```bash
# Mobile app
cd app-mobile
cp .env.example .env
# Add your Supabase URL and API key

# Web app
cd ../lovable-projects
cp .env.example .env
# Add your environment variables
```

4. **Start development servers**
```bash
# Mobile app
cd app-mobile
npm start

# Web app
cd ../lovable-projects
npm run dev
```

## 📁 Project Structure

```
Mingla/
├── app-mobile/                 # React Native mobile app
│   ├── src/
│   │   ├── components/        # Reusable UI components
│   │   ├── screens/          # App screens
│   │   ├── hooks/            # Custom React hooks
│   │   ├── services/         # API and business logic
│   │   ├── store/            # State management
│   │   ├── types/            # TypeScript definitions
│   │   └── utils/            # Utility functions
│   └── App.tsx               # Main app component
├── lovable-projects/          # React web app
│   ├── src/
│   │   ├── components/       # Web components
│   │   ├── pages/           # Web pages
│   │   ├── hooks/           # Custom hooks
│   │   └── utils/           # Utilities
│   └── package.json
├── supabase/                  # Backend services
│   ├── functions/           # Edge functions
│   ├── migrations/          # Database migrations
│   └── schema.sql           # Database schema
└── README.md
```

## 🎨 Design System

### Color Scheme
- **Primary**: Orange (`#FF6B35`) - Consistent throughout the app
- **Secondary**: Green (`#4CAF50`) - Success states
- **Accent**: Blue (`#2196F3`) - Information states
- **Neutral**: Gray scale for text and backgrounds

### Typography
- **Headings**: Semibold weights for hierarchy
- **Body**: Regular weights for readability
- **Captions**: Light weights for secondary information

### Components
- **Cards**: Rounded corners with shadows
- **Buttons**: Orange primary, outlined secondary
- **Inputs**: Clean borders with focus states
- **Navigation**: Bottom tabs with orange active states

## 🔧 Development

### Mobile Development
```bash
cd app-mobile
npm start          # Start Expo development server
npm run android    # Run on Android
npm run ios        # Run on iOS
```

### Web Development
```bash
cd lovable-projects
npm run dev        # Start Vite development server
npm run build      # Build for production
npm run preview    # Preview production build
```

### Backend Development
```bash
cd supabase
supabase start     # Start local Supabase
supabase db reset  # Reset database
supabase functions deploy  # Deploy edge functions
```

## 📊 Database Schema

### Core Tables
- **profiles**: User profile information
- **preferences**: User preference settings
- **experiences**: Experience data and metadata
- **saves**: User saved experiences
- **boards**: Collaborative planning boards
- **user_interactions**: Interaction tracking for AI learning

### Key Features
- **Row Level Security**: Secure data access
- **Real-time**: Live data synchronization
- **Triggers**: Automated data processing
- **Indexes**: Optimized query performance

## 🤖 AI Features

### Recommendation Engine
- **Personalization**: Learns from user behavior
- **Context Awareness**: Considers location, weather, time
- **Group Dynamics**: Adapts to group size and preferences
- **Experience Types**: Categorizes activities with badges

### Content Generation
- **Personalized Copy**: AI-generated descriptions
- **Weather Integration**: Weather-aware suggestions
- **Smart Filtering**: Intelligent constraint handling
- **Natural Language**: Human-friendly explanations

## 🚀 Deployment

### Mobile App
- **Expo**: Use Expo Application Services (EAS)
- **App Stores**: Deploy to iOS App Store and Google Play
- **OTA Updates**: Over-the-air updates for quick fixes

### Web App
- **Vercel**: Recommended for Vite + React
- **Netlify**: Alternative deployment option
- **Custom Domain**: Connect your own domain

### Backend
- **Supabase**: Managed backend service
- **Edge Functions**: Serverless function deployment
- **Database**: Managed PostgreSQL with backups

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Supabase** for the backend infrastructure
- **OpenAI** for AI-powered recommendations
- **Google Maps** for location services
- **Eventbrite** for event data
- **Expo** for mobile development platform

**Built with ❤️ by the Mingla team**