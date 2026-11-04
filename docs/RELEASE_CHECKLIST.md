# Release checklist

- [ ] Production deploys target `resolingo` (number `168640425089`, `.firebaserc` alias `prod`) unless `FIREBASE_PROJECT_ID` overrides it. The native plist and `google-services.json` match `com.resolingo.app` (Android `1:168640425089:android:d2148d985606955459b180`, iOS `1:168640425089:ios:3fa21043c368503659b180`). Firestore, Storage (`gs://resolingo.firebasestorage.app`), and functions are in `europe-west1`.
- [ ] EAS owner is `amanjaiswal03` and project id is `89e3143e-acd3-47b4-95ff-3c131a3f2535`, unless `EXPO_OWNER` or `EXPO_PUBLIC_EAS_PROJECT_ID` overrides them. `EXPO_ACCESS_TOKEN` in Secret Manager is the token for that Expo account.
- [ ] Billing alerts exist at 50%, 80%, and 100%. `TTS_VOICE_TIER` is `wavenet` unless a budget review chose another tier.
- [ ] Rules and indexes are deployed and emulator ownership/race tests pass.
- [ ] Runtime IAM is least-privileged; no service-account JSON key exists.
- [ ] Gemini and TTS A1 and B2 smoke tests pass for both lesson types across all enabled languages.
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
