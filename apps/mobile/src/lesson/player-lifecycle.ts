/**
 * Tear down an audio player we created ourselves.
 *
 * `useAudioPlayer` releases its native shared object in an effect cleanup.
 * React runs those cleanups in declaration order, so any later cleanup
 * (lock-screen deactivation, status listeners) calls into an object that
 * expo-modules-core has already detached. On the iOS dev client that throws
 * `NativeSharedObjectNotFoundException` out of unmount and crashes the app
 * on back, swipe, and the in-app exit alike.
 *
 * Pause and clear the lock screen first so playback stops even when SDK 57
 * defers native deallocation, then release. Each step is isolated: one
 * failure must not skip the rest or escape into React's unmount.
 */
export type OwnedAudioPlayer = {
  pause: () => void;
  clearLockScreenControls: () => void;
  release: () => void;
};

export function stopOwnedPlayer(player: OwnedAudioPlayer, removeListeners?: () => void): void {
  const steps = [
    removeListeners,
    () => player.pause(),
    () => player.clearLockScreenControls(),
    () => player.release(),
  ];
  for (const step of steps) {
    if (!step) continue;
    try {
      step();
    } catch {
      // The native object may already be gone. Keep tearing down.
    }
  }
}
