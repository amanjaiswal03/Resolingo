# New Google Cloud project

Production project id is `resolingo`, project number `168640425089`. `.firebaserc` aliases it as `prod`. Commands below target that project. Set `FIREBASE_PROJECT_ID` to a different id when you want another environment. Unit tests and `npm run test:rules` use the local emulator project `demo-resolingo` and do not touch production.

```bash
export FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-resolingo}"
export REGION=europe-west1
```

`REGION` stays `europe-west1`. That value is fixed in `functions/src/config.ts`.

## 1. Project and billing

- [ ] Confirm project `resolingo` (`168640425089`) is the Firebase project you will deploy. Console: https://console.cloud.google.com/home/dashboard?project=resolingo
- [ ] Upgrade Firebase to the Blaze plan and attach a billing account. Functions, Cloud Tasks, and Text-to-Speech will not run without it.
- [ ] Create a budget for this project only: Billing → Budgets & alerts. Set a monthly amount you can afford to lose. Alert at 50%, 80%, and 100%. Email the owner.
- [ ] Locations already chosen for `resolingo`. They cannot be moved later.
  - [x] Firestore: `europe-west1`
  - [x] Storage bucket: `gs://resolingo.firebasestorage.app` (`europe-west1`)
  - [ ] Functions, Tasks, Scheduler, Artifact Registry: `europe-west1`

## 2. APIs

- [ ] Enable:

```bash
gcloud services enable \
  identitytoolkit.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  cloudtasks.googleapis.com \
  cloudscheduler.googleapis.com \
  eventarc.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  texttospeech.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  firebase.googleapis.com \
  fcm.googleapis.com \
  aiplatform.googleapis.com \
  --project "$FIREBASE_PROJECT_ID"
```

- [ ] In APIs & Services → Cloud Text-to-Speech API → Quotas, confirm WaveNet and Standard character quotas. The free tier is 4 million characters per month for those voices. Leave Chirp 3 HD unused.
- [ ] Keep `TTS_VOICE_TIER=wavenet` (the default). Copy `functions/.env.example` to `functions/.env` only to change `TTS_VOICE_TIER`, `GEMINI_LESSON_MODEL`, or `GEMINI_LOCATION`. Do not put API keys in that file.
- [ ] Lesson text uses Vertex AI, not an API key. Default model is `gemini-3.5-flash-lite` (GA, 21 Jul 2026). It is not available in `europe-west1`. The default location is the EU multi-region `eu` (`https://aiplatform.eu.rep.googleapis.com`), which keeps processing in the EU. `global` also works and can be set with `GEMINI_LOCATION`.
- [ ] Grant the Functions runtime service account `roles/aiplatform.user`. For this project's default compute account:

```bash
gcloud projects add-iam-policy-binding "$FIREBASE_PROJECT_ID" \
  --member="serviceAccount:168640425089-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

Replace the member if Functions runs as a different service account. List price checked 4 Nov 2026: $0.30 per million input tokens and $2.50 per million output tokens, including thinking tokens. At three short lessons a day that is well under a dollar per active user per month. WaveNet Text-to-Speech is still the larger Google bill.

## 3. Firebase apps and native config

Both registered Firebase apps use bundle id `com.resolingo.app`. `APP_IDENTIFIER` overrides that in `apps/mobile/app.config.ts`. `APP_VARIANT` only changes the display name.

| Platform | Bundle id | Firebase app id |
|---|---|---|
| Android | `com.resolingo.app` | `1:168640425089:android:d2148d985606955459b180` |
| iOS | `com.resolingo.app` | `1:168640425089:ios:3fa21043c368503659b180` |

- [x] Android and iOS apps are registered in project `resolingo`.
- [x] `GoogleService-Info.plist` and `google-services.json` exist for those apps. Do not commit them. EAS still needs them as file variables.
- [ ] Add the Android SHA-1 and SHA-256 (debug, upload, and Play signing) to the Android app. None are registered yet, and the Android `google-services.json` has no OAuth client until a fingerprint exists.
- [x] Google sign-in is enabled. The web client id is `168640425089-9rt7kh4f1sil6p7cphd8jojvhr8da0p3.apps.googleusercontent.com`.
- [ ] Enable Apple sign-in. It is not configured. Apple needs the Services ID and the Firebase callback `https://resolingo.firebaseapp.com/__/auth/handler`.
- [x] The web client id is in `.env.example` and in every `apps/mobile/eas.json` build profile.

