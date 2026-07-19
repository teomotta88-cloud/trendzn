// Piccolo wrapper condiviso per chiamare gli hook server-side sotto
// /api/public/hooks/* (getty-search, extract-keywords, approve-job...):
// stesso payload {ok, error} su tutti, evita di duplicare il fetch+parsing
// in ogni componente che ne ha bisogno.
export async function callHook<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/public/hooks/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `Richiesta ${path} fallita (${res.status})`);
  }
  return json;
}
