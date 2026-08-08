# Legacy audit and rebuild boundary

The previous Flutter/Python application mixed the core lesson experience with level/category progression, scenario catalogs, custom topic tools, vocabulary statistics, FSRS review, streaks, ads, credit/premium flows, purchase verification, and multiple narrator/TTS adapters. Those systems created navigation, data, security, and operational complexity that does not serve Resolingo's daily-lesson goal.

Resolingo retains the useful product kernel: Google/Apple identity, native/target language and CEFR preferences, conversation and grammar generation, lesson history/replay, background audio, and reminders. Each retained capability is reimplemented with typed contracts and has no runtime or data dependency on the legacy application.

Explicitly excluded from this repository:

- level/category progression and scenario lessons;
- scenario catalogs or client-selected topic keywords;
- vocabulary, word statistics, FSRS, and streaks;
- ads, credits, premium tiers, IAP receipts, and verification;
- nickname/narrator audio pools and ElevenLabs/OpenAI TTS adapters;
- migration code, legacy Firebase identifiers, branding, or user data.

The previous broad client Firestore access is replaced by owner-scoped rules. Two-stage generation and permissive JSON repair are replaced by one structured Responses request with a single bounded repair attempt. This is a clean product rebuild, not an incremental Flutter port.
