import { collection, doc, limit, onSnapshot, orderBy, query, type FirebaseFirestoreTypes } from "@react-native-firebase/firestore";
import { getDownloadURL, ref } from "@react-native-firebase/storage";
import { PhraseSchema, type Phrase } from "@resolingo/shared";
import { firestore, storage } from "./firebase";

const iso = (value: unknown): string => {
  if (value && typeof value === "object" && "toDate" in value) return (value as FirebaseFirestoreTypes.Timestamp).toDate().toISOString();
  return typeof value === "string" ? value : new Date(0).toISOString();
};

export function subscribePhrases(uid: string, callback: (phrases: Phrase[]) => void, onError?: (error: Error) => void): () => void {
  const phrasesQuery = query(collection(firestore, "users", uid, "phrases"), orderBy("createdAt", "desc"), limit(100));
  return onSnapshot(phrasesQuery, (snapshot) => {
    const phrases: Phrase[] = [];
    for (const document of snapshot.docs) {
      const data = document.data();
      const parsed = PhraseSchema.safeParse({
        ...data,
        id: document.id,
        createdAt: iso(data.createdAt),
        updatedAt: iso(data.updatedAt),
      });
      if (parsed.success) phrases.push(parsed.data);
    }
    callback(phrases);
  }, (error) => onError?.(error));
}

export function subscribePhrase(uid: string, phraseId: string, callback: (phrase: Phrase | null) => void, onError?: (error: Error) => void): () => void {
  return onSnapshot(doc(firestore, "users", uid, "phrases", phraseId), (snapshot) => {
    if (!snapshot.exists) {
      callback(null);
      return;
    }
    const data = snapshot.data();
    const parsed = PhraseSchema.safeParse({
      ...data,
      id: snapshot.id,
      createdAt: iso(data?.createdAt),
      updatedAt: iso(data?.updatedAt),
    });
    callback(parsed.success ? parsed.data : null);
  }, (error) => onError?.(error));
}

export async function phraseAudioUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path));
}
