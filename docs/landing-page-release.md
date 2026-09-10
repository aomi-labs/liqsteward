# Steward landing page

## Current NAV deployment verification — 2026-09-10 20:57 CST

Supersedes the historical publication status below. Website/API code through
`3ee6e8b` is deployed at https://liqsteward-aomi-labs.vercel.app, deployment
`dpl_BJGPmgpFrZNYt5DwrBpomM7DzANE`. The public website uses Aomi **staging**:
discovery `api-staging.aomi.dev`, guest identity and Agent API
`chat-staging.aomi.dev`. Backend source verified at `e3f1953e35305ed5614e71c50e42f7f86a89628f`.
The NAV app resolves to application `2937809`, active with an available artifact.

Vercel includes the verified PostgreSQL TLS change, database connection, NAV
service token, and Ethereum RPC configuration. The NAV store is the separate
Steward Supabase project `ztcfpwonpiaqbhnfpznc`; platform auth/runtime uses staging
`cmwkmjpfbffmdiluvgtu`. No wallet, signing provider, transaction, or budget change
was used for this smoke. Browser: existing task in-app tab; identity: anonymous,
origin-bound widget bearer; GitHub identity not applicable to the smoke.

The old widget's `/api/thread/chat` route no longer exists on staging. Updated
packages are widget-lib 2.0.15, react 0.6.9, and client 0.6.11. A narrow server
relay handles the portal Agent route's missing CORS headers while preserving
visitor authentication, enforcing same-origin requests and the NAV app target,
and excluding action submission/signing routes. NAV management writes require
service authentication; their browser controls are read-only pending manager auth.

| Story | Observed evidence | Verdict |
| --- | --- | --- |
| Deployment/build | Vercel Ready; 30 core/API tests, seven landing/navigation checks and TypeScript/build pass | PASS |
| Guest identity and Agent transport | Browser guest issuance, turn admission and polling all succeed | PASS |
| Live NAV traversal/compile/export | Runtime returns `execution_budget_exhausted`; no DAG created | BLOCKED |
| Wallet/signing stories | Not requested; no wallet connected or transaction attempted | NOT RUN |

| Endpoint | Expected / observed | Verdict |
| --- | --- | --- |
| POST portal `/api/auth/widget/guest` | 200 / 200 | PASS |
| POST Steward `/api/aomi/nav-oracle/v1/agent/chat` with guest bearer | 200 / 200 | PASS |
| GET same relay `/chat/:id` | 200 / 200 | PASS |
| POST same relay without bearer | 401 / 401 | PASS |
| POST `/api/nav/policies` without service auth | 401 / 401 | PASS |
| GET `/api/nav/dags?vault=...` | 200 / 200, empty list | Storage read PASS; valuation not proved |

| Layer | Remaining blocker |
| --- | --- |
| Inference funding | Live api-server has `AOMI_GUEST_CREDITS=25` ($0.25); NAV run hits the guest exposure fence. Use authenticated account access or an explicitly approved demo funding arrangement. Do not increase global guest limits implicitly. |
| Agent-to-NAV service integration | Token match, live traversal, compilation and report export cannot be verified until inference proceeds. |
| Customer readiness | Manager login/authorization remains unfinished; rotate the token previously pasted into chat before customer use. |

Test session: `8a9cc554-a6d6-4452-a80e-eeec949b5f9b`.
No secret values are recorded here. The other agent's local Rust lockfile
change was not included in these website commits.

## Historical NAV navigation integration — previously pending publication

The shared checkout now uses URL-backed navigation: `/` is the landing,
`/app/nav-oracle` is NAV, and `/app/replay` is the incident replay.
The header is now an `Open App` link, and the NAV product panel has an
`Open NAV Oracle` link. App Overview links back to `/`. The old `?demo=1`
entry resolves to NAV. This supersedes the shared onOpenConsole callback
described for the earlier landing release below. Vercel rewrites cover direct
loads of the app paths without changing the API rewrite.

