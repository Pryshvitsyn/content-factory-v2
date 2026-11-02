# PRODUCT SNAPSHOT
Updated: 2026-11-02

## CURRENT STATE
Content Factory V2 is a Node.js/PostgreSQL, multi-brand advertising-video system with a React Dashboard, provider routing, FFmpeg rendering, immutable artifacts and human review. Inspected GitHub baseline: `470cdf46818d10ca281838b20f758c40492f3f38` on `main`. Source exists; current live runtime and pilot output were not accessed.

## LATEST DELTA
Applied Originesis bootstrap to existing files on `docs/originesis-bootstrap-alignment`: shortened README, added progressive-context and completion rules to AGENTS, reconciled this snapshot and executable tasks. GOAL remains valid. Reused existing architecture and script-first workflow documentation; no duplicate architecture, decision log, agents or skills.

## WORKING
On 2026-11-02: QUALITY script-first contract PASS; V2.10 runtime integration PASS (real external calls = 0); V2.1 stage sequence PASS; Dashboard production build PASS. Dependencies installed using package-lock. Checks ran on Node 24.22.1; documented target is Node 22. This is local verification, not live-production certification.

## BROKEN / MISSING
Current pilot has no verified playable, reviewed MP4 in this handoff. Earlier operator report says final preflight READY and production not started; it is not a fresh runtime check. Latest Mac fixes may be ahead of GitHub; installation/sync state is unknown.

## BLOCKERS
Configured active runtime, current draft/approvals and local source revision are unavailable here for live verification. Paid generation still requires explicit start authorization.

## NEXT BEST MOVE
Reconcile the active Mac checkout with this baseline and latest local fixes, then inspect the exact approved script/storyboard, selected models, voice, costs and fresh canonical preflight before any production start.

## PARALLEL
Read-only inspection of catalog capability and regression coverage can proceed independently of live production.

## REFERENCES
Repo: https://github.com/Pryshvitsyn/content-factory-v2
Core: README.md, AGENTS.md, GOAL.md, TASKS.md.
Details: docs/QUALITY-SCRIPT-FIRST-WORKFLOW.md; docs/ARCHITECTURE.md.
