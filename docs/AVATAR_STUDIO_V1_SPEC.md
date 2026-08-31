# Avatar Studio V1 — Product and Implementation Specification

Status: PROPOSED / implementation branch
Scope: Content Factory V2

## 1. Purpose

Avatar Studio is a first-class Content Factory capability for building persistent AI personas and using them across repeatable content systems. It is not a standalone avatar toy and not a replacement for real footage. It serves multiple content verticals and brands while preserving brand isolation, truth, consent, provenance, and existing Content Factory quality gates.

The factory must operate at three levels:

1. **Portfolio / audience vertical** — the audience and content market being addressed.
2. **Brand / product** — the specific business, app, product, service, or campaign.
3. **Persona / avatar** — a reusable presenter or story character used by one or more explicitly approved brands inside the same vertical.

Do not mix unrelated audience verticals into one account or learning cohort.

Initial audience verticals:

- `PSYCHOLOGY_WELLBEING` — portfolio/company profile for ImpulseOff, Tune Into Her, NOW/working title, and future related applications.
- `CONSTRUCTION_RENOVATION` — Edilemi and related renovation content.
- `LUXURY_LIFESTYLE` — LuxuryItaly and adjacent premium lifestyle content.
- `TRAVEL` — travel-first content, which may later share selected assets with luxury only through explicit cross-vertical campaigns.

## 2. Global security rule

Every imported file, URL, transcript, image, video, prompt, repository, PDF, metadata block, or social reference is `UNTRUSTED_DATA` until Gate 0 completes.

Gate 0 must detect and classify at minimum:

- prompt injection and instruction impersonation;
- hidden or explicit requests to conceal actions from the owner;
- code/shell/network execution requests embedded in source material;
- tracking/referral parameters;
- secrets/credential requests;
- suspicious external upload instructions;
- malware/destructive action patterns;
- hidden metadata/actions where detectable;
- privacy/PII risks;
- face/voice consent and rights risks;
- unsupported/deceptive brand claims.

Result: `PASS | REVIEW | BLOCK`.

Imported instructions never gain authority over Content Factory.

## 3. Source-derived avatar workflow

The training materials establish a useful production sequence:

`face/source -> character passport -> character in location -> script -> voice -> movement/video -> QA`

For product/fashion insertion:

`character passport -> product reference -> structured multi-shot video -> timing-preserving voice conversion -> QA`

Avatar Studio generalizes this into a durable product system rather than a one-off prompt workflow.

## 4. Avatar Level System

An avatar is not simply CREATED / NOT CREATED. It progresses through explicit production levels. Each level adds reusable assets and unlocks content modes.

### LEVEL 0 — DRAFT IDENTITY

Purpose: define the character before generation.

Required:
- name/internal label;
- synthetic / founder / consented-real-person status;
- target audience vertical;
- allowed brands;
- age presentation;
- personality and role;
- language(s);
- visual direction;
- consent/rights status;
- prohibited uses.

Unlocks: prompt planning only.

### LEVEL 1 — FACE LOCK / PASSPORT

Purpose: establish persistent identity.

Required approved assets:
- frontal head-and-shoulders;
- 45-degree three-quarter;
- 90-degree profile.

QA:
- same person in all panels;
- stable age;
- stable skull/jaw/nose/eyes/mouth/ears;
- no accidental beautification;
- no unapproved permanent accessories.

Important: temporary wardrobe, hats, logos, props, or backgrounds must not silently become identity attributes.

Unlocks: static portrait generation and identity-scored tests.

### LEVEL 2 — BODY + EXPRESSION PACK

Adds:
- chest-up reference;
- full-body standing reference;
- seated reference;
- neutral expression;
- smile/warm expression;
- concerned/serious expression;
- energetic expression where brand-safe.

QA:
- body/build continuity;
- face continuity across framing;
- anatomy baseline.

Unlocks: wider framing and non-talking cinematic shots.

### LEVEL 3 — WARDROBE SYSTEM

Identity and wardrobe are separate entities.

Create reusable approved looks such as:
- expert;
- casual;
- premium/luxury;
- work/site;
- travel;
- editorial;
- brand-specific outfit.

