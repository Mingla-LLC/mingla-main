import React from 'react';
import { ArrowLeft, FileText } from 'lucide-react';

interface TermsOfServiceProps {
  onNavigateBack: () => void;
}

export default function TermsOfService({ onNavigateBack }: TermsOfServiceProps) {
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
            <FileText className="w-5 h-5 text-[#eb7825]" />
            <h1 className="text-xl font-semibold text-gray-900">Terms of Service</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 bg-white m-4 rounded-2xl border border-gray-200">
        <div className="space-y-6">
          {/* Header */}
          <div className="text-center border-b border-gray-200 pb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">⚖️ Mingla Terms of Service</h1>
            <p className="text-sm text-gray-600">
              <strong>Effective Date:</strong> 27th September 2025
            </p>
          </div>

          {/* Introduction */}
          <div className="space-y-4">
            <p className="text-gray-700 leading-relaxed">
              Welcome to Mingla! By using our app and services ("Services"), you agree to these Terms of Service.
            </p>
          </div>

          {/* Section 1 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">1</span>
              Eligibility
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">You must be at least 18 years old (or 13 with parental consent) to use Mingla.</p>
            </div>
          </div>

          {/* Section 2 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">2</span>
              Use of Services
            </h2>
            <div className="space-y-3 pl-8">
              <p className="text-gray-700">You agree to use Mingla only for lawful purposes and in accordance with these Terms. Prohibited activities include:</p>
              <ul className="space-y-1 text-gray-700">
                <li>• Misuse of invitations, collaborations, or messaging.</li>
                <li>• Uploading offensive, harmful, or infringing content.</li>
                <li>• Reverse engineering or disrupting the Services.</li>
              </ul>
            </div>
          </div>

          {/* Section 3 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">3</span>
              Account Responsibilities
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">You are responsible for maintaining the confidentiality of your account and all activities under it.</p>
            </div>
          </div>

          {/* Section 4 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">4</span>
              Content
            </h2>
            <div className="space-y-3 pl-8">
              <div>
                <p className="font-medium text-gray-900 mb-1">Your Content:</p>
                <p className="text-gray-700">You retain ownership of content you post but grant Mingla a non-exclusive, worldwide license to use it for providing Services.</p>
              </div>
              <div>
                <p className="font-medium text-gray-900 mb-1">Mingla Content:</p>
                <p className="text-gray-700">All app content, code, and design remain property of Mingla.</p>
              </div>
            </div>
          </div>

          {/* Section 5 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">5</span>
              Subscriptions & Payments (if applicable)
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">All purchases are final unless required by law.</p>
            </div>
          </div>

          {/* Section 6 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">6</span>
              Disclaimers
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">Mingla is provided "as is" without warranties of any kind. We do not guarantee availability, accuracy of recommendations, or specific outcomes of planned activities.</p>
            </div>
          </div>

          {/* Section 7 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">7</span>
              Limitation of Liability
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">To the maximum extent permitted by law, Mingla is not liable for indirect, incidental, or consequential damages arising from use of the Services.</p>
            </div>
          </div>

          {/* Section 8 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">8</span>
              Indemnification
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">You agree to indemnify and hold Mingla harmless from claims related to your misuse of the Services.</p>
            </div>
          </div>

          {/* Section 9 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">9</span>
              Termination
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">We may suspend or terminate your account if you violate these Terms. You may delete your account anytime in Account Settings.</p>
            </div>
          </div>

          {/* Section 10 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">10</span>
              Governing Law & Dispute Resolution
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">These Terms are governed by the laws of the United States and the State of Delaware. Any disputes must be resolved through binding arbitration under the rules of the American Arbitration Association (AAA).</p>
            </div>
          </div>

          {/* Section 11 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">11</span>
              Changes to Terms
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">We may update these Terms at any time. Continued use of Mingla after updates means you accept the revised Terms.</p>
            </div>
          </div>

          {/* Section 12 */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="bg-[#eb7825] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">12</span>
              Contact Us
            </h2>
            <div className="pl-8">
              <p className="text-gray-700">
                For questions, contact: <a href="mailto:support@mingla.app" className="text-[#eb7825] hover:underline">support@mingla.app</a>
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 pt-6 mt-8">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <p className="text-sm text-orange-700">
                <strong>Last Updated:</strong> September 27, 2025. These terms are automatically updated to reflect the most current version. By continuing to use Mingla, you agree to the terms outlined above.
              </p>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}