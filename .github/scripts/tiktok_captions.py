#!/usr/bin/env python3
"""Recupera caption, autore e thumbnail dei post TikTok via oEmbed pubblico.

Seleziona da src/data/bluserena-monitoring.json tutti i post TikTok con
caption mancante nelle finestre Jul-Ago 2025 e Jul-Ago 2026, li interroga
sull'endpoint oEmbed pubblico di TikTok e riempie i campi vuoti.

Il lavoro e' ripetibile: un post con la caption gia' valorizzata non viene
piu' selezionato, quindi un run interrotto riparte da dove si era fermato.

Solo standard library: gira con il python3 gia' presente sul runner.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

STORE = "src/data/bluserena-monitoring.json"
OEMBED = "https://www.tiktok.com/oembed?url="
# Senza uno User-Agent da browser desktop TikTok risponde in modo inaffidabile.
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
SHORT_HOSTS = ("vm.tiktok.com", "vt.tiktok.com")
FINESTRE = ("2025-07", "2025-08", "2026-07", "2026-08")
ATTEMPTS = 3


def fetch(url):
    """GET con retry a backoff esponenziale su rete, timeout e 5xx."""
    for attempt in range(1, ATTEMPTS + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=15) as res:
                return res.read().decode("utf-8", "replace"), res.geturl()
        except urllib.error.HTTPError as err:
            if err.code == 429:
                # Gli IP dei runner GitHub sono datacenter: il rate limit
                # scatta piu' facilmente che da una connessione residenziale.
                wait = 30 * attempt
            elif err.code >= 500:
                wait = 2**attempt
            else:
                raise
            if attempt == ATTEMPTS:
                raise
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt == ATTEMPTS:
                raise
            time.sleep(2**attempt)


def is_tiktok(url):
    return (urllib.parse.urlsplit(url).hostname or "").lower().endswith("tiktok.com")


def canonical(url):
    """Risolve gli short link vm/vt e toglie query string e fragment."""
    if (urllib.parse.urlsplit(url).hostname or "").lower() in SHORT_HOSTS:
        url = fetch(url)[1]
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), "", ""))


def oembed(url):
    data = json.loads(fetch(OEMBED + urllib.parse.quote(url, safe=""))[0])
    return {
        "caption": data.get("title"),
        "handle": data.get("author_unique_id"),
        "imageUrl": data.get("thumbnail_url"),
    }


def seleziona(store):
    """Post TikTok senza caption nelle finestre Jul-Ago 2025 e 2026."""
    return [
        a
        for canale in store.get("canali", [])
        for a in canale.get("accounts", [])
        if a.get("url")
        and is_tiktok(a["url"])
        and not a.get("caption")
        and (a.get("date") or "")[:7] in FINESTRE
    ]


def salva(store):
    with open(STORE, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)


def main():
    pausa = float(os.environ.get("TIKTOK_PAUSE") or 1)

    with open(STORE, encoding="utf-8") as f:
        store = json.load(f)

    posts = seleziona(store)
    print(f"{len(posts)} post TikTok senza caption in Jul-Ago 2025/2026, pausa {pausa}s")
    if not posts:
        return

    errori = []
    ok = aggiornati = 0

    for i, account in enumerate(posts, 1):
        try:
            dati = oembed(canonical(account["url"]))
        except Exception as err:  # noqa: BLE001 - un post rotto non ferma il job
            errori.append((account["url"], str(err)))
            print(f"  ❌ {account['url']} — {err}")
        else:
            ok += 1
            riempiti = [c for c in dati if dati[c] and not account.get(c)]
            for campo in riempiti:
                account[campo] = dati[campo]
            if riempiti:
                aggiornati += 1
                # Salvataggio incrementale: un timeout o un annullamento non
                # butta via quanto gia' recuperato.
                if aggiornati % 25 == 0:
                    salva(store)
            print(f"  ✅ {account['url']} — {', '.join(riempiti) or 'niente da riempire'}")

        if i % 50 == 0:
            print(f"  ...{i}/{len(posts)} — recuperati {ok}, aggiornati {aggiornati}")
        if i < len(posts):
            time.sleep(pausa)

    salva(store)
    print(f"\nRecuperati {ok}/{len(posts)} — post aggiornati: {aggiornati}, falliti: {len(errori)}")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("## TikTok oEmbed\n\n")
            f.write(f"Selezionati {len(posts)} — recuperati {ok}, aggiornati {aggiornati}, ")
            f.write(f"falliti {len(errori)}\n")
            if errori:
                f.write("\n| URL | Errore |\n| --- | --- |\n")
                for url, err in errori:
                    f.write(f"| {url} | {err.replace('|', chr(92) + '|')} |\n")

    if ok == 0:
        sys.exit("Tutti gli URL sono falliti.")


main()
