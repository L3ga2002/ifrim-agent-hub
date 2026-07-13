# Open Issues - Ifrim Agent Hub

## P0

- None recorded yet.

## P1

- None recorded.

## P2/P3

- Monitor GPT-5.6 OAuth availability; Terra, Sol and Luna all passed fresh no-fallback probes on 2026-07-12.
- Resolve the non-blocking shared SQLite plugin metadata warning for `codex` only after a fresh backup and dedicated migration test.
- Investigate the 2026-07-13 manual Hub backup request that exceeded 120 seconds and left an incomplete archive; the immediate manual fallback archive succeeded. Existing workflow backups remain valid.
- Optional: add an approval-gated Claude bridge only when subscription/cost/fallback state is visible and testable.
- Optional: add scheduled read-only loops only when Catalin explicitly wants them; do not enable recurring model calls by default.
- Add design inspiration notes field for UI tasks, with source URL/category and no-copy rule.
