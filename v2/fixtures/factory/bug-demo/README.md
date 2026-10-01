# Demo A — bug cu regresie (fixture Software Factory)

`src/requests.js` validează o solicitare de serviciu (nume, e-mail, serviciu). Defect cunoscut: un nume format doar din
spații este acceptat. Testul independent `test/acceptance.test.mjs` descrie comportamentul corect și eșuează înainte de fix.

- Teste: `node --test`
- Date: fictive. Fără rețea, fără servicii externe.
