# Content Factory V2.1 — Multi-Tenant Architecture Contract

## Executive Summary

The Content Factory is **not a video generator**. It is a **multi-tenant content production operating system** where each business has its own creative identity, rules, audiences, products, and content strategy — while the production machinery is shared.

**Key Distinction:** Business is not the same thing as Production.

A single business can have many brands, campaigns, series, products, characters and platforms. The architecture separates these concerns completely.

---

## Complete Architecture Hierarchy

```
CONTENT FACTORY
│
├── TENANT / BUSINESS
│   │
│   ├── Brand
│   │   ├── Brand identity
│   │   ├── Voice
│   │   ├── Visual language
│   │   ├── Rules
│   │   └── Compliance
│   │
│   ├── Audience
│   │
│   ├── Products / Services
│   │
│   ├── Content Strategy
│   │
│   └── Knowledge
│
├── CONTENT UNIVERSES
│   ├── Campaign
│   ├── Series
│   └── Recurring formats
│
└── PRODUCTIONS
    ├── Production Bible
    ├── Shots
    ├── Assets
    ├── Generation
    ├── Assembly
    ├── Editions
    ├── Publishing
    └── Learning
```

---

## 1. Tenant & Business Layer

### Example: Three Different Businesses

| Business | Brand | Audience | Products | Tone |
|----------|-------|----------|----------|------|
| **Roma Pizza** | Roma Pizza | Tourists + locals | Pizza / delivery | Funny / local |
| **Edilemi** | Edilemi | Homeowners | Renovation services | Trustworthy / expert |
| **Brand X** | Brand X | 20–35 fashion | Clothing | Aspirational |

**The factory doesn't change. Only their business configuration changes.** That's the real scalability.

---

## Implementation Status

### V2.1-A — Foundation ✅
- Core entities (projects, contents, variants, productions)
- Reusable assets (characters, locations, styles, voices, props)
- Artifacts with versioning
- Jobs & stage runs with state machine
- Provider registry

### V2.1-B — Multi-Tenant ✅
- Tenants & businesses
- Brands with identity & rules
- Audiences
- Products & services
- Content strategies
- Content universes / series
- Knowledge base
- Industry policies & compliance
- Trend engine (tenant-aware)
- Hierarchical learning system

### V2.1-C — Next
- Production Bible inheritance engine
- Shot planner
- Asset planner
- Continuity engine

---

## Key Architectural Decisions

1. **Multi-tenant by design** — not an afterthought
2. **Business ≠ Production** — complete separation
3. **Brand independence** — one business, many brands
4. **Content universes** — series, campaigns, recurring formats
5. **Bible inheritance** — rules cascade down the hierarchy
6. **Identity vs representation** — characters persist across asset versions
7. **Industry compliance** — different rules per industry
8. **Tenant-aware trends** — relevance scoring per business/brand
9. **Hierarchical learning** — global → business → brand → series
10. **n8n as orchestrator** — not state holder

---

## Next Steps

1. Apply migration: `psql $DATABASE_URL < migrations/20260815_v2_1_multi_business.sql`
2. Verify schema: 24 new tables + updates to existing tables
3. Begin V2.1-C (Production Bible inheritance engine)
4. Implement Bible resolution algorithm
5. Build compliance validator

---

This is the **complete multi-tenant content production OS** architecture.
