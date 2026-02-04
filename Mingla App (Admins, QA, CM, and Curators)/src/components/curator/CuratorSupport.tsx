import React, { useState } from 'react';
import { 
  HelpCircle, Search, MessageCircle, Book, Video, 
  FileText, ExternalLink, ChevronDown, ChevronUp,
  Mail, Phone, Clock, CheckCircle, AlertCircle,
  Lightbulb, DollarSign, Building2, Users, Shield
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import CuratorPageLayout from './CuratorPageLayout';

interface CuratorSupportProps {
  onOpenLiveChat?: () => void;
  onOpenTicket?: () => void;
}

export default function CuratorSupport({ onOpenLiveChat, onOpenTicket }: CuratorSupportProps) {
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
      title: 'Getting Started as a Curator',
      icon: Lightbulb,
      color: 'blue',
      questions: [
        {
          q: 'How do I become a curator on Mingla?',
          a: 'Curators are invited to join Mingla or can apply through our application process. As a curator, you\'ll create and manage unique experience cards for businesses you collaborate with. You\'ll earn commission on every booking made through your curated experiences.'
        },
        {
          q: 'What are the benefits of being a curator?',
          a: 'Curators earn a commission rate (typically 10-20%) on all bookings, get early access to new features, can manage multiple business partnerships, and build their personal brand as experience creators. You also get priority support and analytics to track your performance.'
        },
        {
          q: 'How do I create my first experience card?',
          a: 'Click the "Create Card" button in your dashboard, fill in the experience details including title, description, category, pricing, and availability. Add high-quality images and submit for review. Our QA team will review and approve within 24-48 hours.'
        }
      ]
    },
    {
      id: 'creating-cards',
      title: 'Creating & Managing Experience Cards',
      icon: FileText,
      color: 'purple',
      questions: [
        {
          q: 'What makes a great experience card?',
          a: 'Great cards have clear, compelling titles, detailed descriptions that highlight unique features, high-quality images, accurate pricing and availability, and include all necessary details like duration, location, what\'s included, and any requirements or restrictions.'
        },
        {
          q: 'Can I edit cards after they\'re published?',
          a: 'Yes! You can edit your cards at any time. Minor edits (pricing, availability) take effect immediately. Major changes (title, description, images) may require re-approval from our QA team to maintain quality standards.'
        },
        {
          q: 'How do card statuses work?',
          a: 'Cards have 4 statuses: Draft (work in progress), In Review (submitted to QA team), Live (approved and visible to users), and Returned (needs revisions). You\'ll receive notifications when status changes and can view feedback in the card editor.'
        },
        {
          q: 'What are the image requirements?',
          a: 'Images should be high-resolution (at least 1200x800px), properly lit, showcase the experience authentically, and be your own photos or properly licensed. Avoid watermarks, excessive filters, or misleading imagery. We recommend 3-5 images per card.'
        }
      ]
    },
    {
      id: 'business-collaboration',
      title: 'Business Collaborations',
      icon: Building2,
      color: 'orange',
      questions: [
        {
          q: 'How do I add a business to my portfolio?',
          a: 'In the "My Businesses" section, click "Add Business" and either send an invitation to an existing business on Mingla or create a business profile if they\'re new to the platform. Once they accept, you can create experiences on their behalf.'
        },
        {
          q: 'Can I work with multiple businesses?',
          a: 'Absolutely! There\'s no limit to the number of businesses you can collaborate with. Each collaboration can have its own commission rate and terms. Manage all your partnerships from the My Businesses page.'
        },
        {
          q: 'How do commission negotiations work?',
          a: 'When setting up a collaboration, you and the business agree on a commission rate. This can be negotiated through our messaging system. Standard rates range from 10-20%. Once both parties agree, the rate is locked in and applies to all experiences you create for that business.'
        },
        {
          q: 'What if a business wants to end our collaboration?',
          a: 'Either party can end a collaboration at any time. Existing bookings will honor the original commission terms. Any live experiences you created will remain active unless the business chooses to unpublish them. You\'ll receive a 30-day notice for pending payouts.'
        }
      ]
    },
    {
      id: 'earnings-payouts',
      title: 'Earnings & Payouts',
      icon: DollarSign,
      color: 'green',
      questions: [
        {
          q: 'When do I get paid?',
          a: 'Payouts are processed monthly on the 1st of each month for all bookings completed in the previous month. Funds typically arrive in your account within 2-5 business days depending on your payout method (bank transfer, PayPal, etc.).'
        },
        {
          q: 'How is my commission calculated?',
          a: 'Your commission is calculated on the net booking amount (after Mingla\'s platform fee). For example, if a booking is $100, Mingla takes 5%, leaving $95. If your commission rate is 15%, you earn $14.25 ($95 × 15%).'
        },
        {
          q: 'Can I track my earnings in real-time?',
          a: 'Yes! The Earnings page shows your total earned, pending payouts, this month\'s earnings, transaction history, and breakdowns by business. You can export reports for your records and tax purposes.'
        },
        {
          q: 'What payment methods are supported?',
          a: 'We support bank transfers (ACH/SEPA), PayPal, and Stripe payouts. Set up your preferred payment method in Settings > Payout Settings. International curators may have additional options based on their country.'
        }
      ]
    },
    {
      id: 'messaging-communication',
      title: 'Messaging & Communication',
      icon: MessageCircle,
      color: 'indigo',
      questions: [
        {
          q: 'How do I communicate with business partners?',
          a: 'Use the Messages page to chat with all your business partners in one place. Each business has a dedicated conversation thread. You can discuss collaboration terms, share ideas for new experiences, and coordinate on bookings.'
        },
        {
          q: 'Can customers message me directly?',
          a: 'Customers can send inquiries about experiences, but these go through the business you created the experience for. The business can then loop you into conversations if needed. This protects your privacy while maintaining great customer service.'
        },
        {
          q: 'What should I do if a business isn\'t responding?',
          a: 'Try reaching out through email if they provided contact information. If there\'s an urgent issue affecting live experiences or bookings, contact our support team and we\'ll help facilitate communication or mediate if necessary.'
        }
      ]
    },
    {
      id: 'analytics-performance',
      title: 'Analytics & Performance',
      icon: Users,
      color: 'pink',
      questions: [
        {
          q: 'What metrics should I focus on?',
          a: 'Key metrics include: Views (visibility), Engagement Rate (likes, saves), Conversion Rate (bookings), and Average Time on Card (interest level). Focus on improving engagement and conversion to maximize earnings.'
        },
        {
          q: 'How can I improve my card performance?',
          a: 'Use high-quality images, write detailed descriptions, price competitively, offer flexible availability, respond quickly to inquiries, and regularly update cards with seasonal offerings or special promotions. Check Analytics for insights on what\'s working.'
        },
        {
          q: 'Can I see which cards perform best?',
          a: 'Yes! The Analytics page highlights your top-performing cards and shows trends over time. You can filter by timeframe to see weekly, monthly, or all-time performance. Use these insights to create more of what works.'
        }
      ]
    },
    {
      id: 'policies-guidelines',
      title: 'Policies & Guidelines',
      icon: Shield,
      color: 'red',
      questions: [
        {
          q: 'What content is not allowed on Mingla?',
          a: 'Prohibited content includes: illegal activities, adult content, discriminatory experiences, misleading information, copyright violations, and anything that violates our community guidelines. All cards go through QA review to ensure compliance.'
        },
        {
          q: 'What happens if my card violates policies?',
          a: 'Your card will be returned with feedback explaining the issue. You can edit and resubmit. Repeated violations may result in account warnings or suspension. We\'re here to help you create compliant, high-quality experiences.'
        },
        {
          q: 'How do cancellations affect my commission?',
          a: 'If a customer cancels before the experience, you don\'t earn commission on that booking. If a business cancels, you still earn commission as agreed. Cancellation policies are set by the business and displayed on each card.'
        },
        {
          q: 'Am I responsible for customer issues?',
          a: 'No. The business is primarily responsible for delivering the experience and handling customer service. However, maintaining the quality and accuracy of your cards helps prevent issues. If problems arise from inaccurate card information, it may affect your curator rating.'
        }
      ]
    }
  ];

  const filteredSections = faqSections.map(section => ({
    ...section,
    questions: section.questions.filter(
      q =>
        q.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
        q.a.toLowerCase().includes(searchQuery.toLowerCase())
    )
  })).filter(section => section.questions.length > 0);

  const contactOptions = [
    {
      icon: MessageCircle,
      title: 'Live Chat',
      description: 'Get instant help from our team',
      availability: 'Mon-Fri, 9am-6pm PST',
      action: 'Start Chat',
      onClick: onOpenLiveChat
    },
    {
      icon: Mail,
      title: 'Email Support',
      description: 'curator-support@mingla.com',
      availability: 'Response within 24 hours',
      action: 'Send Email',
      onClick: () => window.location.href = 'mailto:curator-support@mingla.com'
    },
    {
      icon: FileText,
      title: 'Submit a Ticket',
      description: 'Detailed issues and requests',
      availability: 'Tracked and prioritized',
      action: 'Create Ticket',
      onClick: onOpenTicket
    }
  ];

  const resources = [
    {
      title: 'Curator Handbook',
      description: 'Complete guide to being a successful curator',
      icon: Book,
      type: 'PDF',
      color: 'blue'
    },
    {
      title: 'Video Tutorials',
      description: 'Step-by-step video guides',
      icon: Video,
      type: 'Video',
      color: 'red'
    },
    {
      title: 'Best Practices',
      description: 'Tips from top-performing curators',
      icon: Lightbulb,
      type: 'Article',
      color: 'yellow'
    },
    {
      title: 'API Documentation',
      description: 'For advanced integrations',
      icon: FileText,
      type: 'Docs',
      color: 'purple'
    }
  ];

  return (
    <CuratorPageLayout
      title="Help & Support"
      description="Get help with your curator account and find answers to common questions"
    >
      <div className="space-y-4">
        {/* Quick Contact Options */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {contactOptions.map((option, index) => {
            const Icon = option.icon;
            return (
              <Card key={index} className="p-6 border border-gray-200 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-gradient-to-br from-[#eb7825]/10 to-[#d6691f]/10 rounded-xl">
                    <Icon className="w-6 h-6 text-[#eb7825]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-[#111827] mb-1">{option.title}</h3>
                    <p className="text-[#6B7280] text-sm mb-2">{option.description}</p>
                    <div className="flex items-center gap-1 text-xs text-[#6B7280] mb-3">
                      <Clock className="w-3 h-3" />
                      <span>{option.availability}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={option.onClick}
                    >
                      {option.action}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Search */}
        <Card className="p-6 border border-gray-200">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <Input
              placeholder="Search for help articles and FAQs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12 h-12 text-base"
            />
          </div>
        </Card>

        {/* FAQ Sections */}
        <Collapsible defaultOpen={true}>
          <Card className="border border-gray-200 overflow-hidden">
            <CollapsibleTrigger className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition-colors group">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-[#eb7825]/10">
                  <HelpCircle className="w-6 h-6 text-[#eb7825]" />
                </div>
                <div className="text-left">
                  <h2 className="text-[#111827]">Frequently Asked Questions</h2>
                  <p className="text-[#6B7280] text-sm">Find answers to common questions</p>
                </div>
              </div>
              <ChevronDown className="w-5 h-5 text-gray-400 group-data-[state=open]:rotate-180 transition-transform" />
            </CollapsibleTrigger>
            
            <CollapsibleContent>
              <div className="border-t border-gray-200 p-6 space-y-4 bg-gray-50">
                {filteredSections.map(section => {
                  const Icon = section.icon;
                  const isOpen = openSections.includes(section.id);
                  const colorClasses = {
                    blue: 'bg-blue-50 text-blue-600',
                    purple: 'bg-purple-50 text-purple-600',
                    orange: 'bg-[#eb7825]/10 text-[#eb7825]',
                    green: 'bg-green-50 text-green-600',
                    indigo: 'bg-indigo-50 text-indigo-600',
                    pink: 'bg-pink-50 text-pink-600',
                    red: 'bg-red-50 text-red-600',
                    yellow: 'bg-yellow-50 text-yellow-600'
                  };

                  return (
                    <Card key={section.id} className="border border-gray-200 overflow-hidden bg-white">
                      <button
                        onClick={() => toggleSection(section.id)}
                        className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className={`p-3 rounded-xl ${colorClasses[section.color as keyof typeof colorClasses]}`}>
                            <Icon className="w-6 h-6" />
                          </div>
                          <div className="text-left">
                            <h3 className="text-[#111827]">{section.title}</h3>
                            <p className="text-[#6B7280] text-sm">{section.questions.length} articles</p>
                          </div>
                        </div>
                        {isOpen ? (
                          <ChevronUp className="w-5 h-5 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                        )}
                      </button>

                      {isOpen && (
                        <div className="border-t border-gray-200 bg-gray-50">
                          {section.questions.map((qa, qIndex) => (
                            <Collapsible key={qIndex}>
                              <div className="border-b border-gray-200 last:border-b-0">
                                <CollapsibleTrigger className="w-full p-4 px-6 text-left hover:bg-white transition-colors flex items-center justify-between group">
                                  <div className="flex items-start gap-3 flex-1">
                                    <HelpCircle className="w-5 h-5 text-[#eb7825] mt-0.5 flex-shrink-0" />
                                    <span className="text-[#111827] group-hover:text-[#eb7825] transition-colors">
                                      {qa.q}
                                    </span>
                                  </div>
                                  <ChevronDown className="w-4 h-4 text-gray-400 group-data-[state=open]:rotate-180 transition-transform flex-shrink-0 ml-4" />
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  <div className="px-6 pb-4 pl-14">
                                    <p className="text-[#6B7280] leading-relaxed">{qa.a}</p>
                                  </div>
                                </CollapsibleContent>
                              </div>
                            </Collapsible>
                          ))}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Resources */}


        {/* Still Need Help */}

      </div>
    </CuratorPageLayout>
  );
}
