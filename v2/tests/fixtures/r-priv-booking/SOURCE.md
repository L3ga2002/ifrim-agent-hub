# r-priv-booking (test fixture, synthetic data)

A copy of the application files of the local hub-test project „Demo Livrare — Detailing (programări)” (`prj_muz7pfsl_fa3678479c`,
marker `.ifrim-hub-test.json`: fixture `booking-demo`, data `synthetic`) as the §25 delivery `dlv_mv1eo8oo_d120460140` verified it
(mission `mis_mv1eo6il_104584123d`: the phone is required and saved). Copied on 2026-10-10 for the R-PRIV tests
(`v2/tests/r-priv-rev.test.mjs`); `src/server-app.js` sha256 `5cd662956742cca906efa5581330052e745d3bc810722e6671d47d2964628f64`.

Only `src/` and `public/` (no tests, no data). The tests copy this folder to a temporary directory and apply small variants there; this
folder and the real project are never modified. It is NOT the versioned fixture `v2/fixtures/factory/booking-demo` (that one has no phone).
