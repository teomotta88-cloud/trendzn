const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const RSS_BRIDGE_BASE = process.env.RSS_BRIDGE_BASE || "http://localhost:3000/";

const ghHeaders = {
  Authorization: `token ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github.v3+json",
};

function isInJulyAugust(date) {
  if (!date) return false;
  const d = new Date(date);
  const month = d.getMonth() + 1;
  return month === 7 || month === 8;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fullCaption(item) {
  const html = item.content_html || "";
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;/gi, (entity) => {
      const map = {
        "&agrave;": "à", "&aacute;": "á", "&acirc;": "â", "&atilde;": "ã", "&auml;": "ä", "&aring;": "å",
        "&egrave;": "è", "&eacute;": "é", "&ecirc;": "ê", "&euml;": "ë",
        "&igrave;": "ì", "&iacute;": "í", "&icirc;": "î", "&iuml;": "ï",
        "&ograve;": "ò", "&oacute;": "ó", "&ocirc;": "ô", "&otilde;": "õ", "&ouml;": "ö",
        "&ugrave;": "ù", "&uacute;": "ú", "&ucirc;": "û", "&uuml;": "ü",
        "&ntilde;": "ñ", "&ccedil;": "ç", "&szlig;": "ß",
        "&Agrave;": "À", "&Aacute;": "Á", "&Egrave;": "È", "&Eacute;": "É",
      };
      return map[entity] || entity;
    })
    .trim();
  return text || null;
}

function extractMetadata(rssItem) {
  if (!rssItem) return null;

  const result = {
    caption: fullCaption(rssItem) || rssItem.title || null,
    views: null,
    likes: null,
    comments: null,
    shares: null,
  };

  const content = rssItem.content_html || "";
  const viewMatch = content.match(/(\d+)\s*views?/i);
  if (viewMatch) result.views = parseInt(viewMatch[1]);

  const likeMatch = content.match(/(\d+)\s*likes?/i);
  if (likeMatch) result.likes = parseInt(likeMatch[1]);

  const commentMatch = content.match(/(\d+)\s*comments?/i);
  if (commentMatch) result.comments = parseInt(commentMatch[1]);

  const shareMatch = content.match(/(\d+)\s*shares?/i);
  if (shareMatch) result.shares = parseInt(shareMatch[1]);

  return result;
}

async function fetchRSSBridge(url) {
  try {
    const platform = url.includes("tiktok.com") ? "TikTok" : "Instagram";
    const rssUrl = `${RSS_BRIDGE_BASE}?action=display&bridge=${platform}&url=${encodeURIComponent(url)}&format=JSON`;

    const res = await fetch(rssUrl, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;

    const data = await res.json();
    return data?.items?.[0] || null;
  } catch (err) {
    console.log(`  ⚠ RSS-Bridge error: ${err.message}`);
    return null;
  }
}

async function main() {
  try {
    console.log("\u{1F4E5} Reading bluserena-monitoring.json...");
    const fs = await import("fs").then(m => m.promises);
    const fileContent = await fs.readFile(STORE_PATH, "utf-8");
    const data = JSON.parse(fileContent);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    const postsToUpdate = [];
    for (const canale of data.canali) {
      for (const account of canale.accounts || []) {
        if (account.platform !== "tiktok") continue;

        if (!isInJulyAugust(account.date)) continue;

        if (account.caption && account.views) {
          skipped++;
          continue;
        }

        postsToUpdate.push(account);
      }
    }

    console.log(`\u{1F50D} Found ${postsToUpdate.length} posts to backfill`);
    console.log(`\u{23ED} Skipped ${skipped} posts (already have data)`);

    for (let i = 0; i < postsToUpdate.length; i++) {
      const account = postsToUpdate[i];

      try {
        console.log(
          `[${i + 1}/${postsToUpdate.length}] ${account.handle} ${account.date ? account.date.split("T")[0] : "?"}`
        );

        const rssItem = await fetchRSSBridge(account.url);

        if (rssItem) {
          const metadata = extractMetadata(rssItem);
          if (metadata && metadata.caption) {
            if (!account.caption) {
              account.caption = metadata.caption;
              console.log(`  ✅ caption (${metadata.caption.length} chars)`);
            }
            if (!account.views && metadata.views) {
              account.views = metadata.views;
              console.log(`  ✅ views (${metadata.views})`);
            }
            if (!account.likes && metadata.likes) {
              account.likes = metadata.likes;
              console.log(`  ✅ likes (${metadata.likes})`);
            }
            if (!account.comments && metadata.comments) {
              account.comments = metadata.comments;
              console.log(`  ✅ comments (${metadata.comments})`);
            }
            if (!account.shares && metadata.shares) {
              account.shares = metadata.shares;
              console.log(`  ✅ shares (${metadata.shares})`);
            }
            updated++;
          } else {
            errors++;
            console.log(`  ⚠ No caption extracted`);
          }
        } else {
          errors++;
          console.log(`  ⚠ RSS-Bridge no data`);
        }

        await delay(1000);
      } catch (err) {
        console.log(`  ❌ ${err.message}`);
        errors++;
      }
    }

    console.log(`\n\u{1F4CA} Summary:`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Errors: ${errors}`);
    console.log(`  Skipped: ${skipped}`);

    console.log(`\n\u{1F4BE} Updating file and committing to GitHub...`);

    await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2));

    const res = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`,
      { headers: ghHeaders }
    );
    const fileData = await res.json();

    const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
    await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `chore: backfill caption and engagement data for Jul-Aug 2025-2026 posts

- Updated ${updated} posts with caption, views, likes, comments, shares
- Source: RSS-Bridge
- Filtered: Only Jul-Aug 2025 and 2026 TikTok posts with null fields`,
        content,
        sha: fileData.sha,
      }),
    });

    console.log("✅ Committed successfully!");
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
  }
}

main();
