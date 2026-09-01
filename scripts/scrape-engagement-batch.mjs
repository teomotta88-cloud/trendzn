// Recupera dati di engagement (views/likes/comments/shares/caption) per i
// post Jul-Aug 2025-2026 monitorati in bluserena-monitoring.json usando il
// modulo Emplifi LISTENING (non gli endpoint "profili gestiti" della
// Analytics API, che richiedono account collegati/pubblicati — i post
// monitorati qui sono di terzi, quindi vanno cercati via Listening query).
//
// Flusso:
//   1. GET /3/listening/queries  -> risolve l'ID della query "Bluserena"
//      (nome configurato lato dashboard Emplifi).
//   2. POST /3/listening/posts   -> scarica i post trovati dalla query per
//      le due finestre Jul-Aug (2025 e 2026), paginando finché la risposta
//      non è più piena.
//   3. Match per URL normalizzato con gli account già presenti nello store,
//      arricchimento dei campi mancanti.
//
// ATTENZIONE: il path esatto di (2) non è confermato da documentazione
// pubblica (l'host api.emplifi.io non è raggiungibile da questo ambiente
// per verificarlo), è dedotto dal pattern generale delle altre API Emplifi
// (POST /3/{scope}/... con body {date_start,date_end,fields,limit}). Se il
// primo run fallisce, il log stampa status + body grezzo della risposta per
// poter correggere il path senza dover indovinare di nuovo alla cieca.

import fs from "fs/promises";

const STORE_PATH = "src/data/bluserena-monitoring.json";
const EMPLIFI_API_SECRET = process.env.EMPLIFI_API_SECRET;
const EMPLIFI_API_TOKEN = process.env.EMPLIFI_API_TOKEN;
const EMPLIFI_API_BASE = "https://api.emplifi.io/3";
const LISTENING_QUERY_NAME = process.env.EMPLIFI_LISTENING_QUERY_NAME || "Bluserena";
const PAGE_LIMIT = 200;

if (!EMPLIFI_API_SECRET || !EMPLIFI_API_TOKEN) {
  console.error("❌ Missing EMPLIFI_API_SECRET or EMPLIFI_API_TOKEN environment variables");
  process.exit(1);
}

const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  console.error("❌ Manca GITHUB_TOKEN nell'ambiente.");
  process.exit(1);
}

const ghHeaders = {
  Authorization: `token ${githubToken}`,
  Accept: "application/vnd.github.v3+json",
};

