Pod::Spec.new do |s|
  s.name           = 'ZerospikeAlarmKit'
  s.version        = '1.0.0'
  s.summary        = 'Schedules zerospike reminders as real AlarmKit alarms on iOS 26+.'
  s.description    = 'Thin AlarmKit bridge: the JS layer owns which reminders opt in and their schedule, AlarmKit owns the alarm UI, sound and Silent/Focus bypass. AlarmKit does not exist before iOS 26, so the framework is weak-linked and every entry point degrades to a safe no-op/false on an older OS.'
  s.author         = 'zerospike'
  s.homepage       = 'https://zerospike.app'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # AlarmKit ships only in the iOS 26 SDK; weak-linking keeps this pod (and the
  # app's real 16.4 deployment target) buildable and installable on older
  # devices, where the framework simply is not loaded at runtime.
  s.weak_frameworks = 'AlarmKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
