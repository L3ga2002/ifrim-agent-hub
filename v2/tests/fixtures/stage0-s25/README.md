# §25 step-0 candidates (2026-10-11, live, rejected by the Codex test review)

Byte-exact copies of the four acceptance-test candidates the Hub assembled (header + author body) for the §25 privacy revision,
rebuilt from the Hub database with `parseAuthorOutput` + `assembleTestFile`; the 12-hex prefix in each name is the sha256 the
reviews recorded (`factory_reviews.change_set_sha`). Stored as `.txt` so `node --test` never collects them.

| File | Mission | Author run | Review run | Verdict |
|---|---|---|---|---|
| c1 | mis_mv2ql0fp_ee35f8071e | run_mv3a33nl_e0cb900fda | run_mv3aa7rz_e56e12ce71 | CHANGES_REQUESTED |
| c2 | mis_mv2ql0fp_ee35f8071e | run_mv3ab9pm_76730c2024 | run_mv3aioqe_79d35d999a | CHANGES_REQUESTED |
| c3 | mis_mv3b251g_754a6a2159 | run_mv3b5ikj_e82d988fa6 | run_mv3bc9le_6c12baf12e | CHANGES_REQUESTED |
| c4 | mis_mv3b251g_754a6a2159 | run_mv3bd8h9_4485154d23 | run_mv3bn58k_b5918f4157 | CHANGES_REQUESTED |