const authHeader = `Basic ${Buffer.from(`${EMPLIFI_API_SECRET}:${EMPLIFI_API_TOKEN}`).toString("base64")}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

async function emplifiRequest(path, { method = "GET", body } = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${EMPLIFI_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });

      const text = await res.text();

      if (!res.ok) {
        // Errore 4xx: non ha senso ritentare, il path/parametri sono sbagliati.
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`${method} ${path} -> ${res.status}: ${text.substring(0, 500)}`);
        }
        // 5xx: puo' essere transitorio, ritenta.
        if (attempt < retries) {
          console.error(`  ⚠️  ${method} ${path} -> ${res.status}, retry ${attempt}/${retries}...`);
          await sleep(Math.pow(2, attempt) * 1000);
          continue;
        }
        throw new Error(`${method} ${path} -> ${res.status}: ${text.substring(0, 500)}`);
      }

      return text ? JSON.parse(text) : null;
    } catch (err) {
      if (err.name === "AbortError" || err.message.includes("fetch failed")) {
        if (attempt < retries) {
          console.error(`  ⚠️  ${method} ${path} -> ${err.message}, retry ${attempt}/${retries}...`);
          await sleep(Math.pow(2, attempt) * 1000);
          continue;
        }
      }
      throw err;
    }
  }
}

async function resolveListeningQueryId(name) {
  console.log(`🔎 Cerco la Listening query "${name}"...`);
  const data = await emplifiRequest("/listening/queries");
  const queries = data?.data ?? data?.queries ?? (Array.isArray(data) ? data : []);

  if (!Array.isArray(queries) || queries.length === 0) {
    console.error("❌ Nessuna Listening query trovata nella risposta. Risposta grezza:");
    console.error(JSON.stringify(data).substring(0, 1000));
    process.exit(1);
  }

  console.log(`   Trovate ${queries.length} query: ${queries.map((q) => q.name).join(", ")}`);

  const match = queries.find((q) => (q.name || "").toLowerCase() === name.toLowerCase());
  if (!match) {
    console.error(`❌ Nessuna query chiamata "${name}" tra quelle disponibili.`);
    process.exit(1);
  }

  console.log(`   ✅ Query "${match.name}" -> id=${match.id}`);
  return match.id;
}

async function fetchListeningPosts(queryId, dateStart, dateEnd) {
  const posts = [];
  let offset = 0;
  let pageNum = 1;

  while (true) {
    console.log(`   📄 Pagina ${pageNum} (offset ${offset}) per ${dateStart}..${dateEnd}...`);
    const data = await emplifiRequest("/listening/posts", {
      method: "POST",
      body: {
        queries: [queryId],
        date_start: dateStart,
        date_end: dateEnd,
        fields: [
          "url",
          "post_link",
          "permalink",
          "content",
          "text",
          "caption",
          "engagements",
          "likes",
          "comments",
          "shares",
          "views",
          "reach",
          "impressions",
        ],
        limit: PAGE_LIMIT,
        offset,
      },
    });

    if (pageNum === 1) {
      console.log("   Esempio risposta grezza (primi 500 char):");
      console.log("   " + JSON.stringify(data).substring(0, 500));
    }

    const items = data?.data ?? data?.posts ?? data?.mentions ?? (Array.isArray(data) ? data : []);
    if (!Array.isArray(items) || items.length === 0) break;

    posts.push(...items);

    if (items.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
    pageNum++;
    await sleep(500);
  }

  return posts;
}

function extractPostUrl(item) {
  return item.url || item.post_link || item.permalink || item.link || null;
}

function extractPostData(item) {
  return {
    caption: item.content || item.text || item.caption || item.desc || null,
    views: item.views ?? item.video_views ?? item.impressions ?? null,
    likes: item.likes ?? item.reactions ?? null,
    comments: item.comments ?? item.comments_count ?? null,
    shares: item.shares ?? item.shares_count ?? null,
  };
}

async function main() {
  try {
    console.log("📥 Reading bluserena-monitoring.json...");
    const fileContent = await fs.readFile(STORE_PATH, "utf-8");
    const data = JSON.parse(fileContent);

    const urlToAccount = new Map();

    for (const canale of data.canali) {
      for (const account of canale.accounts || []) {
        if (!account.url) continue;

        const date = new Date(account.date);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;

        const isJulAug = month === 7 || month === 8;
        const isTargetYear = year === 2025 || year === 2026;

        if (isJulAug && isTargetYear) {
          urlToAccount.set(normalizeUrl(account.url), account);
        }
      }
    }

    console.log(`📊 ${urlToAccount.size} URL monitorati per Jul-Aug 2025-2026`);

    const queryId = await resolveListeningQueryId(LISTENING_QUERY_NAME);

    console.log(`\n🔄 Scarico i post dalla Listening query...\n`);
    const allPosts = [
      ...(await fetchListeningPosts(queryId, "2025-07-01", "2025-08-31")),
      ...(await fetchListeningPosts(queryId, "2026-07-01", "2026-08-31")),
    ];

    console.log(`\n📊 ${allPosts.length} post scaricati da Emplifi Listening`);

    let updated = 0;
    let matched = 0;

    for (const item of allPosts) {
      const rawUrl = extractPostUrl(item);
      if (!rawUrl) continue;

      const account = urlToAccount.get(normalizeUrl(rawUrl));
      if (!account) continue;

      matched++;
      const result = extractPostData(item);
      let changed = false;

      if (result.caption && !account.caption) {
        account.caption = result.caption;
        changed = true;
      }
      if (result.views != null && result.views !== account.views) {
        account.views = result.views;
        changed = true;
      }
      if (result.likes != null && result.likes !== account.likes) {
        account.likes = result.likes;
        changed = true;
      }
      if (result.comments != null && result.comments !== account.comments) {
        account.comments = result.comments;
        changed = true;
      }
      if (result.shares != null && result.shares !== account.shares) {
        account.shares = result.shares;
        changed = true;
      }

      if (changed) updated++;
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Post Emplifi corrispondenti a URL monitorati: ${matched}`);
    console.log(`   Account aggiornati: ${updated}`);

    if (updated === 0) {
      console.log("\nNo updates made, skipping commit.");
      process.exit(0);
    }

    console.log(`\n💾 Writing updated JSON...`);
    await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2));

    console.log(`📤 Committing to GitHub...`);
    const res = await fetch(
      `https://api.github.com/repos/teomotta88-cloud/trendzn/contents/${STORE_PATH}`,
      { headers: ghHeaders }
    );
    const fileData = await res.json();

    const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
    await fetch(
      `https://api.github.com/repos/teomotta88-cloud/trendzn/contents/${STORE_PATH}`,
      {
        method: "PUT",
        headers: { ...ghHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `chore: update engagement data for Jul-Aug 2025-2026 posts via Emplifi Listening

- Updated caption, views, likes, comments, shares for ${updated} posts
- Source: Emplifi Listening query "${LISTENING_QUERY_NAME}"
- Jul-Aug 2025-2026 timeframe`,
          content,
          sha: fileData.sha,
        }),
      }
    );

    console.log("✅ Committed successfully!");
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
  }
}

main();
