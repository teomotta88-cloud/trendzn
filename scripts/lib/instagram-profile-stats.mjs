// Follower count e foto profilo di un account Instagram, da visitatore
// anonimo (nessun login) — letti dalla pagina profilo pubblica
// (https://www.instagram.com/<username>/), non dai singoli post.
//
// Fonte: il meta tag "description"/"og:description" che Instagram genera
// per le anteprime di condivisione della pagina PROFILO ha un formato fisso
// e diverso da quello dei post (vedi instagram-public-metrics.mjs):
// "12.3K Followers, 456 Following, 789 Posts - See Instagram photos and
// videos from <Nome> (@username)". La foto profilo è nel meta "og:image",
// sempre presente anche per un visitatore anonimo.
//
// Uso previsto: una chiamata per profilo monitorato ad ogni check (non per
// singolo post), per tenere aggiornati followers_count/profile_pic_url in
// instagram_monitored_profiles — solo a scopo di visualizzazione nell'UI,
// non usati dall'euristica di rilevamento collab.

const FOLLOWERS_PATTERN = /^([\d.,]+[KM]?)\s+Followers?/i;

function parseCount(text) {
  const match = text.replace(/,/g, "").match(/^([\d.]+)([KM]?)$/i);
  if (!match) return null;
  const n = parseFloat(match[1]);
  const suffix = match[2].toUpperCase();
  if (suffix === "K") return Math.round(n * 1_000);
  if (suffix === "M") return Math.round(n * 1_000_000);
  return Math.round(n);
}

// context: quello aperto da openInstagramMetricsSession()/browser.newContext,
// riusato per tutti i profili della run invece di aprirne uno per profilo.
export async function fetchProfileStats(context, username) {
  const page = await context.newPage();
  try {
    await page.goto(`https://www.instagram.com/${username}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (/\/(accounts\/login|challenge)/.test(page.url())) {
      return { stats: null, reason: "login-wall" };
    }

    const description = await page
      .$eval('meta[name="description"], meta[property="og:description"]', (el) =>
        el.getAttribute("content"),
      )
      .catch(() => null);

    const followersMatch = description?.match(FOLLOWERS_PATTERN);
    const followersCount = followersMatch ? parseCount(followersMatch[1]) : null;

    const profilePicUrl = await page
      .$eval('meta[property="og:image"]', (el) => el.getAttribute("content"))
      .catch(() => null);

    if (followersCount == null && !profilePicUrl) {
      return { stats: null, reason: description ? "pattern-mismatch" : "no-description" };
    }

    return { stats: { followersCount, profilePicUrl }, reason: null };
  } catch (err) {
    return { stats: null, reason: `error:${String(err)}` };
  } finally {
    await page.close();
  }
}
