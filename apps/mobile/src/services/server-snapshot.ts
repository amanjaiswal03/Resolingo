import { onSnapshot, type FirebaseFirestoreTypes } from "@react-native-firebase/firestore";
import { gateSnapshot, SERVER_GRACE_MS } from "./snapshot-gate";

type Gate<S> = {
  next: (snapshot: S) => void;
  error: ((error: Error) => void) | undefined;
};

/** Holds a first empty cached snapshot until the server answers, or until the grace period ends. */
function gated<S extends { metadata: FirebaseFirestoreTypes.SnapshotMetadata }>(
  { next, error }: Gate<S>,
  describe: (snapshot: S) => { empty: boolean; changed: boolean },
) {
  let delivered = false;
  let held: S | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const deliver = (snapshot: S) => {
    clear();
    held = null;
    delivered = true;
    next(snapshot);
  };
  return {
    onNext: (snapshot: S) => {
      const { empty, changed } = describe(snapshot);
      const decision = gateSnapshot({ delivered, fromCache: snapshot.metadata.fromCache, empty, changed });
      if (decision === "skip") return;
      if (decision === "deliver") {
        deliver(snapshot);
        return;
      }
      held = snapshot;
      timer ??= setTimeout(() => { if (held) deliver(held); }, SERVER_GRACE_MS);
    },
    onError: (failure: Error) => {
      clear();
      held = null;
      error?.(failure);
    },
    stop: clear,
  };
}

/**
 * Like `onSnapshot` for a query, but an empty first answer from the on-device
 * cache waits for the server, so a screen shows its skeleton instead of an
 * empty state that flips to content a moment later.
 */
export function onServerQuerySnapshot(
  // Typed loosely: the SDK's query() and onSnapshot() disagree on the document type for untyped queries.
  query: unknown,
  next: (snapshot: FirebaseFirestoreTypes.QuerySnapshot) => void,
  error?: (error: Error) => void,
): () => void {
  const gate = gated<FirebaseFirestoreTypes.QuerySnapshot>({ next, error }, (snapshot) => ({
    empty: snapshot.empty,
    changed: snapshot.docChanges().length > 0,
  }));
  // The SDK's query types want DocumentData; the queries here are untyped, so cast once at the edge.
  const unsubscribe = onSnapshot(query as unknown as FirebaseFirestoreTypes.Query, { includeMetadataChanges: true }, gate.onNext, gate.onError);
  return () => {
    gate.stop();
    unsubscribe();
  };
}

/** The same as `onServerQuerySnapshot`, for one document: a missing document from the cache waits for the server. */
export function onServerDocSnapshot(
  reference: FirebaseFirestoreTypes.DocumentReference,
  next: (snapshot: FirebaseFirestoreTypes.DocumentSnapshot) => void,
  error?: (error: Error) => void,
): () => void {
  let last: string | undefined;
  const gate = gated<FirebaseFirestoreTypes.DocumentSnapshot>({ next, error }, (snapshot) => {
    const key = snapshot.exists() ? JSON.stringify(snapshot.data()) : "";
    const changed = key !== last;
    last = key;
    return { empty: !snapshot.exists(), changed };
  });
  const unsubscribe = onSnapshot(reference, { includeMetadataChanges: true }, gate.onNext, gate.onError);
  return () => {
    gate.stop();
    unsubscribe();
  };
}
