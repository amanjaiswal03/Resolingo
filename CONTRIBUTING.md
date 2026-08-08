# Contributing

Use Node 22 and branch from `main`. Keep shared wire contracts in `packages/shared`; clients and Functions must not redefine them. Any Firestore/Storage rule change requires an emulator test. Any generated-lesson schema change requires prompt, Zod, player, and provider fixture tests.

Before opening a pull request, run:

```bash
npm ci
npm run check
npm run lint
npm run test:rules
npx expo-doctor@latest
```

Never commit Firebase native configuration, `.env` files, API keys, EAS credentials, service-account keys, user content, or recorded lesson audio.
