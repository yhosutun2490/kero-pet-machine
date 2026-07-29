/**
 * mockRespond — pure function that returns a contextually appropriate practice
 * reply in the chosen language. No async, no API calls.
 */

const RESPONSES: Record<'en' | 'es', string[]> = {
  en: [
    "That's great to hear! Can you tell me more about that?",
    "Really? How did that make you feel?",
    "Interesting! What do you usually do on weekends?",
    "I see! Have you always felt that way?",
    "Wonderful! What are your plans for the rest of the day?",
    "Oh wow, that sounds exciting! What happened next?",
    "That makes a lot of sense. Do you do that often?",
    "Nice! Who else was there with you?",
    "Fascinating! Where did you first learn about that?",
    "I love that! Would you recommend it to a friend?",
  ],
  es: [
    '¡Qué interesante! ¿Puedes contarme más?',
    '¿De verdad? ¿Cómo te sentiste?',
    '¿Qué haces normalmente los fines de semana?',
    'Ya veo. ¿Siempre has pensado así?',
    '¡Genial! ¿Cuáles son tus planes para hoy?',
    '¡Vaya, qué emocionante! ¿Qué pasó después?',
    'Tiene mucho sentido. ¿Lo haces con frecuencia?',
    '¡Qué bien! ¿Quién más estaba contigo?',
    'Fascinante. ¿Dónde aprendiste eso por primera vez?',
    '¡Me encanta! ¿Se lo recomendarías a un amigo?',
  ],
};

/**
 * Produces a stable-ish index by hashing the characters of `text` so that
 * the same user input always maps to the same Kero reply within a session,
 * while different inputs feel varied.
 */
function hashIndex(text: string, poolSize: number): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % poolSize;
}

export function mockRespond(userText: string, language: 'en' | 'es'): string {
  const pool = RESPONSES[language];
  const index = userText.length > 0 ? hashIndex(userText, pool.length) : 0;
  return pool[index];
}
