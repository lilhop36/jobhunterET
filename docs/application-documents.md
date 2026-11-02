# Application Documents (Phase 7)

Abdi JobPilot ET turns a verified profile and one vacancy into an application
package: a tailored CV, a vacancy-specific cover letter, screening answers, a
requirement-to-evidence map and a list of warnings.

The generator is **deterministic**. There is no language model anywhere in the
path, so a package can only contain facts the candidate entered in their own
profile.

## Hard rule: nothing is invented

Every sentence in a generated package comes from one of three sources:

1. A verified profile section (personal details, summary, skills, education,
   experience, projects, certifications, languages, documents).
2. A computed fact, such as experience years derived from dated roles.
3. An explicit "not provided" statement or warning.

Consequences, all covered by tests:

- A skill the profile cannot prove is left out of the CV and cover letter.
- A posting requirement with no evidence becomes `MISSING` or `UNKNOWN`, never
  a claim of experience.
- An empty section is omitted from the CV and reported as a warning; the
  generator does not write placeholder employment or education history.
- Screening answers carry a `basis` field naming the verified source or the
  reason the answer is unavailable.

## Inputs

| Input | Source |
|-------|--------|
| Candidate data | `ProfileService.getProfile(userId)` — the authenticated user's own rows only |
| Vacancy | `Job` + its `JobSkill` rows |
| Requirement verdicts | The latest `JobMatch` for `(userId, jobId)`, produced by the Phase 6 matcher |

The service never accepts a user id from the request body, so one account cannot
generate documents from another account's profile.

## Outputs

| Field | Description |
|-------|-------------|
| `cv` | Markdown CV containing only sections that exist on the profile |
| `coverLetter` | Letter that cites verified skills with their evidence source |
| `screeningAnswers[]` | Question, answer and the verified `basis` for it |
| `requirementMapping[]` | Requirement verdicts: `MET`, `PARTIAL`, `MISSING` or `UNKNOWN`, with evidence |
| `warnings[]` | Missing personal details, empty sections, missing requirements, unknown requirements, expired deadlines |
| `generatorVersion` | `v1.0-deterministic` |

## Versioning and history

Each generation stores a new `ApplicationPackage` row keyed by
`(userId, jobId, version)`. Regenerating appends version 2, 3, … and never
overwrites an earlier package, so the candidate can see exactly what was
generated when and compare versions. The package body is stored as JSON text on
every database provider.

## API

All routes require authentication and are scoped to the caller.

| Route | Purpose |
|-------|---------|
| `POST /api/applications/:jobId/package` | Generate and persist the next version |
| `GET /api/applications/:jobId/packages` | Version history, newest first |
| `GET /api/applications/:jobId/packages/:version` | One stored version in full |

`version` must be a positive integer; other values return `400`.

## UI

The job detail page includes an **Application package** card. It shows the
latest version, the full CV and cover letter, screening answers with their
basis, the requirement-to-evidence map and every warning. Version chips switch
between stored generations, and "Generate new version" appends to the history.

## What this does not do

- It does not submit applications, email employers or upload documents.
- It does not fabricate achievements to improve a match.
- It does not run when the profile is missing; `GET /profile` behaviour applies
  (`404 Profile not found`).