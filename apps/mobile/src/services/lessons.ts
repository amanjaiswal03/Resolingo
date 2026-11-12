import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, type FirebaseFirestoreTypes } from "@react-native-firebase/firestore";
import { getDownloadURL, ref } from "@react-native-firebase/storage";
import { LessonSchema, type Lesson, type UserProfile } from "@resolingo/shared";
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

function mapLesson(document: FirebaseFirestoreTypes.QueryDocumentSnapshot | FirebaseFirestoreTypes.DocumentSnapshot): Lesson {
  const data = document.data();
  if (!data) throw new Error(`Lesson ${document.id} has no data.`);
  return LessonSchema.parse({
    ...data,
    id: document.id,
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
  });
}

export function subscribeLessons(uid: string, callback: (lessons: Lesson[]) => void, onError?: (error: Error) => void): () => void {
  const lessonsQuery = query(collection(firestore, "users", uid, "lessons"), orderBy("createdAt", "desc"), limit(50));
  return onSnapshot(lessonsQuery, (snapshot) => {
    const lessons: Lesson[] = [];
    let firstError: Error | undefined;
    for (const document of snapshot.docs) {
      try {
        lessons.push(mapLesson(document));
      } catch {
        firstError ??= new Error(`Could not read lesson ${document.id}.`);
      }
    }
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

export async function resolveAudioUrls(lesson: Lesson): Promise<Lesson> {
  const segments = await Promise.all(lesson.segments.map(async (segment) => ({
    ...segment,
    audioUrl: segment.audioPath ? await getDownloadURL(ref(storage, segment.audioPath)) : undefined,
  })));
  return { ...lesson, segments };
}

export async function markLessonCompleted(uid: string, lessonId: string): Promise<void> {
  await updateDoc(doc(firestore, "users", uid, "lessons", lessonId), { completed: true, updatedAt: new Date() });
}
