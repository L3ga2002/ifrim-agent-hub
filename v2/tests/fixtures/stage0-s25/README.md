# §25 step-0 candidates (2026-10-11, live, rejected by the Codex test review)

Byte-exact copies of the six acceptance-test candidates the Hub assembled (header + author body) for the §25 privacy revision,
rebuilt from the Hub database with `parseAuthorOutput` + `assembleTestFile`; the 12-hex prefix in each name is the sha256 the
reviews recorded (`factory_reviews.change_set_sha`). Stored as `.txt` so `node --test` never collects them.

| File | Mission | Author run | Review run | Verdict |
|---|---|---|---|---|
| c1 | mis_mv2ql0fp_ee35f8071e | run_mv3a33nl_e0cb900fda | run_mv3aa7rz_e56e12ce71 | CHANGES_REQUESTED |
| c2 | mis_mv2ql0fp_ee35f8071e | run_mv3ab9pm_76730c2024 | run_mv3aioqe_79d35d999a | CHANGES_REQUESTED |
| c3 | mis_mv3b251g_754a6a2159 | run_mv3b5ikj_e82d988fa6 | run_mv3bc9le_6c12baf12e | CHANGES_REQUESTED |
| c4 | mis_mv3b251g_754a6a2159 | run_mv3bd8h9_4485154d23 | run_mv3bn58k_b5918f4157 | CHANGES_REQUESTED |

| c5 | mis_mv3wfpyy_d440c4ec5c | — | run_mv3zitzf_987830bb1c | PROVEN; CHANGES_REQUESTED (insufficient literal checks) |
| c6 | mis_mv3wfpyy_d440c4ec5c | — | run_mv3zpvpq_224f49de21 | CHANGES_REQUESTED (lost P77/P100) |
| amend-reference | synthetic amendment of c5 | no provider | deterministic matrix | keeps c5 checks; passes correct app, rejects 16 defective variants |
| r1-a26a0bca8061 (+ manifest) | isolated rehearsal, synthetic app | Claude cycle-1 amendment | independent Codex review | CHANGES_REQUESTED; keeps all c5 checks but completes only part of the findings |
| r1-review0.parsed.json | isolated rehearsal, c5 cycle-0 review | — | Codex, parsed review with checks | P75–P77, P98–P100, P124 classified insufficient |

The coordinator supplied the r1 test, manifest and parsed cycle-0 review byte-exact; these files are immutable rehearsal evidence.
T-AMEND-04 confirms c5 → r1 has `removed = []`. r1 passes the correct app and the defective **escaped value other key** variant;
it fails the original app and the other 15 variants in the `r-amend.test.mjs` matrix (assertion failures).
The decoded `Object.hasOwn(b, "phone")` check catches escaped keys, but does not detect an escaped phone value under another key.
