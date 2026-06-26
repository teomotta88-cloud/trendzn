"""Primo login manuale per creare session.json.

Da eseguire UNA SOLA VOLTA (o ogni volta che la sessione salvata scade/viene
invalidata) per superare eventuali CAPTCHA/verifiche email-SMS che LinkedIn
chiede quasi sempre al primo accesso di un account nuovo da un dispositivo/IP
mai visto prima - cosa che un login headless automatico non può gestire.

Apre un browser visibile (headless=False): fai login a mano nella finestra
(inclusa eventuale verifica), poi premi Invio nel terminale. La sessione
viene salvata in SESSION_PATH e da quel momento sync_linkedin.py la riusa
senza richiedere altri login.

Variabili d'ambiente:
  SESSION_PATH   percorso dove salvare la sessione (default: ./session.json)

Uso:
  python first_login.py
"""

import asyncio
import os

from linkedin_scraper import BrowserManager, is_logged_in

SESSION_PATH = os.getenv("SESSION_PATH", "session.json")


async def main() -> None:
    async with BrowserManager(headless=False) as browser:
        await browser.page.goto("https://www.linkedin.com/login")

        print("Completa il login (e l'eventuale verifica) nella finestra del browser.")
        input("Premi Invio qui quando hai finito... ")

        if not await is_logged_in(browser.page):
            print("Login non rilevato: controlla la finestra del browser e riprova.")
            return

        await browser.save_session(SESSION_PATH)
        print(f"Sessione salvata in {SESSION_PATH}. Ora puoi lanciare sync_linkedin.py.")


if __name__ == "__main__":
    asyncio.run(main())
