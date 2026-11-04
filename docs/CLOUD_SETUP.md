# Cloud and store setup

For a brand-new Google account, start with [New project setup](NEW_PROJECT_SETUP.md). This file is the longer store, Apple, and monitoring reference.

Production is project `resolingo` (number `168640425089`), aliased as `prod` in `.firebaserc`. `npm run deploy` uses that alias. Export `FIREBASE_PROJECT_ID` to target a different project. Add a second alias in `.firebaserc` when you create a separate development project.

## 1. GitHub

```bash
gh auth login
gh repo create Resolingo --private --source . --remote origin --push
```

In repository settings, protect `main`: require a pull request and approval, require the `validate` CI job, require branches to be current, dismiss stale approvals, block force pushes/deletion, enable secret scanning and Dependabot alerts. Restrict production EAS/Firebase environments to approved reviewers.

## 2. Firebase and Google Cloud

Create two projects, for example Resolingo Dev and Resolingo Prod. You choose the ids. Attach the billing account, upgrade Firebase to Blaze, and select:

- Firestore multi-region: `eur3`;
- default Storage bucket: an EU location;
- Functions, Tasks, Scheduler, and Artifact Registry: `europe-west1`.

Enable these APIs in each project: Identity Toolkit/Auth, Firestore, Cloud Storage, Cloud Functions, Cloud Run, Cloud Tasks, Cloud Scheduler, Eventarc, Cloud Build, Artifact Registry, Secret Manager, Cloud Logging/Monitoring, Text-to-Speech, Firebase App Check, Crashlytics, and Analytics.

Register four apps per environment as appropriate:

| Variant | iOS bundle ID | Android package |
|---|---|---|
| Development | `com.resolingo.app.dev` | `com.resolingo.app.dev` |
| Production | `com.resolingo.app` | `com.resolingo.app` |

Download each environment's `GoogleService-Info.plist` and `google-services.json` locally, upload them as EAS file environment variables, and delete unneeded local copies. They are ignored by Git.

### Authentication

Enable Google and Apple providers in Firebase Authentication. For Google, set the OAuth consent branding, support email, and production status; add debug/upload/Play-signing SHA-1 and SHA-256 fingerprints to each Android app.

For Apple Developer and Firebase:

1. Create App IDs for production and development and enable **Sign in with Apple** and **Push Notifications**.
2. Create a Sign in with Apple key; record the key ID and Team ID and store the `.p8` securely.
3. Create a Services ID and configure the Firebase return URL shown by the Apple provider screen (normally `https://<project-id>.firebaseapp.com/__/auth/handler`).
4. Enter Team ID, key ID, Services ID, and key material in Firebase Auth's Apple provider.
5. Keep native Apple sign-in capability enabled in the EAS-generated iOS project.

### App Check

Register App Attest with DeviceCheck fallback on iOS and Play Integrity on Android. Use App Check debug tokens only for the emulator and named EAS development devices. Observe valid/invalid metrics before enabling enforcement for Functions, Firestore, and Storage. Rotate leaked debug tokens immediately.

### Secrets and IAM

Set secrets independently in each Firebase project:

```bash
firebase functions:secrets:set EXPO_ACCESS_TOKEN --project "$FIREBASE_PROJECT_ID"
```

Lesson text uses the Functions service account against Vertex AI. There is no Gemini API key. Never put secrets in EAS mobile variables. Do not create downloadable Google service-account keys. Grant that runtime account `roles/aiplatform.user`.

Use a dedicated Functions runtime service account. Grant only the precise roles needed for Firestore document access, Storage objects under the app bucket, Text-to-Speech use, Cloud Tasks enqueue, Secret Manager secret access, and log writing. Grant deploy identities separately; do not give the runtime Owner/Editor.

Deploy in this order:

```bash
export FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-resolingo}"
npm run deploy:rules
npm run deploy:functions
```

Cloud Tasks queues used by Firebase task functions are provisioned during deployment. Confirm the generated queue and target both use `europe-west1`, the runtime invoker is correct, max concurrent dispatches is 8, and retries match the source.

