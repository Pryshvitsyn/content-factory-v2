# Content Factory V2.1 — Autonomous Content Production Contract

## 1. Purpose

Content Factory turns a human creative idea into production-ready, objectively validated, human-approved, publishable content.

The factory is autonomous in **execution**, but not autonomous in **creative authority**.

## 2. Non-Negotiable Production Principle

```text
IDEA
  -> THINK / PLAN
  -> CREATE
  -> ASSEMBLE
  -> MASTER
  -> OBJECTIVE QA
      PASS -> HUMAN REVIEW
                APPROVE -> DELIVERY -> DELIVERY QA -> PUBLISH
                REVISION -> NEW REVISION
      FAIL -> TARGETED REPAIR -> AFFECTED REBUILD -> QA AGAIN
```

A successful creative result is never regenerated merely because an automated critic believes another version might be better.

## 3. Human Authority

Human approval is the authority for subjective creative quality.

The factory MUST NOT autonomously regenerate an otherwise compliant production because of:

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

Examples include technical integrity, script/voice mismatch, missing required scene/shot, continuity violations, duplicate output where uniqueness is required, malformed generated content when an explicit detector exists, required brand elements, prohibited content, CTA requirements, duration bounds, and destination requirements.

Subjective quality scores alone MUST NOT trigger automatic repair.

## 5. Repair Scope

Automatic repair MUST be targeted.

The system MUST identify the smallest affected artifact set and regenerate only affected nodes plus their invalidated downstream derivatives.

Unaffected artifacts MUST remain immutable.

Repeated objective failure MUST stop at an explicit failure/dead-letter boundary; it MUST NOT create an uncontrolled regeneration loop.

## 6. Immutable Production Truth

Every accepted artifact version is immutable.

A new creative revision creates a new version with explicit lineage. No process may silently mutate an accepted artifact.

## 7. Production Layers

### Creative layer

Interprets intent, researches when required, develops strategy/concept, writes the script, defines visual/audio direction and edit intent.

### Execution layer

Runs deterministic stages, provider calls, retries, idempotency, persistence, dependency tracking and rendering.

### Quality layer

Runs deterministic validation, constraint validation, media integrity, continuity checks, destination compliance and repair planning.

### Human approval layer

Controls subjective creative approval, requested revisions and final release authorization.

### Delivery layer

Transforms the approved canonical master into destination-specific packages, validates them and publishes them through destination adapters.

## 8. Canonical Master

The canonical Master is the approved production truth from which all destination deliveries are derived.

Destination packages MUST NOT become independent creative masters.

```text
CONTENT UNIT
    |
    +-- SOURCE ARTIFACTS
    +-- COMPOSITION / TIMELINE
    |
    +-- CANONICAL MASTER
             |
             +-- DELIVERY POLICY A -> ADAPTER A
             +-- DELIVERY POLICY B -> ADAPTER B
             +-- DELIVERY POLICY N -> ADAPTER N
```

The core MUST NOT hard-code a finite list of platforms. A destination is an adapter plus a versioned policy defining requirements, transformation and publication capabilities.

## 9. Content Identity and Lineage

Every production has a stable content identity.

Every artifact MUST expose directly or through lineage:

- content identity
- logical artifact identity
- version
- parent artifacts
- producer/stage
- provider/model when applicable
- configuration/provenance
- content hash when applicable
- validation state

The system MUST be able to answer why an artifact exists and exactly which upstream inputs produced it.

## 10. Validation Is Cross-Cutting

Validation is not only a final stage.

```text
Script       -> semantic / constraint validation
Voice        -> audio validation
Visual       -> media / continuity validation
Timeline     -> structural validation
Master       -> media / production validation
Delivery     -> destination validation
```

## 11. Execution and Approval State

Execution state and approval state MUST remain distinct.

The lifecycle is conceptually:

```text
DRAFT -> PLANNED -> IN_PROGRESS -> MASTERED
MASTERED -> QA_FAILED -> REPAIRING -> MASTERED
MASTERED -> QA_PASSED -> AWAITING_HUMAN_APPROVAL
AWAITING_HUMAN_APPROVAL -> APPROVED | REVISION_REQUESTED
APPROVED -> DELIVERY -> DELIVERY_QA -> PUBLISHED
```

`QA_PASSED` does not imply `APPROVED`.

`APPROVED` does not imply `PUBLISHED`.

## 12. Deterministic Rebuild

Given identical approved inputs, configuration, provider/model identity and renderer version, the system SHOULD produce reproducible production decisions and MUST preserve sufficient provenance to explain any non-bit-identical output.

## 13. AI Provider Provenance

AI-generated artifacts MUST retain sufficient provenance, where available, to identify provider, model/version, prompt/template identity, relevant configuration, input/reference artifacts and generation attempt.

Secrets MUST never be persisted as provenance.

## 14. Delivery Adapter Contract

A destination adapter is responsible only for destination-specific behavior.

```text
prepare(master, policy)
validate(package, policy)
publish(package, idempotency_key)
getPublicationStatus(external_reference)
```

Adapters MUST be versioned, idempotent where the destination permits it, auditable, and isolated from creative production logic.

Adding a new destination MUST NOT require changes to the Content Graph, Creative layer, Master contract or existing adapters.

## 15. Publication Gate

Publication requires ALL of:

```text
Canonical Master exists
AND
Master objective QA = PASS
AND
Human approval = APPROVED
AND
Delivery package exists
AND
Delivery QA = PASS
AND
Destination adapter = ENABLED
```

Publication attempts are independently auditable and retryable. A successful publication MUST retain the destination's external reference when available.

## 16. Architectural Rule

The Content Factory is not a linear chain of AI calls. It is a controlled production system:

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
Destination Adapter
     |
     v
Publication
```

The system is optimized for **excellent first-pass production, deterministic compliance, minimal unnecessary regeneration, explicit human creative authority, extensible destinations, and auditable delivery**.
