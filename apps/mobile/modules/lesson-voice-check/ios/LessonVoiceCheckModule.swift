import Accelerate
import AVFoundation
import ExpoAudio
import ExpoModulesCore
import Speech

struct AnswerWindow: Record {
  @Field var id: String = ""
  @Field var startSeconds: Double = 0
  @Field var endSeconds: Double = 0
  @Field var feedbackAtSeconds: Double = 0
  @Field var responseSeconds: Double = 0
  @Field var extraSeconds: Double = 0
  @Field var expected: String = ""
}

struct FeedbackClips: Record {
  @Field var recalled: [String] = []
  @Field var compare: [String] = []
  @Field var unclear: [String] = []
}

public final class LessonVoiceCheckModule: Module {
  private let checks = LessonVoiceCheck()

  public func definition() -> ModuleDefinition {
    Name("LessonVoiceCheck")
    Events("onAnswer", "onWindow", "onFeedback", "onStopped")

    Function("supports") { (language: String) -> Bool in
      LessonVoiceCheck.legacyRecognizer(language: language) != nil
    }

    AsyncFunction("prepare") { (language: String, promise: Promise) in
      Task { @MainActor in
        promise.resolve(await self.checks.prepare(language: language))
      }
    }.runOnQueue(.main)

    AsyncFunction("requestSpeechPermission") { (promise: Promise) in
      SFSpeechRecognizer.requestAuthorization { status in
        promise.resolve(status == .authorized)
      }
    }.runOnQueue(.main)

    AsyncFunction("start") { (player: AudioPlayer, sessionId: String, language: String, windows: [AnswerWindow]) in
      try self.checks.start(player: player.ref, sessionId: sessionId, language: language, windows: windows) { [weak self] id, verdict, heard in
        self?.sendEvent("onAnswer", ["sessionId": sessionId, "id": id, "verdict": verdict, "heard": heard])
      } onWindow: { [weak self] id, state in
        self?.sendEvent("onWindow", [
          "sessionId": sessionId, "id": id, "recording": state == .recording, "state": state.rawValue,
        ])
      } onFeedback: { [weak self] playing in
        self?.sendEvent("onFeedback", ["sessionId": sessionId, "playing": playing])
      } onStopped: { [weak self] in
        self?.sendEvent("onStopped", ["sessionId": sessionId])
      }
    }.runOnQueue(.main)

    AsyncFunction("installFeedback") { (sessionId: String, clips: FeedbackClips) in
      self.checks.installFeedback(sessionId: sessionId, clips: clips)
    }.runOnQueue(.main)

    AsyncFunction("cancelFeedback") { (sessionId: String, resume: Bool) in
      self.checks.cancelFeedback(sessionId: sessionId, resume: resume)
    }.runOnQueue(.main)

    AsyncFunction("stop") { (sessionId: String) in
      self.checks.stop(sessionId: sessionId)
    }.runOnQueue(.main)

    OnDestroy { [checks] in
      DispatchQueue.main.async { checks.stop() }
    }
  }
}

private enum VoiceCheckError: Error {
  case unavailable
}

private enum AnswerWindowState: String {
  case recording, cancelled, skipped, checking, unclear
}

private final class AnswerAudioLevel {
  private static let minimumVoiceSeconds = 0.045
  private let lock = NSLock()
  private var totalSeconds = 0.0
  private var audibleSeconds = 0.0

  func measure(_ buffer: AVAudioPCMBuffer) {
    guard let channels = buffer.floatChannelData, buffer.frameLength > 0,
          buffer.format.sampleRate > 0 else { return }
    var audible = false
    for channel in 0..<Int(buffer.format.channelCount) {
      var rms: Float = 0
      vDSP_rmsqv(channels[channel], vDSP_Stride(buffer.stride), &rms, vDSP_Length(buffer.frameLength))
      if rms >= 0.005 { // About -46 dBFS. Favor "unclear" over skipping a quiet reply.
        audible = true
        break
      }
    }
    let seconds = Double(buffer.frameLength) / buffer.format.sampleRate
    lock.lock()
    totalSeconds += seconds
    if audible { audibleSeconds += seconds }
    lock.unlock()
  }

