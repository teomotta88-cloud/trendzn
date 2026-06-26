"""Prototipo: replica per LinkedIn dello script scripts/sync-canali-feed.mjs.

A differenza di RSS-Bridge (che legge contenuti pubblici senza login per
Instagram/TikTok), LinkedIn richiede una sessione autenticata: questo script
usa linkedin_scraper (Playwright) con un account LinkedIn dedicato, pensato
per girare come servizio a parte (es. Railway) con un volume persistente per
session.json, non come job effimero di GitHub Actions.

Variabili d'ambiente richieste:
  GITHUB_TOKEN        token con permesso "contents: write" sul repo
  LINKEDIN_EMAIL      email dell'account LinkedIn dedicato (solo al primo login)
  LINKEDIN_PASSWORD   password (solo al primo login)

Variabili opzionali:
  SESSION_PATH        percorso del file di sessione persistito (default: ./session.json)
  MAX_POSTS_PER_CHANNEL (default: 15, stesso valore dello script Node)
"""

import asyncio
import base64
import json
import os
from pathlib import Path

import httpx
from linkedin_scraper import BrowserManager, CompanyPostsScraper, login_with_credentials

REPO = "teomotta88-cloud/trendzn"
TRENDS_PATH = "src/data/trends.json"
SESSION_PATH = Path(os.getenv("SESSION_PATH", "session.json"))
MAX_POSTS_PER_CHANNEL = int(os.getenv("MAX_POSTS_PER_CHANNEL", "15"))
POSTS_PER_COMPANY = 10

GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GH_HEADERS = {
    "Authorization": f"token {GITHUB_TOKEN}",
    "Accept": "application/vnd.github.v3+json",
}


async def read_trends_json(client: httpx.AsyncClient) -> tuple[dict, str]:
    res = await client.get(f"https://api.github.com/repos/{REPO}/contents/{TRENDS_PATH}", headers=GH_HEADERS)
    res.raise_for_status()
    data = res.json()
    trends = json.loads(base64.b64decode(data["content"]).decode("utf-8"))
    return trends, data["sha"]


async def write_trends_json(client: httpx.AsyncClient, trends: dict, sha: str) -> None:
    content = base64.b64encode(json.dumps(trends, indent=2, ensure_ascii=False).encode("utf-8")).decode("ascii")
    res = await client.put(
        f"https://api.github.com/repos/{REPO}/contents/{TRENDS_PATH}",
        headers=GH_HEADERS,
        json={"message": "chore: sync post LinkedIn [trendzn-bot]", "content": content, "sha": sha},
    )
    res.raise_for_status()


def is_post_url(url: str) -> bool:
    return "/posts/" in url or "/feed/update/" in url


async def ensure_session(browser: BrowserManager) -> None:
    if SESSION_PATH.exists():
        await browser.load_session(str(SESSION_PATH))
        return
    await login_with_credentials(
        browser.page,
        email=os.environ["LINKEDIN_EMAIL"],
        password=os.environ["LINKEDIN_PASSWORD"],
    )
    await browser.save_session(str(SESSION_PATH))


async def main() -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        trends, sha = await read_trends_json(client)

        lists = [
            trends.get("canali_inspo", []),
            trends.get("influencer_profiles", []),
            trends.get("canali_cliente", []),
        ]

        # Canali con un account LinkedIn configurato (solo aziende per ora:
        # CompanyPostsScraper, non profili personali)
        linkedin_targets = [
            (canale, account)
            for lista in lists
            for canale in lista
            for account in canale.get("accounts", [])
            if account.get("platform") == "linkedin" and not is_post_url(account.get("url", ""))
        ]

        if not linkedin_targets:
            print("Nessun canale LinkedIn configurato in trends.json, esco.")
            return

        print(f"Sincronizzo {len(linkedin_targets)} canali LinkedIn.")
        modified = False

        async with BrowserManager(headless=True) as browser:
            await ensure_session(browser)
            scraper = CompanyPostsScraper(browser.page)

            for canale, account in linkedin_targets:
                try:
                    posts = await scraper.scrape(account["url"], limit=POSTS_PER_COMPANY)
                except Exception as err:  # account privato, layout cambiato, rate limit, ecc.
                    print(f"Scrape LinkedIn fallito per {account['url']}: {err}")
                    continue

                existing_urls = {a["url"] for a in canale["accounts"]}
                for post in posts:
                    if not post.linkedin_url or post.linkedin_url in existing_urls:
                        continue

                    canale["accounts"].append(
                        {
                            "platform": "linkedin",
                            "handle": account.get("handle"),
                            "url": post.linkedin_url,
                            "date": post.posted_date,
                            "caption": post.text or None,
                        }
                    )
                    existing_urls.add(post.linkedin_url)
                    modified = True

                post_entries = [a for a in canale["accounts"] if is_post_url(a["url"])]
                while len(post_entries) > MAX_POSTS_PER_CHANNEL:
                    oldest = post_entries.pop(0)
                    canale["accounts"].remove(oldest)

        if not modified:
            print("Nessuna novità, trends.json non modificato.")
            return

        await write_trends_json(client, trends, sha)
        print("trends.json aggiornato su GitHub.")


if __name__ == "__main__":
    asyncio.run(main())
