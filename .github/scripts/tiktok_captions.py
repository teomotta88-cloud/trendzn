#!/usr/bin/env python3
"""Recupera caption, autore e thumbnail dei post TikTok via oEmbed pubblico.

Legge gli URL (uno per riga) da TIKTOK_URLS, interroga l'endpoint oEmbed
pubblico di TikTok e riporta i dati sui post gia' presenti in
src/data/bluserena-monitoring.json, riempiendo solo i campi vuoti.

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


def strip_url(url):
    """Toglie query string, fragment, slash finale e www: serve per il match."""
    parts = urllib.parse.urlsplit(url)
    host = (parts.hostname or "").lower().removeprefix("www.")
    return urllib.parse.urlunsplit(("https", host, parts.path.rstrip("/"), "", ""))


def canonical(url):
    """Risolve gli short link vm/vt e normalizza l'URL."""
    if (urllib.parse.urlsplit(url).hostname or "").lower() in SHORT_HOSTS:
        url = fetch(url)[1]
    return strip_url(url)


def oembed(url):
    data = json.loads(fetch(OEMBED + urllib.parse.quote(url, safe=""))[0])
    return {
        "caption": data.get("title"),
        "handle": data.get("author_unique_id"),
        "imageUrl": data.get("thumbnail_url"),
        "author_url": data.get("author_url"),
    }


def main():
    urls = [u.strip() for u in os.environ.get("TIKTOK_URLS", "").splitlines() if u.strip()]
    pausa = float(os.environ.get("TIKTOK_PAUSE") or 1)
    if not urls:
        sys.exit("Nessun URL fornito.")

    with open(STORE, encoding="utf-8") as f:
        store = json.load(f)

    posts = {
        strip_url(a["url"]): a
        for canale in store.get("canali", [])
        for a in canale.get("accounts", [])
        if a.get("url")
    }

    righe = []
    ok = aggiornati = 0

    for i, raw in enumerate(urls):
        if not (urllib.parse.urlsplit(raw).hostname or "").lower().endswith("tiktok.com"):
            righe.append((raw, "❌", "non e' un URL tiktok.com"))
            continue

        try:
            url = canonical(raw)
            dati = oembed(url)
        except Exception as err:  # noqa: BLE001 - un URL rotto non ferma il job
            righe.append((raw, "❌", str(err)))
            continue

        ok += 1
        account = posts.get(url)
        if account is None:
            righe.append((url, "⚠️", f"non presente nello store — caption: {dati['caption']!r}"))
        else:
            riempiti = [
                campo
                for campo in ("caption", "handle", "imageUrl")
                if dati[campo] and not account.get(campo)
            ]
            for campo in riempiti:
                account[campo] = dati[campo]
            if riempiti:
                aggiornati += 1
            righe.append((url, "✅", ", ".join(riempiti) if riempiti else "gia' completo"))

        if i < len(urls) - 1:
            time.sleep(pausa)

    if aggiornati:
        with open(STORE, "w", encoding="utf-8") as f:
            json.dump(store, f, ensure_ascii=False, indent=2)

    print(f"\nRecuperati {ok}/{len(urls)} — post aggiornati nello store: {aggiornati}")
    for url, esito, nota in righe:
        print(f"  {esito} {url} — {nota}")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"## TikTok oEmbed\n\nRecuperati {ok}/{len(urls)} — aggiornati {aggiornati}\n\n")
            f.write("| URL | Esito | Note |\n| --- | --- | --- |\n")
            for url, esito, nota in righe:
                nota = nota.replace("|", "\\|")
                f.write(f"| {url} | {esito} | {nota} |\n")

    if ok == 0:
        sys.exit("Tutti gli URL sono falliti.")


main()
