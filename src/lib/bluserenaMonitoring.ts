// Store dei canali di "Bluserena-monitoring" — duplicato di ASPI-monitoring con
// stessa logica ma dati INDIPENDENTI (file separato src/data/bluserena-monitoring.json,
// sezione "bluserena-monitoring" in trend_submissions, workflow di sync dedicato).
// Parte vuota: i canali si caricano manualmente. Riusa i tipi di Canali Inspo.
import data from "@/data/bluserena-monitoring.json";
import type { CanaleInspo } from "@/lib/trends";

// Bundlato a build-time (come canaliInspo in trends.ts): la pagina di dettaglio
// legge da qui, quindi i post appaiono dopo che il sync ha committato il JSON e
// l'app è stata ricostruita. La index invece rilegge il JSON a runtime da GitHub.
export const bluserenaCanali = data.canali as CanaleInspo[];
