import React from 'react';
import { motion } from 'motion/react';
import { FileText, ChevronLeft, UserCheck, Briefcase, DollarSign, XCircle, Copyright, AlertTriangle, Scale, Ban, Clock } from 'lucide-react';

interface BusinessTermsConditionsProps {
  onBack?: () => void;
}

export default function BusinessTermsConditions({ onBack }: BusinessTermsConditionsProps) {
  const sections = [
    {
      icon: UserCheck,
      title: "Acceptance of Terms",
      content: [
        {
          subtitle: "Agreement to Terms",
          text: "By creating a business account on Mingla, you agree to be bound by these Terms and Conditions. These terms constitute a legally binding agreement between you (the business) and Mingla Inc. If you do not agree to these terms, you may not use our services."
        },
        {
          subtitle: "Eligibility",
          text: "To register as a business on Mingla, you must be at least 18 years old, have the legal authority to bind your business, and comply with all applicable laws in your jurisdiction. You represent that all information provided during registration is accurate and complete."
        },
        {
          subtitle: "Business Verification",
          text: "Mingla reserves the right to verify your business credentials, require additional documentation, and conduct background checks to ensure platform safety and compliance with regulations."
        }
      ]
    },
    {
      icon: Briefcase,
      title: "Business Account & Services",
      content: [
        {
          subtitle: "Account Registration",
          text: "You must provide accurate business information including name, category, contact details, and business address. You are responsible for maintaining the confidentiality of your account credentials and all activities under your account."
        },
        {
          subtitle: "Experience Listings",
          text: "You may create and manage experience listings on Mingla. All listings must accurately represent your services, include truthful descriptions and pricing, contain your own photos or properly licensed images, and comply with local laws and regulations."
        },
        {
          subtitle: "Platform Services",
          text: "Mingla provides a marketplace platform connecting businesses with explorers and curators. We facilitate bookings, process payments, provide analytics tools, and offer customer support. However, we are not responsible for the actual delivery of experiences."
        },
        {
          subtitle: "Service Modifications",
          text: "We reserve the right to modify, suspend, or discontinue any part of our services at any time with reasonable notice. We may also update features, change pricing structures, or adjust platform policies as needed."
        }
      ]
    },
    {
      icon: DollarSign,
      title: "Payments, Fees & Payouts",
      content: [
        {
          subtitle: "Payment Processing",
          text: "All payments are processed through Stripe, our secure payment partner. By using Mingla, you agree to Stripe's terms of service. Explorers pay for bookings through the platform, and funds are held securely until the experience is completed."
        },
        {
          subtitle: "Platform Commission",
          text: "Mingla charges a service fee on each booking. The standard commission is 15% of the booking value, deducted from your payout. Commission rates may vary based on your partnership tier, promotional periods, or special agreements."
        },
        {
          subtitle: "Payout Schedule",
          text: "Payouts are processed according to your selected schedule (daily, weekly, or monthly). Funds are transferred after the experience is completed and any applicable hold periods. You must complete KYC verification to receive payouts."
        },
        {
          subtitle: "Taxes & Compliance",
          text: "You are responsible for all taxes related to your earnings, including income tax, sales tax, and VAT where applicable. You must comply with tax reporting requirements in your jurisdiction. Mingla may provide earnings reports to assist with tax filing."
        },
        {
          subtitle: "Currency & Conversion",
          text: "Transactions are processed in the currency you specify for your region. Currency conversion fees may apply for international transactions. Exchange rates are determined by our payment processor at the time of transaction."
        }
      ]
    },
    {
      icon: XCircle,
      title: "Cancellations & Refunds",
      content: [
        {
          subtitle: "Cancellation Policy",
          text: "You must establish a clear cancellation policy for your experiences. You are required to honor your stated cancellation terms, process cancellations promptly, and communicate changes to explorers. Failure to honor bookings may result in penalties."
        },
        {
          subtitle: "Refund Processing",
          text: "If a cancellation occurs according to your policy, refunds are processed automatically through the platform. You may be responsible for refund amounts depending on the timing and reason for cancellation. Refunds are typically processed within 5-10 business days."
        },
        {
          subtitle: "Force Majeure",
          text: "In cases of extreme weather, natural disasters, government restrictions, or other circumstances beyond your control, special cancellation terms may apply. You must document such circumstances and provide reasonable notice to affected explorers."
        },
        {
          subtitle: "Dispute Resolution",
          text: "In case of disputes regarding cancellations or refunds, Mingla may mediate between you and the explorer. We reserve the right to make final decisions on refund amounts in disputed cases to protect all parties fairly."
        }
      ]
    },
    {
      icon: Copyright,
      title: "Intellectual Property",
      content: [
        {
          subtitle: "Your Content",
          text: "You retain ownership of all content you upload to Mingla, including experience descriptions, photos, videos, and business information. By uploading content, you grant Mingla a worldwide, non-exclusive license to use, display, and promote your content on our platform."
        },
        {
          subtitle: "Content Requirements",
          text: "All content must be original or properly licensed. You warrant that you have the right to use all uploaded content, including images, text, and videos. You may not upload content that infringes on others' intellectual property rights."
        },
        {
          subtitle: "Mingla Branding",
          text: "The Mingla name, logo, and platform design are our intellectual property. You may use Mingla branding in connection with your business listings and promotional materials, but may not modify or misuse our trademarks."
        },
        {
          subtitle: "Trademark Protection",
          text: "You may not register domain names, social media handles, or trademarks that include 'Mingla' or create confusion with our brand. Any unauthorized use of our intellectual property may result in account termination and legal action."
        }
      ]
    },
    {
      icon: Ban,
      title: "Prohibited Activities",
      content: [
        {
          subtitle: "Business Conduct",
          text: "You may not engage in fraudulent activities, misrepresent your services or pricing, discriminate against explorers based on protected characteristics, or harass explorers or platform users in any way."
        },
        {
          subtitle: "Payment Violations",
          text: "You may not attempt to circumvent platform payments by requesting off-platform transactions, manipulate pricing or availability, engage in price fixing with other businesses, or process fake or fraudulent bookings."
        },
        {
          subtitle: "Content Violations",
          text: "Prohibited content includes false or misleading information, explicit or inappropriate material, content promoting illegal activities, spam or unsolicited marketing, and content that infringes on others' rights."
        },
        {
          subtitle: "System Abuse",
          text: "You may not attempt to hack or breach platform security, scrape or collect user data, use automated systems without permission, create multiple accounts to manipulate reviews, or interfere with platform operations."
        },
        {
          subtitle: "Legal Compliance",
          text: "You must operate with proper business licenses and permits, comply with local tourism and business regulations, maintain required insurance coverage, follow health and safety standards, and adhere to consumer protection laws."
        }
      ]
    },
    {
      icon: AlertTriangle,
      title: "Liability & Disclaimers",
      content: [
        {
          subtitle: "Business Responsibility",
          text: "You are solely responsible for the delivery and quality of your experiences, safety of participants, accuracy of your listings, your business operations, and compliance with all applicable laws. Mingla is a platform provider and not liable for your services."
        },
        {
          subtitle: "Platform Disclaimer",
          text: "Mingla provides the platform 'as is' without warranties of any kind. We do not guarantee uninterrupted service, error-free operation, or specific business results. We are not responsible for disputes between you and explorers."
        },
        {
          subtitle: "Limitation of Liability",
          text: "To the maximum extent permitted by law, Mingla's liability is limited to the amount of fees you paid to us in the 12 months prior to any claim. We are not liable for indirect, incidental, consequential, or punitive damages."
        },
        {
          subtitle: "Indemnification",
          text: "You agree to indemnify and hold Mingla harmless from any claims, damages, losses, or expenses arising from your use of the platform, your business operations, violations of these terms, or infringement of third-party rights."
        },
        {
          subtitle: "Insurance",
          text: "You are required to maintain appropriate business insurance coverage, including general liability insurance. Mingla is not responsible for injuries, damages, or losses that occur during your experiences."
        }
      ]
    },
    {
      icon: Scale,
      title: "Dispute Resolution",
      content: [
        {
          subtitle: "Informal Resolution",
          text: "Before initiating formal proceedings, you agree to contact Mingla to attempt informal resolution of disputes. We will work in good faith to resolve issues through negotiation and discussion."
        },
        {
          subtitle: "Arbitration Agreement",
          text: "Any disputes that cannot be resolved informally will be settled through binding arbitration rather than in court. Arbitration will be conducted by a neutral arbitrator in accordance with applicable arbitration rules."
        },
        {
          subtitle: "Class Action Waiver",
          text: "You agree to resolve disputes on an individual basis only. You waive any right to participate in class actions, collective actions, or representative proceedings against Mingla."
        },
        {
          subtitle: "Governing Law",
          text: "These terms are governed by the laws of the State of California, USA, without regard to conflict of law principles. Any court proceedings must be brought in state or federal courts in San Francisco, California."
        }
      ]
    },
    {
      icon: Clock,
      title: "Account Termination",
      content: [
        {
          subtitle: "Termination by You",
          text: "You may terminate your business account at any time through account settings. Upon termination, you must fulfill all pending bookings, settle outstanding payments, and remove your active listings from the platform."
        },
        {
          subtitle: "Termination by Mingla",
          text: "We may suspend or terminate your account for violations of these terms, fraudulent activity, repeated customer complaints, failure to deliver services, non-payment of fees, or legal violations. We will provide notice when possible."
        },
        {
          subtitle: "Effects of Termination",
          text: "Upon termination, your access to the platform will be revoked, pending bookings may be cancelled, outstanding payouts will be processed according to policy, and your business data may be deleted after a retention period."
        },
        {
          subtitle: "Survival Clauses",
          text: "Certain provisions survive termination, including payment obligations, intellectual property licenses, liability limitations, indemnification obligations, and dispute resolution procedures."
        }
      ]
    }
  ];

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Fixed Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-30 bg-white/70 backdrop-blur-2xl border-b border-gray-200/50 px-4 py-3"
      >
        <div className="flex items-center gap-3">
          {onBack && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={onBack}
              className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-gray-700" />
            </motion.button>
          )}
          <div className="flex items-center gap-2">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl shadow-lg shadow-purple-500/20">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900">Terms & Conditions</h1>
              <p className="text-xs text-gray-500">For Business Users</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Introduction */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, type: "spring" }}
          className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-5 shadow-xl shadow-gray-900/5"
        >
          <h2 className="text-lg font-bold text-gray-900 mb-3">Terms of Service</h2>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            Welcome to Mingla! These Terms and Conditions govern your use of the Mingla platform as a business user. By creating a business account and offering experiences on our platform, you enter into a binding agreement with Mingla Inc.
          </p>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            Please read these terms carefully. They outline your rights, responsibilities, and obligations as a business partner on Mingla. Your continued use of our platform constitutes acceptance of these terms.
          </p>
          <div className="flex items-start gap-2 p-3 bg-purple-50/50 border border-purple-200/50 rounded-2xl">
            <AlertTriangle className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-purple-900">
              <strong>Important:</strong> Last Updated February 2, 2026. By continuing to use Mingla after updates, you accept the revised terms.
            </p>
          </div>
        </motion.div>

        {/* Terms Sections */}
        {sections.map((section, idx) => {
          const Icon = section.icon;
          return (
            <motion.div
              key={section.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-5 shadow-xl shadow-gray-900/5"
            >
              {/* Section Header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-gradient-to-br from-[#eb7825]/10 to-[#d6691f]/10 rounded-2xl border border-[#eb7825]/20">
                  <Icon className="w-5 h-5 text-[#eb7825]" />
                </div>
                <h3 className="text-base font-bold text-gray-900">{section.title}</h3>
              </div>

              {/* Section Content */}
              <div className="space-y-4">
                {section.content.map((item, itemIdx) => (
                  <div key={itemIdx} className="pl-2">
                    <h4 className="text-sm font-semibold text-gray-900 mb-1.5">{item.subtitle}</h4>
                    <p className="text-sm text-gray-600 leading-relaxed">{item.text}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          );
        })}

        {/* Reviews & Ratings */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-5 shadow-xl shadow-gray-900/5"
        >
          <h3 className="text-base font-bold text-gray-900 mb-3">Reviews & Ratings</h3>
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-1.5">Explorer Reviews</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                Explorers may leave reviews and ratings for your experiences. All reviews are published publicly and cannot be removed except in cases of violation of content policies. You may respond to reviews but may not offer incentives for positive reviews or threaten negative reviewers.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-1.5">Review Integrity</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                You may not manipulate reviews by posting fake reviews, asking friends/family to leave reviews, offering discounts for reviews, or threatening legal action against negative reviews. Violations may result in account suspension.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-1.5">Rating Impact</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                Your average rating affects your visibility in search results and eligibility for featured placements. Maintaining high-quality service and positive ratings is essential for platform success.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Data & Privacy */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-5 shadow-xl shadow-gray-900/5"
        >
          <h3 className="text-base font-bold text-gray-900 mb-3">Data & Privacy</h3>
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-1.5">Explorer Data</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                You receive limited explorer contact information necessary to deliver your services. You may not use this data for purposes other than fulfilling bookings, may not sell or share explorer data with third parties, and must protect explorer privacy in accordance with applicable laws.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-1.5">Data Security</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                You must implement reasonable security measures to protect any explorer data you receive, promptly report any data breaches to Mingla and affected explorers, and comply with data protection regulations including GDPR and CCPA where applicable.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-1.5">Privacy Policy</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                Your use of the platform is also governed by our Privacy Policy, which explains how we collect, use, and protect your business data. Please review our Privacy Policy for detailed information.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Platform Updates */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-5 shadow-xl shadow-gray-900/5"
        >
          <h3 className="text-base font-bold text-gray-900 mb-3">Changes to Terms</h3>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            Mingla reserves the right to modify these Terms and Conditions at any time. When we make material changes, we will notify you through:
          </p>
          <div className="space-y-2 text-sm text-gray-700 mb-3">
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-400 mt-2" />
              <span>Email notification to your registered business email</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-400 mt-2" />
              <span>Prominent notice in your business dashboard</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-400 mt-2" />
              <span>Updated 'Last Modified' date at the top of this document</span>
            </div>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            Your continued use of Mingla after changes take effect constitutes acceptance of the revised terms. If you do not agree to changes, you must stop using the platform and may terminate your account.
          </p>
        </motion.div>

        {/* Contact Information */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="bg-gradient-to-br from-[#eb7825]/5 to-[#d6691f]/5 border border-[#eb7825]/20 rounded-3xl p-5 shadow-xl shadow-gray-900/5"
        >
          <h3 className="text-base font-bold text-gray-900 mb-3">Contact & Support</h3>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            For questions about these Terms and Conditions or to report violations, please contact our legal and support teams:
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#eb7825]" />
              <span className="text-gray-700"><strong>Legal Inquiries:</strong> legal@mingla.com</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#eb7825]" />
              <span className="text-gray-700"><strong>Business Support:</strong> support@mingla.com</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#eb7825]" />
              <span className="text-gray-700"><strong>Mailing Address:</strong> Mingla Inc., Legal Department, San Francisco, CA 94102</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#eb7825]" />
              <span className="text-gray-700"><strong>Business Hours:</strong> Monday-Friday, 9:00 AM - 6:00 PM PST</span>
            </div>
          </div>
        </motion.div>

        {/* Severability */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
          className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-5 shadow-xl shadow-gray-900/5"
        >
          <h3 className="text-base font-bold text-gray-900 mb-3">Miscellaneous Provisions</h3>
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-1.5">Severability</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                If any provision of these terms is found to be unenforceable or invalid, that provision will be limited or eliminated to the minimum extent necessary so that the remaining terms remain in full force and effect.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-1.5">Entire Agreement</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                These Terms and Conditions, along with our Privacy Policy, constitute the entire agreement between you and Mingla regarding your use of the platform and supersede all prior agreements.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-1.5">No Waiver</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                Mingla's failure to enforce any right or provision of these terms will not be considered a waiver of those rights. Any waiver must be in writing and signed by an authorized representative.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Acknowledgment */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200/50 rounded-3xl p-5 shadow-xl shadow-gray-900/5"
        >
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-2">Agreement Acknowledgment</h3>
              <p className="text-sm text-gray-700 leading-relaxed">
                By using Mingla as a business, you acknowledge that you have read, understood, and agree to be bound by these Terms and Conditions. You also acknowledge that these terms may be updated periodically and that it is your responsibility to review them regularly.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Bottom Spacer for Navigation */}
        <div className="h-20" />
      </div>
    </div>
  );
}
