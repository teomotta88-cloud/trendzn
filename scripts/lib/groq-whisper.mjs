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

// Su un volume di ~1500 video il rate limit di Groq non è un rischio, è una
// certezza. Senza retry ogni 429 marcherebbe il post come "tentato e fallito",
// costringendo a ripescarlo dopo con REPROCESS_FAILED.
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Groq indica l'attesa in Retry-After (secondi, anche frazionari). Se manca,
// backoff esponenziale. Il tetto evita che un Retry-After assurdo blocchi la run.
function waitMs(res, attempt, baseMs) {
  const header = Number.parseFloat(res.headers.get("retry-after") ?? "");
  if (Number.isFinite(header) && header >= 0) return Math.min(header * 1000, 60_000);
  return Math.min(baseMs * 2 ** (attempt - 1), 60_000);
}

async function postWithRetry(url, buildInit, { attempts, baseMs }) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      // Il body si ricostruisce a ogni tentativo: un FormData già inviato non
      // è garantito riutilizzabile.
      res = await fetch(url, buildInit());
    } catch (err) {
      if (attempt >= attempts) return { error: String(err?.message ?? err).slice(0, 120) };
      await sleep(Math.min(baseMs * 2 ** (attempt - 1), 60_000));
      continue;
    }

    if (!RETRYABLE.has(res.status) || attempt >= attempts) return { res };

    const wait = waitMs(res, attempt, baseMs);
    console.log(
      `    ⏳ Groq ${res.status}, riprovo fra ${(wait / 1000).toFixed(1)}s (tentativo ${attempt}/${attempts - 1})`,
    );
    await sleep(wait);
  }
}

export async function transcribeAudioBuffer(
  bytes,
  {
    apiKey,
    model,
    language,
    url = DEFAULT_GROQ_URL,
    filename = "audio.mp3",
    attempts = 4,
    retryBaseMs = 2000,
  } = {},
) {
  const buildInit = () => {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "audio/mpeg" }), filename);
    form.append("model", model);
    form.append("response_format", "verbose_json");
    if (language) form.append("language", language);
    return { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form };
  };

  const { res, error } = await postWithRetry(url, buildInit, { attempts, baseMs: retryBaseMs });
  if (error) return { ok: false, reason: `rete: ${error}` };

  if (!res.ok) {
    const body = (await res.text()).slice(0, 160);
    // Un 429 sopravvissuto ai retry è una condizione di quota, non un problema
    // di questo post: va distinta perché il chiamante la tratta diversamente.
    if (res.status === 429)
      return {
        ok: false,
        rateLimited: true,
        reason: `Groq 429 dopo ${attempts} tentativi: ${body}`,
      };
    return { ok: false, reason: `Groq ${res.status}: ${body}` };
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