  var wasQuiet: Bool {
    lock.lock()
    defer { lock.unlock() }
    // No metering data means the mic couldn't be evaluated.
    return totalSeconds >= 0.15 && audibleSeconds < Self.minimumVoiceSeconds
  }

  var heardSound: Bool {
    lock.lock()
    defer { lock.unlock() }
    return audibleSeconds >= 0.12
  }

  var hasVoiceActivity: Bool {
    lock.lock()
    defer { lock.unlock() }
    return audibleSeconds >= Self.minimumVoiceSeconds
  }
}

// All playback and recognition state is owned by the main queue. The audio tap
// feeds the recognizer directly so it works without a running JavaScript clock.
private final class LessonVoiceCheck: NSObject, AVAudioPlayerDelegate {
  private final class Capture {
    let id = UUID()
    let window: AnswerWindow
    let request = SFSpeechAudioBufferRecognitionRequest()
    let audio = AVAudioEngine()
    let level = AnswerAudioLevel()
    var task: SFSpeechRecognitionTask?
    var analysis: Task<Void, Never>?
    var recording: SpokenClip?
    var best: SFTranscription?
    var final = false

    init(window: AnswerWindow) {
      self.window = window
      request.requiresOnDeviceRecognition = true
      request.shouldReportPartialResults = true
      request.taskHint = .confirmation
    }

    func closeMic() {
      audio.stop()
      audio.inputNode.removeTap(onBus: 0)
      request.endAudio()
    }

    func cancelRecognition() {
      task?.cancel()
      analysis?.cancel()
    }
  }

  private let session = AVAudioSession.sharedInstance()
  private weak var player: AVPlayer?
  private weak var item: AVPlayerItem?
  private var sessionId: String?
  private var recognizer: SFSpeechRecognizer?
  private var preparedDictation: (language: String, engine: OnDeviceDictation)?
  private var dictation: OnDeviceDictation?
  private var cue: AVAudioPlayer?
  private var windows: [AnswerWindow] = []
  private var notify: ((String, String, String) -> Void)?
  private var onWindow: ((String, AnswerWindowState) -> Void)?
  private var onStopped: (() -> Void)?
  private var period: Any?
  private var boundary: Any?
  private var status: NSKeyValueObservation?
  private var itemChange: NSKeyValueObservation?
  private var notifications: [NSObjectProtocol] = []
  private var previousTime: Double?
  private var previousUptime: TimeInterval?
  private var pending: AnswerWindow?
  private var armedAt: TimeInterval = 0
  private var speakingRate: (normal: Float, duringPause: Float)?
  private var active: Capture?
  private var finishing: [UUID: Capture] = [:]
  private var latestCapture: [String: UUID] = [:]
  private var reachedEnd = false
  private var previousMode: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?
  private var checkingOptions: AVAudioSession.CategoryOptions?
  private var interrupted = false
  private var feedbackAudio: AVAudioPlayer?
  private var feedbackClips: [String: [Data]] = [:]
  private var feedbackVariant = 0
  private var feedbackBreak: (id: UUID, rate: Float)?
  private var onFeedback: ((Bool) -> Void)?

  static func legacyRecognizer(language: String) -> SFSpeechRecognizer? {
    let requested = Locale(identifier: language)
    guard let recognizer = SFSpeechRecognizer(locale: requested),
          recognizer.locale.language.languageCode == requested.language.languageCode,
          recognizer.supportsOnDeviceRecognition else { return nil }
    return recognizer
  }

  @MainActor func prepare(language: String) async -> String {
    if let recognizer = Self.legacyRecognizer(language: language), recognizer.isAvailable {
      preparedDictation = nil
      return "legacy"
    }
#if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      do {
        if let engine = try await OnDeviceDictation.prepare(locale: Locale(identifier: language)) {
          preparedDictation = (language, engine)
          return "dictation"
        }
      } catch {
        return "setupFailed"
      }
    }
