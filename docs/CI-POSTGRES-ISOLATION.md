# CI PostgreSQL Isolation

Each V2.1 PostgreSQL certification must bootstrap the database objects it owns and must not depend on execution order from another test.

The concurrency certification therefore creates only the minimal canonical V2 identities (`workspaces` and `generation_jobs`), applies the V2.1 execution migration and its certification migration, runs the concurrent ownership race, and cleans up its schema and fixture tables.

This keeps the CI suite deterministic and prevents a green test from depending on state left behind by a previous test.
