import { describe, expect, it } from "vitest";
import { joinAudio, mp3DurationMs, wavDurationMs } from "./combine-audio";

function wav(samples: number, sampleRate = 8000): Uint8Array {
  const pcm = new Uint8Array(samples * 2);
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  out.set([82, 73, 70, 70], 0);
  view.setUint32(4, 36 + pcm.length, true);
  out.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  out.set([100, 97, 116, 97], 36);
  view.setUint32(40, pcm.length, true);
  return out;
}

function mp3Frame(): Uint8Array {
  const frame = new Uint8Array(417);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0xc0;
  return frame;
}

describe("join lesson audio", () => {
  it("reads a wav duration and joins clips into one file", () => {
    const first = wav(8000);
    const second = wav(4000);
    expect(wavDurationMs(first)).toBe(1000);
    const joined = joinAudio([first, second]);
    expect(joined?.extension).toBe("wav");
    expect(joined?.durationsMs).toEqual([1000, 500]);
    expect(wavDurationMs(joined?.bytes ?? new Uint8Array())).toBe(1500);
  });

  it("reads an mp3 frame and keeps each clip's duration", () => {
    const frame = mp3Frame();
    expect(mp3DurationMs(frame)).toBe(26);
    const joined = joinAudio([frame, frame]);
    expect(joined?.extension).toBe("mp3");
    expect(joined?.durationsMs).toEqual([26, 26]);
    expect(joined?.bytes.length).toBe(frame.length * 2);
  });

  it("refuses to mix wav and mp3", () => {
    expect(joinAudio([wav(80), mp3Frame()])).toBeNull();
  });
});
