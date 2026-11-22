import type { LanguageId } from "@resolingo/shared";

/**
 * Spoken check lines. Praise is warm and short. Close and unclear stay quiet,
 * because the model answer plays immediately afterwards.
 */
export const answerFeedbackLines: Record<LanguageId, {
  recalled: readonly [string, string];
  close: readonly [string, string];
  unclear: string;
}> = {
  "en-US": { recalled: ["Yes, you got it.", "Well done."], close: ["Close.", "Nearly."], unclear: "I didn’t quite catch that." },
  "en-GB": { recalled: ["Yes, you got it.", "Well done."], close: ["Close.", "Nearly."], unclear: "I didn’t quite catch that." },
  "en-AU": { recalled: ["Yes, you got it.", "Well done."], close: ["Close.", "Nearly."], unclear: "I didn’t quite catch that." },
  "de-DE": { recalled: ["Ja, genau.", "Gut gemacht."], close: ["Knapp.", "Fast."], unclear: "Ich habe dich nicht ganz verstanden." },
  "es-ES": { recalled: ["Sí, lo lograste.", "Muy bien."], close: ["Casi.", "Muy cerca."], unclear: "No lo oí bien." },
  "es-MX": { recalled: ["Sí, lo lograste.", "Muy bien."], close: ["Casi.", "Muy cerca."], unclear: "No lo oí bien." },
  "fr-CA": { recalled: ["Oui, c’est bien ça.", "Bien joué."], close: ["Presque.", "Tout près."], unclear: "Je n’ai pas bien entendu." },
  "fr-FR": { recalled: ["Oui, c’est bien ça.", "Bien joué."], close: ["Presque.", "Tout près."], unclear: "Je n’ai pas bien entendu." },
  "it-IT": { recalled: ["Sì, ci sei.", "Ben fatto."], close: ["Quasi.", "Ci sei quasi."], unclear: "Non ho capito bene." },
  "pt-BR": { recalled: ["Isso, você conseguiu.", "Muito bem."], close: ["Quase.", "Bem perto."], unclear: "Não consegui ouvir direito." },
  "pt-PT": { recalled: ["Isso, conseguiste.", "Muito bem."], close: ["Quase.", "Bem perto."], unclear: "Não consegui ouvir bem." },
  "ar-EG": { recalled: ["نعم، تمام.", "أحسنت."], close: ["قريب.", "تقريبًا."], unclear: "لم أسمعك بوضوح." },
  "bn-IN": { recalled: ["হ্যাঁ, ঠিক ধরেছ।", "ভালো হয়েছে।"], close: ["কাছাকাছি।", "প্রায়।"], unclear: "ঠিক শুনতে পেলাম না।" },
  "da-DK": { recalled: ["Ja, det er rigtigt.", "Godt gået."], close: ["Tæt på.", "Næsten."], unclear: "Jeg hørte det ikke helt." },
  "fil-PH": { recalled: ["Oo, tama iyan.", "Magaling."], close: ["Malapit.", "Halos."], unclear: "Hindi ko narinig nang malinaw." },
  "gu-IN": { recalled: ["હા, બરાબર.", "સરસ."], close: ["નજીક.", "લગભગ."], unclear: "મને બરાબર સંભળાયું નહીં." },
  "hi-IN": { recalled: ["हाँ, सही कहा.", "बहुत अच्छे."], close: ["करीब.", "लगभग."], unclear: "मुझे ठीक से सुनाई नहीं दिया." },
  "id-ID": { recalled: ["Ya, kamu berhasil.", "Bagus."], close: ["Hampir.", "Nyaris."], unclear: "Aku kurang jelas mendengarnya." },
  "ja-JP": { recalled: ["はい、そのとおり。", "よくできました。"], close: ["おしい。", "もう少し。"], unclear: "よく聞き取れませんでした。" },
  "kn-IN": { recalled: ["ಹೌದು, ಸರಿಯಾಗಿದೆ.", "ಚೆನ್ನಾಗಿದೆ."], close: ["ಹತ್ತಿರ.", "ಬಹುತೇಕ."], unclear: "ನನಗೆ ಸ್ಪಷ್ಟವಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ." },
  "ko-KR": { recalled: ["맞아요.", "잘했어요."], close: ["가까워요.", "거의예요."], unclear: "잘 들리지 않았어요." },
  "ml-IN": { recalled: ["അതെ, ശരിയായി.", "നന്നായി."], close: ["അടുത്തു.", "ഏതാണ്ട്."], unclear: "എനിക്ക് വ്യക്തമായി കേട്ടില്ല." },
  "ms-MY": { recalled: ["Ya, tepat.", "Bagus."], close: ["Hampir.", "Nyaris."], unclear: "Saya tak dengar dengan jelas." },
  "nb-NO": { recalled: ["Ja, akkurat.", "Bra jobbet."], close: ["Nær.", "Nesten."], unclear: "Jeg hørte det ikke helt." },
  "pa-IN": { recalled: ["ਹਾਂ, ਠੀਕ ਕਿਹਾ.", "ਸ਼ਾਬਾਸ਼."], close: ["ਨੇੜੇ.", "ਲਗਭਗ."], unclear: "ਮੈਨੂੰ ਸਾਫ਼ ਸੁਣਾਈ ਨਹੀਂ ਦਿੱਤਾ." },
  "pl-PL": { recalled: ["Tak, dokładnie.", "Dobra robota."], close: ["Blisko.", "Prawie."], unclear: "Nie udało mi się tego wyraźnie usłyszeć." },
  "ru-RU": { recalled: ["Да, именно так.", "Хорошо получилось."], close: ["Близко.", "Почти."], unclear: "Я не расслышал." },
  "sv-SE": { recalled: ["Ja, precis.", "Bra gjort."], close: ["Nära.", "Nästan."], unclear: "Jag hörde inte riktigt." },
  "ta-IN": { recalled: ["ஆம், சரியாகச் சொன்னீர்கள்.", "நன்றாக இருந்தது."], close: ["அருகில்.", "கிட்டத்தட்ட."], unclear: "எனக்குத் தெளிவாகக் கேட்கவில்லை." },
  "tr-TR": { recalled: ["Evet, oldu.", "Aferin."], close: ["Yakın.", "Neredeyse."], unclear: "Tam duyamadım." },
  "vi-VN": { recalled: ["Đúng rồi.", "Bạn làm tốt."], close: ["Gần rồi.", "Suýt đúng."], unclear: "Mình chưa nghe rõ." },
  "zh-TW": { recalled: ["對，就是這樣。", "做得好。"], close: ["很接近。", "差一點。"], unclear: "我沒有聽清楚。" },
};