#endif
    return "unsupported"
  }

  func start(
    player: AVPlayer, sessionId: String, language: String, windows: [AnswerWindow],
    notify: @escaping (String, String, String) -> Void,
    onWindow: @escaping (String, AnswerWindowState) -> Void,
    onFeedback: @escaping (Bool) -> Void,
    onStopped: @escaping () -> Void
  ) throws {
    stop()
    let prepared = preparedDictation?.language == language ? preparedDictation?.engine : nil
    let recognizer = SFSpeechRecognizer.authorizationStatus() == .authorized
      ? Self.legacyRecognizer(language: language) : nil
    guard let item = player.currentItem,
          !windows.isEmpty,
          session.recordPermission == .granted,
          prepared != nil || recognizer?.isAvailable == true else {
      throw VoiceCheckError.unavailable
    }

    previousMode = (session.category, session.mode, session.categoryOptions)
    do {
      // Keep Bluetooth media output available. iOS can use the phone mic with A2DP.
      try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP])
      checkingOptions = session.categoryOptions
      let cue = try AVAudioPlayer(data: Self.cueAudio())
      guard cue.prepareToPlay() else { throw VoiceCheckError.unavailable }
      self.cue = cue
    } catch {
      restoreAudioMode()
      throw error
    }

    self.player = player
    self.item = item
    self.sessionId = sessionId
    self.recognizer = recognizer
    dictation = prepared
    self.windows = windows
    self.notify = notify
    self.onWindow = onWindow
    self.onFeedback = onFeedback
    self.onStopped = onStopped

    status = player.observe(\.timeControlStatus) { [weak self, weak player] _, _ in
      DispatchQueue.main.async {
        guard let self, let player, self.sessionId == sessionId else { return }
        if self.feedbackBreak != nil {
          // A system Play command can resume the lesson while feedback is playing.
          if player.timeControlStatus == .playing { self.endFeedback(resume: false) }
        } else if player.timeControlStatus != .playing {
          self.resetWindow()
        }
      }
    }
    itemChange = player.observe(\.currentItem) { [weak self] _, _ in
      DispatchQueue.main.async { self?.stop(sessionId: sessionId, announce: true) }
    }
    let center = NotificationCenter.default
    notifications = [
      center.addObserver(forName: AVPlayerItem.timeJumpedNotification, object: item, queue: .main) { [weak self] _ in
        self?.endFeedback(resume: true)
        self?.resetWindow()
      },
      center.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
        guard let self, self.sessionId == sessionId else { return }
        self.endFeedback(resume: false)
        self.resetWindow()
        self.reachedEnd = true
        self.stopIfFinished()
      },
      center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] event in
        let reason = event.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
        if reason != AVAudioSession.RouteChangeReason.categoryChange.rawValue {
          self?.endFeedback(resume: false)
          self?.resetWindow()
        }
      },
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] event in
        let kind = event.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
        self?.interrupted = kind == AVAudioSession.InterruptionType.began.rawValue
        self?.endFeedback(resume: false)
        self?.resetWindow()
      }
    ]
    period = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.05, preferredTimescale: 1_000), queue: .main) { [weak self] _ in
      self?.tick()
    }
    let captureEnds = Set(windows.map(\.endSeconds)).filter { $0.isFinite && $0 > 0 }.sorted()
    if !captureEnds.isEmpty {
      boundary = player.addBoundaryTimeObserver(
        forTimes: captureEnds.map { NSValue(time: CMTime(seconds: $0, preferredTimescale: 1_000)) },
        queue: .main
      ) { [weak self] in
        self?.tick()
      }
    }
  }

  func stop(sessionId requestedId: String? = nil, announce: Bool = false) {
    if let requestedId, requestedId != sessionId { return }
    endFeedback(resume: false)
    resetWindow()
    for capture in finishing.values { capture.cancelRecognition() }
    finishing.removeAll()
    if let period { player?.removeTimeObserver(period) }
    if let boundary { player?.removeTimeObserver(boundary) }
    period = nil
    boundary = nil
    status = nil
    itemChange = nil
    for token in notifications { NotificationCenter.default.removeObserver(token) }
    notifications.removeAll()
    player = nil
    item = nil
    recognizer = nil
    dictation = nil
    cue = nil
    sessionId = nil
    notify = nil
    onWindow = nil
    onFeedback = nil
    feedbackClips.removeAll()
    feedbackVariant = 0
    latestCapture.removeAll()
    reachedEnd = false
    interrupted = false
    restoreAudioMode()
    let onStopped = self.onStopped
    self.onStopped = nil
    if announce { onStopped?() }
  }

  private func restoreAudioMode() {
    if let (category, mode, options) = previousMode, ownsAudioMode {
      try? session.setCategory(category, mode: mode, options: options)
    }
    previousMode = nil
    checkingOptions = nil
  }

  private var ownsAudioMode: Bool {
    session.category == .playAndRecord && session.categoryOptions == checkingOptions
  }

  private func resetWindow() {
    previousTime = nil
    previousUptime = nil
    pending = nil
    cue?.stop()
    if let active {
      self.active = nil
      active.closeMic()
      onWindow?(active.window.id, .cancelled)
      active.cancelRecognition()
    }
    restoreSpeakingRate()
  }

  private func tick() {
    if reachedEnd || feedbackBreak != nil { return }
    guard ownsAudioMode else {
      stop(announce: true)
      return
    }
    guard let player, player.currentItem === item, player.timeControlStatus == .playing,
          player.rate > 0, !interrupted else {
      resetWindow()
      return
    }
    let time = player.currentTime().seconds
    guard time.isFinite else { return }
    let now = ProcessInfo.processInfo.systemUptime
    defer {
      previousTime = time
      previousUptime = now
    }
    guard let previousTime, let previousUptime else { return }
    // A jump abandons the attempt. A delayed callback can still finish a pause
    // we played through, but any audio from beyond the pause must be discarded.
    let advance = time - previousTime
    let elapsed = now - previousUptime
    guard advance >= 0, advance <= elapsed * Double(player.rate) + 0.14 else {
      resetWindow()
      return
    }

    if let active {
      if time >= active.window.endSeconds {
        finish(active, canTranscribe: time <= active.window.endSeconds + 0.18)
      }
      return
    }
    guard elapsed < 0.5 else {
      resetWindow()
      return
    }
    if let pending {
      if time >= pending.endSeconds - 0.35 {
        self.pending = nil
        restoreSpeakingRate()
      } else if now >= armedAt {
        self.pending = nil
        begin(pending)
      }
      return
    }

    guard let window = windows.first(where: {
            previousTime < $0.startSeconds && time >= $0.startSeconds &&
            time <= $0.startSeconds + 0.40 && time < $0.endSeconds - 0.65
          }),
          let cue else { return }
    cue.currentTime = 0
    guard cue.play() else { return }
    pending = window
    extendSpeakingPause(window, on: player, at: time)
    // Let the cue clear the output before opening the input, including Bluetooth latency.
    armedAt = now + 0.30
  }

  private func begin(_ window: AnswerWindow) {
    defer {
      if active == nil { restoreSpeakingRate() }
    }
    let capture = Capture(window: window)
    let input = capture.audio.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else { return }
    if dictation != nil {
      guard let recording = SpokenClip(format: format) else { return }
      capture.recording = recording
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [level = capture.level, recording = capture.recording, request = capture.request] buffer, _ in
      level.measure(buffer)
      if let recording { recording.append(buffer) }
      else { request.append(buffer) }
    }
    do {
      try capture.audio.start()
    } catch {
      capture.closeMic()
      return
    }
    active = capture
    latestCapture[window.id] = capture.id
    onWindow?(window.id, .recording)
    guard capture.recording == nil, let recognizer else { return }
    capture.task = recognizer.recognitionTask(with: capture.request) { [weak self, weak capture] result, error in
      DispatchQueue.main.async {
        guard let self, let capture, self.active === capture || self.finishing[capture.id] != nil else { return }
        if let result {
          capture.best = result.bestTranscription
          capture.final = result.isFinal
        }
        if self.finishing[capture.id] != nil && (capture.final || error != nil) {
          self.report(capture)
        }
      }
    }
  }

  private func finish(_ capture: Capture, canTranscribe: Bool) {
    active = nil
    let hasTranscript = capture.best?.formattedString.isEmpty == false
    if canTranscribe && (capture.level.hasVoiceActivity || hasTranscript) {
      holdForFeedback(capture.window, captureId: capture.id)
    }
    capture.closeMic()
    restoreSpeakingRate()
    if capture.level.wasQuiet && !hasTranscript {
      capture.cancelRecognition()
      onWindow?(capture.window.id, .skipped)
      if feedbackBreak?.id == capture.id { endFeedback(resume: true) }
      return
    }
    guard canTranscribe else {
      capture.cancelRecognition()
      onWindow?(capture.window.id, .unclear)
      return
    }
    finishing[capture.id] = capture
    onWindow?(capture.window.id, .checking)
#if compiler(>=6.2)
    if #available(iOS 26.0, *), let dictation, let recording = capture.recording {
      if let audio = recording.close() {
        capture.analysis = Task { @MainActor [weak self, weak capture] in
          let transcript = try? await dictation.transcribe(audio)
          guard let self, let capture, self.finishing[capture.id] != nil else { return }
          self.report(capture, transcript: transcript, locale: dictation.locale)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self, weak capture] in
          guard let self, let capture, self.finishing[capture.id] != nil else { return }
          self.report(capture, transcript: nil, locale: dictation.locale)
        }
      } else {
        report(capture, transcript: nil, locale: dictation.locale)
      }
      return
    }
