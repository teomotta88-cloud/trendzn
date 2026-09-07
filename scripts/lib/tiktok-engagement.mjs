// Estrazione dei contatori di engagement dal JSON che TikTok incorpora in
// ogni pagina video (script#__UNIVERSAL_DATA_FOR_REHYDRATION__). Sta qui, e
// non dentro scrape-tiktok-engagement.mjs, perché è l'unica parte
// verificabile senza rete: la policy dell'ambiente di sviluppo nega
// tiktok.com, quindi il percorso dei campi va coperto dai test su strutture
// realistiche invece che da un run dal vivo.

// Il campo piatto letto dalla UI e la chiave corrispondente in stats/statsV2.
export const METRIC_KEYS = {
  views: "playCount",
  likes: "diggCount",
  comments: "commentCount",
  shares: "shareCount",
};

export const METRICS = Object.keys(METRIC_KEYS);

// I contatori arrivano come numero in `stats` e come stringa di cifre in
// `statsV2`. Qualunque altra cosa (null, "", "1.2M" abbreviato, negativi)
// diventa null invece di NaN o di un numero inventato: su una pagina che può
// tornare parziale, meglio un buco dichiarato che un dato falso salvato come
// buono.
export function toCount(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number.parseInt(value.trim(), 10);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

// statsV2 ha la precedenza su stats: è il blocco più recente e sulle view
// molto alte stats arrotonda. Il fallback è campo per campo, non a blocchi:
// se statsV2 esiste ma ha un solo contatore valorizzato, gli altri tre si
// prendono comunque da stats invece di perderli.
export function extractStats(itemStruct) {
  const stats = itemStruct?.stats ?? {};
  const statsV2 = itemStruct?.statsV2 ?? {};
  const out = {};
  for (const [metric, key] of Object.entries(METRIC_KEYS)) {
    out[metric] = toCount(statsV2[key]) ?? toCount(stats[key]);
  }
  return out;
}

// Legge il payload di idratazione già parsato e dice cosa contiene: o le
// metriche, o il motivo per cui non ci sono. Il chiamante ci aggiunge solo
// quello che sa lui (login-wall, errori di rete).
export function readVideoDetail(data) {
  const detail = data?.__DEFAULT_SCOPE__?.["webapp.video-detail"];
  const itemStruct = detail?.itemInfo?.itemStruct;

  if (!itemStruct) {
    // statusCode != 0 = video rimosso, privato o non disponibile: esito
    // legittimo del singolo post, non un guasto della pipeline.
    const code = detail?.statusCode;
    if (code) return { status: "not_found", reason: `statusCode ${code}` };
    return { status: "no_data", reason: "itemStruct assente" };
  }

  const stats = extractStats(itemStruct);
  if (METRICS.every((m) => stats[m] == null)) {
    return { status: "no_stats", reason: "itemStruct senza contatori" };
  }

  // La caption è nella stessa pagina già scaricata per i contatori
  // (itemStruct.desc): prenderla qui non costa una richiesta in più ed evita
  // di passare da backfill-bluserena-caption.mjs, che riscrive l'intero store
  // con una PUT sola e senza retry sui conflitti.
  const caption = typeof itemStruct.desc === "string" ? itemStruct.desc.trim() : "";

  return { status: "ok", source: "tiktok-page", caption: caption || null, ...stats };
}

// I campi piatti views/likes/comments/shares sono quelli che legge la UI. Si
// riempiono solo dove sono vuoti: 218 post hanno già i numeri da
// backfill-tiktok-hashtag.mjs (Apify/ScrapeCreators) e sovrascriverli
// silenziosamente cambierebbe dati esistenti senza che nessuno l'abbia
// chiesto. Con overwrite=true si rinfrescano da questa fonte, che essendo la
// pagina del video è la più aggiornata. `applied` elenca cosa è stato scritto
// davvero, così il record spiega da solo perché un post con status "ok" può
// non aver cambiato nulla.
export function applyEngagement(account, record, { overwrite = false } = {}) {
  account.engagementData = record;
  if (record.status !== "ok") return record;

  const applied = [];
  for (const metric of METRICS) {
    const value = record[metric];
    if (value == null) continue;
    if (!overwrite && account[metric] != null) continue;
    account[metric] = value;
    applied.push(metric);
  }

  // La caption si riempie SOLO se manca, anche con overwrite=true: i numeri
  // invecchiano e ha senso rinfrescarli, un testo no — e alcune caption sono
  // state sistemate a mano dal feed, sovrascriverle sarebbe una perdita.
  if (record.caption && !(account.caption ?? "").trim()) {
    account.caption = record.caption;
    applied.push("caption");
  }

  record.applied = applied;
  return record;
}
