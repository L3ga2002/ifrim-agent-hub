# Demo B — „Solicitare serviciu” (fixture Software Factory)

Mini-proiect de test: formular, endpoint local `POST/GET /api/requests`, validare, persistare într-o bază node:sqlite de
TEST (`data/`), deduplicare și listă. Scheletul servește pagina; API-ul răspunde 501 până la implementare.

- Teste: `node --test` (integrare reală: server local pe port liber + bază de test)
- Preview: `node server.js` → http://127.0.0.1:4610/ (portul din `config.json`)
- Fără e-mail, SMS, autentificări reale sau servicii cloud. Date fictive.