#endif
    if capture.final {
      report(capture)
      return
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self, weak capture] in
      guard let self, let capture, self.finishing[capture.id] != nil else { return }
      self.report(capture)
    }
  }

  private func extendSpeakingPause(_ window: AnswerWindow, on player: AVPlayer, at time: Double) {
    guard window.responseSeconds.isFinite, window.extraSeconds.isFinite, window.extraSeconds > 0,
          player.rate > 0 else { return }
    let normal = player.rate
    let remaining = window.endSeconds - time
    let seconds = max(remaining / Double(normal), window.responseSeconds) + window.extraSeconds
    // Media time inside the baked silence advances more slowly, so the
    // microphone stays open longer while the rest of the lesson keeps its rate.
    let slower = min(normal, max(0.12, Float(remaining / seconds)))
    guard slower < normal else { return }
    speakingRate = (normal, slower)
    player.playImmediately(atRate: slower)
  }

  private func restoreSpeakingRate() {
    guard let speakingRate else { return }
    self.speakingRate = nil
    // A Pause or a new speed selected while answering takes precedence.
    if let player, abs(player.rate - speakingRate.duringPause) < 0.01 {
      player.rate = speakingRate.normal
    }
  }

  private func report(_ capture: Capture) {
    let transcript = capture.best.map {
      SpokenTranscript(text: $0.formattedString, confidences: $0.segments.map(\.confidence), isFinal: capture.final)
    }
    report(capture, transcript: transcript, locale: recognizer?.locale ?? .current)
  }

  private func report(_ capture: Capture, transcript: SpokenTranscript?, locale: Locale) {
    finishing.removeValue(forKey: capture.id)
    capture.cancelRecognition()
    defer { stopIfFinished() }
    guard latestCapture[capture.window.id] == capture.id else { return }
    let heard = Self.normalized(transcript?.text ?? "", locale: locale)
    let expected = Self.normalized(capture.window.expected, locale: locale)
    guard !expected.isEmpty else {
      sendResult(capture, verdict: "unclear", heard: "", maySpeak: false)
      return
    }
    guard let transcript, !heard.isEmpty else {
      sendResult(capture, verdict: capture.level.wasQuiet ? "skipped" : "unclear", heard: "", maySpeak: capture.level.heardSound)
      return
    }
    let words = transcript.confidences
    let confidence = words.isEmpty ? 0 : words.reduce(0, +) / Float(words.count)
    let display = String(transcript.text.prefix(900))
    if transcript.isFinal, confidence >= 0.5, heard == expected {
      sendResult(capture, verdict: "recalled", heard: display)
    } else if transcript.isFinal, confidence >= 0.55, heard != expected {
      // The learner may have spoken a valid variant, so this is a prompt to compare.
      sendResult(capture, verdict: "compare", heard: display)
    } else {
      sendResult(capture, verdict: "unclear", heard: "")
    }
  }

  private func sendResult(_ capture: Capture, verdict: String, heard: String, maySpeak: Bool = true) {
    notify?(capture.window.id, verdict, heard)
    guard feedbackBreak?.id == capture.id else { return }
    guard maySpeak && verdict != "skipped" else {
      endFeedback(resume: true)
      return
    }
    playFeedback(verdict)
  }

  func installFeedback(sessionId: String, clips: FeedbackClips) {
    guard self.sessionId == sessionId else { return }
    feedbackClips = [
      "recalled": clips.recalled,
      "compare": clips.compare,
      "unclear": clips.unclear,
    ].mapValues { $0.compactMap { Data(base64Encoded: $0) } }.filter { !$0.value.isEmpty }
  }

  func cancelFeedback(sessionId: String, resume: Bool) {
    if self.sessionId == sessionId { endFeedback(resume: resume) }
  }

  private func holdForFeedback(_ window: AnswerWindow, captureId: UUID) {
    guard let player, !feedbackClips.isEmpty, !reachedEnd, !interrupted, feedbackBreak == nil,
          player.timeControlStatus == .playing, player.rate > 0 else { return }
    // Older plans placed the feedback time after the model answer. Always stop within the pause.
    let latest = min(window.feedbackAtSeconds, window.endSeconds + 0.12)
    guard player.currentTime().seconds <= latest else { return }
    let resumeRate: Float
    if let speakingRate, abs(player.rate - speakingRate.duringPause) < 0.01 {
      resumeRate = speakingRate.normal
    } else {
      resumeRate = player.rate
    }
    feedbackBreak = (captureId, resumeRate)
    player.pause()
    onFeedback?(true)
  }

  private func playFeedback(_ verdict: String) {
    guard let feedbackBreak, let clips = feedbackClips[verdict],
          let audio = try? AVAudioPlayer(data: clips[feedbackVariant % clips.count]), audio.duration <= 6 else {
      endFeedback(resume: true)
      return
    }
    feedbackVariant += 1
    feedbackAudio = audio
    audio.delegate = self
    audio.enableRate = true
    audio.rate = feedbackBreak.rate
    if !audio.play() { endFeedback(resume: true) }
  }

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    if feedbackAudio === player { endFeedback(resume: true) }
  }

  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: (any Error)?) {
    if feedbackAudio === player { endFeedback(resume: true) }
  }

  private func endFeedback(resume: Bool) {
    guard let previous = feedbackBreak else { return }
    feedbackBreak = nil
    feedbackAudio?.stop()
    feedbackAudio = nil
    previousTime = nil
    previousUptime = nil
    onFeedback?(false)
    if resume && !interrupted && !reachedEnd { player?.playImmediately(atRate: previous.rate) }
  }

  private func stopIfFinished() {
    if reachedEnd && finishing.isEmpty { stop(announce: true) }
  }

  private static func normalized(_ text: String, locale: Locale) -> String {
    text.lowercased(with: locale).precomposedStringWithCanonicalMapping
      .replacingOccurrences(of: "[^\\p{L}\\p{M}\\p{N}]+", with: " ", options: .regularExpression)
      .trimmingCharacters(in: .whitespaces)
  }

  private static func cueAudio() -> Data {
    let rate = 24_000
    let frames = 2_400
    var data = Data("RIFF".utf8)
    func append<T: FixedWidthInteger>(_ value: T) {
      withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
    }
    append(UInt32(36 + frames * 2))
    data.append(Data("WAVEfmt ".utf8))
    append(UInt32(16))
    append(UInt16(1))
    append(UInt16(1))
    append(UInt32(rate))
    append(UInt32(rate * 2))
    append(UInt16(2))
    append(UInt16(16))
    data.append(Data("data".utf8))
    append(UInt32(frames * 2))
    for frame in 0..<frames {
      let progress = Double(frame) / Double(frames)
      let envelope = pow(sin(Double.pi * progress), 2)
      let sample = sin(2 * Double.pi * 880 * Double(frame) / Double(rate)) * envelope
      append(Int16(sample * 8_000))
    }
    return data
  }
}
