# JobHunter — Requirement → Test Traceability Matrix

> SRS v2.3 | Updated August 2026

Every tested requirement maps to at least one test file and test case.

## Coverage Summary

| Category | Total | Tested | Coverage |
|----------|-------|--------|----------|
| Accounts/Roles/Lifecycle | 10 | 8 | 80% |
| Profile & CV | 5 | 3 | 60% |
| Job Sources & Collection | 8 | 8 | 100% |
| Job Pipeline (Fidelity) | 4 | 4 | 100% |
| Matching Engine | 5 | 5 | 100% |
| Notifications | 5 | 3 | 60% |
| Applications & Saved | 4 | 3 | 75% |
| Searches | 2 | 1 | 50% |
| Background Processing | 7 | 3 | 43% |
| Security | 3 | 3 | 100% |
| **Total** | **53** | **41** | **77%** |

## Accounts, Roles & Lifecycle

| Req | Description | Test File | Tests |
|-----|-------------|-----------|-------|
| FR-001 | Registration + role precedence | auth.service.spec.ts | register creates ADMIN for first user |
| FR-002 | Login | auth.service.spec.ts | login returns JWT, wrong password fails |
| FR-002d | Role-based access | auth.controller.spec.ts | 403 for USER on admin routes |
| FR-002e | Account deactivation/deletion | account.service.spec.ts | deactivate, delete, pseudonymize, token invalidation, dormant reactivation |
| FR-002f | Admin user management | admin.service.spec.ts | role change, self-modify prevention, last-ADMIN safeguard, password reset |
| FR-002g | Auth throttling | auth.controller.spec.ts | rate limits per IP and per email |
| FR-002h | Token revocation | auth.controller.spec.ts + jwt-auth.guard | old token rejected after password change |

## Profile & CV

| Req | Description | Test File | Tests |
|-----|-------------|-----------|-------|
| FR-003 | Profile CRUD | integration.spec.ts | seeded user has complete profile components |
| FR-003a | Completion meter | integration.spec.ts | boundary: 0 for missing, 85% for seeded user, each component verified |
| FR-003e | Recalc on profile update | matching.service.spec.ts | recalculate triggered on core field change |

## Job Sources & Collection

| Req | Description | Test File | Tests |
|-----|-------------|-----------|-------|
| FR-008 | Adapter architecture (11 adapters) | adapters.spec.ts | each adapter parses fixture HTML/JSON, extracts title/company/location/URL |
| FR-013 | Validation | sources.service.spec.ts | invalid source rejected |
| FR-014 | Deduplication | sources.service.spec.ts | duplicate sourceJobId creates 0 new jobs |
| FR-015 | Ghost job detection | sources.service.spec.ts | missedCycles ≥ 3 → REMOVED |
| FR-008t | Telegram channel adapter | telegram-channel.spec.ts | parses HTML, extracts companies/deadlines/apply URLs, skips non-job posts, throws on HTTP error |

## Job Pipeline (Fidelity)

| Req | Description | Test File | Tests |
|-----|-------------|-----------|-------|
| FR-012d | Description cleaning | job-fidelity.spec.ts | HTML entity decoding, mojibake fix, boilerplate stripping |
| FR-012e | Quality score | job-fidelity.spec.ts | empty → 0, full description → high score |
| FR-012f | URL normalization | job-fidelity.spec.ts | trailing slash, UTM params, fragment removal |
| FR-012g | Apply-method extraction | job-fidelity.spec.ts | EMAIL, IN_PERSON, ONLINE_URL detection |
| FR-012h | Normalization | job-fidelity.spec.ts | salary parsing, company name, deadline extraction, fingerprinting |

## Matching Engine

