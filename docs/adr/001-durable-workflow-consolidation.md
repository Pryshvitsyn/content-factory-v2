# ADR 001: Consolidate above the certified runtime

Status: Accepted for this feature branch.

We did not create a standalone workflow engine because V2.1 already provides durable Production/Job/Stage/Attempt execution, V2.5 provides paid-media intent and reconciliation, V2.8 provides provider routing, V2.9 provides QA contracts, and V2.10 provides creative/continuity/preflight semantics. Duplicate run tables would split recovery truth and threaten certified behavior.

Workflow Definition says what should happen; Operation Contract says what one typed node requires and how its side effects behave; Model Contract says how a selected generation model maps an approved request. Provider transport and domain policy remain separate.

Paid external operations reconcile by persisted provider job ID because automatic re-submission after uncertainty can duplicate spend. Cross-brand continuity is private by default and sharing requires explicit same-workspace grants because mere artifact existence is not authorization.
