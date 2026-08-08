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

function mapLesson(document: FirebaseFirestoreTypes.QueryDocumentSnapshot): Lesson {
  const data = document.data();
  return LessonSchema.parse({
    ...data,
    id: document.id,
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
  });
}

export function subscribeLessons(uid: string, callback: (lessons: Lesson[]) => void, onError?: (error: Error) => void): () => void {
  const lessonsQuery = query(collection(firestore, "users", uid, "lessons"), orderBy("createdAt", "desc"), limit(50));
  return onSnapshot(lessonsQuery, (snapshot) => callback(snapshot.docs.map(mapLesson)), onError);
}

export function subscribeLesson(uid: string, lessonId: string, callback: (lesson: Lesson | null) => void): () => void {
  return onSnapshot(doc(firestore, "users", uid, "lessons", lessonId), (snapshot) => {
    callback(snapshot.exists() ? mapLesson(snapshot as FirebaseFirestoreTypes.QueryDocumentSnapshot) : null);
  });
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
