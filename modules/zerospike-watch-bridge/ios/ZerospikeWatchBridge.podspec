Pod::Spec.new do |s|
  s.name           = 'ZerospikeWatchBridge'
  s.version        = '1.0.0'
  s.summary        = 'Pushes LiveData to the paired Apple Watch app via WatchConnectivity.'
  s.description    = 'Thin WatchConnectivity bridge: the phone owns and computes LiveData, this only relays the latest snapshot to the watch application context.'
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