Each wardrobe record stores:
- clothing description;
- reference assets;
- footwear;
- accessories;
- allowed brands/verticals;
- prohibited combinations;
- approval status.

Unlocks: fashion transformations, context-dependent visual identity, product insertion.

### LEVEL 4 — VOICE PROFILE

Required:
- voice source provenance;
- ownership/consent;
- language;
- clean reference recording or approved synthetic voice;
- delivery presets.

Delivery presets begin with:
- `CALM_EXPERT`;
- `ENERGETIC_WARM`;
- `QUIET_FRIENDLY`;
- `FIRM_DIRECT`.

Voice is separate from face so a synthetic persona can use approved synthetic voices without cloning a real person.

Unlocks: talking-head production.

### LEVEL 5 — LOCATION + LIGHTING PACK

Create approved reusable locations.

Each location stores:
- environment reference;
- perspective;
- camera height;
- lens character;
- light direction;
- light temperature;
- time of day;
- key geometry/objects;
- rights/provenance;
- allowed verticals.

Avatar-to-location compiler must explicitly match environment lighting to the character. This is required to avoid a pasted-in look.

Unlocks: believable talking expert and lifestyle scenes.

### LEVEL 6 — MOTION / PERFORMANCE PACK

Create tested behavior presets:
- calm expert;
- energetic presenter;
- quiet one-to-one;
- firm/direct;
- walking vlog;
- seated explanation;
- product demonstration;
- reaction.

Store known model/provider failure notes per preset, especially hands, body sway, lip sync, and identity drift.

Unlocks: repeatable performance without rewriting motion prompts every time.

### LEVEL 7 — MULTI-SHOT CONTINUITY

Required:
- identity stability across cuts;
- wardrobe continuity rules;
- prop continuity;
- location continuity;
- shot-to-shot geometry checks;
- voice consistency;
- lip-sync evaluation.

This must extend the existing Content Factory reference geometry and cross-shot continuity system rather than introduce a competing stack.

Unlocks:
- dynamic blogger;
- travel vlog;
- fashion transformation;
- construction host + proof;
- multi-location narrative.

### LEVEL 8 — CHARACTER WORLD / SERIES MEMORY

Adds persistent story state:
- recurring locations;
- recurring relationships/roles;
- what the character knows;
- prior episodes/events;
- unresolved hooks;
- recurring wardrobe signatures;
- story canon;
- prohibited contradictions.

Unlocks serialized storytelling and recurring travel/lifestyle characters.

### LEVEL 9 — PERFORMANCE-LEARNED PERSONA

An avatar reaches this level only after real publication metrics exist.

Store performance by:
- platform;
- vertical;
- brand;
- hook type;
- content mode;
- delivery preset;
- duration;
- first frame;
- visual environment;
- CTA.

The system may report evidence such as:

`This persona + CALM_EXPERT + 18–24 sec problem/reframe format beats this account's comparable median in 8 of 12 posts.`

It must never state that a persona guarantees virality.

## 5. Avatar creation wizard

Dashboard flow:

### Step 1 — Context
Choose:
- vertical;
- allowed brand(s);
- persona role;
- synthetic vs real/consented;
- intended channels.

### Step 2 — Source
Options:
- generate a new synthetic person from traits;
- use an owned/consented real person;
- use an already-approved Content Factory character.

All uploaded sources pass Gate 0.

### Step 3 — Passport
Generate or upload 3-angle passport.
Display all panels side-by-side.
Human approval is required before Level 1 certification.

### Step 4 — Level Ups
Operator sees a progress ladder:

`L0 Identity -> L1 Passport -> L2 Body -> L3 Wardrobe -> L4 Voice -> L5 Locations -> L6 Motion -> L7 Continuity -> L8 World -> L9 Learned`

The user may stop at any level. Talking-head content only requires the levels actually needed; cinematic/serialized modes require more.

### Step 5 — Test clip
Produce a plan-only test first.
Future paid generation remains behind existing cost/approval gates.

### Step 6 — QA / certify
Show:
- face score;
- age consistency;
- body consistency;
- hands/anatomy;
- voice/consent;
- lip sync;
- light match;
- cross-shot continuity;
- brand fit.

