import { AudioQuality, IOSOutputFormat, type RecordingOptions } from "expo-audio";

/** Speech is intelligible at a low AAC bitrate, which stays under the upload cap. */
export const SPEECH_RECORDING: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  isMeteringEnabled: true,
  android: {
    extension: ".m4a",
    outputFormat: "mpeg4",
    audioEncoder: "aac",
    sampleRate: 16000,
    audioSource: "voice_recognition",
  },
  ios: {
    extension: ".m4a",
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.LOW,
    sampleRate: 16000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/mp4",
    bitsPerSecond: 32000,
  },
};
