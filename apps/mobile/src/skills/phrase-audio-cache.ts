import { Directory, File, Paths } from "expo-file-system";
import { phraseAudioUrl } from "@/services/phrases";

const pending = new Map<string, Promise<string>>();

/** A storage path as one safe file name, keeping its extension so the player knows the format. */
export function cacheFileName(path: string): string {
  return path.replace(/[^A-Za-z0-9._-]+/g, "_");
}

/**
 * Download a phrase clip once and play it from the device after that.
 * Fetching a fresh link and streaming it on every tap is what made clips lag.
 */
export function cachedPhraseAudio(path: string): Promise<string> {
  const known = pending.get(path);
  if (known) return known;
  const task = (async () => {
    const directory = new Directory(Paths.cache, "phrase-audio");
    if (!directory.exists) directory.create({ idempotent: true, intermediates: true });
    const destination = new File(directory, cacheFileName(path));
    if (destination.exists && (destination.size ?? 0) > 0) return destination.uri;
    const url = await phraseAudioUrl(path);
    try {
      const file = await File.downloadFileAsync(url, destination, { idempotent: true });
      return file.uri;
    } catch {
      // Stream it this time if the download can't be stored.
      return url;
    }
  })();
  pending.set(path, task);
  task.catch(() => pending.delete(path));
  return task;
}

/** Start fetching a clip before it is needed. Errors surface when it is played. */
export function prefetchPhraseAudio(path: string | undefined | null): void {
  if (path) void cachedPhraseAudio(path).catch(() => undefined);
}
