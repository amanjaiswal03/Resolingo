export type JoinedAudio = { bytes: Uint8Array; durationsMs: number[]; extension: "mp3" | "wav" };

const MPEG1_L3_BITRATE = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG2_L3_BITRATE = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MPEG1_RATE = [44100, 48000, 32000];
const MPEG2_RATE = [22050, 24000, 16000];
const MPEG25_RATE = [11025, 12000, 8000];

function text(bytes: Uint8Array, start: number, end: number): string {
  let value = "";
  for (let index = start; index < end; index += 1) value += String.fromCharCode(bytes[index] ?? 0);
  return value;
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (u16(bytes, offset) | (u16(bytes, offset + 2) << 16)) >>> 0;
}

/** Bytes to skip for a leading ID3v2 tag. Later tags are left for the decoder. */
export function id3PrefixLength(bytes: Uint8Array): number {
  if (text(bytes, 0, 3) !== "ID3" || bytes.length < 10) return 0;
  const size = ((bytes[6] ?? 0) & 0x7f) << 21 | ((bytes[7] ?? 0) & 0x7f) << 14 | ((bytes[8] ?? 0) & 0x7f) << 7 | ((bytes[9] ?? 0) & 0x7f);
  return Math.min(bytes.length, 10 + size);
}

function frameAt(bytes: Uint8Array, offset: number): { sampleRate: number; samples: number; length: number } | null {
  if (offset + 4 > bytes.length) return null;
  const b0 = bytes[offset] ?? 0;
  const b1 = bytes[offset + 1] ?? 0;
  const b2 = bytes[offset + 2] ?? 0;
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 0x03;
  const layer = (b1 >> 1) & 0x03;
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const rateIndex = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const bitrate = (version === 3 ? MPEG1_L3_BITRATE : MPEG2_L3_BITRATE)[bitrateIndex] ?? 0;
  const sampleRate = (version === 3 ? MPEG1_RATE : version === 2 ? MPEG2_RATE : MPEG25_RATE)[rateIndex] ?? 0;
  if (!bitrate || !sampleRate) return null;
  const samples = version === 3 ? 1152 : 576;
  const length = Math.floor((samples / 8) * (bitrate * 1000) / sampleRate) + padding;
  if (length < 4 || offset + length > bytes.length) return null;
  return { sampleRate, samples, length };
}

export function mp3DurationMs(bytes: Uint8Array): number | null {
  let offset = id3PrefixLength(bytes);
  let samples = 0;
  let rate = 0;
  let frames = 0;
  while (offset + 4 <= bytes.length && frames < 200_000) {
    const frame = frameAt(bytes, offset);
    if (!frame) {
      offset += 1;
      if (frames > 0 && offset > bytes.length - 4) break;
      continue;
    }
    samples += frame.samples;
    rate = frame.sampleRate;
    offset += frame.length;
    frames += 1;
  }
  if (!frames || !rate) return null;
  return Math.round((samples / rate) * 1000);
}

export function wavDurationMs(bytes: Uint8Array): number | null {
  if (text(bytes, 0, 4) !== "RIFF" || text(bytes, 8, 12) !== "WAVE") return null;
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 16;
  let dataLength = 0;
  while (offset + 8 <= bytes.length) {
    const id = text(bytes, offset, offset + 4);
    const size = u32(bytes, offset + 4);
    if (id === "fmt " && offset + 24 <= bytes.length) {
      channels = u16(bytes, offset + 10);
      sampleRate = u32(bytes, offset + 12);
      bits = u16(bytes, offset + 22);
    } else if (id === "data") {
      dataLength = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!sampleRate || !channels || !bits || !dataLength) return null;
  return Math.round((dataLength / (sampleRate * channels * (bits / 8))) * 1000);
}

function wavData(bytes: Uint8Array): { pcm: Uint8Array; sampleRate: number; channels: number; bits: number } | null {
  if (wavDurationMs(bytes) == null) return null;
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 16;
  while (offset + 8 <= bytes.length) {
    const id = text(bytes, offset, offset + 4);
    const size = u32(bytes, offset + 4);
    if (id === "fmt " && offset + 24 <= bytes.length) {
      channels = u16(bytes, offset + 10);
      sampleRate = u32(bytes, offset + 12);
      bits = u16(bytes, offset + 22);
    } else if (id === "data") {
      const start = offset + 8;
      return { pcm: bytes.slice(start, start + size), sampleRate, channels, bits };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

function wavFile(pcm: Uint8Array, sampleRate: number, channels: number, bits: number): Uint8Array {
  const block = channels * (bits / 8);
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  out.set([82, 73, 70, 70], 0);
  view.setUint32(4, 36 + pcm.length, true);
  out.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * block, true);
  view.setUint16(32, block, true);
  view.setUint16(34, bits, true);
  out.set([100, 97, 116, 97], 36);
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** One playable file, in clip order, with each clip's real duration. */
export function joinAudio(parts: Uint8Array[]): JoinedAudio | null {
  if (parts.length === 0 || parts.some((part) => part.length === 0)) return null;
  const wavs = parts.map(wavData);
  if (wavs.every((part) => part != null)) {
    const first = wavs[0];
    if (!first) return null;
    if (wavs.some((part) => part?.sampleRate !== first.sampleRate || part.channels !== first.channels || part.bits !== first.bits)) return null;
    const durationsMs = wavs.map((part) => part ? Math.round((part.pcm.length / (part.sampleRate * part.channels * (part.bits / 8))) * 1000) : 0);
    const size = wavs.reduce((sum, part) => sum + (part?.pcm.length ?? 0), 0);
    const pcm = new Uint8Array(size);
    let cursor = 0;
    for (const part of wavs) {
      if (!part) return null;
      pcm.set(part.pcm, cursor);
      cursor += part.pcm.length;
    }
    return { bytes: wavFile(pcm, first.sampleRate, first.channels, first.bits), durationsMs, extension: "wav" };
  }
  const durationsMs = parts.map(mp3DurationMs);
  if (durationsMs.some((duration) => duration == null)) return null;
  const audio = parts.map((part) => part.slice(id3PrefixLength(part)));
  const size = audio.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(size);
  let cursor = 0;
  for (const part of audio) {
    bytes.set(part, cursor);
    cursor += part.length;
  }
  return { bytes, durationsMs: durationsMs.filter((duration): duration is number => duration != null), extension: "mp3" };
}
