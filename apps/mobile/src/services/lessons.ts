import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where, type FirebaseFirestoreTypes } from "@react-native-firebase/firestore";
import { getDownloadURL, ref } from "@react-native-firebase/storage";
import { displayLessonSegment, LessonSchema, visibleLessonText, type Lesson, type UserProfile } from "@resolingo/shared";
import { firestore, storage } from "./firebase";

const iso = (value: unknown): string => {
  if (value && typeof value === "object" && "toDate" in value) return (value as FirebaseFirestoreTypes.Timestamp).toDate().toISOString();
  return typeof value === "string" ? value : new Date(0).toISOString();
};

export function subscribeProfile(uid: string, callback: (profile: UserProfile | null) => void): () => void {
  return onSnapshot(doc(firestore, "users", uid), (snapshot) => {
    callback(snapshot.exists() ? ({ uid, ...snapshot.data() } as UserProfile) : null);
  });
}

function shown(value: unknown): unknown {
  return typeof value === "string" ? visibleLessonText(value) : value;
}

function shownSegments(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((segment) => {
    if (!segment || typeof segment !== "object" || typeof (segment as { text?: unknown }).text !== "string") return segment;
    return displayLessonSegment(segment as { text: string; translation?: string; transliteration?: string });
  });
}

function mapLesson(document: FirebaseFirestoreTypes.QueryDocumentSnapshot | FirebaseFirestoreTypes.DocumentSnapshot): Lesson {
  const data = document.data();
  if (!data) throw new Error(`Lesson ${document.id} has no data.`);
  return LessonSchema.parse({
    ...data,
    title: shown(data.title),
    topic: shown(data.topic),
    summary: shown(data.summary),
    segments: shownSegments(data.segments),
    id: document.id,
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
  });
}

export function subscribeReadyCount(uid: string, quotaDate: string, callback: (count: number) => void): () => void {
  return onSnapshot(doc(firestore, "users", uid, "dailyUsage", quotaDate), (snapshot) => {
    const value = snapshot.data()?.readyCount;
    callback(typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, () => callback(0));
}

export function subscribeLessons(uid: string, callback: (lessons: Lesson[]) => void, onError?: (error: Error) => void): () => void {
  const lessonsQuery = query(collection(firestore, "users", uid, "lessons"), orderBy("createdAt", "desc"), limit(50));
  const cached = new Map<string, { updatedAt: string; lesson: Lesson }>();
  return onSnapshot(lessonsQuery, (snapshot) => {
    const lessons: Lesson[] = [];
    const live = new Set<string>();
    let firstError: Error | undefined;
    for (const document of snapshot.docs) {
      live.add(document.id);
      const data = document.data();
      const updatedAt = data?.updatedAt ? iso(data.updatedAt) : "";
      const previous = updatedAt ? cached.get(document.id) : undefined;
      if (previous && previous.updatedAt === updatedAt) {
        lessons.push(previous.lesson);
        continue;
      }
      try {
        const lesson = mapLesson(document);
        if (updatedAt) cached.set(document.id, { updatedAt, lesson });
        lessons.push(lesson);
      } catch {
        firstError ??= new Error(`Could not read lesson ${document.id}.`);
      }
    }
    for (const id of cached.keys()) if (!live.has(id)) cached.delete(id);
    callback(lessons);
    if (firstError) onError?.(firstError);
  }, onError);
}

export function subscribeLesson(uid: string, lessonId: string, callback: (lesson: Lesson | null) => void, onError?: (error: Error) => void): () => void {
  return onSnapshot(doc(firestore, "users", uid, "lessons", lessonId), (snapshot) => {
    try {
      callback(snapshot.exists() ? mapLesson(snapshot) : null);
    } catch {
      onError?.(new Error(`Could not read lesson ${lessonId}.`));
    }
  }, onError);
}

export function subscribeCompletedLessons(
  uid: string,
  count: number,
  callback: (lessons: Lesson[], hasMore: boolean) => void,
  onError: (error: Error) => void,
): () => void {
  const completed = query(collection(firestore, "users", uid, "lessons"),
    where("completed", "==", true), orderBy("updatedAt", "desc"), limit(count + 1));
  return onSnapshot(completed, (snapshot) => {
    const lessons: Lesson[] = [];
    for (const document of snapshot.docs.slice(0, count)) {
      try { lessons.push(mapLesson(document)); }
      catch { continue; }
    }
    callback(lessons, snapshot.size > count);
  }, onError);
}

const artworkUrls = new Map<string, Promise<string | undefined>>();

/** Resolves the artwork download URL once per path. Missing or unreadable artwork falls back to the badge. */
export function resolveArtworkUrl(artworkPath: string | undefined): Promise<string | undefined> {
  if (!artworkPath) return Promise.resolve(undefined);
  let pending = artworkUrls.get(artworkPath);
  if (!pending) {
    pending = getDownloadURL(ref(storage, artworkPath)).catch(() => {
      artworkUrls.delete(artworkPath);
      return undefined;
    });
    artworkUrls.set(artworkPath, pending);
  }
  return pending;
}

export async function resolveAudioUrls(lesson: Lesson): Promise<Lesson> {
  const [segments, artworkUrl] = await Promise.all([
    Promise.all(lesson.segments.map(async (segment) => ({
      ...segment,
      audioUrl: segment.audioPath ? await getDownloadURL(ref(storage, segment.audioPath)) : undefined,
    }))),
    resolveArtworkUrl(lesson.artworkPath),
  ]);
  return { ...lesson, segments, ...(artworkUrl ? { artworkUrl } : {}) };
}

export async function markLessonCompleted(uid: string, lessonId: string): Promise<void> {
  await updateDoc(doc(firestore, "users", uid, "lessons", lessonId), { completed: true, updatedAt: new Date() });
}
