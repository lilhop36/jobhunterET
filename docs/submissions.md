# Submissions (Phase 9)

Phase 8 ends with an application a human has approved. Phase 9 is the only part
of JobPilot allowed to *send* an application, and it is built around one rule:

> JobPilot may submit only the exact application version that an authenticated
> human approved.

Nothing else about the application — a newer package, a re-run of the generator,
or the assistant's own opinion — may be sent. The submission module never
produces application content; it reads the draft's current revision, checks that
the approval covers precisely that revision, and then either prepares a manual
submission or (only through an explicitly registered official transport)
performs an automated one.

## Data model

| Model | Role |
|-------|------|
| `ApplicationSubmission` | One attempt per `(userId, jobId)`. Pins `approvalId`, `revisionId` and `contentHash`, plus the resolved channel, mode, status and receipt |
| `SubmissionEvent` | Append-only audit trail: prepared, manual required, submitted, failed, manually confirmed |

The submission references the approval and revision it was prepared from, so
there is no ambiguity about which bytes were sent.

## Official channels only

`submission-channel.ts` resolves where a vacancy is actually applied to, from
the fields ingestion already recorded. It never guesses and never invents a
destination.

| Input | Channel |
|-------|---------|
| `applyMethod: EMAIL` + `applyEmail` | `EMAIL` |
| `mailto:` link in `applyUrl` | `EMAIL` |
| Official `applyUrl` (falling back to `finalUrl`, then the posting URL) | `WEB` |
| A `t.me` / Telegram link | `TELEGRAM` |
| Nothing usable, or a non-http(s) scheme | `UNKNOWN` |

Only `http:` and `https:` URLs are accepted as web destinations. `javascript:`,
`ftp:` and malformed strings are rejected rather than followed.

## What must be true before submitting

`submission-validation.ts` is deterministic. It blocks submission when any of
these fail:

| Check | Result |
|-------|--------|
| The current revision is not approved | blocker |
| The approval hash does not equal the current content hash | blocker |
| The saved revision was edited but not confirmed (attestation) | blocker |
| The draft's pre-approval validation has errors | blocker (with those errors) |
| No official channel is recorded | blocker |
| A submission for this vacancy is already `SUBMITTED` | blocker |
| No automated transport supports the channel | warning — a manual submission is prepared instead |
| Channel could not be resolved | warning |

## Manual fallback and automated attempts

There is **no automated transport in production**. `SubmissionsModule` provides
the `SUBMISSION_TRANSPORT` token as `null`, so every real submission is recorded
as `AWAITING_MANUAL`: the candidate is handed the official link or email, sends
the application themselves, and confirms it in JobPilot.

The transport interface exists so a later, explicitly sanctioned official
integration (for example an employer's documented API) can be registered
without weakening the binding: it is only ever handed the exact approved
revision, and only for a channel it declares it supports. Tests inject a fake
transport to exercise the automated path.

JobPilot does **not** drive third-party forms, solve CAPTCHAs, or work around
access restrictions.

## Duplicate-submission protection

There is one submission row per `(userId, jobId)` (a unique constraint). A
second attempt to submit an already `SUBMITTED` vacancy is refused with `409`.
Re-preparing the same still-pending manual submission is idempotent and returns
the existing record.

## Flow

1. `GET /api/submissions/draft/:draftId/plan` — explains the channel, whether
   automation is available, and every current blocker. It changes nothing.
2. `POST /api/submissions/draft/:draftId` with `{ contentHash }` — the caller
   echoes the hash it displayed. A mismatch is `409`; an unready draft is `400`.
   An approved revision produces either an `AWAITING_MANUAL` record or, with a
   registered transport, an automated attempt.
3. The candidate sends the application through the official channel.
4. `POST /api/submissions/:id/confirm` with an optional `reference` and `note`
   records the confirmation. The exact approved revision must still be current:
   an edit after preparation returns `409` and the submission must be prepared
   again.

## Receipts and audit

Every state change writes a `SubmissionEvent`. When a submission completes it
also stores a receipt:

- manual: `{ method: "MANUAL", reference, note, at }`
- automated: `{ method: "AUTOMATED", reference, detail, at }`
- failed: `{ method: "AUTOMATED", error, at }`

A failed automated attempt stays available for the manual fallback; the
candidate can still send and confirm it by hand.

## API

All routes require authentication and are scoped to the caller.

| Route | Purpose |
|-------|---------|
| `GET /api/submissions` | The caller's submissions, newest first |
| `GET /api/submissions/draft/:draftId/plan` | Dry run: channel, mode, blockers, warnings |
| `POST /api/submissions/draft/:draftId` | Submit the exact approved revision |
| `GET /api/submissions/:id` | One submission |
| `POST /api/submissions/:id/confirm` | Confirm a manual submission |
| `GET /api/submissions/:id/audit` | The submission audit trail |

## What this does not do

- It does not generate or alter application content; it sends the approved
  revision or nothing.
- It does not approve; approval is a separate authenticated human act.
- It does not bypass CAPTCHAs or access restrictions.
- It does not advance the tracked `Application` stage automatically — the
  candidate stays in control of their own pipeline.
- It does not let one account see, submit or confirm another account's
  application.
