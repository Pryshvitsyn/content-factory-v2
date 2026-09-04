# Avatar Motion Pilot identity incident

Historical Replicate request `0txyydm541rmt0d0dcyacb6z1g` used `alibaba/wan-3` with the certified CHEST_UP_NEUTRAL intake `da222265-c6a3-45dc-bdb7-a0a0a2f77d45`.

The certified source SHA-256 was `b44bb4794908f0a28a54b8473565a5e5e997edbf5c8db3292e0360464e70d0f1`. The exact reconstructed normalized provider input hash was `3fb1a7d61d882006727b44cc1b7a717d9977e4d5977f971cff61392036588b35`, which matches the raw-output provenance (`HASH_MATCH=true`). The output was technically valid, but frame zero already showed a different person.

Conclusion: source selection and deterministic request construction were ruled out; identity substitution occurred at or before provider output frame zero. The historical result is technical-pipeline pass, identity-fidelity fail, and must not be identity-certified. Historical records are not rewritten.

New identity-critical Motion Pilot plans use Replicate `wan-video/wan-2.7-r2v` with `REFERENCE_TO_VIDEO` and an immutable, hash-verified identity-reference bundle. This route is deliberately separate from the retained Wan 3 route used by other workflows.
