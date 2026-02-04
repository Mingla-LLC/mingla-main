import React, { useState } from 'react';
import { 
  HelpCircle, Search, MessageCircle, Book, Video, 
  FileText, ExternalLink, ChevronDown, ChevronUp,
  Mail, Phone, Clock, CheckCircle, AlertCircle,
  Lightbulb, DollarSign, Package, Users, Shield, QrCode
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import BusinessPageLayout from './BusinessPageLayout';

interface BusinessSupportProps {
  onOpenLiveChat?: () => void;
  onOpenTicket?: () => void;
}

export default function BusinessSupport({ onOpenLiveChat, onOpenTicket }: BusinessSupportProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [openSections, setOpenSections] = useState<string[]>(['getting-started']);

  const toggleSection = (id: string) => {
    setOpenSections(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const faqSections = [
    {
      id: 'getting-started',
      title: 'Getting Started as a Business',
      icon: Lightbulb,
      color: 'blue',
      questions: [
        {
          q: 'How do I join Mingla as a business?',
          a: 'Businesses can join Mingla by accepting an invitation from a curator or by signing up directly through our platform. Once registered, you can create your business profile, add experience cards, and start attracting customers through our platform.'
        },
        {
          q: 'What are the benefits for businesses on Mingla?',
          a: 'Mingla provides businesses with access to a curated marketplace, increased visibility through curator partnerships, seamless booking and payment processing, customer analytics, and marketing support. You only pay a small platform fee on successful bookings.'
        },
        {
          q: 'How does the platform fee work?',
          a: 'Mingla charges a 5% platform fee on each booking. This fee covers payment processing, customer support, platform maintenance, and marketing. Fees are automatically deducted before payouts, so you receive the net amount directly to your account.'
        }
      ]
    },
    {
      id: 'creating-experiences',
      title: 'Creating & Managing Experiences',
      icon: Package,
      color: 'purple',
      questions: [
        {
          q: 'How do I create an experience card?',
          a: 'Click "Create Experience" in your dashboard, fill in all required information including title, description, category, pricing, packages, availability, and policies. Add high-quality images and submit for review. Our QA team will approve within 24-48 hours.'
        },
        {
          q: 'Can curators create experiences for me?',
          a: 'Yes! One of Mingla\'s unique features is curator partnerships. When you collaborate with a curator, they can create and manage experience cards on your behalf. They earn a commission (typically 10-20%) on bookings made through their curated experiences.'
        },
        {
          q: 'What makes a successful experience listing?',
          a: 'Successful listings have compelling titles, detailed descriptions highlighting unique features, professional photos, competitive pricing, clear availability, comprehensive package options, and transparent policies. Include all necessary details customers need to make a booking decision.'
        },
        {
          q: 'How do I update pricing or availability?',
          a: 'You can update pricing and availability anytime in the card editor. Changes to availability take effect immediately. Pricing changes for new bookings are instant, but existing bookings honor the original price.'
        }
      ]
    },
    {
      id: 'curator-partnerships',
      title: 'Working with Curators',
      icon: Users,
      color: 'orange',
      questions: [
        {
          q: 'Why should I work with curators?',
          a: 'Curators bring professional curation expertise, create high-quality experience cards, provide marketing support, and have their own follower base. They\'re invested in your success since they earn commission on bookings, creating a win-win partnership.'
        },
        {
          q: 'How do I find and invite curators?',
          a: 'Browse our curator marketplace to find curators in your category or region. Send collaboration invitations directly through the platform. You can also be discovered by curators browsing for business partners.'
        },
        {
          q: 'What commission rate should I offer?',
          a: 'Standard commission rates range from 10-20% of the net booking amount (after platform fees). Higher rates may attract more experienced curators. The rate is negotiable and should reflect the value the curator brings to your business.'
        },
        {
          q: 'Can I work with multiple curators?',
          a: 'Absolutely! Many businesses work with several curators, each potentially focusing on different experience types or target audiences. Each collaboration can have its own commission rate and terms.'
        }
      ]
    },
    {
      id: 'bookings-redemptions',
      title: 'Bookings & Redemptions',
      icon: QrCode,
      color: 'green',
      questions: [
        {
          q: 'How do customers book experiences?',
          a: 'Customers browse experience cards, select a package, choose their preferred date/time, and complete payment through our secure checkout. You\'ll receive instant notifications for new bookings and can track them in the Sales page.'
        },
        {
          q: 'How does the QR code validation work?',
          a: 'Each booking generates a unique QR code. When customers arrive, use the Quick Validate feature to scan their code. The system verifies the booking and marks it as redeemed. Each code works only once for security.'
        },
        {
          q: 'What if a customer needs to reschedule?',
          a: 'Your cancellation and modification policies (set in each experience card) govern rescheduling. Customers can request changes through the platform. You can approve or deny based on your policies and availability.'
        },
        {
          q: 'How do I handle no-shows?',
          a: 'If a customer doesn\'t show up, you can mark the booking as a no-show in your Sales dashboard. Your cancellation policy determines if the booking is still charged. No-shows don\'t affect your revenue if prepaid.'
        }
      ]
    },
    {
      id: 'payments-payouts',
      title: 'Payments & Payouts',
      icon: DollarSign,
      color: 'emerald',
      questions: [
        {
          q: 'When do I receive payments?',
          a: 'Payouts are processed monthly on the 1st for all redeemed bookings from the previous month. Funds arrive in your account within 2-5 business days. You can track pending and completed payouts in the Payouts page.'
        },
        {
          q: 'How is my payout calculated?',
          a: 'Your payout is: (Booking Amount) - (Platform Fee 5%) - (Curator Commission if applicable). For example, on a $100 booking with a 15% curator commission: $100 - $5 (platform) - $14.25 (curator) = $80.75 to you.'
        },
        {
          q: 'What payment methods do you support?',
          a: 'We support bank transfers (ACH/SEPA), PayPal, and Stripe payouts. Set up your preferred method in Settings > Payout Settings. International businesses may have additional options based on country.'
        },
        {
          q: 'Can I see a breakdown of fees?',
          a: 'Yes! The Earnings and Sales pages show detailed breakdowns including gross revenue, platform fees, curator commissions, and your net revenue. You can export these reports for accounting purposes.'
        }
      ]
    },
    {
      id: 'analytics-insights',
      title: 'Analytics & Performance',
      icon: FileText,
      color: 'indigo',
      questions: [
        {
          q: 'What analytics are available?',
          a: 'Track views, likes, saves, conversion rates, bookings, revenue, popular experiences, peak booking times, customer demographics, and more. The Analytics page provides comprehensive insights to optimize your offerings.'
        },
        {
          q: 'How can I improve my conversion rate?',
          a: 'Optimize with professional photos, detailed descriptions, competitive pricing, flexible availability, and clear policies. Review your analytics to see which experiences perform best and apply those learnings to others.'
        },
        {
          q: 'Can I see which curator drives the most bookings?',
          a: 'Yes! The Earnings and Analytics pages break down performance by curator, showing which partnerships are most successful. Use this data to strengthen those relationships or adjust commission rates.'
        }
      ]
    }
  ];

  const filteredSections = searchQuery
    ? faqSections.map(section => ({
        ...section,
        questions: section.questions.filter(
          q =>
            q.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
            q.a.toLowerCase().includes(searchQuery.toLowerCase())
        )
      })).filter(section => section.questions.length > 0)
    : faqSections;

  const contactOptions = [
    {
      icon: MessageCircle,
      title: 'Live Chat',
      description: 'Get instant help from our support team',
      action: onOpenLiveChat,
      actionLabel: 'Start Chat',
      color: 'blue'
    },
    {
      icon: Mail,
      title: 'Submit a Ticket',
      description: 'Send us a detailed inquiry',
      action: onOpenTicket,
      actionLabel: 'Create Ticket',
      color: 'purple'
    },
    {
      icon: Phone,
      title: 'Call Us',
      description: 'Mon-Fri, 9am-6pm EST',
      action: () => window.location.href = 'tel:1-800-MINGLA',
      actionLabel: '1-800-MINGLA',
      color: 'green'
    }
  ];

  const quickLinks = [
    {
      icon: Book,
      title: 'Business Guide',
      description: 'Complete guide for business owners',
      href: '#',
      color: 'blue'
    },
    {
      icon: Video,
      title: 'Video Tutorials',
      description: 'Watch step-by-step walkthroughs',
      href: '#',
      color: 'red'
    },
    {
      icon: FileText,
      title: 'Best Practices',
      description: 'Tips to maximize your success',
      href: '#',
      color: 'orange'
    },
    {
      icon: Shield,
      title: 'Terms & Policies',
      description: 'Review our terms of service',
      href: '#',
      color: 'gray'
    }
  ];

  const getColorClasses = (color: string) => {
    const colors: Record<string, string> = {
      blue: 'bg-blue-50 text-blue-600',
      purple: 'bg-purple-50 text-purple-600',
      orange: 'bg-orange-50 text-[#eb7825]',
      green: 'bg-green-50 text-green-600',
      emerald: 'bg-emerald-50 text-emerald-600',
      indigo: 'bg-indigo-50 text-indigo-600',
      red: 'bg-red-50 text-red-600',
      gray: 'bg-gray-50 text-gray-600',
      pink: 'bg-pink-50 text-pink-600',
    };
    return colors[color] || colors.blue;
  };

  return (
    <BusinessPageLayout
      title="Help & Support"
      description="Find answers and get help with your business account"
    >
      <div className="space-y-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <Input
            type="text"
            placeholder="Search for help..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-12 h-12"
          />
        </div>

        {/* Contact Options */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {contactOptions.map((option) => {
            const Icon = option.icon;
            return null;
          })}
        </div>

        {/* Quick Links */}
        <Card className="p-6 border border-gray-200">
          <h2 className="text-[#111827] mb-4">Quick Links</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {quickLinks.map((link) => {
              const Icon = link.icon;
              return (
                <a
                  key={link.title}
                  href={link.href}
                  className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 hover:border-[#eb7825] hover:bg-gray-50 transition-all group"
                >
                  <div className={`p-2 ${getColorClasses(link.color)} rounded-lg flex-shrink-0`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[#111827] text-sm mb-0.5 group-hover:text-[#eb7825] transition-colors">
                      {link.title}
                    </p>
                    <p className="text-[#6B7280] text-xs">{link.description}</p>
                  </div>
                  <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-[#eb7825] flex-shrink-0" />
                </a>
              );
            })}
          </div>
        </Card>

        {/* FAQ Sections */}
        <div className="space-y-4">
          <h2 className="text-[#111827]">Frequently Asked Questions</h2>
          
          {filteredSections.length === 0 ? (
            <Card className="p-12 text-center border border-gray-200">
              <HelpCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-[#111827] mb-2">No results found</h3>
              <p className="text-[#6B7280]">
                Try different keywords or browse all categories
              </p>
            </Card>
          ) : (
            filteredSections.map((section) => {
              const Icon = section.icon;
              const isOpen = openSections.includes(section.id);
              
              return (
                <Card key={section.id} className="border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => toggleSection(section.id)}
                    className="w-full p-4 sm:p-6 flex items-center justify-between gap-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className={`p-2 sm:p-3 ${getColorClasses(section.color)} rounded-xl flex-shrink-0`}>
                        <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
                      </div>
                      <div className="text-left">
                        <h3 className="text-[#111827]">{section.title}</h3>
                        <p className="text-[#6B7280] text-sm mt-1">
                          {section.questions.length} question{section.questions.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    {isOpen ? (
                      <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    )}
                  </button>
                  
                  {isOpen && (
                    <div className="border-t border-gray-200 bg-gray-50">
                      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
                        {section.questions.map((q, index) => (
                          <div key={index} className="space-y-2">
                            <div className="flex items-start gap-2">
                              <HelpCircle className="w-5 h-5 text-[#eb7825] flex-shrink-0 mt-0.5" />
                              <p className="text-[#111827]">{q.q}</p>
                            </div>
                            <p className="text-[#6B7280] text-sm pl-7 leading-relaxed">{q.a}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>

        {/* Still Need Help */}
        <Card className="p-6 sm:p-8 border-2 border-[#eb7825]/20 bg-gradient-to-br from-orange-50 to-amber-50 text-center">
          <HelpCircle className="w-12 h-12 sm:w-16 sm:h-16 text-[#eb7825] mx-auto mb-4" />
          <h2 className="text-[#111827] mb-2">Still need help?</h2>
          <p className="text-[#6B7280] mb-6 max-w-md mx-auto">
            Our support team is here to help you succeed on Mingla
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              onClick={onOpenLiveChat}
              className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
            >
              <MessageCircle className="w-4 h-4 mr-2" />
              Start Live Chat
            </Button>
            <Button
              onClick={onOpenTicket}
              variant="outline"
              className="border-[#eb7825] text-[#eb7825] hover:bg-[#eb7825] hover:text-white"
            >
              <Mail className="w-4 h-4 mr-2" />
              Submit Ticket
            </Button>
          </div>
        </Card>
      </div>
    </BusinessPageLayout>
  );
}