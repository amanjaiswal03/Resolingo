# Architecture

## Product boundary

Resolingo does one thing well: produce a daily grammar or conversation lesson appropriate to a learner's language pair and CEFR level. The topic is always selected server-side. A user may have any mix of three ready lessons per IANA-timezone day and only one active generation job.

```mermaid
flowchart LR
  M["Expo mobile app"] -->|"App Check + Auth callable"| C["Firebase callable functions"]
  C -->|"transaction: reservation + lesson"| F["Firestore"]
  C -->|"enqueue in europe-west1"| Q["Cloud Tasks"]
  Q --> W["Generation worker"]
  W -->|"structured JSON"| O["Vertex AI Gemini"]
  W -->|"segment synthesis, WaveNet by default"| T["Google Cloud TTS"]
  W --> S["Cloud Storage audio"]
  W --> F
  W --> P["Expo Push Service"]
  F -->|"realtime owner subscription"| M
  S -->|"owner read only"| M
```

## Generation state machine

`queued → generating_content → synthesizing_audio → ready`

The lesson is `queued` with `enqueuePending` until Cloud Tasks accepts the job. If acceptance never lands, the next lesson request and a one-minute sweep release `activeLessonId` after two minutes. An enqueue error rolls the quota reservation back in the same transaction. Any terminal provider or validation problem produces `failed`, a user-safe failure code, releases the reservation, and clears the active job. Transient task failures retry at the queue level. The transcript is committed before TTS begins; the complete manifest is published only after every segment exists. Speech defaults to Google WaveNet, then Standard. Set `TTS_VOICE_TIER` to `neural2` or `chirp3` only after a budget review. Lesson text uses Vertex AI `gemini-3.5-flash-lite` in the EU multi-region (`eu`), because that model is not available in `europe-west1`. The daily cap stays three ready lessons. List price checked 4 Nov 2026 is $0.30 per million input tokens and $2.50 per million output tokens, so text stays under about a dollar per active user per month at this cap. WaveNet TTS remains the larger Google bill.

## Trust boundary

- The callable derives ownership from `request.auth.uid`; a UID is never accepted in request data.
- App Check is enforced on all public callables. Auth lifecycle and scheduled/task functions are not public client APIs.
- Mobile can read its profile, lessons, and audio. It may only edit allowlisted preferences and lesson completion.
- Admin SDK writes bypass rules, so the runtime service account must remain least-privileged.
- The lesson prompt never includes the Firebase UID. Vertex AI authenticates as the Functions service account. Gemini safety filters block medium-and-above harassment, hate, sexual, and dangerous content, with one repair attempt after a block.
- Telemetry is disabled in native SDKs until explicit consent.

## Data ownership

All personal data is rooted at `users/{uid}`. Lesson audio is rooted at `users/{uid}/lessons/{lessonId}` in Storage. Recursive account deletion removes both trees and then deletes the Auth identity. Ready lessons otherwise remain until deletion; failed partial objects are cleaned by schedule.
