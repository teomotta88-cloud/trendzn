// Script diagnostico usa-e-getta: dump della struttura JSON che TikTok
// incorpora in ogni pagina video (script#__UNIVERSAL_DATA_FOR_REHYDRATION__),
// per scoprire DOVE si trova il geotag (POI) prima di fidarsi
// dell'estrazione in sync-bluserena-hashtags.mjs — quel codice è stato
// scritto sulla struttura NOTA/documentata di TikTok ma mai verificato dal
// vivo (nessun accesso di rete a tiktok.com dall'ambiente di sviluppo), su
// richiesta esplicita di verificarlo con due video reali geotaggati.
//
// Uso: node scripts/probe-tiktok-video-json.mjs <url1>[,<url2>,...]

import { chromium } from "playwright";

const urls = (process.argv[2] || "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

if (urls.length === 0) {
  console.error("Uso: node scripts/probe-tiktok-video-json.mjs <url1>[,<url2>,...]");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
});

try {
  for (const url of urls) {
    console.log(`\n\n========== ${url} ==========`);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2500);

      const raw = await page
        .$eval("#__UNIVERSAL_DATA_FOR_REHYDRATION__", (el) => el.textContent)
        .catch(() => null);

      if (!raw) {
        console.error("Script __UNIVERSAL_DATA_FOR_REHYDRATION__ non trovato nella pagina.");
        const title = await page.title().catch(() => null);
        console.error(`Titolo pagina (per capire se siamo su un login-wall): ${title}`);
        continue;
      }

      const data = JSON.parse(raw);
      const scopeKeys = Object.keys(data?.__DEFAULT_SCOPE__ ?? {});
      console.log("Chiavi in __DEFAULT_SCOPE__:", scopeKeys);

      const itemStruct =
        data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct ?? null;

      if (!itemStruct) {
        console.error("itemStruct non trovato al path atteso (webapp.video-detail.itemInfo.itemStruct).");
        continue;
      }

      console.log("\nChiavi di primo livello di itemStruct:", Object.keys(itemStruct));

      console.log("\n--- itemStruct.poi ---");
      console.log(JSON.stringify(itemStruct.poi ?? null, null, 2));

      console.log("\n--- itemStruct.anchors ---");
      console.log(JSON.stringify(itemStruct.anchors ?? null, null, 2));

      console.log("\n--- itemStruct.locationCreated / itemStruct.location (se esistono) ---");
      console.log(JSON.stringify(itemStruct.locationCreated ?? itemStruct.location ?? null, null, 2));

      console.log("\n--- itemStruct.desc (caption) ---");
      console.log(itemStruct.desc ?? null);

      console.log("\n--- itemStruct.author (per confronto con l'estrazione già fatta dall'URL) ---");
      console.log(JSON.stringify(itemStruct.author ?? null, null, 2));

      console.log("\n--- itemStruct.createTime (per confronto con la data derivata dall'ID video) ---");
      console.log(itemStruct.createTime ?? null);
    } catch (err) {
      console.error(`Errore su ${url}: ${String(err)}`);
    }
  }
} finally {
  await browser.close();
}
