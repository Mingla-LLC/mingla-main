import React from 'react';
import { Text, View, TouchableOpacity } from 'react-native';
import { ArrowLeft, Shield } from 'lucide-react';

interface PrivacyPolicyProps {
  onNavigateBack: () => void;
}

export default function PrivacyPolicy({ onNavigateBack }: PrivacyPolicyProps) {
  return (
    <View className="h-full bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <View className="bg-white border-b border-gray-200 px-4 py-4 flex-shrink-0">
        <View className="flex items-center gap-3">
          <TouchableOpacity
            onClick={onNavigateBack}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </TouchableOpacity>
          <View className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#eb7825]" />
            <Text className="text-xl font-semibold text-gray-900">Privacy Policy</Text>
          </View>
        </View>
      </View>

      {/* Content */}
      <View className="flex-1 overflow-y-auto">
        <View className="max-w-4xl mx-auto p-6 bg-white m-4 rounded-2xl border border-gray-200">
        <View className="space-y-6">
          {/* Header */}
          <View className="text-center border-b border-gray-200 pb-6">
            <Text className="text-2xl font-bold text-gray-900 mb-2">📜 Mingla Privacy Policy</Text>
            <Text className="text-sm text-gray-600">
              <strong>Effective Date:</strong> 27th September 2025
            </Text>
          </View>

          {/* Introduction */}
          <View className="space-y-4">
            <Text className="text-gray-700 leading-relaxed">
              Mingla ("we," "our," "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and protect your information when you use the Mingla mobile application and related services ("Services").
            </Text>
          </View>

          {/* Section 1 */}
          <View className="space-y-4">
            <Text className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Text className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">1</Text>
              Information We Collect
            </Text>
            <View className="space-y-3 pl-8">
              <View>
                <Text className="font-medium text-gray-900 mb-1">Personal Information You Provide:</Text>
                <Text className="text-gray-700">When you create an account, update your profile, connect with friends, or interact with features, we may collect your name, username, profile photo, location, email address, preferences, and communications.</Text>
              </View>
              <View>
                <Text className="font-medium text-gray-900 mb-1">Automatically Collected Information:</Text>
                <Text className="text-gray-700">We may collect device information, IP addresses, geolocation data, and usage patterns to operate and improve the app.</Text>
              </View>
              <View>
                <Text className="font-medium text-gray-900 mb-1">Activity Data:</Text>
                <Text className="text-gray-700">Cards liked, boards created, RSVPs, calendar entries, messages, and interactions within Mingla.</Text>
              </View>
            </View>
          </View>

          {/* Section 2 */}
          <View className="space-y-4">
            <Text className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Text className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">2</Text>
              How We Use Information
            </Text>
            <View className="pl-8">
              <Text className="text-gray-700 mb-2">We use information to:</Text>
              <ul className="space-y-1 text-gray-700">
                <li>• Provide, personalize, and improve the Services.</li>
                <li>• Enable collaboration, messaging, and activity planning.</li>
                <li>• Show location-based recommendations.</li>
                <li>• Deliver notifications, updates, and communications.</li>
                <li>• Ensure security, detect fraud, and comply with legal obligations.</li>
              </ul>
            </View>
          </View>

          {/* Section 3 */}
          <View className="space-y-4">
            <Text className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Text className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">3</Text>
              Sharing of Information
            </Text>
            <View className="pl-8">
              <Text className="text-gray-700 mb-2">We may share information:</Text>
              <ul className="space-y-1 text-gray-700">
                <li>• <strong>With other users:</strong> As necessary to enable collaboration, boards, invitations, and messaging.</li>
                <li>• <strong>With service providers:</strong> For hosting, analytics, and app functionality.</li>
                <li>• <strong>For legal reasons:</strong> To comply with applicable law, enforce our Terms of Service, or protect the rights and safety of Mingla and its users.</li>
                <li>• <strong>In case of business transfer:</strong> If Mingla is acquired, merged, or undergoes reorganization.</li>
              </ul>
            </View>
          </View>

          {/* Section 4 */}
          <View className="space-y-4">
            <Text className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Text className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">4</Text>
              Data Retention
            </Text>
            <View className="pl-8">
              <Text className="text-gray-700">We retain information for as long as your account is active or as needed to provide Services. You may request account deletion, after which we will delete your data except where retention is required by law.</Text>
            </View>
          </View>

          {/* Section 5 */}
          <View className="space-y-4">
            <Text className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Text className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">5</Text>
              Your Choices
            </Text>
            <View className="pl-8">
              <ul className="space-y-1 text-gray-700">
                <li>• You can edit your profile, settings, and preferences at any time.</li>
                <li>• You may opt in/out of notifications.</li>
                <li>• You can delete your account permanently in Account Settings.</li>
              </ul>
            </View>
          </View>

          {/* Section 6 */}
          <View className="space-y-4">
            <Text className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Text className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">6</Text>
              Children's Privacy
            </Text>
            <View className="pl-8">
              <Text className="text-gray-700">Mingla is not intended for children under 13. We do not knowingly collect data from children under 13.</Text>
            </View>
          </View>

          {/* Section 7 */}
          <View className="space-y-4">
            <Text className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Text className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">7</Text>
              Security
            </Text>
            <View className="pl-8">
              <Text className="text-gray-700">We implement safeguards to protect your information, but no system is 100% secure.</Text>
            </View>
          </View>

          {/* Section 8 */}
          <View className="space-y-4">
            <Text className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Text className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">8</Text>
              Your Rights
            </Text>
            <View className="pl-8">
              <Text className="text-gray-700">Depending on your state, you may have privacy rights under laws like the California Consumer Privacy Act (CCPA). These may include the right to access, delete, or opt out of certain data uses.</Text>
            </View>
          </View>

          {/* Section 9 */}
          <View className="space-y-4">
            <Text className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Text className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">9</Text>
              Updates to Policy
            </Text>
            <View className="pl-8">
              <Text className="text-gray-700">We may update this policy periodically. Continued use of Mingla constitutes acceptance of the updated policy.</Text>
            </View>
          </View>

          {/* Section 10 */}
          <View className="space-y-4">
            <Text className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Text className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">10</Text>
              Contact Us
            </Text>
            <View className="pl-8">
              <Text className="text-gray-700">
                For questions, contact: <a href="mailto:privacy@mingla.app" className="text-[#eb7825] hover:underline">privacy@mingla.app</a>
              </Text>
            </View>
          </View>

          {/* Footer */}
          <View className="border-t border-gray-200 pt-6 mt-8">
            <View className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <Text className="text-sm text-orange-700">
                <strong>Last Updated:</strong> September 27, 2025. This policy is automatically updated to reflect the most current version. By continuing to use Mingla, you agree to the terms outlined above.
              </Text>
            </View>
          </View>
        </View>
        </View>
      </View>
    </View>
  );
}