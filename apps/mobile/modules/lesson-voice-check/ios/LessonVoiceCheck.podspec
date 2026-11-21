Pod::Spec.new do |s|
  s.name = 'LessonVoiceCheck'
  s.version = '0.1.0'
  s.summary = 'On-device speech checks during Resolingo lessons'
  s.description = s.summary
  s.homepage = 'https://github.com/amanjaiswal03/Resolingo'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'Resolingo'
  s.source = { :git => s.homepage }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = '*.swift'
  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoAudio'
end
