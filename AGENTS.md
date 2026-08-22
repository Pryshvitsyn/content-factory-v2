# Content Factory V2 — Codex Instructions

## Mission

Maintain and extend Content Factory V2 without weakening its certified V2.1 foundation. Prefer small, reversible, reviewable changes over broad rewrites.

## Non-negotiable rules

1. **Protect the V2.1 certified foundation.** Treat certified behavior, contracts, schemas, and artifacts as compatibility boundaries. Do not replace, bypass, or silently reinterpret them.
2. **Use migrations for persistent changes.** Never modify production data, schemas, stored configuration, or durable artifact formats ad hoc. Add an ordered, repeatable migration with a safe rollback or a documented forward-only recovery path.
3. **Never store secrets.** Do not commit credentials, tokens, private keys, customer data, or populated environment files. Use environment variables or the approved secret manager. Keep examples synthetic.
4. **Keep artifacts immutable.** Never overwrite or delete a certified or published artifact. Create a new version with provenance linking it to its inputs, configuration, brand, producer, and predecessor.
5. **Test before certification.** A change is not certified because it builds or works locally. Run the relevant automated checks and record the result. Certification and publication remain explicit human decisions.
6. **Enforce multi-brand isolation.** Every brand-scoped operation must carry an explicit brand/tenant identity. Never mix prompts, assets, credentials, configuration, storage paths, caches, logs, or outputs across brands. Fail closed when brand context is missing or ambiguous.
7. **Respect human approval boundaries.** Do not publish content, certify artifacts, deploy to production, run production migrations, rotate secrets, incur material cost, or perform destructive/external actions without explicit human approval.

## Working method

Before changing code:

- Read the nearest documentation, tests, migrations, and existing implementation.
- Identify the affected compatibility boundary and brand scope.
- Check the working tree and preserve unrelated user changes.
- If requirements conflict with a non-negotiable rule, stop and explain the conflict.

While changing code:

- Make the smallest coherent change that solves the request.
- Follow existing architecture, naming, and migration conventions.
- Preserve backward compatibility unless a breaking change and migration are explicitly approved.
- Validate inputs and authorization at system boundaries; do not rely on UI checks alone.
- Keep generated outputs reproducible and traceable to versioned inputs and configuration.
- Do not silently repair, overwrite, or recertify historical records.

Before handing off:

- Run the relevant unit, integration, migration, isolation, and regression tests available in the repository.
- For migrations, test both a clean setup and an upgrade from the latest certified version when supported.
- Review the diff for secrets, cross-brand leakage, unintended artifact mutation, and unrelated changes.
- Report what changed, tests run and their results, migrations added, residual risks, and any approval still required.

## Approval matrix

Codex may implement code, tests, documentation, and migration files in the working branch. Explicit human approval is required before:

- production deployment or production migration;
- publishing or distributing content;
- certifying, promoting, or replacing an artifact;
- destructive or irreversible data operations;
- accessing or changing real credentials, customer data, billing, or third-party production systems;
- weakening isolation, security, auditability, provenance, or certified compatibility.

When approval is required, prepare the change and evidence, then pause at the boundary. Never treat silence, prior approval for another action, or a passing test suite as approval.

## Definition of done

A task is done only when the requested behavior is implemented, relevant checks pass, migrations and documentation are included where needed, brand isolation and artifact immutability are preserved, no secrets are introduced, and all remaining human actions are clearly listed.