The seven fixture/navigation tests and combined frontend production build pass.
The local direct NAV route returns HTTP 200. The local runtime configuration
reports `deployed: false`, `artifactReady: false`, and `applicationId: null`.
Production Vercel environment-name inspection found only AOMI_BACKEND_URL;
DATABASE_URL and LIQSTEWARD_SERVICE_TOKEN are absent. No secrets were copied,
database configured, migrations run, or agent deployed by this navigation task.
Publication is held until NAV infrastructure is ready or the user explicitly
chooses to publish an unavailable workspace. Changes are only in the shared
checkout; the previously published isolated landing release is unchanged.

## Published release

Published 2026-09-10 to https://liqsteward-aomi-labs.vercel.app/.
Vercel deployment `dpl_AQFu1E8yrJCvPydEhCnT9ZRSZjN8` is READY; the requested
alias resolves to that deployment. Source commit: `37c0cf5`.
The separate existing application is available at `/?demo=1`.
Other custom-domain aliases were not promoted by this release.
Direct HTTP checks from this environment failed with connection resets, so
post-publication rendering and interactions remain unverified.

## Scope

The landing page is `apps/web/src/Landing.tsx` plus `apps/web/src/steward/`.
It is independent of NAV Oracle implementation, API services, and the PRD.
Its CSS is scoped to `.steward`; parent application chrome is hidden only while
this landing component is present. The supplied `onOpenConsole` callback is
preserved for the application footer link.

## Product contract

Section order: hero, product previews, ecosystem, authority/evidence, worked
example, Aomi Labs, contact invitation. Warm editorial tokens, official Aomi mark,
three conceptual SVG diagrams. Product tabs and map controls are keyboard
accessible. Native dialog supplies modal focus containment and Escape behavior.
Reduced motion is respected. Mobile uses route cards rather than a squeezed SVG.

All product-preview data is synthetic. No live queries, wallet access, signatures,
fork execution, or executable transaction payloads are implied. The evidence
panel explains the dataset and assumptions. The downloadable JSON is an example
approval record, explicitly `executable: false`, with no transactions.

The contact form opens a draft to `contact@aomi.dev`, verified against Aomi's
public contact page on 2026-09-10. It does not collect, store, or transmit the form
on a server and does not claim successful delivery. A backend form integration
is intentionally outside this landing-only release.

The ecosystem carries the existing research's named relationships and source
links; it does not represent a current integration matrix or customer roster.
Supported operating alternatives are identified separately.

## Release isolation

Worktree: `/Users/cecilia/Code/risk-off-pilot-landing`, branch `codex/steward-landing`.
Base: `a7cafc49bc70e388d4a24cdeefdf2ab8d0addf0d`.
Existing live deployment used as baseline:
`dpl_8Uu49NjUwf3uM5VgLmAe9TqVvU5n`.

The API source, core source, root package manifest, lockfile, and Vercel config
were compared by file SHA-1 to the live deployment source and matched. The
existing live stylesheet was recovered into this isolated worktree to retain the
control room's deployed theme. ControlRoom.tsx already matched the live source.
No unfinished NAV work from the shared checkout is part of this release.

In this isolated release only, `main.tsx` renders the marketing page by default
and lazy-loads the existing application at `/?demo=1`. That entrypoint must NOT
replace the shared checkout's newer NAV routing. Only Landing.tsx and steward/
are copied back for Claude's integration, alongside the fixture test and this
handoff. In the shared app, the existing onOpenConsole callback owns navigation.

## Validation

- `npm run build:web`: production TypeScript + Vite build.
- `tsx --test apps/web/steward.test.ts`: fixture totals, scenario arithmetic,
  mandate decisions, source-link structure, graph convergence.
- Vite SSR render: every section renders, no NaN/undefined ribbon geometry.
- Browser interactions and mobile rendering were not automatically tested.

The landing's initial JavaScript is approximately 237 KB uncompressed / 74 KB
gzip; the existing chat application loads only when the demo is opened.