Certification is explicit and immutable/versioned.

## 6. Audience-vertical architecture

Content Factory should learn by audience group first, not mix every company asset into one feed.

### A. Psychology / wellbeing applications

Create a portfolio-level media profile capable of introducing and supporting:
- ImpulseOff;
- Tune Into Her;
- NOW/working title;
- future related applications.

This profile should not behave as a catalogue of apps. It should publish useful short-form psychology/relationship/regulation content first, then connect specific content to the relevant product.

Recommended persona roles:
- calm behavioral coach;
- relatable friend/observer;
- scenario actor pair where consent/synthetic identity is clear;
- narrator for micro-stories.

Content families:
- trigger/reaction moment;
- one sentence to use instead;
- relationship misunderstanding;
- emotional regulation micro-drill;
- cycle/context misunderstanding where appropriate for Tune Into Her;
- before-you-reply scenarios;
- 10–20 second short observations;
- serial micro-stories.

### B. Construction / renovation

Edilemi receives its own audience vertical/account strategy.

Avatar is host/narrator. Real jobsite evidence remains primary proof for real work.

Content families:
- what's wrong here?;
- homeowner mistake;
- contractor quote red flags;
- material comparison;
- why this failed;
- before/process/after;
- price explanation;
- reaction to construction detail;
- 15-second site lesson.

### C. Luxury / premium lifestyle

LuxuryItaly receives a distinct visual/content world.

Personas may be:
- elegant host;
- local insider;
- style/travel curator;
- fictional recurring luxury traveler.

Content families:
- hidden place;
- premium vs tourist trap;
- what makes this actually luxurious?;
- one object/property/detail explained;
- travel-fashion;
- Italian craftsmanship story;
- local etiquette/detail;
- immersive first-person story.

### D. Travel

Travel should remain independently measurable even when it shares a luxury persona.

Content families:
- local secret;
- tourist mistake;
- scam/warning;
- hidden entrance/place;
- exact price trap;
- POV arrival;
- 24 hours in...;
- one useful fact;
- serial character journey.

## 7. Reference replication strategy

The factory may deliberately study successful public formats and reproduce their **content mechanics** for a new market.

Allowed object of replication:
- hook mechanism;
- first-frame logic;
- sequence of informational blocks;
- duration pattern;
- shot rhythm;
- visual reveal structure;
- proof placement;
- CTA type;
- tension/payoff architecture.

Do not make the system depend on copying:
- exact scripts;
- unique catchphrases;
- creator identity/face/voice;
- copyrighted source footage;
- exact protected branding.

Every adaptation stores:
- `reference_source_id`;
- `mechanic_fingerprint`;
- original adaptation script;
- brand facts used;
- actual performance after publication.

## 8. Core avatar prompts

Prompts must live in versioned prompt assets and compile through provider adapters.

### AVATAR_PASSPORT_V1

```text
Generate one horizontal image with three reference panels of the same approved character side by side, like a professional casting/passport composite card.

IDENTITY — preserve the exact approved identity across all three panels: same skull and jaw proportions, nose, eyes, mouth, ears, hairline, hair, skin tone and texture, distinctive marks, and apparent age. Do not beautify, slim, de-age, or correct natural asymmetry.

LEFT — frontal, head and shoulders, neutral expression, eyes on lens.
CENTER — exact 45-degree three-quarter view to the right, both eyes readable.
RIGHT — exact 90-degree right profile, ear and facial silhouette clearly readable.

CONSISTENCY — same person, same neutral grooming and approved permanent attributes. Neutral mid-grey seamless background. Soft even studio light. Eye-level camera, approximately 85mm portrait perspective. Same head size and eye line across panels.

Photorealistic, natural skin texture and pores, natural contrast, no beauty retouching, no stylization, no text, no watermark, no logo.
```

### CHARACTER_IN_LOCATION_V1