| Req | Description | Test File | Tests |
|-----|-------------|-----------|-------|
| FR-018 | Per-user matching | matching-engine.spec.ts | user gets personalized scores |
| FR-019 | Score 0-100 | matching-engine.spec.ts | exact match → 100, no match → 0 |
| FR-019b | Freshness decay | matching-engine.spec.ts | older jobs score lower |
| FR-019c | Deterministic factors | matching-engine.spec.ts | role, skills, experience, location, employment, salary weights |
| FR-020 | Negative criteria | matching-engine.spec.ts | excludeOnsite penalty |

## Notifications

| Req | Description | Test File | Tests |
|-----|-------------|-----------|-------|
| FR-024 | Notification conditions | notifications.service.spec.ts | creates notification for above-threshold match |
| FR-024b | Rate limiting | telegram.service.spec.ts | per-chat interval, global rate |
| FR-025 | Telegram alert format | telegram.service.spec.ts | summary line, [Save][Reject][Apply][Open] buttons |

## Applications & Saved

| Req | Description | Test File | Tests |
|-----|-------------|-----------|-------|
| FR-029/030 | Save/reject jobs | integration.spec.ts | SAVED stage allows APPLIED/REJECTED transitions |
| FR-031 | Application tracking | applications.service.spec.ts | stage transitions recorded |
| FR-031a | Transition graph | integration.spec.ts | table-driven: all 8 stages × legal/illegal moves, terminal states verified |

## Searches

| Req | Description | Test File | Tests |
|-----|-------------|-----------|-------|
| FR-033 | Saved search profiles | integration.spec.ts | create and delete a search profile |

## Security

| Req | Description | Test File | Tests |
|-----|-------------|-----------|-------|
| SEC-001 | Helmet headers | security.spec.ts | middleware factory importable |
| SEC-003 | Magic-byte upload | security.spec.ts | table: PDF ✓, DOCX ✓, EXE ✗, PNG ✗, HTML ✗, empty ✗, short ✗ |
| SEC-004 | Filename sanitization | security.spec.ts | table: clean pass-through, CRLF, semicolons, path traversal, truncation |

## Untested Requirements

| Req | Description | Priority |
|-----|-------------|----------|
| FR-001a | User status model (ACTIVE/DORMANT/DISABLED/DELETED) | Medium |
| FR-024c | Web Inbox fallback routing | Medium |
| FR-028 | Daily digest generation | Low |
| FR-034d | Dormancy sweeper (query tested, update not) | Low |
| FR-035 | Collection scheduling | Low |
| FR-036 | Retry/backoff | Low |

## Test File Index

| File | Tests | Covers |
|------|-------|--------|
| auth.service.spec.ts | ~15 | FR-001, FR-002 |
| auth.controller.spec.ts | ~8 | FR-002d, FR-002g |
| account.service.spec.ts | 7 | FR-002e |
| admin.service.spec.ts | 8 | FR-002f |
| applications.service.spec.ts | ~10 | FR-031, FR-031a |
| matching-engine.spec.ts | ~22 | FR-018, FR-019, FR-019b, FR-019c, FR-020 |
| sources.service.spec.ts | ~8 | FR-013, FR-014, FR-015 |
| adapters.spec.ts | 41 | FR-008 (11 adapters) |
| telegram-channel.spec.ts | 10 | FR-008t |
| telegram.service.spec.ts | ~10 | FR-024b, FR-025 |
| notifications.service.spec.ts | ~6 | FR-024, FR-027 |
| job-fidelity.spec.ts | 28 | FR-012d, FR-012e, FR-012f, FR-012g, FR-012h |
| integration.spec.ts | 21 | FR-003a, FR-029/030, FR-031a, FR-033, FR-034d, data integrity |
| security.spec.ts | 12 | SEC-001, SEC-003, SEC-004 |
| rate-limiter.spec.ts | 5 | SEC-005 |
| exclusive.spec.ts | — | Utility |
| keyset.spec.ts | — | Utility |
| parse-port.spec.ts | — | Utility |
| **Total** | **~227** | **41/53 requirements (77%)** |
