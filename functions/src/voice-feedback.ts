import { LanguageIdSchema, line, type LanguageId } from "@resolingo/shared";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { requireUid } from "./auth.js";
import { REGION } from "./config.js";
import { db } from "./firebase.js";
import { synthesizeTeacherFeedback } from "./tts.js";

// A spoken answer is never sent out for feedback. A match is two short calm
// lines from the teaching table. A miss is a fixed later-practice line.
const later: Record<LanguageId, readonly [string, string]> = {
  "en-US": ["Good try. Practice it again later.", "I didn’t quite catch that. Try again later."],
  "en-GB": ["Good try. Practice it again later.", "I didn’t quite catch that. Try again later."],
  "en-AU": ["Good try. Practice it again later.", "I didn’t quite catch that. Try again later."],
  "de-DE": ["Guter Versuch. Üb den Satz später noch einmal.", "Ich habe dich nicht ganz verstanden. Versuch es später noch einmal."],
  "es-ES": ["Buen intento. Puedes practicar esa frase otra vez.", "No lo oí bien. Inténtalo otra vez más tarde."],
  "es-MX": ["Buen intento. Puedes practicar esa frase otra vez.", "No lo oí bien. Inténtalo otra vez más tarde."],
  "fr-CA": ["Bel essai. Tu peux reprendre cette phrase plus tard.", "Je n’ai pas bien entendu. Réessaie plus tard."],
  "fr-FR": ["Bel essai. Tu peux reprendre cette phrase plus tard.", "Je n’ai pas bien entendu. Réessaie plus tard."],
  "it-IT": ["Buon tentativo. Puoi riprovare più tardi.", "Non ho capito bene. Riprova più tardi."],
  "pt-BR": ["Boa tentativa. Pratique essa frase de novo mais tarde.", "Não consegui ouvir direito. Tente de novo mais tarde."],
  "pt-PT": ["Boa tentativa. Podes voltar a praticar a frase mais tarde.", "Não consegui ouvir bem. Tenta outra vez mais tarde."],
  "ar-EG": ["محاولة جيدة. يمكنك التدرّب على هذه العبارة مرة أخرى لاحقًا.", "لم أسمعك بوضوح. حاول مرة أخرى لاحقًا."],
  "bn-IN": ["ভালো চেষ্টা। পরে বাক্যটা আবার অনুশীলন করতে পারো।", "ঠিক শুনতে পেলাম না। পরে আবার চেষ্টা করো।"],
  "da-DK": ["Godt forsøgt. Du kan øve sætningen igen senere.", "Jeg hørte det ikke helt. Prøv igen senere."],
  "fil-PH": ["Magandang subok. Puwede mong balikan ang pariralang iyan mamaya.", "Hindi ko narinig nang malinaw. Subukan ulit mamaya."],
  "gu-IN": ["સારો પ્રયાસ. પછી ફરીથી આ વાક્યની પ્રેક્ટિસ કરજો.", "મને બરાબર સંભળાયું નહીં. પછી ફરી પ્રયત્ન કરજો."],
  "hi-IN": ["अच्छी कोशिश। बाद में इस वाक्य की फिर से प्रैक्टिस करना।", "मुझे ठीक से सुनाई नहीं दिया। बाद में फिर कोशिश करना।"],
  "id-ID": ["Usaha yang bagus. Kamu bisa berlatih lagi nanti.", "Aku kurang jelas mendengarnya. Coba lagi nanti."],
  "ja-JP": ["いい練習になりましたね。あとでもう一度言ってみましょう。", "よく聞き取れませんでした。あとでまた試しましょう。"],
  "kn-IN": ["ಒಳ್ಳೆಯ ಪ್ರಯತ್ನ. ನಂತರ ಮತ್ತೆ ಈ ವಾಕ್ಯವನ್ನು ಹೇಳಿ ನೋಡಿ.", "ನನಗೆ ಸ್ಪಷ್ಟವಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ. ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."],
  "ko-KR": ["좋은 시도예요. 나중에 이 표현을 다시 연습해 봐요.", "잘 들리지 않았어요. 나중에 다시 해 봐요."],
  "ml-IN": ["നല്ല ശ്രമം. ഈ വാചകം പിന്നീട് വീണ്ടും പരിശീലിക്കാം.", "എനിക്ക് വ്യക്തമായി കേട്ടില്ല. പിന്നീട് വീണ്ടും ശ്രമിക്കൂ."],
  "ms-MY": ["Cubaan yang baik. Boleh berlatih lagi nanti.", "Saya tak dengar dengan jelas. Cuba lagi nanti."],
  "nb-NO": ["Godt forsøk. Du kan øve på setningen igjen senere.", "Jeg hørte det ikke helt. Prøv igjen senere."],
  "pa-IN": ["ਚੰਗੀ ਕੋਸ਼ਿਸ਼। ਇਹ ਵਾਕ ਬਾਅਦ ਵਿੱਚ ਫਿਰ ਅਭਿਆਸ ਕਰੋ।", "ਮੈਨੂੰ ਸਾਫ਼ ਸੁਣਾਈ ਨਹੀਂ ਦਿੱਤਾ। ਬਾਅਦ ਵਿੱਚ ਫਿਰ ਕੋਸ਼ਿਸ਼ ਕਰੋ।"],
  "pl-PL": ["Dobra próba. Wróć do tego zdania później.", "Nie udało mi się tego wyraźnie usłyszeć. Spróbuj ponownie później."],
  "ru-RU": ["Хорошая попытка. Можно повторить эту фразу позже.", "Я не расслышал. Попробуй ещё раз позже."],
  "sv-SE": ["Bra försök. Öva gärna på frasen igen senare.", "Jag hörde inte riktigt. Försök igen senare."],
  "ta-IN": ["நல்ல முயற்சி. இந்த வாக்கியத்தைப் பிறகு மீண்டும் பயிற்சி செய்யுங்கள்.", "எனக்குத் தெளிவாகக் கேட்கவில்லை. பிறகு மீண்டும் முயற்சியுங்கள்."],
  "tr-TR": ["Güzel denemeydi. Bu ifadeyi sonra tekrar çalışabilirsin.", "Tam duyamadım. Daha sonra tekrar dene."],
  "vi-VN": ["Bạn đã cố gắng tốt. Có thể luyện lại câu này sau nhé.", "Mình chưa nghe rõ. Thử lại sau nhé."],
  "zh-TW": ["很好的嘗試，晚點可以再練習這一句。", "我沒有聽清楚，晚一點再試試看。"],
};

