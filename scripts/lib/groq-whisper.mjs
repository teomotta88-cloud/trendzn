// Trascrizione di un file audio con Groq Whisper.
//
// Qui vive il fix del bug che rendeva inutile l'intero workflow audio: la
// richiesta veniva costruita con il FormData del pacchetto npm `form-data` e
// passata come body a fetch (undici), che non sa serializzarlo e lo converte a
// stringa. Groq riceveva 17 byte — esattamente la lunghezza di
// "[object FormData]" — e rispondeva 400 "multipart: NextPart: EOF" su ogni
// singolo video, per 14 run di fila.
//
// Due regole da non violare:
//   - FormData e Blob devono essere quelli nativi di Node, non `form-data`;
//   - non si imposta Content-Type a mano: il boundary lo deve generare fetch
//     (era l'altro pezzo del bug, `...formData.getHeaders()`).

export const DEFAULT_GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export async function transcribeAudioBuffer(
  bytes,
  { apiKey, model, language, url = DEFAULT_GROQ_URL, filename = "audio.mp3" } = {},
) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/mpeg" }), filename);
  form.append("model", model);
  form.append("response_format", "verbose_json");
  if (language) form.append("language", language);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    return { ok: false, reason: `rete: ${String(err?.message ?? err).slice(0, 120)}` };
  }

  if (!res.ok) {
    return { ok: false, reason: `Groq ${res.status}: ${(await res.text()).slice(0, 160)}` };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "Groq ha risposto con un JSON non valido" };
  }

  return {
    ok: true,
    text: (body.text ?? "").trim(),
    language: body.language ?? language ?? null,
    durationSec: typeof body.duration === "number" ? +body.duration.toFixed(1) : null,
  };
}
