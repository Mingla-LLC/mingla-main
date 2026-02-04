import React from 'react';
import { ArrowLeft, Shield } from 'lucide-react';

interface PrivacyPolicyProps {
  onNavigateBack: () => void;
}

export default function PrivacyPolicy({ onNavigateBack }: PrivacyPolicyProps) {
  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onNavigateBack}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#eb7825]" />
            <h1 className="text-xl font-semibold text-gray-900">Privacy Policy</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 bg-white m-4 rounded-2xl border border-gray-200">
        <div className="space-y-6">
          {/* Header */}
          <div className="text-center border-b border-gray-200 pb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">📜 Mingla Privacy Policy</h1>
            <p className="text-sm text-gray-600">
              <strong>Effective Date:</strong> 27th September 2025
            </p>
          </div>

          {/* Introduction */}
          <div className="space-y-4">
            <p className="text-gray-700 leading-relaxed">
              Mingla ("we," "our," "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and protect your information when you use the Mingla mobile application and related services ("Services").
            </p>
          </div>

          {/* Section 1 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">1</span>
              Information We Collect
            </h2>
            <div className="space-y-3 pl-8">
              <div>
                <p className="font-medium text-gray-900 mb-1">Personal Information You Provide:</p>
                <p className="text-gray-700">When you create an account, update your profile, connect with friends, or interact with features, we may collect your name, username, profile photo, location, email address, preferences, and communications.</p>
              </div>
              <div>
                <p className="font-medium text-gray-900 mb-1">Automatically Collected Information:</p>
                <p className="text-gray-700">We may collect device information, IP addresses, geolocation data, and usage patterns to operate and improve the app.</p>
              </div>
              <div>
                <p className="font-medium text-gray-900 mb-1">Activity Data:</p>
                <p className="text-gray-700">Cards liked, boards created, RSVPs, calendar entries, messages, and interactions within Mingla.</p>
              </div>
            </div>
          </div>

          {/* Section 2 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">2</span>
              How We Use Information
            </h2>
            <div className="pl-8">
              <p className="text-gray-700 mb-2">We use information to:</p>
              <ul className="space-y-1 text-gray-700">
                <li>• Provide, personalize, and improve the Services.</li>
                <li>• Enable collaboration, messaging, and activity planning.</li>
                <li>• Show location-based recommendations.</li>
                <li>• Deliver notifications, updates, and communications.</li>
                <li>• Ensure security, detect fraud, and comply with legal obligations.</li>
              </ul>
            </div>
          </div>

          {/* Section 3 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">3</span>
              Sharing of Information
            </h2>
            <div className="pl-8">
              <p className="text-gray-700 mb-2">We may share information:</p>
              <ul className="space-y-1 text-gray-700">
                <li>• <strong>With other users:</strong> As necessary to enable collaboration, boards, invitations, and messaging.</li>
                <li>• <strong>With service providers:</strong> For hosting, analytics, and app functionality.</li>
                <li>• <strong>For legal reasons:</strong> To comply with applicable law, enforce our Terms of Service, or protect the rights and safety of Mingla and its users.</li>
                <li>• <strong>In case of business transfer:</strong> If Mingla is acquired, merged, or undergoes reorganization.</li>
              </ul>
            </div>
          </div>

          {/* Section 4 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">4</span>
              Data Retention
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">We retain information for as long as your account is active or as needed to provide Services. You may request account deletion, after which we will delete your data except where retention is required by law.</p>
            </div>
          </div>

          {/* Section 5 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">5</span>
              Your Choices
            </h2>
            <div className="pl-8">
              <ul className="space-y-1 text-gray-700">
                <li>• You can edit your profile, settings, and preferences at any time.</li>
                <li>• You may opt in/out of notifications.</li>
                <li>• You can delete your account permanently in Account Settings.</li>
              </ul>
            </div>
          </div>

          {/* Section 6 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">6</span>
              Children's Privacy
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">Mingla is not intended for children under 13. We do not knowingly collect data from children under 13.</p>
            </div>
          </div>

          {/* Section 7 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">7</span>
              Security
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">We implement safeguards to protect your information, but no system is 100% secure.</p>
            </div>
          </div>

          {/* Section 8 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">8</span>
              Your Rights
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">Depending on your state, you may have privacy rights under laws like the California Consumer Privacy Act (CCPA). These may include the right to access, delete, or opt out of certain data uses.</p>
            </div>
          </div>

          {/* Section 9 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">9</span>
              Updates to Policy
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">We may update this policy periodically. Continued use of Mingla constitutes acceptance of the updated policy.</p>
            </div>
          </div>

          {/* Section 10 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">10</span>
              Contact Us
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">
                For questions, contact: <a href="mailto:privacy@mingla.app" className="text-[#eb7825] hover:underline">privacy@mingla.app</a>
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 pt-6 mt-8">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <p className="text-sm text-orange-700">
                <strong>Last Updated:</strong> September 27, 2025. This policy is automatically updated to reflect the most current version. By continuing to use Mingla, you agree to the terms outlined above.
              </p>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}