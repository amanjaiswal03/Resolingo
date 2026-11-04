# Operations

## Deploy order

Production is `.firebaserc` alias `prod` (`resolingo`, number `168640425089`). `npm run deploy` uses it. Set `FIREBASE_PROJECT_ID` to deploy somewhere else. The setup checklist is [New project setup](NEW_PROJECT_SETUP.md).

1. Deploy Firestore indexes/rules plus Storage rules.
2. Set Functions secrets and deploy Functions.
3. Run provider smoke tests, then build the development client.
4. App Check is already enforced in code. Register a debug token before the first device test, and watch metrics before a production rollout.
5. Production deploys use project `resolingo`. A development project must never reuse that id.

```bash
export FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-resolingo}"
# EXPO_ACCESS_TOKEN is already set for project resolingo. Run this only to rotate it.
firebase functions:secrets:set EXPO_ACCESS_TOKEN --project "$FIREBASE_PROJECT_ID"
npm run deploy:rules
npm run deploy:functions
```

## Monitoring

Create Cloud Monitoring policies for task queue age/backlog, generation failures, Gemini/TTS error ratios, p95 generation latency over two minutes, scheduler failures, push receipt failures, and unusual lesson volume per UID hash. Configure billing alerts at 50%, 80%, and 100% of the owner-approved monthly budget. Gemini list price is $0.30 per million input tokens and $2.50 per million output tokens for `gemini-3.5-flash-lite`; WaveNet Text-to-Speech is still the main Google cost at the three-lesson cap.

Application logs must contain request IDs, stage, timing, model/voice IDs, and safe error codes—never lesson text, access tokens, email, nickname, or raw UID. Retain audit logs for IAM and Secret Manager access.

## Failure behavior

- Malformed/refused model output: one repair request, then terminal failure and quota release.
- Transient Gemini/TTS/Storage failure: task retry with bounded exponential backoff.
- Partial audio: deterministic paths make retries idempotent; cleanup removes abandoned failed objects.
- Invalid Expo push token: remove after receipt reports `DeviceNotRegistered`.
- Account deletion: do not report success until Storage, Firestore, and Auth deletion finish.

## Dependency advisories

Run `npm audit --omit=dev` and Expo Doctor on every upgrade. Do not apply audit's current forced downgrade to Expo 46 or Firebase Admin 10. Upgrade when Expo/Metro and Google Cloud upstreams publish compatible fixes.
