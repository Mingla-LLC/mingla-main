import React from 'react';
import { motion } from 'motion/react';
import { Shield, ChevronLeft, Lock, Eye, Database, Users, FileText, AlertCircle } from 'lucide-react';

interface BusinessPrivacyPolicyProps {
  onBack?: () => void;
}

export default function BusinessPrivacyPolicy({ onBack }: BusinessPrivacyPolicyProps) {
  const sections = [
    {
      icon: Database,
      title: "Information We Collect",
      content: [
        {
          subtitle: "Business Account Information",
          text: "When you register as a business on Mingla, we collect your business name, category, description, contact information (email, phone), business address, and payment details for processing transactions."
        },
        {
          subtitle: "Financial Data",
          text: "We collect and process payment information through our secure payment partner Stripe. This includes bank account details for payouts, transaction history, and earnings data."
        },
        {
          subtitle: "Experience Data",
          text: "Information about the experiences you create and manage, including descriptions, pricing, availability, photos, and booking details."
        },
        {
          subtitle: "Usage Information",
          text: "We collect data about how you use the Mingla platform, including login times, pages viewed, features used, and interactions with explorers and curators."
        }
      ]
    },
    {
      icon: Lock,
      title: "How We Use Your Information",
      content: [
        {
          subtitle: "Platform Operations",
          text: "To operate and maintain your business account, process bookings, manage payments and payouts, and provide customer support."
        },
        {
          subtitle: "Communication",
          text: "To send you important notifications about bookings, payments, policy updates, and platform features. You can control notification preferences in your settings."
        },
        {
          subtitle: "Analytics & Improvements",
          text: "To analyze platform usage, improve our services, develop new features, and provide you with business insights and performance metrics."
        },
        {
          subtitle: "Marketing",
          text: "With your consent, to send you marketing communications about new features, tips for growing your business, and promotional opportunities."
        }
      ]
    },
    {
      icon: Users,
      title: "Information Sharing",
      content: [
        {
          subtitle: "With Explorers",
          text: "Your business profile, experience details, and contact information are visible to explorers who book your experiences. Reviews and ratings are publicly displayed."
        },
        {
          subtitle: "With Curators",
          text: "Based on your privacy settings, you can choose to share your business profile and analytics data with curator partners who may feature your experiences."
        },
        {
          subtitle: "Service Providers",
          text: "We share necessary information with trusted service providers including Stripe for payments, cloud hosting providers, analytics services, and customer support tools."
        },
        {
          subtitle: "Legal Requirements",
          text: "We may disclose information when required by law, to respond to legal requests, protect our rights, prevent fraud, or ensure platform safety."
        }
      ]
    },
    {
      icon: Shield,
      title: "Data Security",
      content: [
        {
          subtitle: "Encryption",
          text: "All data transmitted between your device and our servers is encrypted using industry-standard SSL/TLS protocols. Sensitive data is encrypted at rest."
        },
        {
          subtitle: "Access Controls",
          text: "We implement strict access controls to ensure only authorized personnel can access business data, and only when necessary for platform operations."
        },
        {
          subtitle: "Payment Security",
          text: "Payment data is processed through Stripe, a PCI DSS compliant payment processor. We never store complete payment card information on our servers."
        },
        {
          subtitle: "Security Monitoring",
          text: "We continuously monitor our systems for security threats and vulnerabilities, and promptly address any identified issues."
        }
      ]
    },
    {
      icon: Eye,
      title: "Your Privacy Rights",
      content: [
        {
          subtitle: "Access & Correction",
          text: "You can access and update your business information at any time through your account settings. Contact us if you need assistance."
        },
        {
          subtitle: "Data Portability",
          text: "You have the right to request a copy of your data in a machine-readable format. Use the 'Download My Data' feature in settings."
        },
        {
          subtitle: "Deletion",
          text: "You can request deletion of your business account and associated data. Note that we may retain certain information for legal compliance and record-keeping."
        },
        {
          subtitle: "Marketing Opt-Out",
          text: "You can opt out of marketing communications at any time through your notification preferences or by clicking unsubscribe in emails."
        }
      ]
    },
    {
      icon: FileText,
      title: "Data Retention",
      content: [
        {
          subtitle: "Active Accounts",
          text: "We retain your business data for as long as your account is active and for a reasonable period thereafter to comply with legal obligations."
        },
        {
          subtitle: "Transaction Records",
          text: "Financial transaction data is retained for 7 years to comply with tax and accounting regulations."
        },
        {
          subtitle: "Deleted Accounts",
          text: "When you delete your account, most personal data is removed within 30 days. Some data may be retained for legal compliance, fraud prevention, or resolving disputes."
        }
      ]
    },
    {
      icon: AlertCircle,
      title: "Cookies & Tracking",
      content: [
        {
          subtitle: "Essential Cookies",
          text: "We use cookies necessary for platform functionality, including authentication, session management, and security features."
        },
        {
          subtitle: "Analytics Cookies",
          text: "We use analytics tools to understand how businesses use our platform. This helps us improve features and user experience."
        },
        {
          subtitle: "Your Choices",
          text: "You can control cookie preferences through your browser settings. Note that disabling certain cookies may affect platform functionality."
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
            <div className="p-2 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl shadow-lg shadow-green-500/20">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900">Privacy Policy</h1>
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
          <h2 className="text-lg font-bold text-gray-900 mb-3">Welcome to Mingla</h2>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            At Mingla, we're committed to protecting your privacy and being transparent about how we collect, use, and protect your business information. This Privacy Policy explains how we handle data for business users on our platform.
          </p>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            By using Mingla as a business, you agree to the collection and use of information in accordance with this policy. We respect your privacy and work diligently to safeguard your data.
          </p>
          <div className="flex items-start gap-2 p-3 bg-blue-50/50 border border-blue-200/50 rounded-2xl">
            <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-blue-900">
              <strong>Last Updated:</strong> February 2, 2026. We may update this policy periodically. We'll notify you of significant changes.
            </p>
          </div>
        </motion.div>

        {/* Policy Sections */}
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

        {/* Contact Information */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-gradient-to-br from-[#eb7825]/5 to-[#d6691f]/5 border border-[#eb7825]/20 rounded-3xl p-5 shadow-xl shadow-gray-900/5"
        >
          <h3 className="text-base font-bold text-gray-900 mb-3">Contact Us</h3>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            If you have questions about this Privacy Policy or how we handle your data, please contact our privacy team:
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#eb7825]" />
              <span className="text-gray-700"><strong>Email:</strong> privacy@mingla.com</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#eb7825]" />
              <span className="text-gray-700"><strong>Address:</strong> Mingla Inc., Privacy Team, San Francisco, CA</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#eb7825]" />
              <span className="text-gray-700"><strong>Response Time:</strong> We respond to privacy inquiries within 30 days</span>
            </div>
          </div>
        </motion.div>

        {/* GDPR & CCPA Compliance */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-5 shadow-xl shadow-gray-900/5"
        >
          <h3 className="text-base font-bold text-gray-900 mb-3">International Compliance</h3>
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-1.5">GDPR (European Users)</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                For businesses operating in the EU, we comply with the General Data Protection Regulation. You have rights to access, rectification, erasure, restriction, portability, and objection regarding your data.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-1.5">CCPA (California Users)</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                California businesses have the right to know what personal information we collect, delete personal information, opt-out of sale of personal information, and non-discrimination for exercising privacy rights.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Children's Privacy */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-5 shadow-xl shadow-gray-900/5"
        >
          <h3 className="text-base font-bold text-gray-900 mb-3">Children's Privacy</h3>
          <p className="text-sm text-gray-700 leading-relaxed">
            Mingla is intended for businesses and individuals 18 years or older. We do not knowingly collect personal information from children under 18. If you believe we have inadvertently collected such information, please contact us immediately.
          </p>
        </motion.div>

        {/* Changes to Policy */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-5 shadow-xl shadow-gray-900/5"
        >
          <h3 className="text-base font-bold text-gray-900 mb-3">Changes to This Policy</h3>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. When we make significant changes, we will:
          </p>
          <div className="space-y-2 text-sm text-gray-700">
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-400 mt-2" />
              <span>Notify you via email at your registered business email address</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-400 mt-2" />
              <span>Display a prominent notice in your business dashboard</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-400 mt-2" />
              <span>Update the "Last Updated" date at the top of this policy</span>
            </div>
          </div>
        </motion.div>

        {/* Acknowledgment */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200/50 rounded-3xl p-5 shadow-xl shadow-gray-900/5"
        >
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-2">Your Privacy Matters</h3>
              <p className="text-sm text-gray-700 leading-relaxed">
                By continuing to use Mingla, you acknowledge that you have read and understood this Privacy Policy and agree to its terms. We're committed to maintaining your trust and protecting your business data.
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
