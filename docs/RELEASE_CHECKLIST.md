# Release checklist

- [ ] Dev and prod are distinct billed Firebase/GCP projects in `eur3` / `europe-west1` with EU Storage.
- [ ] Rules and indexes are deployed and emulator ownership/race tests pass.
- [ ] Runtime IAM is least-privileged; no service-account JSON key exists.
- [ ] OpenAI/TTS A1 and B2 smoke tests pass for both lesson types across all enabled languages.
- [ ] App Check debug, preview, and production attestations pass before enforcement.
- [ ] Google login passes on physical iOS/Android; Apple login passes on physical iOS.
- [ ] The fourth local-day request fails and failed jobs release quota.
- [ ] Duplicate taps return one job; an active job survives app termination.
- [ ] Transcript sync, seek, speed, interruptions, background audio, and lock-screen controls pass.
- [ ] Expo and native push tokens rotate correctly; reminders land within 15 minutes and skip active days.
- [ ] Telemetry is off before consent and toggles immediately.
- [ ] Recursive deletion is verified in Auth, Firestore, Storage, and device tokens.
- [ ] Privacy policy, support URL, store copy, screenshots, final icon approval, and data-safety forms are complete.
- [ ] No excluded legacy feature, identifier, or branding is present.