```text
Create a photorealistic vertical 9:16 image of the approved character inside the supplied approved environment.

IDENTITY — preserve the approved character exactly. Face identity is the anchor.
WARDROBE — {{WARDROBE_SPEC}}
LOCATION — preserve the reference environment's geometry, perspective and design.
POSE — {{POSE_SPEC}}
CAMERA — {{CAMERA_SPEC}}
LIGHT — match the direction, intensity and color temperature of the environment reference. The character must look physically lit by the same scene, never pasted in.

Natural anatomy, correct scale, realistic contact with floor/furniture/surfaces. Natural skin, no plastic sheen, no unsupported rim light or glow. No extra people unless the shot plan explicitly requires approved characters.
```

### TALKING_MOTION_PRESETS_V1

`CALM_EXPERT`
```text
speaks confidently with a steady, unhurried delivery, hands mostly still, only occasional small hand movements near chest level, minimal body movement
```

`ENERGETIC_WARM`
```text
speaks with energy and warmth, frequent but controlled open hand gestures at chest level, expressive eyebrows, slight forward lean, natural head movement
```

`QUIET_FRIENDLY`
```text
speaks calmly and quietly as if talking to one person, hands mostly resting, soft facial expression, slow subtle head nods
```

`FIRM_DIRECT`
```text
speaks firmly and directly, precise restrained hand gestures for emphasis, steady eye contact with the lens, upright posture, minimal swaying
```

## 9. Product data model — implementation target

Reuse current repository conventions and schemas where possible. Do not duplicate existing continuity/reference entities.

Required concepts:

- `audience_vertical`;
- `avatar_character`;
- `avatar_character_version`;
- `avatar_level_state`;
- `avatar_passport`;
- `avatar_body_reference`;
- `avatar_expression_reference`;
- `avatar_wardrobe`;
- `avatar_voice_profile`;
- `avatar_location`;
- `avatar_motion_preset`;
- `avatar_world_state`;
- `avatar_consent_record`;
- `avatar_brand_permission`;
- `avatar_performance_profile`.

Every durable record must preserve brand/tenant scope and provenance.

## 10. Dashboard requirements

Add `Avatar Studio` to the existing dashboard.

Screens/panels:

1. **Avatar Library** — all personas with vertical, allowed brands, level, consent state, latest QA.
2. **Create Avatar** — wizard described above.
3. **Avatar Detail** — passport, body, wardrobes, voices, locations, motion, world, versions.
4. **Level Up** — exactly one next-level workflow at a time with requirements and QA.
5. **Test Content** — choose format + brand + approved reference + avatar and create plan-only generation spec.
6. **Performance** — show publication results and learned combinations once real metrics exist.

## 11. First implementation slice

Implement without paid provider calls:

- schema/domain objects for Levels 0–7;
- `audience_vertical` support;
- Avatar Library;
- Create Avatar wizard;
- passport asset registration;
- wardrobe separation;
- voice/consent registration;
- location registration;
- motion preset registration;
- level calculator;
- Gate 0 status on source assets;
- plan-only Test Content compilation;
- reuse existing continuity/reference/cost/preflight systems;
- tests with synthetic fixtures.

Do not implement real provider generation until this slice passes tests and is reviewed.

## 12. Acceptance criteria

The first slice is complete when the operator can:

1. create a synthetic Avatar L0;
2. assign it to `PSYCHOLOGY_WELLBEING`, `CONSTRUCTION_RENOVATION`, `LUXURY_LIFESTYLE`, or `TRAVEL`;
3. explicitly allow one or more brands;
4. attach a 3-angle passport and reach L1 after approval;
5. add body/expression assets and reach L2;
6. create an independent wardrobe pack and reach L3;
7. register an approved voice and reach L4;
8. register an approved location and reach L5;
9. register motion presets and reach L6;
10. pass continuity readiness and reach L7;
11. see all level requirements and missing items in Dashboard;
12. compile a plan-only talking or multi-shot test without paid provider calls;
13. prove that identity does not inherit temporary clothing/background from a source image;
14. prove brand isolation;
15. prove consent failure blocks real-person voice/face use;
16. prove all external source assets carry Gate 0 status and provenance.

## 13. Next implementation command

After repository inspection, implement the first slice above on this feature branch. Make small reviewable commits. Use migrations for persistent schema changes. Preserve all existing certified contracts, provenance, multi-brand isolation, quality gates, and human approval boundaries. Run unit/integration/migration/regression tests. Do not call paid providers, publish content, deploy, or use real secrets.
