# Application Drafts and Human Approval (Phase 8)

Phase 7 generates an immutable application package. Phase 8 turns that package
into something a candidate can actually work on, without ever mutating the
generated original and without letting a machine approve the application.

The package is the source. A **draft** is the candidate's editable copy of one
package. Every save is stored as an immutable **revision**, and an **approval**
binds to one exact revision. Nothing here submits an application; that is a
later phase.

## Data model

| Model | Role |
|-------|------|
| `ApplicationDraft` | The working copy of one package for `(userId, jobId)`, plus the current candidate attestation |
| `ApplicationDraftRevision` | One immutable edit: full content JSON + the `contentHash` it hashes to |
| `ApplicationApproval` | A human approval bound to `revisionId` and `contentHash` |
| `ApplicationArtifact` | Which uploaded document (`CvFile`) is attached to the draft |
| `ApplicationAuditLog` | Append-only record of created / edited / attested / cleared / validated / approved / invalidated events |

`ApplicationPackage` is never modified by this module. The draft references a
specific package version (`packageId`), so a later regeneration leaves an
existing draft untouched; the UI surfaces "a newer package exists" as a warning.

## Content hash

```text
sha256(JSON({
  packageId,
  cv,
  coverLetter,
  screeningAnswers: [{ q, a, b }...],
  documents: sorted file ids
}))
```

The hash covers the prose, the screening answers *and* which documents are
attached. If any byte changes — including swapping the attached CV — the hash
changes. A save whose hash equals the latest revision's hash creates no new
revision (the edit was a no-op).

## Candidate attestation

Because a candidate may rewrite generated text, edits are only approvable after
the candidate explicitly confirms them. Confirmation stores `attestedHash` on the
draft.

Saving and confirming are **separate requests by design**:

1. The candidate edits the text or the attached documents and saves.
2. A new immutable revision is created and any previous attestation is cleared.
3. The candidate reviews the saved revision.
4. A second request records the confirmation for that revision
   (`attestedHash = contentHash`).
5. Only then can the revision be approved.

The backend enforces this. A request that changes the prose **or** the attached
documents and also asks to attest is rejected with `400`; it cannot attest the
revision it creates. An attestation-only request creates no revision. A
candidate can also withdraw a confirmation (`attestation: false`), which is
recorded in the audit log. Validation fails while the draft is edited and
`attestedHash !== contentHash`.

The system cannot know whether an edit is truthful; it can only require that a
human took responsibility for one exact revision and record which one that was.

## Pre-approval validation

`draft-validation.ts` is deterministic — no model scores prose. It blocks
approval when any of these fail, and raises warnings for the rest:

| Check | Result |
|-------|--------|
| CV text is empty | error |
| Cover letter is empty | error |
| A screening answer is empty or has no evidence `basis` | error |
| No `CV` document is attached | error |
| Content was edited but not attested for the current revision | error |
| A requirement marked `MISSING` is claimed in the text | error |
| Vacancy is not `ELIGIBLE`, or not `ACTIVE`, or its deadline has passed | error |
| Requirement verdict is `UNKNOWN` | warning |
| Vacancy link (`urlStatus`) is not OK | warning |
| A newer generated package exists | warning |
| No screening answers at all | warning |

The MISSING-claim check matches skill names as whole tokens (so `C++`, `.NET`
and `Node.js` are handled) and skips the generic aggregated `Skill requirements`
placeholder.

## Approval

Approval is an explicit, authenticated human action:

- `POST /api/application-drafts/:id/approve` requires the caller to echo the
  `contentHash` they reviewed. If the content changed since it was displayed,
  the request returns `409` instead of silently approving something else.
- Approval is rejected with `400` while validation has errors.
- Approving an already-approved revision is idempotent.
- Any later edit makes the approval no longer apply: the draft reports
  `approval.invalidated`, the derived status returns to `NEEDS_ATTENTION`, and an
  `APPROVAL_INVALIDATED` entry is written to the audit log.
- A note may be attached to the approval.

The AI never approves. The service only records a decision the authenticated
user made about an exact hash.

## Statuses

Derived, never stored:

| Status | Meaning |
|--------|---------|
| `NEEDS_ATTENTION` | Validation has errors |
| `READY_FOR_APPROVAL` | Validation passes, no approval applies to the latest revision |
| `APPROVED` | The latest revision is approved |

## API

All routes require authentication and are scoped to the caller.

| Route | Purpose |
|-------|---------|
| `POST /api/application-drafts` | Create the draft for a job from a package version (default: latest) |
| `GET /api/application-drafts` | The caller's drafts, newest first |
| `GET /api/application-drafts/:id` | Full view: content, generated original, validation, approval, documents |
| `PATCH /api/application-drafts/:id` | Apply an edit as a new revision (clears any attestation), **or** set/withdraw the attestation for the current revision — never both in one request |
| `POST /api/application-drafts/:id/validate` | Run the checks and record a `VALIDATED` audit entry |
| `POST /api/application-drafts/:id/approve` | Record human approval bound to a content hash |
| `GET /api/application-drafts/:id/audit` | The audit trail for this draft |

There is one draft per `(userId, jobId)`; a second create returns `409`.

## UI

- The **Application package** card on a job page gains *Prepare application draft
  from vN*, which creates the draft and opens it.
- `/application-drafts/[id]` is the editor: editable CV, cover letter and
  screening answers, document selection, the check panel, the attestation
  checkbox and the approve button. It shows whether an approval applies or has
  been invalidated, and exposes the audit trail.
- `/applications` lists drafts with their status.

## What this does not do

- It does not submit, email or upload anything on the candidate's behalf.
- It does not approve automatically, and no autonomous component can approve.
- It does not edit the generated package; the original stays retrievable.
- It does not let one account read, edit, approve or attach documents to
  another account's draft.
