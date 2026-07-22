Pod::Spec.new do |s|
  s.name           = 'ZerospikeLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Starts and ends the zerospike post-meal Live Activity.'
  s.description    = 'Thin ActivityKit bridge: the JS layer owns when the timer runs, ActivityKit owns how it is drawn.'
  s.author         = 'zerospike'
  s.homepage       = 'https://zerospike.app'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
