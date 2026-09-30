# What is withheld from this showcase — and why

This repository shows the **real security architecture** of Pocket Familiar (final release `bf66824`):
server routes with verified Firebase ID tokens, input bounds, owner-scoped Firestore access, Security
Rules and their tests, the model fallback ladder, private media handling, deletion-plan logic, data
export, configuration fail-closed checks and secret scanning. The parts that carry the product's
know-how are withheld, so the code is intentionally **not buildable or runnable as a product**.

| Withheld | What it does (what / why — not how) |
|---|---|
| System prompts (`server/prompts/`) | Reflection modes, Midnight's character guard, prompt-injection guard, Diary Page drafting, Memory Seed proposals, Little Memory scene briefs. |
| Response-contract validators | Deterministic checks that make model output fail closed: length, list shape, per-turn question policy, closed JSON schemas, source-id membership. Signatures remain in `server/app.ts`. |
| Familiar engine (`src/lib/familiar-*`, `keeper-readiness`, `growth-client`) | Origin, state and Companion → Keeper growth rules. |
| Memory engine (`memory-seed-flow`, `memory-room`, `memory-views`, `diary-*`, `reflection-*`) | Consent-based seeds, Living Memory projection, diary and reflection flows. |
| Little Memory pipeline (`little-memory-*`) | Scene-brief sanitising, image prompt construction, generation lifecycle, share cards. |
| Interface (`src/App.tsx`, `src/components/`, styles, brand copy) | The complete React UI and all product copy. |
| Artwork (`public/assets/`) | All character art and backgrounds. Two small previews are in `docs/images/` for this README only. |
| Remaining test suites | Contract, flow, UI and integration tests (301 automated tests in the full release). |

**Included:** `server.ts`, `server/app.ts` (routes; prompts and validators withheld), `server/config.ts`,
`server/static-cache.ts`, `firestore.rules` + rules tests, `src/types.ts` (data model),
`src/lib/firebase*.ts`, `firestore-service.ts`, `deletion-plan.ts`, `memory-export.ts`,
`text-metrics.ts`, selected security/config tests, `scripts/secret-scan.sh`, build configuration.
Cloud project identifiers are replaced with placeholders.

Interested in the full implementation (collaboration, licensing, hiring)?
Contact the author via https://github.com/nullinbetween.