### Monitoring and cost controls

Choose a monthly budget and add email/Pub/Sub alerts at 50%, 80%, and 100%. Create alert policies for queue oldest-task age, task retry/dead-letter volume, scheduler failures, p95 generation duration, OpenAI/TTS error ratio, Storage errors, and per-user request anomalies. Log only IDs/hashes, stages, timings, and safe failure codes.

## 3. Expo and EAS

Create/select the Expo organization and project:

```bash
npx eas-cli login
npx eas-cli init
npx eas-cli project:info
```

Put the returned project UUID in `EXPO_PUBLIC_EAS_PROJECT_ID`. Create `development`, `preview`, and `production` EAS environments. Add public Firebase values from `.env.example`, the Google web OAuth client ID, and these sensitive file variables:

- `GOOGLE_SERVICES_INFO_PLIST` → the environment's plist;
- `GOOGLE_SERVICES_JSON` → the environment's JSON.

Do not mark the public Firebase config as a secret—it is an identifier, not authorization. Security comes from Auth, App Check, rules, and IAM.

Build both development clients on physical devices:

```bash
npx eas-cli build --profile development --platform ios
npx eas-cli build --profile development --platform android
```

Configure EAS Update channels exactly as `eas.json` specifies. Never send a production update to a development binary. Native dependency/config-plugin changes require a new binary, not only an OTA update.

## 4. Push credentials

For iOS, let EAS create or attach an APNs key in the Apple Developer organization and verify the production entitlement. For Android, create a Firebase service account restricted to FCM sending, upload its FCM v1 credential to Expo, and verify Play upload/app-signing fingerprints in Firebase. The app stores both Expo and native device tokens; production sends through Expo and removes tokens reported as `DeviceNotRegistered` by receipts.

## 5. App Store Connect and Google Play

In App Store Connect create Resolingo for `com.resolingo.app`, supply privacy policy/support URLs, complete App Privacy declarations, age rating, export compliance, account-deletion instructions, and review credentials. Enable background audio only for actual lesson playback.

In Play Console create Resolingo for `com.resolingo.app`, enable Play App Signing, complete Data Safety/account deletion/content rating, add the Play signing SHA certificates to Firebase, and upload through an internal test track before closed/production rollout.

Use EAS-managed distribution credentials unless the organization has an existing controlled credential process. Limit store API keys to the minimum role and store them in EAS, not GitHub source.

## 6. Gemini and Google TTS

Enable `aiplatform.googleapis.com`. The lesson model defaults to `gemini-3.5-flash-lite` in Vertex location `eu` (the model is not in `europe-west1`). Change `GEMINI_LESSON_MODEL` or `GEMINI_LOCATION` in `functions/.env` without a store release. Provider logging and app logs must exclude lesson text and personal data. At the published list price of $0.30 / $2.50 per million input / output tokens, text is a small share of the bill next to WaveNet TTS.

Enable Google Cloud Text-to-Speech. The default tier is WaveNet, then Standard (`TTS_VOICE_TIER` in `functions/.env`). Do not set `chirp3` or `neural2` until a budget review says so. Voice mappings live in `packages/shared/src/languages.ts` and backend selection remains deployable without a mobile store release.

With Application Default Credentials pointed at the target project, run `TTS_VOICE_TIER=wavenet npm run validate:voices -w @resolingo/functions` to fail if any registry locale has fewer than two voices in that tier after the Standard fallback.

## 7. Final environment validation

Run the full [release checklist](RELEASE_CHECKLIST.md) in development, then preview, then production. In particular, validate App Check, authentication, background playback, push delivery, quota races, provider failure release, owner isolation, and recursive deletion on real devices.

Official references: [Firebase task queues](https://firebase.google.com/docs/functions/task-functions), [Firestore rule conditions](https://firebase.google.com/docs/firestore/security/rules-conditions), [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/), [EAS Build](https://docs.expo.dev/build/setup/), [Expo notifications](https://docs.expo.dev/push-notifications/push-notifications-setup/), and [Expo Audio](https://docs.expo.dev/versions/latest/sdk/audio/).