## 4. App Check

Callable functions already set `enforceAppCheck: true`. A build with no token cannot call them.

- [ ] Register App Attest (DeviceCheck fallback) for iOS and Play Integrity for Android. In the Firebase console, open App Check, then Apps, then the iOS app, and add App Attest with the Apple Team ID. Add DeviceCheck with a DeviceCheck `.p8` key from the Apple Developer portal. Until this is done, TestFlight and App Store builds get no App Check token and every callable fails with "unauthenticated".
- [x] `app.config.ts` sets the `com.apple.developer.devicecheck.appattest-environment` entitlement to `production`. EAS turns on the App Attest capability for the App ID when it builds.
- [ ] Create an App Check debug token and register it for each development device before the first lesson request.
- [ ] Watch valid and invalid metrics before you rely on a production build.

## 5. Secrets

These are Secret Manager values, not EAS variables and not `functions/.env`.

`EXPO_ACCESS_TOKEN` is already in Secret Manager for project `resolingo`. Rotate it with:

```bash
firebase functions:secrets:set EXPO_ACCESS_TOKEN --project "$FIREBASE_PROJECT_ID"
```

- [x] `EXPO_ACCESS_TOKEN` exists. Do not create a second copy.
- [ ] Gemini does not use a secret. `OPENAI_API_KEY` and `SAFETY_IDENTIFIER_SECRET` are not part of this app.
- [ ] Use a dedicated Functions runtime service account if you prefer. Grant Firestore, the app Storage bucket, Text-to-Speech, Cloud Tasks enqueue, Secret Manager access, log writing, and `roles/aiplatform.user`. Do not grant Owner or Editor.

## 6. Deploy

Cloud Tasks creates the `generateLessonTask` queue during the functions deploy. Do not create it by hand first.

```bash
npm run deploy:rules
npm run deploy:functions
```

- [x] Rules, indexes, and Storage are deployed. The four lesson and reminder indexes are `READY`.
- [x] Cloud Tasks queue `generateLessonTask` is `RUNNING` in `europe-west1`, with max concurrent dispatches 8.
- [ ] Run `TTS_VOICE_TIER=wavenet npm run validate:voices -w @resolingo/functions` with Application Default Credentials pointed at this project. It fails if a language has fewer than two WaveNet voices and no Standard pair.

## 7. EAS

The Expo project already exists. `apps/mobile/app.config.ts` defaults to it. `EXPO_OWNER` and `EXPO_PUBLIC_EAS_PROJECT_ID` override those defaults.

| Field | Value |
|---|---|
| Owner | `amanjaiswal03` |
| Slug | `resolingo` |
| Project id | `89e3143e-acd3-47b4-95ff-3c131a3f2535` |

```bash
npx eas-cli login
npx eas-cli project:info
```

- [x] EAS project `89e3143e-acd3-47b4-95ff-3c131a3f2535` is the default in `app.config.ts`.
- [ ] Create the `development` environment if it does not exist yet. Public values are in `.env.example`. `EXPO_PUBLIC_FIREBASE_PROJECT_ID` must stay `resolingo` for this backend.
- [ ] Upload file variables `GOOGLE_SERVICES_INFO_PLIST` and `GOOGLE_SERVICES_JSON`. The app reads the project from those files.
- [ ] Build a development client: `npx eas-cli build --profile development --platform ios` and the Android equivalent, from `apps/mobile`.
- [ ] Add an APNs key for iOS. For Android, upload an FCM v1 credential to Expo. Push sending uses Expo, and the sender is still a Cloud Function in this project.

## 8. First lesson

- [ ] Sign in on a device that has the App Check debug token.
- [ ] Finish onboarding, request one conversation lesson, and confirm the audio plays.
- [ ] Request a fourth lesson the same local day and confirm the server rejects it.
- [ ] Turn reminders on and confirm a token lands in `users/{uid}/devices`.
- [ ] Delete the test account and confirm Auth, Firestore, and Storage are empty for that uid.

Store listing, privacy policy, and production rollout stay in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). Apple, Play, and monitoring detail stay in [CLOUD_SETUP.md](CLOUD_SETUP.md).
