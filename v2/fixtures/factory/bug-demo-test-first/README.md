# Demo A — bug fără test de acceptanță (fixture Software Factory, test scris de Hub)

`src/requests.js` validează o solicitare de serviciu (nume, e-mail, serviciu). Defect cunoscut: un nume format doar din
spații este acceptat. Proiectul nu are încă un test care să descrie comportamentul corect; are doar testele unitare din
`test/unit.test.mjs`, care trec.

- Teste: `node --test`
- Date: fictive. Fără rețea, fără servicii externe.
