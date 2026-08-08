import textToSpeech from "@google-cloud/text-to-speech";
import { languages } from "@resolingo/shared";

const client = new textToSpeech.TextToSpeechClient();
let failures = 0;

for (const language of languages) {
  const [response] = await client.listVoices({ languageCode: language.googleTtsLanguageCode });
  const names = (response.voices ?? []).flatMap((voice) => voice.name ? [voice.name] : []);
  if (names.length < 2) {
    failures += 1;
    console.error(`${language.id}: expected two voices, found ${names.length}`);
  } else {
    console.info(`${language.id}: ${names.slice(0, 4).join(", ")}`);
  }
}

if (failures) process.exitCode = 1;
