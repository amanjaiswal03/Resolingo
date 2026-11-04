import textToSpeech from "@google-cloud/text-to-speech";
import { languages } from "@resolingo/shared";
import { selectVoices, voiceTierFromEnv } from "./voices.js";

const client = new textToSpeech.TextToSpeechClient();
const tier = voiceTierFromEnv(process.env.TTS_VOICE_TIER);
let failures = 0;

for (const language of languages) {
  const [response] = await client.listVoices({ languageCode: language.googleTtsLanguageCode });
  const names = (response.voices ?? []).flatMap((voice) => voice.name ? [voice.name] : []);
  const selected = selectVoices(names, tier);
  if (selected.voices.length < 2) {
    failures += 1;
    console.error(`${language.id}: expected two ${tier} voices, found ${selected.voices.length} (${selected.tier ?? "none"})`);
  } else {
    console.info(`${language.id}: ${selected.tier} ${selected.voices.slice(0, 4).join(", ")}`);
  }
}

if (failures) process.exitCode = 1;
