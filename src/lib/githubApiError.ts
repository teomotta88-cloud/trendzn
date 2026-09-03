// Un 403 di GitHub, da solo, non dice cosa è andato storto: può essere il
// rate limit esaurito, lo scope "repo" mancante, l'SSO non autorizzato per
// l'organizzazione, oppure un token fine-grained senza permesso "Contents"
// sul repo. Gli hook di scrittura riportavano alla UI solo lo status
// ("Lettura metadata fallita: 403") mentre il body con la causa vera
// finiva al massimo nei log del runtime, che dalla pagina non si vedono.
//
// Qui componiamo status + messaggio di GitHub + stato del rate limit in
// una riga sola, pensata per essere concatenata dopo un prefisso che
// descrive l'operazione fallita (es. "Lettura metadata fallita: ") e
// mostrata direttamente all'utente.
//
// Il body va passato dal chiamante (già letto con res.text()): una Response
// si può leggere una volta sola, e chi chiama di solito lo logga comunque.
export function describeGithubFailure(res: Response, body: string): string {
  let message = "";
  const trimmed = (body || "").trim();
  if (trimmed) {
    try {
      message = String(JSON.parse(trimmed).message || "").trim();
    } catch {
      // risposta non JSON (es. una pagina di errore del proxy): teniamo il
      // testo grezzo, troncato per non far esplodere l'alert nella UI
      message = trimmed.slice(0, 200);
    }
  }

  const parts = [String(res.status)];
  if (message) parts.push(message);

  // /rate_limit non consuma quota ed è esente dal limite: quando il token
  // ha esaurito le chiamate, quell'endpoint continua a rispondere 200
  // mentre TUTTO il resto risponde 403. È la firma più insidiosa da
  // riconoscere, perché sembra un problema di permessi; questi header la
  // rendono esplicita.
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const when =
      Number.isFinite(reset) && reset > 0
        ? `${new Date(reset * 1000).toISOString().slice(11, 16)} UTC`
        : "a breve";
    parts.push(`rate limit GitHub esaurito (0 chiamate residue, si ripristina alle ${when})`);
  }

  return parts.join(" — ");
}
