# Resolingo

Resolingo is a focused daily language-learning app for iOS and Android. A learner chooses **Conversation** or **Grammar** and the backend generates a fresh 3–5 minute lesson with synchronized audio. There are no levels, scenarios, streaks, ads, credits, or vocabulary/SRS systems.

## What is implemented

- Expo SDK 57, React Native, Expo Router, strict TypeScript, accessible light/dark design tokens.
- Google authentication on iOS/Android and Apple authentication on iOS.
- Resumable onboarding for nickname, languages, CEFR level, timezone, reminders, and telemetry consent.
- Daily home, asynchronous generation status, history, transcript-aware background audio player, settings, and deletion.
- Owner-scoped Firestore and Storage rules with emulator tests.
- Firebase Functions callables protected by Auth and App Check, a region-pinned Cloud Tasks worker, quota/idempotency transactions, reminders, cleanup, and recursive deletion.
- A single strict OpenAI Responses request per lesson, Zod validation, privacy-preserving safety identifier, Google Cloud TTS (WaveNet, then Standard), deterministic Storage paths, and Expo push delivery.
- A canonical 32-language BCP-47 registry in `packages/shared`.

## Repository

```text
apps/mobile/             Expo application and native service integrations
functions/               Firebase Functions v2, task worker, schedules, providers
packages/shared/         Zod contracts, generated lesson schema, language registry
packages/rules-tests/    Firestore and Storage emulator security tests
docs/                    Architecture, cloud setup, operations, and release checks
firestore.rules          Owner-scoped client access
storage.rules            Owner-read/server-write audio policy
firebase.json            EU-region deployment and emulator configuration
```

## Local development

Requirements: Node 22, npm 11, Java 21, Firebase CLI, EAS CLI, Xcode for iOS, and Android Studio for Android.

```bash
nvm use
npm ci
cp .env.example .env.local
npm run check
npm run lint
npm run test:rules
npm run emulators
```

In another terminal, create and run a native development build:

```bash
npx eas-cli build --profile development --platform ios
npx eas-cli build --profile development --platform android
npm run start -w @resolingo/mobile -- --dev-client
```

Expo Go is intentionally unsupported because Auth providers, App Check, Crashlytics, native Firebase, push credentials, and background audio require native development builds.

## Configuration

Project ids are not stored in this repo. Set `FIREBASE_PROJECT_ID` for CLI deploys and put that project's native config files in EAS.

1. Follow [New project setup](docs/NEW_PROJECT_SETUP.md) for a fresh Google account.
2. Use [Cloud setup](docs/CLOUD_SETUP.md) for store, Apple, and monitoring detail.
3. Add EAS environment variables from `.env.example`.
4. Upload `GoogleService-Info.plist` and `google-services.json` as EAS file environment variables; never commit them.
5. Store backend secrets with `firebase functions:secrets:set`.
6. Deploy rules and indexes before distributing clients.

See [Architecture](docs/ARCHITECTURE.md), [operations](docs/OPERATIONS.md), [legacy audit](docs/LEGACY_AUDIT.md), and the [release checklist](docs/RELEASE_CHECKLIST.md).

## Verification

`npm run check` performs strict type checking, unit tests, and production builds. `npm run test:rules` runs Firestore and Storage ownership tests in the Firebase Emulator Suite. `npx expo-doctor@latest` validates SDK dependency compatibility.

Security note: currently published Expo/Metro and Google Cloud dependency trees report transitive npm advisories without a non-breaking resolution. Do not use `npm audit fix --force`; Dependabot and CI should track upstream patches. The vulnerable image parsers are build tooling and are not used on untrusted app input.
