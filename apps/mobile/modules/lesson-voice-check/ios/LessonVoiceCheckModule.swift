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
    Events("onAnswer", "onWindow", "onFeedback", "onStopped", "onGrade", "onPartial")

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
      try self.checks.start(player: player.ref, sessionId: sessionId, language: language, windows: windows) { [weak self] id, captureId, verdict, heard in
        self?.sendEvent("onAnswer", [
          "sessionId": sessionId, "id": id, "captureId": captureId, "verdict": verdict, "heard": heard,
        ])
      } onGrade: { [weak self] id, captureId, heard, alternate, audible, confidenceKnown, wasQuiet in
        self?.sendEvent("onGrade", [
          "sessionId": sessionId, "id": id, "captureId": captureId, "heard": heard, "alternate": alternate,
          "audibleSeconds": audible, "confidenceKnown": confidenceKnown, "wasQuiet": wasQuiet,
        ])
      } onPartial: { [weak self] id, captureId, heard, alternate, stable, quiet, audible, elapsed in
        self?.sendEvent("onPartial", [
          "sessionId": sessionId, "id": id, "captureId": captureId, "heard": heard, "alternate": alternate,
          "stableSeconds": stable, "quietSeconds": quiet, "audibleSeconds": audible, "elapsedSeconds": elapsed,
        ])
      } onWindow: { [weak self] id, captureId, state in
        self?.sendEvent("onWindow", [
          "sessionId": sessionId, "id": id, "captureId": captureId, "recording": state == .recording, "state": state.rawValue,
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

    AsyncFunction("abandon") { (sessionId: String) in
      self.checks.abandon(sessionId: sessionId)
    }.runOnQueue(.main)

    AsyncFunction("speak") { (sessionId: String, captureId: String, verdict: String) in
      self.checks.speak(sessionId: sessionId, captureId: captureId, verdict: verdict)
    }.runOnQueue(.main)

    AsyncFunction("finishEarly") { (sessionId: String, captureId: String) in
      self.checks.finishEarly(sessionId: sessionId, captureId: captureId)
    }.runOnQueue(.main)

    AsyncFunction("skip") { (sessionId: String) in
      self.checks.skip(sessionId: sessionId)
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
    if audible {
      audibleSeconds += seconds
      lastAudible = ProcessInfo.processInfo.systemUptime
    }
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

  var secondsAudible: Double {
    lock.lock()
    defer { lock.unlock() }
    return audibleSeconds
  }

  var hasVoiceActivity: Bool {
    lock.lock()
    defer { lock.unlock() }
    return audibleSeconds >= Self.minimumVoiceSeconds
  }

  /// Seconds since the last audible buffer. Zero until speech has been heard.
  var quietSeconds: Double {
    lock.lock()
    defer { lock.unlock() }
    guard let lastAudible else { return 0 }
    return ProcessInfo.processInfo.systemUptime - lastAudible
  }

  private var lastAudible: TimeInterval?
}

// All playback and recognition state is owned by the main queue. The audio tap
// feeds the recognizer directly so it works without a running JavaScript clock.
private final class LessonVoiceCheck: NSObject, AVAudioPlayerDelegate {
  private final class Capture {
    let id = UUID()
    let window: AnswerWindow
    let request = SFSpeechAudioBufferRecognitionRequest()
    let level = AnswerAudioLevel()
    var task: SFSpeechRecognitionTask?
    var analysis: Task<Void, Never>?
    var recording: SpokenClip?
    var best: SFTranscription?
    var richest = ""
    var final = false
    var started = ProcessInfo.processInfo.systemUptime
    var partialText = ""
    var partialSince = ProcessInfo.processInfo.systemUptime
    var lastPartialSent: TimeInterval = 0

    init(window: AnswerWindow, onDevice: Bool) {
      self.window = window
      // On-device when the locale has a model. Otherwise Apple's recognizer may use the network.
      request.requiresOnDeviceRecognition = onDevice
      request.shouldReportPartialResults = true
      // Full phrases, not yes/no. The expected line is a hint, and the grader
      // rejects a short exact echo when confidence is missing.
      request.taskHint = .dictation
      let hint = window.expected.trimmingCharacters(in: .whitespacesAndNewlines)
      if !hint.isEmpty { request.contextualStrings = [hint] }
    }

    func endRequest() {
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
  private var notify: ((String, String, String, String) -> Void)?
  private var onGrade: ((String, String, String, String, Double, Bool, Bool) -> Void)?
  private var onPartial: ((String, String, String, String, Double, Double, Double, Double) -> Void)?
  private var ignoreJumpsUntil: TimeInterval = 0
  private var onWindow: ((String, String, AnswerWindowState) -> Void)?
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
  /// After a seek, open the microphone if playback is already inside a pause.
  private var replay = false
  /// The last tone for a cue. A pause rate change must not sound it again.
  private var lastCue: (id: String, at: TimeInterval)?
  private var reachedEnd = false
  private var previousMode: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?
  /// Kept running for the whole checked lesson. Starting it again from the background fails.
  private let microphone = AVAudioEngine()
  private var microphoneTap = false
  private let feedLock = NSLock()
  private var feed: (level: AnswerAudioLevel, recording: SpokenClip?, request: SFSpeechAudioBufferRecognitionRequest)?
  private var interrupted = false
  private var feedbackAudio: AVAudioPlayer?
  private var feedbackClips: [String: [Data]] = [:]
  private var feedbackVariant = 0
  private var feedbackBreak: (id: UUID, rate: Float)?
  private var feedbackSpoken = false
  private var onFeedback: ((Bool) -> Void)?

  static func legacyRecognizer(language: String) -> SFSpeechRecognizer? {
    let requested = Locale(identifier: language)
    guard let recognizer = SFSpeechRecognizer(locale: requested),
          recognizer.locale.language.languageCode == requested.language.languageCode else { return nil }
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
    notify: @escaping (String, String, String, String) -> Void,
    onGrade: @escaping (String, String, String, String, Double, Bool, Bool) -> Void,
    onPartial: @escaping (String, String, String, String, Double, Double, Double, Double) -> Void,
    onWindow: @escaping (String, String, AnswerWindowState) -> Void,
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
      // One playAndRecord session for the whole checked lesson. iOS will not
      // start a fresh microphone after the screen locks, so the engine stays up.
      try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP])
      try session.setActive(true)
      try startMicrophone()
      let cue = try AVAudioPlayer(data: Self.cueAudio())
      guard cue.prepareToPlay() else { throw VoiceCheckError.unavailable }
      self.cue = cue
    } catch {
      stopMicrophone()
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
    self.onGrade = onGrade
    self.onPartial = onPartial
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
        self?.noteTimeJump()
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
        // Locking the screen can change the route. Keep the engine; only refresh the tap.
        if reason != AVAudioSession.RouteChangeReason.categoryChange.rawValue {
          try? self?.startMicrophone()
        }
      },
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] event in
        guard let self else { return }
        let began = (event.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
        self.interrupted = began
        if began {
          self.endFeedback(resume: false)
          self.resetWindow()
        } else {
          try? self.session.setActive(true)
          try? self.startMicrophone()
        }
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
    feedbackSpoken = false
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
    onGrade = nil
    onPartial = nil
    onWindow = nil
    onFeedback = nil
    feedbackClips.removeAll()
    feedbackVariant = 0
    latestCapture.removeAll()
    replay = false
    lastCue = nil
    reachedEnd = false
    interrupted = false
    stopMicrophone()
    restoreAudioMode()
    let onStopped = self.onStopped
    self.onStopped = nil
    if announce { onStopped?() }
  }

  /// Refresh the input tap without stopping the engine, so a locked screen can still record.
  private func startMicrophone() throws {
    let input = microphone.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else { throw VoiceCheckError.unavailable }
    if microphoneTap {
      input.removeTap(onBus: 0)
      microphoneTap = false
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.consume(buffer)
    }
    microphoneTap = true
    if !microphone.isRunning {
      microphone.prepare()
      try microphone.start()
    }
  }

  private func stopMicrophone() {
    feedLock.lock()
    feed = nil
    feedLock.unlock()
    if microphoneTap {
      microphone.inputNode.removeTap(onBus: 0)
      microphoneTap = false
    }
    if microphone.isRunning { microphone.stop() }
  }

  private func consume(_ buffer: AVAudioPCMBuffer) {
    feedLock.lock()
    let current = feed
    feedLock.unlock()
    guard let current else { return }
    current.level.measure(buffer)
    if let recording = current.recording { recording.append(buffer) }
    else { current.request.append(buffer) }
  }

  private func attach(_ capture: Capture) {
    feedLock.lock()
    feed = (capture.level, capture.recording, capture.request)
    feedLock.unlock()
  }

  private func releaseCapture(_ capture: Capture) {
    feedLock.lock()
    if feed?.request === capture.request { feed = nil }
    feedLock.unlock()
    capture.endRequest()
  }

  private func restoreAudioMode() {
    if let (category, mode, options) = previousMode, ownsAudioMode {
      try? session.setCategory(category, mode: mode, options: options)
    }
    previousMode = nil
  }

  private var ownsAudioMode: Bool {
    session.category == .playAndRecord
  }

  /// Retire every in-flight capture. A transcript that resolves afterwards no longer matches latestCapture.
  private func abandonAttempts() {
    replay = true
    if let active {
      let capture = active
      self.active = nil
      releaseCapture(capture)
      capture.cancelRecognition()
      onWindow?(capture.window.id, capture.id.uuidString, .cancelled)
    }
    for capture in finishing.values {
      capture.cancelRecognition()
      capture.analysis?.cancel()
      onWindow?(capture.window.id, capture.id.uuidString, .cancelled)
    }
    finishing.removeAll()
    latestCapture.removeAll()
    pending = nil
    cue?.stop()
    previousTime = nil
    previousUptime = nil
    restoreSpeakingRate()
  }

  func abandon(sessionId: String) {
    guard self.sessionId == sessionId else { return }
    abandonAttempts()
  }

  private func resetWindow() {
    previousTime = nil
    previousUptime = nil
    pending = nil
    cue?.stop()
    if let active {
      self.active = nil
      releaseCapture(active)
      onWindow?(active.window.id, active.id.uuidString, .cancelled)
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
    // A real skip abandons the attempt. Slowing the pause, or a coarse clock,
    // must not. A delayed callback can still finish a pause we played through.
    let elapsed = now - previousUptime
    guard !playheadJumped(from: previousTime, to: time, elapsed: elapsed, rate: player.rate) else {
      if now < ignoreJumpsUntil { return }
      abandonAttempts()
      return
    }

    if let active {
      if time >= active.window.endSeconds {
        finish(active, canTranscribe: time <= active.window.endSeconds + 0.18)
      } else if active.recording == nil {
        let elapsed = now - active.started
        if !active.level.hasVoiceActivity && elapsed >= 2.5 {
          finish(active, canTranscribe: true)
        } else {
          publishPartial(active, force: false)
        }
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

    if replay, let window = windows.first(where: {
      time >= $0.startSeconds && time < $0.endSeconds - 0.65
    }) {
      soundCue(window, on: player, at: time, now: now)
      return
    }

    guard let window = windows.first(where: {
            previousTime < $0.startSeconds && time >= $0.startSeconds &&
            time <= $0.startSeconds + 0.40 && time < $0.endSeconds - 0.65
          }) else { return }
    soundCue(window, on: player, at: time, now: now)
  }

  /// Pause, resume, and the slower answer rate all post a time jump. Only a real skip counts.
  private func noteTimeJump() {
    if ProcessInfo.processInfo.systemUptime < ignoreJumpsUntil { return }
    guard let player else { return }
    let time = player.currentTime().seconds
    let elapsed = previousUptime.map { ProcessInfo.processInfo.systemUptime - $0 } ?? 0
    guard playheadJumped(from: previousTime, to: time, elapsed: elapsed, rate: player.rate) else { return }
    endFeedback(resume: true)
    abandonAttempts()
  }

  /// Same thresholds as apps/mobile/src/lesson/answer-cue.ts.
  private func playheadJumped(from previous: Double?, to time: Double, elapsed: TimeInterval, rate: Float) -> Bool {
    guard let previous, time.isFinite, previous.isFinite else { return false }
    let advance = time - previous
    if advance < -0.2 { return true }
    let allowance = max(0, elapsed) * Double(max(rate, 0)) + 0.35
    return advance > allowance
  }

  private func soundCue(_ window: AnswerWindow, on player: AVPlayer, at time: Double, now: TimeInterval) {
    if let lastCue, lastCue.id == window.id, now - lastCue.at < 0.9 {
      replay = false
      return
    }
    guard let cue else { return }
    cue.currentTime = 0
    guard cue.play() else { return }
    lastCue = (window.id, now)
    replay = false
    pending = window
    extendSpeakingPause(window, on: player, at: time)
    // The beep is 0.1s. Leave a short tail so it does not land in the transcript.
    armedAt = now + 0.20
  }

  private func begin(_ window: AnswerWindow) {
    defer {
      if active == nil { restoreSpeakingRate() }
    }
    do { try startMicrophone() } catch { return }
    let format = microphone.inputNode.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else { return }
    let capture = Capture(window: window, onDevice: recognizer?.supportsOnDeviceRecognition == true)
    if dictation != nil {
      guard let recording = SpokenClip(format: format) else { return }
      capture.recording = recording
    }
    attach(capture)
    guard microphone.isRunning else {
      releaseCapture(capture)
      return
    }
    capture.started = ProcessInfo.processInfo.systemUptime
    capture.partialSince = capture.started
    active = capture
    latestCapture[window.id] = capture.id
    onWindow?(window.id, capture.id.uuidString, .recording)
    guard capture.recording == nil, let recognizer else { return }
    capture.task = recognizer.recognitionTask(with: capture.request) { [weak self, weak capture] result, error in
      DispatchQueue.main.async {
        guard let self, let capture, self.active === capture || self.finishing[capture.id] != nil else { return }
        if let result {
          capture.best = result.bestTranscription
          capture.final = result.isFinal
          let text = result.bestTranscription.formattedString
          if text.count > capture.richest.count { capture.richest = text }
          if text != capture.partialText {
            capture.partialText = text
            capture.partialSince = ProcessInfo.processInfo.systemUptime
          }
          self.publishPartial(capture, force: false)
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
    releaseCapture(capture)
    restoreSpeakingRate()
    if capture.level.wasQuiet && !hasTranscript {
      capture.cancelRecognition()
      onWindow?(capture.window.id, capture.id.uuidString, .skipped)
      if feedbackBreak?.id == capture.id { endFeedback(resume: true) }
      return
    }
    guard canTranscribe else {
      capture.cancelRecognition()
      onWindow?(capture.window.id, capture.id.uuidString, .unclear)
      return
    }
    finishing[capture.id] = capture
    onWindow?(capture.window.id, capture.id.uuidString, .checking)
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

  /// Grading happens in JavaScript. Confidence of 0 means unknown, and the best partial is kept.
  private func report(_ capture: Capture, transcript: SpokenTranscript?, locale _: Locale) {
    finishing.removeValue(forKey: capture.id)
    capture.cancelRecognition()
    defer { stopIfFinished() }
    guard latestCapture[capture.window.id] == capture.id else { return }
    let latest = String((transcript?.text ?? "").prefix(900))
    if latest.count > capture.richest.count { capture.richest = latest }
    let alternate = capture.richest == latest ? "" : String(capture.richest.prefix(900))
    let confidences = transcript?.confidences ?? []
    let confidenceKnown = confidences.contains { $0 > 0.01 }
    onGrade?(capture.window.id, capture.id.uuidString, latest, alternate, capture.level.secondsAudible, confidenceKnown, capture.level.wasQuiet)
    let captureId = capture.id
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
      self?.speakIfHolding(captureId, verdict: "unclear")
    }
  }

  private func publishPartial(_ capture: Capture, force: Bool) {
    guard capture.recording == nil, active === capture else { return }
    let now = ProcessInfo.processInfo.systemUptime
    let stable = capture.partialText.isEmpty ? 0 : now - capture.partialSince
    let quiet = capture.level.quietSeconds
    let ready = !capture.partialText.isEmpty && stable >= 0.4 && quiet >= 0.7
    if !force && !ready && now - capture.lastPartialSent < 0.15 { return }
    capture.lastPartialSent = now
    let latest = String(capture.partialText.prefix(900))
    let richest = String(capture.richest.prefix(900))
    onPartial?(
      capture.window.id, capture.id.uuidString, latest, richest == latest ? "" : richest,
      stable, quiet, capture.level.secondsAudible, now - capture.started
    )
  }

  func finishEarly(sessionId: String, captureId: String) {
    guard self.sessionId == sessionId, let active, active.id.uuidString == captureId, active.recording == nil else { return }
    finish(active, canTranscribe: true)
  }

  func skip(sessionId: String) {
    guard self.sessionId == sessionId, let active else { return }
    let end = active.window.endSeconds
    let capture = active
    self.active = nil
    releaseCapture(capture)
    capture.cancelRecognition()
    onWindow?(capture.window.id, capture.id.uuidString, .skipped)
    restoreSpeakingRate()
    ignoreJumpsUntil = ProcessInfo.processInfo.systemUptime + 1
    let target = CMTime(seconds: max(0, end), preferredTimescale: 1_000)
    player?.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
      DispatchQueue.main.async {
        guard let self else { return }
        self.previousTime = self.player?.currentTime().seconds
        self.previousUptime = ProcessInfo.processInfo.systemUptime
        if !self.interrupted && !self.reachedEnd { self.player?.play() }
      }
    }
  }

  func speak(sessionId: String, captureId: String, verdict: String) {
    guard self.sessionId == sessionId, let captureId = UUID(uuidString: captureId) else { return }
    speakIfHolding(captureId, verdict: verdict)
  }

  private func speakIfHolding(_ captureId: UUID, verdict: String) {
    guard feedbackBreak?.id == captureId, !feedbackSpoken else { return }
    feedbackSpoken = true
    if verdict == "skipped" {
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
    // Stop before the model answer even when the feedback clips are still loading,
    // so the answer is heard only after this attempt, following the feedback.
    guard let player, !reachedEnd, !interrupted, feedbackBreak == nil,
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
    feedbackSpoken = false
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
