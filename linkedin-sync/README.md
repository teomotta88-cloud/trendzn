# LinkedIn sync (prototipo)

Replica per i canali LinkedIn dello stesso meccanismo di
`scripts/sync-canali-feed.mjs` (legge/scrive `trends.json` su GitHub), ma
con sessione browser autenticata invece di RSS-Bridge, perché LinkedIn non
ha un bridge pubblico utilizzabile.

## Differenze rispetto allo script Node esistente

- **Va eseguito come servizio a parte** (es. un container su Railway), non
  come job GitHub Actions: serve una sessione browser persistita
  (`session.json`) tra le esecuzioni, su un volume/disco persistente, per
  non dover rifare login (con Playwright headless) ogni volta.
- Copre solo canali con `"platform": "linkedin"` configurati nelle liste
  `canali_inspo` / `influencer_profiles` / `canali_cliente` di
  `trends.json` — il resto (Instagram/TikTok) resta gestito dallo script
  Node via RSS-Bridge.
- Per ora scrappa solo pagine aziendali (`CompanyPostsScraper`), non
  profili personali — da estendere con `PersonScraper` se servono anche
  gli influencer LinkedIn.

## Setup

```bash
pip install -r requirements.txt
playwright install chromium
```

Variabili d'ambiente:

| Var | Note |
| --- | --- |
| `GITHUB_TOKEN` | stesso token usato dallo script Node, serve `contents: write` |
| `LINKEDIN_EMAIL` / `LINKEDIN_PASSWORD` | account LinkedIn dedicato, usate solo se non esiste già `session.json` |
| `SESSION_PATH` | dove persistere la sessione (default `./session.json`) |
| `MAX_POSTS_PER_CHANNEL` | default 15, come lo script Node |

## Esecuzione

```bash
python sync_linkedin.py
```

Pensato per essere lanciato a intervalli (es. cron Railway) mantenendo lo
stesso volume montato per `session.json` tra un'esecuzione e l'altra.

## Da verificare prima di portarlo in produzione

- Stabilità di `CompanyPostsScraper` su layout LinkedIn reali (il
  prototipo non è stato eseguito contro un account vero in questa sessione).
- Rischio di blocco/ban dell'account dedicato: aggiungere delay random tra
  le richieste e variare gli orari di esecuzione invece di un cron fisso.
- Come/dove ospitare il volume persistente per `session.json` su Railway.
