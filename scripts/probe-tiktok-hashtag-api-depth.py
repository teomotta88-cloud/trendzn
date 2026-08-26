"""Script diagnostico usa-e-getta: misura quanto indietro nel tempo riesce ad
arrivare la libreria TikTokApi (davidteather/TikTok-Api), che invece di fare
scroll del DOM come scripts/probe-tiktok-hashtag-depth.mjs chiama
direttamente l'endpoint interno di TikTok con paginazione a cursore
(hashtag.videos(count=...)) finché l'API stessa non dice "non c'è altro".

Motivo del test: il probe DOM (probe-tiktok-hashtag-depth.mjs) su #bluserena
si è fermato a 60 video unici, ma un conteggio manuale sull'app suggerisce
almeno 360 contenuti reali — quindi il muro visto non è detto sia un limite
reale dell'hashtag, potrebbe essere un limite della tecnica di scroll
anonimo. Questo script verifica se un accesso più simile a quello di un
utente vero (con paginazione via API, non re-render del DOM) recupera di più.

Nessuna scrittura su store: solo output in console.

Setup (il workflow lo fa già in CI, in locale servirebbe):
  pip install TikTokApi
  python -m playwright install chromium

Uso: python scripts/probe-tiktok-hashtag-api-depth.py <hashtag>
Env opzionali:
  MAX_VIDEOS (default 500) — quanti video richiedere in paginazione
  ms_token — se assente, TikTokApi prova a generarlo da solo aprendo una
    sessione browser vera (meno affidabile ma non richiede setup manuale,
    vedi note nel README del progetto sulla fragilità di questo passaggio)
"""

import asyncio
import os
import sys
from collections import Counter
from datetime import datetime, timezone

from TikTokApi import TikTokApi


async def main():
    if len(sys.argv) < 2:
        print("Uso: python scripts/probe-tiktok-hashtag-api-depth.py <hashtag>")
        sys.exit(1)

    tag = sys.argv[1]
    max_videos = int(os.environ.get("MAX_VIDEOS", "500"))
    ms_token = os.environ.get("ms_token")

    print(f"=== Probe API TikTok (paginazione a cursore): #{tag} ===")
    print(f"Richiesti fino a {max_videos} video via hashtag.videos()\n")
    if ms_token:
        print("ms_token fornito via env.")
    else:
        print("Nessun ms_token fornito: TikTokApi proverà a generarlo da solo (meno affidabile).")

    session_kwargs = {
        "num_sessions": 1,
        "sleep_after": 3,
        "browser": os.environ.get("TIKTOK_BROWSER", "chromium"),
    }
    if ms_token:
        session_kwargs["ms_tokens"] = [ms_token]

    dates = []
    total = 0
    errored = False

    async with TikTokApi() as api:
        await api.create_sessions(**session_kwargs)
        hashtag = api.hashtag(name=tag)
        try:
            async for video in hashtag.videos(count=max_videos):
                total += 1
                create_time = video.as_dict.get("createTime")
                if create_time:
                    dates.append(datetime.fromtimestamp(int(create_time), tz=timezone.utc))
                if total % 50 == 0:
                    print(f"  {total} video ricevuti finora...")
        except Exception as exc:  # diagnostico: vogliamo comunque il riepilogo parziale
            errored = True
            print(f"\nInterrotto da un errore a metà raccolta: {exc}")

    print(f"\nVideo totali restituiti dall'API: {total}" + (" (raccolta interrotta da errore)" if errored else ""))

    if not dates:
        print("Nessuna data ricavabile dagli item restituiti (campo createTime assente?).")
        return

    dates.sort()
    print(f"Video più vecchio: {dates[0].date().isoformat()}")
    print(f"Video più recente: {dates[-1].date().isoformat()}")

    by_month = Counter(f"{d.year}-{d.month:02d}" for d in dates)
    print("Distribuzione per mese:")
    for month in sorted(by_month):
        print(f"  {month}: {by_month[month]}")


if __name__ == "__main__":
    asyncio.run(main())
