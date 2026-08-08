# Operations

## Deploy order

1. Select `dev` and deploy Firestore indexes/rules plus Storage rules.
2. Set Functions secrets and deploy Functions.
3. Run provider smoke tests, then build the development client.
4. Enforce App Check only after debug/preview/prod traffic appears valid.
5. Repeat against `prod`; production configuration must never point at development resources.

```bash
firebase use dev
firebase deploy --only firestore:rules,firestore:indexes,storage
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set SAFETY_IDENTIFIER_SECRET
firebase functions:secrets:set EXPO_ACCESS_TOKEN
firebase deploy --only functions
```

## Monitoring

Create Cloud Monitoring policies for task queue age/backlog, generation failures, OpenAI/TTS error ratios, p95 generation latency over two minutes, scheduler failures, push receipt failures, and unusual lesson volume per UID hash. Configure billing alerts at 50%, 80%, and 100% of the owner-approved monthly budget.

Application logs must contain request IDs, stage, timing, model/voice IDs, and safe error codes—never lesson text, access tokens, email, nickname, or raw UID. Retain audit logs for IAM and Secret Manager access.

## Failure behavior

- Malformed/refused model output: one repair request, then terminal failure and quota release.
- Transient OpenAI/TTS/Storage failure: task retry with bounded exponential backoff.
- Partial audio: deterministic paths make retries idempotent; cleanup removes abandoned failed objects.
- Invalid Expo push token: remove after receipt reports `DeviceNotRegistered`.
- Account deletion: do not report success until Storage, Firestore, and Auth deletion finish.

## Dependency advisories

Run `npm audit --omit=dev` and Expo Doctor on every upgrade. Do not apply audit's current forced downgrade to Expo 46 or Firebase Admin 10. Upgrade when Expo/Metro and Google Cloud upstreams publish compatible fixes.
