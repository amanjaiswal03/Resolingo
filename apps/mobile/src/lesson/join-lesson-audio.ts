import { Directory, File, Paths } from "expo-file-system";
import { joinAudio } from "./combine-audio";

export type LessonAudioPart = { audioUrl: string; audioPath?: string };

function cacheKey(parts: LessonAudioPart[]): string {
  const text = parts.map((part) => part.audioPath || part.audioUrl).join("|");
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  return (hash >>> 0).toString(16);
}

/** Download every clip and store one file so the lock screen shows a single lesson. */
export async function joinLessonAudio(parts: LessonAudioPart[]): Promise<{ uri: string; durationsMs: number[] } | null> {
  if (parts.length === 0) return null;
  const directory = new Directory(Paths.cache, "lesson-audio");
  if (!directory.exists) directory.create({ idempotent: true });
  const key = cacheKey(parts);
  const downloads = await Promise.all(parts.map(async (part, index) => {
    const destination = new File(directory, `${key}-${index}`);
    if (!destination.exists) await File.downloadFileAsync(part.audioUrl, destination, { idempotent: true });
    return destination.bytes();
  }));
  const joined = joinAudio(downloads);
  if (!joined) return null;
  const output = new File(directory, `${key}.${joined.extension}`);
  if (!output.exists) output.create({ intermediates: true });
  output.write(joined.bytes);
  return { uri: output.uri, durationsMs: joined.durationsMs };
}
