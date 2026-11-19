# Technical assessment and delivery roadmap

Last updated: 2026-11-19

Status: Core persistence, dashboard security controls, management workflows,
analytics, and operational foundations have been added incrementally. The
project is **not yet release-complete**: command/dashboard modularization,
broader authorization and interaction tests, and production deployment review
remain.

## Initial assessment

The original application concentrated startup, event handling, and command
dispatch in `src/index.ts`; OAuth, sessions, authorization, and dashboard API
routes in `src/dashboard.ts`; and dashboard UI behavior in `public/app.js`.
Persistent settings, leveling, presence, and audit history used JSON/JSONL.
Long-running Discord handlers could exceed the interaction acknowledgment
deadline. Express's default session store was in-memory. The repository had no
automated test, lint, formatting, or CI checks, and README referred to a
misnamed environment template.

Existing security protections included OAuth `state` validation, session
regeneration, CSRF/origin checks for mutations, per-request guild
authorization, restrictive response headers, secure cookie options, and
loopback-only dashboard binding. These protections are retained.

## Current implementation and phase status

| Phase                                      | Priority | Status                                                                                                                       |
| ------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Interaction handling and critical fixes | Critical | Implemented for selected administrative/slow commands; interaction-response tests remain.                                    |
| 2. SQLite and persistent sessions          | High     | Implemented with versioned migrations and a validated, non-destructive JSON/JSONL importer.                                  |
| 3. Architecture and code quality           | High     | In progress; database and service logic are split out, but command dispatch and dashboard routes remain large modules.       |
| 4. Testing and CI/CD                       | High     | In progress; test/lint/format/build scripts and CI exist, but coverage is still narrow.                                      |
| 5. Ticket and moderation improvements      | Medium   | Core ticket workflows and warning/history records are implemented; end-to-end Discord failure paths need more tests.         |
| 6. Analytics and permission management     | Medium   | Basic analytics and per-feature dashboard role assignments are implemented; broader analytics and permission tests remain.   |
| 7. Monitoring and release readiness        | Medium   | Health endpoint, structured logs, and signal shutdown exist; deployment and external monitoring are not production-reviewed. |

### Persistence and migration

- SQLite is the active store for guild settings, member XP, tickets and ticket
  staff activity, moderation records/warnings, command audit history,
  dashboard sessions, daily activity/command usage, feature-role assignments,
  and bot presence.
- Migrations are versioned and run during startup. The legacy importer validates
  and imports existing JSON/JSONL files transactionally, records content hashes
  to avoid duplicate imports, and preserves source files.
- The default SQLite file is `data/bot.sqlite` (or `BOT_DATA_DIR/bot.sqlite`).
  Keep the full data directory private. Back up with the bot stopped or use
  SQLite's online backup API; do not copy only the main file during live WAL
  writes.
- A local migration test verifies import, service updates, session storage,
  ticket/moderation operations, analytics, role assignments, restart
  persistence, and retention of a legacy source file. Production data recovery
  and backup/restore procedures still need operational validation.

### Dashboard and authorization

- Dashboard sessions are stored in SQLite and expire with their configured
  lifetime. The dashboard adds bounded in-memory IP rate limits and `no-store`
  cache controls for API responses.
- OAuth state, CSRF/origin checks, guild membership checks, Discord permission
  checks, role hierarchy checks, and loopback binding remain in effect.
- Manage Server users retain access and can configure up to ten staff roles per
  dashboard feature. Feature roles grant access only to their configured
  dashboard areas; action-specific Discord permissions remain required.
- The dashboard is still not intended for public exposure. A reverse proxy,
  public TLS setup, network controls, persistent rate-limit storage, and
  deployment-specific session configuration require a separate security
  review.

### Feature scope

- Tickets have atomic open-ticket reservations, claim/assignment/priority,
  close/reopen records, staff activity, and private-channel transcript support.
- Moderation includes warnings and searchable action history. Existing
  Discord-side permission and hierarchy checks remain authoritative.
- Analytics stores message counts, member-count snapshots, and command usage
  metadata, not message content. It does not yet provide every comparison or
  trend requested in the product brief.
- Health reports process uptime, gateway ping, heap usage, and SQLite
  availability. Structured JSON logs include command execution duration and
  failure event names. External alerting, API error aggregation, and resource
  thresholds are not configured.

## Validation

Validated in this workspace:

- `npm run build` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed.
- `npm test` — passed under Node 20.11.1; the test suite currently contains
  one SQLite-backed integration test.

The repository's ambient Node 26 runtime is not compatible with the installed
`better-sqlite3` 12.4.1 binding. The package targets Node 20.11 or newer; use a
supported Node runtime when running the SQLite tests. A Node 26 native rebuild
was attempted and failed in the dependency's V8 bindings, so no Node 26
compatibility is claimed.

## Remaining work before release

1. Move command handlers, dashboard routes, and lifecycle logic into focused
   modules without changing existing behavior.
2. Expand tests for interaction acknowledgment/error responses, OAuth and CSRF,
   authorization and feature-role boundaries, migration failure recovery,
   duplicate ticket races, and dashboard action permissions.
3. Validate backups and restore on a representative deployment; document
   operational ownership and retention for audit/session data.
4. Run CI on the minimum supported Node version and a current LTS version, then
   review production hosting, secret rotation, HTTPS/proxy boundaries, and
   monitoring before public deployment.

## Changelog

- 2026-11-19: Added the SQLite persistence and legacy import foundation,
  persistent dashboard sessions, ticket/moderation workflows, analytics,
  feature-role assignments, structured operational logs, graceful signal
  shutdown, tests, lint/format checks, and CI. Updated setup and storage
  documentation. Verification exposed and fixed a dashboard UI syntax error,
  TypeScript role-map typing issues, and Node 20 test discovery compatibility.
