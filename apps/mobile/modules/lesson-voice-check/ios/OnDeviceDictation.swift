import AVFoundation
import Speech

struct SpokenTranscript {
  let text: String
  let confidences: [Float]
  let isFinal: Bool
}

// The analyzer receives a bounded clip after the mic closes. Keep it in memory
// and copy the tap's samples because the audio engine can reuse its buffers.
final class SpokenClip {
  private let storage: AVAudioPCMBuffer
  private let lock = NSLock()
  private var closed = false

  init?(format: AVAudioFormat) {
    // Lesson pauses are at most 20 seconds. The cap also covers slower playback.
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(format.sampleRate * 25)) else {
      return nil
    }
    storage = buffer
  }

  func append(_ sample: AVAudioPCMBuffer) {
    lock.lock()
    defer { lock.unlock() }
    guard !closed, sample.format == storage.format,
          sample.frameLength <= storage.frameCapacity - storage.frameLength else { return }
    let bytesPerFrame = Int(storage.format.streamDescription.pointee.mBytesPerFrame)
    let offset = Int(storage.frameLength) * bytesPerFrame
    let length = Int(sample.frameLength) * bytesPerFrame
    let source = UnsafeMutableAudioBufferListPointer(sample.mutableAudioBufferList)
    let destination = UnsafeMutableAudioBufferListPointer(storage.mutableAudioBufferList)
    for (from, to) in zip(source, destination) {
      guard let input = from.mData, let output = to.mData else { return }
      output.advanced(by: offset).copyMemory(from: input, byteCount: length)
    }
    storage.frameLength += sample.frameLength
  }

  func close() -> AVAudioPCMBuffer? {
    lock.lock()
    defer { lock.unlock() }
    closed = true
    return storage.frameLength > 0 ? storage : nil
  }
}

struct OnDeviceDictation {
  let locale: Locale
  let format: AVAudioFormat
}

#if compiler(>=6.2)
@available(iOS 26.0, *)
extension OnDeviceDictation {
  static func prepare(locale: Locale) async throws -> Self? {
    guard let supported = await DictationTranscriber.supportedLocale(equivalentTo: locale) else { return nil }
    let transcriber = makeTranscriber(locale: supported)
    let modules = [transcriber]
    guard await AssetInventory.status(forModules: modules) != .unsupported else { return nil }
    if let request = try await AssetInventory.assetInstallationRequest(supporting: modules) {
      try await request.downloadAndInstall()
    }
    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: modules) else { return nil }
    return Self(locale: supported, format: format)
  }

  func transcribe(_ recording: AVAudioPCMBuffer) async throws -> SpokenTranscript? {
    guard let audio = audioForAnalysis(recording) else { return nil }
    let transcriber = Self.makeTranscriber(locale: locale)
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let input = AsyncStream<AnalyzerInput> { continuation in
      continuation.yield(AnalyzerInput(buffer: audio))
      continuation.finish()
    }

    return try await withTaskCancellationHandler {
      async let transcript = Self.finalTranscript(from: transcriber)
      do {
        if let end = try await analyzer.analyzeSequence(input) {
          try await analyzer.finalizeAndFinish(through: end)
        } else {
          await analyzer.cancelAndFinishNow()
          return nil
        }
        return try await transcript
      } catch {
        await analyzer.cancelAndFinishNow()
        throw error
      }
    } onCancel: {
      Task { await analyzer.cancelAndFinishNow() }
    }
  }

  private static func makeTranscriber(locale: Locale) -> DictationTranscriber {
    var preset = DictationTranscriber.Preset.phrase
    preset.reportingOptions.remove(.volatileResults)
    preset.attributeOptions.insert(.transcriptionConfidence)
    return DictationTranscriber(locale: locale, preset: preset)
  }

  private static func finalTranscript(from transcriber: DictationTranscriber) async throws -> SpokenTranscript {
    var text: [String] = []
    var confidences: [Float] = []
    for try await result in transcriber.results where result.isFinal {
      text.append(String(result.text.characters))
      for run in result.text.runs {
        let characters = result.text[run.range].characters
        if characters.contains(where: { $0.isLetter || $0.isNumber }) {
          confidences.append(Float(run.transcriptionConfidence ?? 0))
        }
      }
    }
    return SpokenTranscript(text: text.joined(separator: " "), confidences: confidences, isFinal: true)
  }

  private func audioForAnalysis(_ source: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    if source.format == format { return source }
    let capacity = ceil(Double(source.frameLength) * format.sampleRate / source.format.sampleRate) + 1_024
    guard let converter = AVAudioConverter(from: source.format, to: format),
          let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(capacity)) else { return nil }
    var provided = false
    let status = converter.convert(to: converted, error: nil) { _, inputStatus in
      if provided {
        inputStatus.pointee = .endOfStream
        return nil
      }
      provided = true
      inputStatus.pointee = .haveData
      return source
    }
    return status != .error && converted.frameLength > 0 ? converted : nil
  }
}
#endif
