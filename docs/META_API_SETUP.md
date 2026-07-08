# Setup Instagram Graph API (Fase 1: canali cliente)

Collega gli account Instagram Business/Creator dei clienti (Piano Editoriale
→ "Canali cliente") via Facebook Login for Business, sostituendo per quei
canali lo scraping RSS-Bridge e il matching per similarità del copy con post
e insight reali letti dalla Graph API.

## 1. Configurazione nella Meta App (developers.facebook.com)

Nell'app già creata:

1. Aggiungi il prodotto **Facebook Login for Business** (se non già presente).
2. In **Impostazioni → Base**, prendi nota di **App ID** e **App Secret**.
3. In **Facebook Login → Impostazioni**, aggiungi come **URI di reindirizzamento OAuth validi**:
   `https://trendzn.lovable.app/api/meta/oauth-callback`
4. L'app parte in **modalità Sviluppo**: in questa modalità il login funziona solo per gli utenti aggiunti come **Amministratore/Sviluppatore/Tester** dell'app (Ruoli app), su Pagine/account Instagram di cui sono admin. Per i primi test basta aggiungere te stesso o un account del cliente come tester.
5. Per usare il flusso con account cliente reali non aggiunti come tester serve passare in **modalità Live**, il che richiede **Verifica del business** e, per i permessi usati qui (`instagram_manage_insights`), **App Review** (spiega a Meta il caso d'uso: agenzia che legge post/insight degli account Instagram Business dei propri clienti, con loro autorizzazione esplicita via login).
6. Requisito lato cliente: l'account Instagram deve essere **Business o Creator** e collegato a una **Pagina Facebook** di cui il cliente (o l'agenzia con permessi delegati) è amministratore.

## 2. Variabili d'ambiente da impostare su Lovable (mai nel repo)

Env var server-only (non prefissate `VITE_`) da aggiungere nel pannello Lovable del progetto:

| Nome | Valore |
|---|---|
| `META_APP_ID` | App ID dalla Meta App |
| `META_APP_SECRET` | App Secret dalla Meta App |
| `META_OAUTH_REDIRECT_URI` | `https://trendzn.lovable.app/api/meta/oauth-callback` |
| `META_SYNC_SECRET` | Un segreto generato a caso (es. `openssl rand -hex 32`), usato per autenticare le chiamate da GitHub Actions a `/api/meta/sync-posts` e `/api/meta/refresh-tokens` |
| `META_GRAPH_API_VERSION` | Opzionale, default `v21.0` |

Lo stesso valore di `META_SYNC_SECRET` va aggiunto anche come **GitHub Actions secret** del repo (`Settings → Secrets and variables → Actions`), perché i due workflow schedulati (`sync-meta-posts.yml`, `refresh-meta-tokens.yml`) lo leggono da lì per chiamare gli endpoint.

## 3. Flusso end-to-end

1. Nel Piano Editoriale, sezione "Canali cliente", il pulsante **"Connetti account Instagram/Facebook del cliente"** porta l'utente sul login Facebook (`/api/meta/oauth-start`).
2. Dopo il consenso, `/api/meta/oauth-callback` scambia il code per un token long-lived (~60gg), trova la/e Pagina/e con Instagram Business collegato, crea (se non esiste) il canale cliente e salva la connessione in `meta_connections`.
3. Il workflow **Sync Meta Posts** (ogni 3 ore) chiama `/api/meta/sync-posts`: per ogni connessione attiva legge i post reali e gli insight (impression, reach, like, commenti) e li salva in `editorial_published_posts` con `source = 'meta_api'`, mantenendo il matching col piano editoriale.
4. Il workflow **Refresh Meta Tokens** (giornaliero) chiama `/api/meta/refresh-tokens`: rinnova i token in scadenza entro 7 giorni. Se il refresh fallisce (es. il cliente ha revocato l'accesso), la connessione passa a `needs_reauth` e va ricollegata dal cliente.

## 4. Limiti noti (Fase 1)

- Solo Instagram Business/Creator collegati a una Pagina Facebook — profili personali non sono supportati dalla Graph API.
- Nessuna pubblicazione automatica (Content Publishing API): è la Fase 3, richiede il permesso `instagram_content_publish` (Advanced Access, App Review separato).
- I canali "Canali Inspo" (profili di ispirazione/competitor non del cliente) restano fuori da questa fase: per quelli l'unica via ufficiale è la **Business Discovery API**, che funziona solo su altri account Business/Creator e non richiede il loro consenso, ma è un caso d'uso a parte da questa migrazione.