const inFlight = new Map<LanguageId, Promise<{ recalled: string[]; compare: string[]; unclear: string[] }>>();

export const lessonVoiceFeedback = onCall({ region: REGION, enforceAppCheck: true }, async (request) => {
  const uid = requireUid(request);
  const id = request.data?.lessonId;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new HttpsError("invalid-argument", "Choose a lesson.");
  }
  const lesson = (await db.doc(`users/${uid}/lessons/${id}`).get()).data();
  if (lesson?.status !== "ready") throw new HttpsError("not-found", "Lesson is not available.");
  const segments: unknown[] = Array.isArray(lesson.segments) ? lesson.segments : [];
  const intro = segments.find((part): part is { language: unknown } =>
    !!part && typeof part === "object" && "phase" in part && part.phase === "intro" && "language" in part,
  );
  const language = LanguageIdSchema.safeParse(intro?.language);
  if (!language.success) throw new HttpsError("failed-precondition", "The narrator language is unavailable.");
  const existing = inFlight.get(language.data);
  if (existing) return existing;
  const [compare, unclear] = later[language.data];
  const speak = (text: string, delivery: "praise" | "gentle") => synthesizeTeacherFeedback(language.data, text, delivery);
  const task = Promise.all([
    speak(line(language.data, "matchYes"), "praise"),
    speak(line(language.data, "matchGood"), "praise"),
    speak(compare, "gentle"),
    speak(unclear, "gentle"),
  ])
    .then(([first, second, practice, retry]) => ({ recalled: [first, second], compare: [practice], unclear: [retry] }))
    .finally(() => inFlight.delete(language.data));
  inFlight.set(language.data, task);
  return task;
});
