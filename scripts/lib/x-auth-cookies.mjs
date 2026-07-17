// RETTIWT_API_KEY (già in produzione per ASPI-monitoring, vedi sync-x-posts.mjs)
// non è una vera "API key": rettiwt-api la costruisce come i cookie reali
// dell'account X loggato (auth_token, ct0, twid, ...) codificati in base64
// (vedi AuthService.decodeCookie in node_modules/rettiwt-api/dist/services/internal/AuthService.js).
// Riusata qui da probe-x-trending-authenticated.mjs e discover-x-trending.mjs
// per iniettare la stessa sessione autenticata in un browser Playwright vero.

export function decodeCookieString(apiKey) {
  return Buffer.from(apiKey, "base64").toString("ascii");
}

export function toPlaywrightCookies(cookieString) {
  return cookieString
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf("=");
      if (idx < 1) return null;
      const name = entry.slice(0, idx).trim();
      const value = entry.slice(idx + 1).trim();
      if (!name || !value) return null;
      return { name, value, domain: ".x.com", path: "/" };
    })
    .filter(Boolean);
}
