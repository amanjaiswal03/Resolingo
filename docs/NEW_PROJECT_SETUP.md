# New Google Cloud project

Use this checklist for a brand-new account. The repo does not contain a project id. Unit tests and `npm run test:rules` use the local emulator and do not need this project.

Set the id once and reuse it in every command below:

```bash
export FIREBASE_PROJECT_ID=your-new-project-id
export REGION=europe-west1
```

`REGION` stays `europe-west1`. That value is fixed in `functions/src/config.ts`.

## 1. Project and billing

- [ ] Create the project in the [Firebase console](https://console.firebase.google.com/) or with `gcloud projects create`. Firebase and Google Cloud must be the same project.
- [ ] Upgrade Firebase to the Blaze plan and attach a billing account. Functions, Cloud Tasks, and Text-to-Speech will not run without it.
- [ ] Create a budget for this project only: Billing → Budgets & alerts. Set a monthly amount you can afford to lose. Alert at 50%, 80%, and 100%. Email the owner.
- [ ] Choose locations at creation time. They cannot be moved later.
  - [ ] Firestore: `eur3`
  - [ ] Default Storage bucket: an EU location
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
  --project "$FIREBASE_PROJECT_ID"
```

- [ ] In APIs & Services → Cloud Text-to-Speech API → Quotas, confirm WaveNet and Standard character quotas. The free tier is 4 million characters per month for those voices. Leave Chirp 3 HD unused.
- [ ] Keep `TTS_VOICE_TIER=wavenet` (the default). Copy `functions/.env.example` to `functions/.env` only if you need to change the tier or the OpenAI model. Do not put API keys in that file.

## 3. Firebase apps and native config

Bundle ids come from `apps/mobile/app.config.ts`.

| Variant | iOS bundle id | Android package |
|---|---|---|
| Development (`APP_VARIANT` unset or `development`) | `com.resolingo.app.dev` | `com.resolingo.app.dev` |
| Production (`APP_VARIANT=production`) | `com.resolingo.app` | `com.resolingo.app` |

- [ ] Register the iOS and Android apps you will ship first. Development builds are enough to start.
- [ ] Download `GoogleService-Info.plist` and `google-services.json`. Do not commit them.
- [ ] Add the Android SHA-1 and SHA-256 (debug, upload, and Play signing) to the Android app.
- [ ] Enable Google and Apple sign-in under Authentication. Apple needs the Services ID and the Firebase callback `https://$FIREBASE_PROJECT_ID.firebaseapp.com/__/auth/handler`.
- [ ] Copy the Web client id into `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.

## 4. App Check

Callable functions already set `enforceAppCheck: true`. A build with no token cannot call them.

- [ ] Register App Attest (DeviceCheck fallback) for iOS and Play Integrity for Android.
- [ ] Create an App Check debug token and register it for each development device before the first lesson request.
- [ ] Watch valid and invalid metrics before you rely on a production build.

## 5. Secrets

These are Secret Manager values, not EAS variables and not `functions/.env`.

```bash
firebase functions:secrets:set OPENAI_API_KEY --project "$FIREBASE_PROJECT_ID"
firebase functions:secrets:set SAFETY_IDENTIFIER_SECRET --project "$FIREBASE_PROJECT_ID"
firebase functions:secrets:set EXPO_ACCESS_TOKEN --project "$FIREBASE_PROJECT_ID"
```

- [ ] `SAFETY_IDENTIFIER_SECRET` is 32 random bytes. Generate it locally. Do not reuse an OpenAI key.
- [ ] Use a dedicated Functions runtime service account. Grant Firestore, the app Storage bucket, Text-to-Speech, Cloud Tasks enqueue, Secret Manager access, and log writing. Do not grant Owner or Editor.

## 6. Deploy

Cloud Tasks creates the `generateLessonTask` queue during the functions deploy. Do not create it by hand first.

```bash
npm run deploy:rules
npm run deploy:functions
```

- [ ] Rules, indexes, and Storage deploy before functions.
- [ ] In Cloud Tasks, confirm the queue is in `europe-west1`, max concurrent dispatches is 8, and the target function is `generateLessonTask`.
- [ ] Run `TTS_VOICE_TIER=wavenet npm run validate:voices -w @resolingo/functions` with Application Default Credentials pointed at this project. It fails if a language has fewer than two WaveNet voices and no Standard pair.

## 7. EAS

```bash
npx eas-cli login
npx eas-cli init
```

- [ ] Put the EAS project UUID in `EXPO_PUBLIC_EAS_PROJECT_ID` (`apps/mobile/app.config.ts` reads it).
- [ ] Create the `development` environment. Set every key in `.env.example`. `EXPO_PUBLIC_FIREBASE_PROJECT_ID` must equal `FIREBASE_PROJECT_ID`.
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
