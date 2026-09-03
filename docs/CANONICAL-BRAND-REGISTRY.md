# Canonical Content Factory Brand Registry

Status: operator-approved registry, 2026-09-03.

Content Factory executes brand-specific content production. It does not become the source of truth for product strategy; brand/product truth remains outside the production engine and is imported only when explicitly approved.

## Canonical active contexts

1. `edilemi.com`
2. `tgsimon.com`
3. `delsole.cc`
4. `ImpulseOff`
5. `LuxuryItaly.net`
6. `pastamore`
7. `NOW`
8. `Tune Into Her`

`Attune` is not a new active brand. It is a legacy alias of `Tune Into Her`.

The registry intentionally does not invent mission, positioning, audience, voice, visual language, claim policy or preferred assets. Those Brand Pack fields remain `NEEDS_COMPLETION` until approved source material is supplied.

Known parent relation recorded in metadata:

- `ImpulseOff` → `Elio Genesis`
- `NOW` → `Elio Genesis`
- `Tune Into Her` → `Elio Genesis`

`NOW` remains marked as a working title.

## Runtime behavior

`npm run dashboard:local` prepares the existing Content Factory database and then calls the idempotent canonical registry synchronizer.

If the database contains exactly one workspace, that workspace is selected automatically. If multiple workspaces exist, synchronization fails closed and requires `CONTENT_FACTORY_WORKSPACE_ID` so the Factory never guesses brand ownership.

The synchronization:

- creates missing canonical brand rows;
- reuses an existing brand identity when name or slug already matches;
- preserves existing `mission`, `positioning`, historical productions and brand IDs;
- if only legacy `Attune` exists, migrates that exact brand row in place to `Tune Into Her` so historical productions keep the same `brand_id`;
- archives any remaining duplicate `Attune` rows as legacy aliases;
- merges canonical registry metadata without deleting unrelated existing metadata;
- is idempotent and safe to run on every local dashboard startup.

Manual sync is also available with:

```bash
node scripts/sync-canonical-brands.js
```

For a multi-workspace database:

```bash
CONTENT_FACTORY_WORKSPACE_ID=<uuid> node scripts/sync-canonical-brands.js
```

No provider generation, paid media call, publication or deployment is performed by brand synchronization.
