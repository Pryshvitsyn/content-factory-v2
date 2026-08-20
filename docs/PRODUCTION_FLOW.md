# Autonomous Production Flow

## Golden Path

```text
Human Idea
   |
   v
Content Unit
   |
   v
Creative Planning
   |
   +--> Research (when required)
   |
   v
Production Graph
   |
   +--> Script
   +--> Production Bible
   +--> Shots
   +--> Continuity
   +--> Asset Requirements
   +--> Voice / Visual / Music assets
   +--> Timeline
   |
   v
Canonical Master
   |
   v
Objective QA
   |
   +---- FAIL ----> Targeted Repair ----> QA
   |
   +---- PASS ----> Human Review
                         |
                    +----+----+
                    |         |
                  REDO      APPROVE
                    |         |
                    v         v
             Revision Graph  Delivery
                              |
                              v
                           Publish
```

## Autonomy Boundary

The system may autonomously:

- interpret the requested production intent;
- plan production;
- call approved providers;
- retry transient failures;
- validate explicit rules;
- repair objective violations;
- invalidate and rebuild affected downstream derivatives;
- prepare platform packages;
- publish only after all publication gates are satisfied.

The system may NOT autonomously:

- replace an approved creative direction because it prefers another one;
- regenerate compliant content merely to improve a subjective score;
- overwrite approved artifacts;
- publish without human approval.

## Repair Algorithm

1. Record QA finding.
2. Identify failed rule.
3. Resolve the failed artifact/node.
4. Calculate downstream dependency closure.
5. Mark only affected derivatives invalid.
6. Regenerate the smallest valid repair scope.
7. Re-run objective QA.
8. Stop after configured repair budget and enter explicit failure/dead-letter state if the rule remains broken.

## Human Revision Algorithm

A human revision is not a QA failure.

1. Human submits a revision request.
2. Store the request as a `human_review` decision.
3. Convert the request into explicit revision scope where possible.
4. Create a new production revision.
5. Preserve the previous approved version.
6. Produce and validate the new candidate.
7. Return to human approval.

## Publication Gate

```text
canonical master exists
AND master objective QA = PASS
AND human approval = APPROVED
AND platform package exists
AND platform QA = PASS
AND publication policy = ENABLED
```

Only then may the publication executor act.
