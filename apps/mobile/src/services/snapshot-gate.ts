/**
 * How long an empty answer from the on-device cache is held back while the
 * server is asked. Past this the empty answer is shown, so an offline learner
 * still gets a page instead of an endless skeleton.
 */
export const SERVER_GRACE_MS = 6000;

export type SnapshotGateInput = {
  /** A snapshot has already been passed on to the screen. */
  delivered: boolean;
  /** The snapshot came from the on-device cache, not the server. */
  fromCache: boolean;
  /** The snapshot holds nothing: no documents, or a missing document. */
  empty: boolean;
  /** The documents themselves changed, not only their metadata. */
  changed: boolean;
};

/**
 * Decide what to do with a snapshot from a listener that also hears metadata
 * changes. A first answer that is empty and came from the cache usually means
 * the cache has not caught up yet, not that the learner has nothing, so it is
 * held until the server answers. Later metadata-only snapshots are dropped.
 */
export function gateSnapshot({ delivered, fromCache, empty, changed }: SnapshotGateInput): "deliver" | "hold" | "skip" {
  if (!delivered) return fromCache && empty ? "hold" : "deliver";
  return changed ? "deliver" : "skip";
}
