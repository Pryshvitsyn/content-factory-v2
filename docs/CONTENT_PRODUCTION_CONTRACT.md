# Content Factory V2.1 — Autonomous Content Production Contract

## 1. Purpose

Content Factory turns a human creative idea into production-ready, validated, human-approved, publishable content.

The factory is autonomous in **execution**, but not autonomous in **creative authority**.

## 2. Non-Negotiable Production Principle

```text
IDEA
  -> THINK / PLAN
  -> CREATE
  -> ASSEMBLE
  -> RENDER
  -> OBJECTIVE QA
      PASS -> HUMAN REVIEW -> APPROVE -> PUBLISH
      FAIL -> TARGETED REPAIR -> RENDER AFFECTED OUTPUT -> QA AGAIN
```

A successful creative result is never regenerated merely because an automated critic believes another version might be better.

## 3. Human Authority

Human approval is the authority for subjective creative quality.

The factory MUST NOT autonomously regenerate an otherwise compliant production because of subjective judgments such as:

- taste
- preference
- perceived beauty
- alternative hooks
- alternative music
- stylistic preference
- speculative retention improvement

A human revision request explicitly authorizes a new creative revision.

## 4. Objective Failure Authority

The factory MAY initiate automatic repair only when a deterministic or explicitly configured rule fails.

Examples:

### Technical integrity
- corrupt or unreadable media
- invalid codec/container
- invalid resolution or aspect ratio
- invalid frame rate
- missing audio where required
- invalid loudness/clipping constraints
- black/corrupt frames
- missing required assets
- failed render integrity

### Production integrity
- script/voice mismatch
- missing required scene/shot
- timeline/spec mismatch
- continuity violation
- duplicate output where uniqueness is required
- impossible or visibly malformed generated content, when an explicit detector/rule exists
- character/location state mismatch

### Brand/project constraints
- prohibited content
- required element missing
- required CTA missing
- forbidden logo treatment
- duration outside configured bounds
- other explicit project constraints

Subjective quality scores alone MUST NOT trigger automatic repair.

## 5. Repair Scope

Automatic repair MUST be targeted.

The system MUST identify the smallest affected artifact set and regenerate only the affected nodes plus their invalidated downstream derivatives.

Example:

```text
Shot 17 visual FAIL
        |
        +--> regenerate Shot 17
        |
        +--> rebuild affected timeline
        |
        +--> rerender Master
        |
        +--> regenerate affected delivery packages
```

Unaffected script, voice, music, shots and assets MUST remain immutable.

## 6. Immutable Production Truth

Once an artifact version is accepted by objective QA, it is immutable.

The factory MUST NOT silently mutate an accepted artifact.

New work creates a new revision/version with explicit lineage.

## 7. Production Layers

### Creative layer

Responsible for:

- interpreting the idea
- research when required
- creative strategy
- concept development
- script
- visual direction
- audio direction
- edit intent

### Execution layer

Responsible for:

- deterministic stage execution
- provider invocation
- retries
- idempotency
- artifact persistence
- dependency tracking
- rendering

### Quality layer

Responsible for:

- deterministic validation
- constraint validation
- media integrity
- continuity checks
- platform compliance
- repair planning

### Human approval layer

Responsible for:

- subjective creative approval
- requested revisions
- final release authorization

### Delivery layer

Responsible for:

- platform transformation
- package validation
- publication
- publication status

## 8. Canonical Master

The canonical Master is the approved production truth from which platform deliveries are derived.

Platform packages MUST NOT become independent creative masters.

```text
CONTENT UNIT
    |
    +-- SOURCE ARTIFACTS
    |
    +-- COMPOSITION
    |
    +-- CANONICAL MASTER
             |
             +-- TikTok package
             +-- Instagram package
             +-- YouTube package
```

## 9. Content Identity and Lineage

Every production MUST have a stable content identity.

Every artifact MUST expose, directly or through lineage:

- content identity
- logical artifact identity
- version
- parent artifacts
- producer/stage
- provider/model when applicable
- configuration/provenance
- content hash when applicable
- validation state

The system MUST be able to answer:

> Why does this artifact exist?

with its complete upstream lineage.

## 10. Validation Is Cross-Cutting

Validation is not a final pipeline stage only.

Artifacts MAY be validated at every production boundary:

```text
Script       -> semantic/constraint validation
Voice        -> audio validation
Visual       -> media/continuity validation
Timeline     -> structural validation
Master       -> media validation
Delivery     -> platform validation
```

## 11. State Model

Execution state and approval state MUST remain distinct.

Recommended lifecycle:

```text
DRAFT
PLANNED
IN_PROGRESS
RENDERED
QA_FAILED
REPAIRING
QA_PASSED
AWAITING_HUMAN_APPROVAL
APPROVED
PUBLISHING
PUBLISHED
```

`QA_PASSED` does not imply `APPROVED`.

`APPROVED` does not imply `PUBLISHED`.

## 12. Deterministic Rebuild

Given identical approved inputs, configuration, provider/model identity and renderer version, the system SHOULD produce reproducible production decisions and MUST preserve the provenance necessary to explain any non-bit-identical output.

## 13. AI Provider Provenance

AI-generated artifacts MUST retain sufficient provenance to identify, where available:

- provider
- model
- model/version identifier
- prompt/template identity
- relevant configuration
- input/reference artifacts
- generation attempt

Secrets MUST never be persisted as provenance.

## 14. Failure Policy

Transient execution failure MAY retry according to deterministic retry policy.

Objective production failure MAY trigger targeted repair.

Repeated objective failure MUST terminate in an explicit failed state or dead-letter state rather than creating an uncontrolled regeneration loop.

Creative disagreement MUST go to human review, not autonomous regeneration.

## 15. Publication Gate

Nothing is publishable merely because rendering succeeded.

Publication requires:

```text
Master exists
AND
Master objective QA passed
AND
Human approval exists
AND
Delivery package validation passed
```

## 16. Architectural Rule

The Content Factory is not a linear chain of AI calls.

It is a controlled production system:

```text
Human Intent
     |
     v
Creative Planning
     |
     v
Production Graph
     |
     v
Execution Engine
     |
     v
Objective Quality Engine
     |
     +---- FAIL -> Targeted Repair
     |
     v
Human Approval
     |
     v
Canonical Master
     |
     v
Policy-driven Delivery
     |
     v
Publication
```

The system is optimized for **high-quality first-pass production, deterministic compliance, minimal unnecessary regeneration, explicit human creative authority, and auditable delivery**.
