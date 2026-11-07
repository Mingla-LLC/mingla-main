# #4271 — Apple's required "How to Tap" merchant education for Tap to Pay on
# iPhone (ProximityReaderDiscovery, iOS 18+). Local Expo module, autolinked from
# mingla-business/modules. ProximityReader is weak-linked so the app still
# launches on iOS versions that predate the framework.
Pod::Spec.new do |s|
  s.name           = 'MinglaTapToPayEducation'
  s.version        = '1.0.0'
  s.summary        = 'Presents Apple Tap to Pay on iPhone How to Tap education.'
  s.description    = 'Wraps ProximityReaderDiscovery content(for: .payment(.howToTap)) for Mingla Host.'
  s.author         = 'Mingla'
  s.homepage       = 'https://usemingla.com'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.swift_version  = '5.9'
  s.dependency 'ExpoModulesCore'
  s.weak_frameworks = 'ProximityReader'
  s.source_files   = '**/*.swift'
end
