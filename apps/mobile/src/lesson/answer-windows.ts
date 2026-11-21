import { lessonDisplayText, type LanguageId, type LessonSegment } from "@resolingo/shared";
import type { PlaybackClip } from "./timeline";

export type AnswerWindow = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  feedbackAtSeconds?: number;
  expected: string;
};

export type PracticePrompt = AnswerWindow & {
  answerId: string;
  translation?: string;
  modelAudioUrl?: string;
};

export type AnswerPlan = { language: LanguageId; windows: PracticePrompt[] };

/** Use measured durations of the joined file and only drill pairs with a clear model answer. */
export function answerPlan(segments: LessonSegment[], clips: PlaybackClip[], durationsMs: number[]): AnswerPlan | null {
  if (clips.length !== durationsMs.length || durationsMs.some((ms) => !Number.isFinite(ms) || ms <= 0)) return null;

  let clipEndMs = 0;
  let language: LanguageId | undefined;
  const windows: PracticePrompt[] = [];
  const followingSegment = new Map(segments.map((segment, index) => [segment.id, segments[index + 1]?.id]));
  for (const [index, clip] of clips.entries()) {
    const duration = durationsMs[index]!;
    clipEndMs += duration;
    const prompt = clip.segments[0];
    const answerClip = clips[index + 1];
    const answer = answerClip?.segments[0];
    const pause = prompt?.pauseAfterMs;
    if (clip.segments.length !== 1 ||
        !prompt || !answer || !pause || pause < 1_200 || duration < pause ||
        prompt.kind !== "drill" || prompt.speaker !== "teacher" ||
        prompt.phase === "notice" || prompt.phase === "check" ||
        (answer.kind !== "drill" && answer.kind !== "example") ||
        followingSegment.get(prompt.id) !== answer.id ||
        prompt.language === answer.language ||
        (language && language !== answer.language)) continue;
    const expected = lessonDisplayText(answer.text).trim();
    if (!expected) continue;
    language = answer.language;
    windows.push({
      id: prompt.id,
      // Stay inside the baked silence, including for the two-second buildup drills.
      startSeconds: (clipEndMs - pause + 60) / 1_000,
      endSeconds: (clipEndMs - 220) / 1_000,
      ...(clips[index + 2] && durationsMs[index + 1] ? { feedbackAtSeconds: (clipEndMs + durationsMs[index + 1]!) / 1_000 } : {}),
      expected,
      answerId: answer.id,
      ...(answer.translation ? { translation: lessonDisplayText(answer.translation) } : {}),
      ...(answerClip.segments.length === 1 ? { modelAudioUrl: answerClip.audioUrl } : {}),
    });
  }
  return language ? { language, windows } : null;
}
