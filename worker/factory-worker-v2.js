
require("dotenv").config();
const crypto = require("crypto");

const { Client } = require("pg");
const OpenAI = require("openai");
const { jsonrepair } = require("jsonrepair");

const db = new Client({
  connectionString: process.env.DATABASE_URL,
});

const ai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


async function resolveModel(job) {
  if (!job.model_id) {
    throw new Error(`Job ${job.id} has no model_id.`);
  }

  const result = await db.query(
    `
    SELECT
      m.id,
      m.name,
      m.model_id,
      p.slug AS provider_slug
    FROM ai_models m
    JOIN ai_providers p ON p.id = m.provider_id
    WHERE m.id = $1
      AND m.enabled = true
    LIMIT 1
    `,
    [job.model_id]
  );

  if (!result.rows.length) {
    throw new Error(`AI model ${job.model_id} was not found or disabled.`);
  }

  const model = result.rows[0];

  if (model.provider_slug !== "nvidia") {
    throw new Error(
      `Current factory text engine requires NVIDIA. Got ${model.provider_slug}.`
    );
  }

  console.log(
    `Resolved model: ${model.name} -> ${model.model_id}`
  );

  return model.model_id;
}


function extractJson(text) {
  if (!text) {
    throw new Error("Empty AI response.");
  }

  try {
    return JSON.parse(text);
  } catch {}

  try {
    return JSON.parse(jsonrepair(text));
  } catch {}

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start >= 0 && end > start) {
    try {
      return JSON.parse(
        jsonrepair(text.slice(start, end + 1))
      );
    } catch {}
  }

  throw new Error("Could not extract JSON from AI response.");
}


function validateScript(script) {
  if (!script || typeof script !== "object") {
    throw new Error("Script is not an object.");
  }

  if (!script.title) {
    throw new Error("Script has no title.");
  }

  if (!Array.isArray(script.scenes) || !script.scenes.length) {
    throw new Error("Script contains no scenes.");
  }

  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];

    if (scene.scene_number !== i + 1) {
      throw new Error(
        `Invalid scene numbering at scene ${i + 1}.`
      );
    }

    if (!scene.visual) {
      throw new Error(
        `Scene ${scene.scene_number} has no visual.`
      );
    }

    if (scene.duration_seconds == null) {
      throw new Error(
        `Scene ${scene.scene_number} has no duration.`
      );
    }
  }

  return true;
}


function validateProductionPlan(plan, script) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("Production plan is not an object.");
  }

  // AI output may omit optional collections. Normalize them safely.
  if (!Array.isArray(plan.characters)) {
    plan.characters = [];
  }

  if (!Array.isArray(plan.locations)) {
    plan.locations = [];
  }

  if (
    !plan.visual_identity ||
    typeof plan.visual_identity !== "object" ||
    Array.isArray(plan.visual_identity)
  ) {
    plan.visual_identity = {};
  }

  if (!Array.isArray(plan.continuity_rules)) {
    plan.continuity_rules = [];
  }

  if (!Array.isArray(plan.scene_plans)) {
    throw new Error("Production plan has no scene_plans.");
  }

  if (
    !plan.shot_strategy ||
    typeof plan.shot_strategy !== "object" ||
    Array.isArray(plan.shot_strategy)
  ) {
    plan.shot_strategy = {};
  }

  // Scene count is NOT optional.
  if (plan.scene_plans.length !== script.scenes.length) {
    throw new Error(
      `Production Planner changed scene count: expected ${script.scenes.length}, got ${plan.scene_plans.length}.`
    );
  }

  // The approved script is the source of truth.
  // Never allow the production planner to rewrite script content.
  for (let i = 0; i < script.scenes.length; i++) {
    const source = script.scenes[i];
    const scenePlan = plan.scene_plans[i];

    if (!scenePlan || typeof scenePlan !== "object") {
      throw new Error(
        `Production Planner returned invalid scene plan ${i + 1}.`
      );
    }

    if (scenePlan.scene_number !== source.scene_number) {
      throw new Error(
        `Production Planner changed scene numbering at scene ${source.scene_number}.`
      );
    }

    scenePlan.dialogue = source.dialogue ?? "";
    scenePlan.voiceover = source.voiceover ?? "";
    scenePlan.on_screen_text = source.on_screen_text ?? "";
    scenePlan.story_action =
      source.action ?? source.story_action ?? "";

    if (!scenePlan.visual) {
      scenePlan.visual = source.visual ?? "";
    }

    if (!scenePlan.camera) scenePlan.camera = "";
    if (!scenePlan.framing) scenePlan.framing = "";
    if (!scenePlan.lighting) scenePlan.lighting = "";
    if (!scenePlan.composition) scenePlan.composition = "";
    if (!scenePlan.motion) scenePlan.motion = "";
    if (!scenePlan.continuity) scenePlan.continuity = "";

    if (!Array.isArray(scenePlan.production_requirements)) {
      scenePlan.production_requirements = [];
    }
  }

  return true;
}

const V2_VERSION = "2.0.0";

function stageNameForJob(job) {
  if (job.job_type === "script_generation") return "script";
  if (job.job_type === "production_planning") return "production_bible";
  return job.job_type;
}

async function ensurePipelineStage(job) {
  const stageKey = stageNameForJob(job);
  const pipelineKey = `job:${job.id}`;
  const pipeline = await db.query(
    `
    INSERT INTO pipeline_runs (
      workspace_id, source_job_id, idempotency_key, status,
      current_stage, input_data, started_at
    )
    VALUES ($1,$2,$3,'running',$4,$5::jsonb,COALESCE($6,now()))
    ON CONFLICT (workspace_id, idempotency_key)
    DO UPDATE SET
      current_stage = EXCLUDED.current_stage,
      status = CASE
        WHEN pipeline_runs.status IN ('completed','cancelled') THEN pipeline_runs.status
        ELSE 'running'
      END
    RETURNING id
    `,
    [
      job.workspace_id,
      job.id,
      pipelineKey,
      stageKey,
      JSON.stringify(job.input_data || {}),
      job.started_at
    ]
  );

  const sequence = stageKey === "script" ? 20 :
    stageKey === "production_bible" ? 30 : 10;

  const stage = await db.query(
    `
    INSERT INTO job_stages (
      pipeline_run_id, stage_key, sequence_no, status,
      idempotency_key, max_attempts, started_at
    )
    VALUES ($1,$2,$3,'running',$4,$5,now())
    ON CONFLICT (pipeline_run_id, stage_key)
    DO UPDATE SET
      status = CASE
        WHEN job_stages.status = 'completed' THEN 'completed'
        ELSE 'running'
      END,
      locked_at = now()
    RETURNING *
    `,
    [
      pipeline.rows[0].id,
      stageKey,
      sequence,
      `stage:${job.id}:${stageKey}`,
      job.max_attempts || 3
    ]
  );

  const stageRow = stage.rows[0];
  const attemptNo = stageRow.attempt_count + 1;

  await db.query(
    `
    UPDATE job_stages
    SET attempt_count=$2, locked_at=now()
    WHERE id=$1
    `,
    [stageRow.id, attemptNo]
  );

  const attempt = await db.query(
    `
    INSERT INTO stage_attempts (
      stage_id, attempt_no, provider_id, model_id,
      request_json, status
    )
    VALUES ($1,$2,$3,$4,$5::jsonb,'running')
    ON CONFLICT (stage_id, attempt_no)
    DO UPDATE SET status='running', started_at=now()
    RETURNING id
    `,
    [
      stageRow.id,
      attemptNo,
      job.provider_id,
      job.model_id,
      JSON.stringify({
        job_id: job.id,
        job_type: job.job_type,
        input_data: job.input_data || {}
      })
    ]
  );

  return {
    pipelineId: pipeline.rows[0].id,
    stageId: stageRow.id,
    attemptId: attempt.rows[0].id,
    stageKey,
    attemptNo
  };
}

async function recordValidation(stageId, artifactId, type, status, findings = [], score = null) {
  await db.query(
    `
    INSERT INTO validation_results
      (stage_id, artifact_id, validation_type, status, score, findings)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)
    `,
    [stageId, artifactId, type, status, score, JSON.stringify(findings)]
  );
  if (status !== "passed") {
    throw new Error(`${type} validation failed: ${JSON.stringify(findings)}`);
  }
}

async function createArtifact({
  job, stageId, pipelineId, artifactType, logicalKey,
  contentJson = null, contentText = null, uri = null,
  metadata = {}
}) {
  const hash = crypto.createHash("sha256")
    .update(JSON.stringify(contentJson ?? contentText ?? uri ?? ""))
    .digest("hex");

  const existing = await db.query(
    `SELECT id, version, sha256 FROM artifacts
     WHERE workspace_id=$1 AND logical_key=$2
     ORDER BY version DESC LIMIT 1`,
    [job.workspace_id, logicalKey]
  );

  if (existing.rows[0] && existing.rows[0].sha256 === hash) {
    return existing.rows[0].id;
  }

  const version = (existing.rows[0]?.version || 0) + 1;
  const result = await db.query(
    `
    INSERT INTO artifacts (
      workspace_id,pipeline_run_id,stage_id,artifact_type,logical_key,
      version,status,content_json,content_text,uri,sha256,
      provider_id,model_id,metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,'active',$7::jsonb,$8,$9,$10,$11,$12,$13::jsonb)
    RETURNING id
    `,
    [
      job.workspace_id, pipelineId, stageId, artifactType, logicalKey,
      version,
      contentJson == null ? null : JSON.stringify(contentJson),
      contentText, uri, hash, job.provider_id, job.model_id,
      JSON.stringify({ ...metadata, factory_version: V2_VERSION })
    ]
  );

  await db.query(
    `
    INSERT INTO artifact_versions(artifact_id,version,sha256)
    VALUES($1,$2,$3)
    ON CONFLICT (artifact_id,version) DO NOTHING
    `,
    [result.rows[0].id, version, hash]
  );

  return result.rows[0].id;
}

async function completeStage(ctx, artifactId, output) {
  await db.query(
    `
    UPDATE stage_attempts
    SET status='completed', response_json=$2::jsonb, completed_at=now()
    WHERE id=$1
    `,
    [ctx.attemptId, JSON.stringify(output || {})]
  );
  await db.query(
    `
    UPDATE job_stages
    SET status='completed', output_artifact_id=$2, completed_at=now(), locked_at=NULL
    WHERE id=$1
    `,
    [ctx.stageId, artifactId]
  );
  await db.query(
    `
    UPDATE pipeline_runs
    SET status='running', current_stage=$2, output_data=output_data || $3::jsonb
    WHERE id=$1
    `,
    [ctx.pipelineId, ctx.stageKey, JSON.stringify(output || {})]
  );
}

async function recordStageFailure(ctx, error, retry) {
  const errorData = JSON.stringify({
    message: error.message,
    stack: error.stack
  });

  if (ctx?.attemptId) {
    await db.query(
      `UPDATE stage_attempts
       SET status='failed', error_data=$2::jsonb, completed_at=now()
       WHERE id=$1`,
      [ctx.attemptId, errorData]
    );
  }

  if (ctx?.stageId) {
    await db.query(
      `UPDATE job_stages
       SET status=$2, error_data=$3::jsonb, locked_at=NULL
       WHERE id=$1`,
      [ctx.stageId, retry ? "retrying" : "dead_letter", errorData]
    );
  }
}

async function continuitySnapshot(job, scriptId, sceneId, entityType, entityId, entityName, state) {
  const normalized = JSON.stringify(state || {});
  const hash = crypto.createHash("sha256").update(normalized).digest("hex");
  await db.query(
    `
    INSERT INTO continuity_snapshots
      (workspace_id,script_id,scene_id,entity_type,entity_id,entity_name,state_json,state_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
    ON CONFLICT DO NOTHING
    `,
    [job.workspace_id,scriptId,sceneId,entityType,entityId,entityName,normalized,hash]
  );
}

async function validateContinuity(job, scriptId) {
  const rows = await db.query(
    `
    SELECT
      sc.id AS scene_id,
      sc.scene_number,
      sc.location_id,
      l.name AS location_name,
      l.visual_description,
      c.id AS character_id,
      c.name AS character_name,
      c.appearance,
      c.wardrobe
    FROM scenes sc
    LEFT JOIN locations l
      ON l.id = sc.location_id
    LEFT JOIN character_appearances ca
      ON ca.scene_id = sc.id
    LEFT JOIN characters c
      ON c.id = ca.character_id
    WHERE sc.script_id = $1
    ORDER BY sc.scene_number
    `,
    [scriptId]
  );

  if (!rows.rows.length) {
    throw new Error(
      "Continuity validation: script has no scenes."
    );
  }

  const sceneNumbers = new Set();

  for (const r of rows.rows) {
    sceneNumbers.add(r.scene_number);

    /*
     * Every scene receives a continuity checkpoint.
     *
     * Characters and locations are optional. The scene itself
     * is always part of the continuity chain.
     */
    await continuitySnapshot(
      job,
      scriptId,
      r.scene_id,
      "scene",
      r.scene_id,
      `scene_${r.scene_number}`,
      {
        scene_number: r.scene_number,
        location_id: r.location_id || null,
        location_name: r.location_name || "",
        character_id: r.character_id || null,
        character_name: r.character_name || "",
        appearance: r.appearance || "",
        wardrobe: r.wardrobe || ""
      }
    );

    if (r.location_id) {
      await continuitySnapshot(
        job,
        scriptId,
        r.scene_id,
        "location",
        r.location_id,
        r.location_name || "",
        {
          name: r.location_name || "",
          visual_description: r.visual_description || ""
        }
      );
    }

    if (r.character_id) {
      await continuitySnapshot(
        job,
        scriptId,
        r.scene_id,
        "character",
        r.character_id,
        r.character_name || "",
        {
          name: r.character_name || "",
          appearance: r.appearance || "",
          wardrobe: r.wardrobe || ""
        }
      );
    }
  }

  return {
    scenes: sceneNumbers.size,
    snapshots: rows.rows.length
  };
}

async function claimJob() {
  const result = await db.query(
    `
    WITH candidate AS (
      SELECT id
      FROM generation_jobs
      WHERE status IN ('queued','retrying')
        AND attempts < max_attempts
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        AND ($1::uuid IS NULL OR id=$1::uuid)
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE generation_jobs g
    SET
      status='running',
      started_at=now(),
      completed_at=NULL,
      attempts=attempts+1,
      next_attempt_at=NULL
    FROM candidate
    WHERE g.id=candidate.id
    RETURNING g.*;
    `,
    [process.env.FACTORY_JOB_ID || null]
  );
  return result.rows[0] || null;
}


async function callNvidia(modelId, system, user) {
  console.log(`NVIDIA call: ${modelId}`);

  const response = await ai.chat.completions.create({
    model: modelId,

    messages: [
      {
        role: "system",
        content: system
      },
      {
        role: "user",
        content: user
      }
    ],

    temperature: 1,
    top_p: 0.95,

    max_tokens: 16384
  });

  const text =
    response.choices?.[0]?.message?.content || "";

  if (!text) {
    throw new Error("NVIDIA returned empty content.");
  }

  return text;
}


async function saveScript(job, parsed) {
  const conceptId = job.input_data.concept_id;

  // Idempotency: a retry of the same generation job must reuse its
  // already-created script rather than silently creating another version.
  const prior = await db.query(
    `SELECT id FROM scripts
     WHERE metadata->>\'source_generation_job_id\' = $1
     ORDER BY version DESC LIMIT 1`,
    [job.id]
  );
  if (prior.rows.length) {
    return prior.rows[0].id;
  }

  if (!conceptId) {
    throw new Error("script_generation job has no concept_id.");
  }

  const versionResult = await db.query(
    `
    SELECT COALESCE(MAX(version), 0) + 1 AS next_version
    FROM scripts
    WHERE concept_id = $1
    `,
    [conceptId]
  );

  const version = Number(versionResult.rows[0].next_version);

  const scriptResult = await db.query(
    `
    INSERT INTO scripts (
      concept_id,
      version,
      title,
      script_text,
      duration_seconds,
      language,
      status,
      metadata
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,'draft',$7::jsonb
    )
    RETURNING id
    `,
    [
      conceptId,
      version,
      parsed.title,
      JSON.stringify(parsed),
      parsed.duration_seconds || null,
      parsed.language || "en",
      JSON.stringify({
        source_generation_job_id: job.id,
        factory_version: "2.0"
      })
    ]
  );

  const scriptId = scriptResult.rows[0].id;

  for (const scene of parsed.scenes) {
    await db.query(
      `
      INSERT INTO scenes (
        script_id,
        scene_number,
        title,
        duration_seconds,
        action,
        dialogue,
        voiceover,
        visual_prompt,
        metadata
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb
      )
      `,
      [
        scriptId,
        scene.scene_number,
        `Scene ${scene.scene_number}`,
        scene.duration_seconds,
        scene.action || "",
        scene.dialogue || "",
        scene.voiceover || "",
        scene.visual || "",
        JSON.stringify({
          on_screen_text: scene.on_screen_text || "",
          source_generation_job_id: job.id
        })
      ]
    );
  }

  await db.query(
    `
    UPDATE generation_jobs
    SET output_data =
      output_data || $2::jsonb
    WHERE id = $1
    `,
    [
      job.id,
      JSON.stringify({
        script_id: scriptId
      })
    ]
  );

  console.log(`Saved script: ${parsed.title}`);
  console.log(`Saved ${parsed.scenes.length} scenes.`);

  return scriptId;
}


async function generateScript(job, modelId) {
  const conceptId = job.input_data.concept_id;

  const conceptResult = await db.query(
    `
    SELECT *
    FROM creative_concepts
    WHERE id = $1
    `,
    [conceptId]
  );

  if (!conceptResult.rows.length) {
    throw new Error(`Creative concept ${conceptId} not found.`);
  }

  const concept = conceptResult.rows[0];

  const system = `
You are the Script Director of a professional advertising Content Factory.

Create a production-ready short-form advertisement script.

Return JSON only.

The approved creative concept is the source of truth.

Do not invent a different product.
Do not change the core message.
Do not change the CTA.

The output must contain:

{
  "title": "...",
  "duration_seconds": 15,
  "hook": "...",
  "language": "en",
  "scenes": [
    {
      "scene_number": 1,
      "duration_seconds": 5,
      "visual": "...",
      "action": "...",
      "dialogue": "...",
      "voiceover": "...",
      "on_screen_text": "..."
    }
  ],
  "cta": "..."
}

Make the advertisement emotionally clear, visually producible and suitable for TikTok/Reels/Shorts.
`;

  const user = JSON.stringify({
    creative_concept: concept
  }, null, 2);

  const raw = await callNvidia(modelId, system, user);

  const parsed = extractJson(raw);

  validateScript(parsed);

  console.log("Script validated.");

  return parsed;
}


async function generateProductionPlan(
  job,
  scriptId,
  script,
  modelId
) {
  console.log("Creating Production Bible...");

  const system = `
You are the Production Director of a professional AI advertising studio.

You receive an approved script.

Your job is NOT to rewrite the story.

The script is immutable source-of-truth.

Create a Production Bible containing:

1. recurring characters
2. recurring locations
3. visual identity
4. continuity rules
5. scene plans
6. shot strategy

Return JSON only.

For every scene preserve:
- scene number
- dialogue
- voiceover
- on-screen text
- story action

You may determine:
- camera
- framing
- lighting
- lens feeling
- composition
- motion
- continuity
- visual production requirements

Never rewrite dialogue or voiceover.
`;

  const raw = await callNvidia(
    modelId,
    system,
    JSON.stringify({
      script
    }, null, 2)
  );


  const plan = extractJson(raw);

  /*
   * The approved script is immutable.
   * Never allow the AI response to remove the scene structure.
   *
   * Nemotron may occasionally omit scene_plans even when explicitly
   * requested. In that case construct the scene-plan skeleton from
   * the source script deterministically.
   */

  if (!Array.isArray(plan.scene_plans)) {
    console.log(
      "Production Planner omitted scene_plans; constructing deterministic scene plans from script."
    );

    plan.scene_plans = [];
  }

  const existingPlans = new Map();

  for (const scenePlan of plan.scene_plans) {
    if (
      scenePlan &&
      Number.isInteger(scenePlan.scene_number)
    ) {
      existingPlans.set(scenePlan.scene_number, scenePlan);
    }
  }

  plan.scene_plans = script.scenes.map((scene) => {
    const existing = existingPlans.get(scene.scene_number) || {};

    return {
      scene_number: scene.scene_number,

      dialogue: scene.dialogue || "",
      voiceover: scene.voiceover || "",
      on_screen_text: scene.on_screen_text || "",
      story_action: scene.action || "",

      visual: existing.visual || scene.visual || "",
      camera: existing.camera || "",
      framing: existing.framing || "",
      lighting: existing.lighting || "",
      composition: existing.composition || "",
      motion: existing.motion || "",
      continuity: existing.continuity || "",

      production_requirements:
        Array.isArray(existing.production_requirements)
          ? existing.production_requirements
          : []
    };
  });

  if (!Array.isArray(plan.characters)) {
    plan.characters = [];
  }

  if (!Array.isArray(plan.locations)) {
    plan.locations = [];
  }

  if (
    !plan.visual_identity ||
    typeof plan.visual_identity !== "object" ||
    Array.isArray(plan.visual_identity)
  ) {
    plan.visual_identity = {};
  }

  if (!Array.isArray(plan.continuity_rules)) {
    plan.continuity_rules = [];
  }

  if (
    !plan.shot_strategy ||
    typeof plan.shot_strategy !== "object" ||
    Array.isArray(plan.shot_strategy)
  ) {
    plan.shot_strategy = {
      default_shot_duration_seconds: 3,
      coverage: "",
      camera_motion: "",
      transition_style: ""
    };
  }

  validateProductionPlan(plan, script);

  return plan;
}


async function persistProductionPlan(
  job,
  scriptId,
  script,
  plan
) {
  const workspaceId = job.workspace_id;

  const characterIds = {};
  const locationIds = {};

  for (const character of plan.characters) {
    const existing = await db.query(
      `
      SELECT id
      FROM characters
      WHERE workspace_id = $1
        AND name = $2
      LIMIT 1
      `,
      [workspaceId, character.name]
    );

    let id;

    if (existing.rows.length) {
      id = existing.rows[0].id;

      await db.query(
        `
        UPDATE characters
        SET
          description = $3,
          gender = $4,
          age_range = $5,
          appearance = $6::jsonb,
          personality = $7::jsonb,
          wardrobe = $8::jsonb,
          voice_profile = $9::jsonb
        WHERE id = $1
          AND workspace_id = $2
        `,
        [
          id,
          workspaceId,
          character.description || "",
          character.gender || "",
          character.age_range || "",
          JSON.stringify(character.appearance || {}),
          JSON.stringify(character.personality || {}),
          JSON.stringify(character.wardrobe || {}),
          JSON.stringify(character.voice_profile || {})
        ]
      );
    } else {
      const inserted = await db.query(
        `
        INSERT INTO characters (
          workspace_id,
          name,
          description,
          gender,
          age_range,
          appearance,
          personality,
          wardrobe,
          voice_profile,
          metadata
        )
        VALUES (
          $1,$2,$3,$4,$5,
          $6::jsonb,$7::jsonb,$8::jsonb,
          $9::jsonb,$10::jsonb
        )
        RETURNING id
        `,
        [
          workspaceId,
          character.name,
          character.description || "",
          character.gender || "",
          character.age_range || "",
          JSON.stringify(character.appearance || {}),
          JSON.stringify(character.personality || {}),
          JSON.stringify(character.wardrobe || {}),
          JSON.stringify(character.voice_profile || {}),
          JSON.stringify({
            source_generation_job_id: job.id
          })
        ]
      );

      id = inserted.rows[0].id;
    }

    characterIds[character.name] = id;
  }


  for (const location of plan.locations) {
    const existing = await db.query(
      `
      SELECT id
      FROM locations
      WHERE workspace_id = $1
        AND name = $2
      LIMIT 1
      `,
      [workspaceId, location.name]
    );

    let id;

    if (existing.rows.length) {
      id = existing.rows[0].id;

      await db.query(
        `
        UPDATE locations
        SET
          description = $3,
          visual_description = $4
        WHERE id = $1
          AND workspace_id = $2
        `,
        [
          id,
          workspaceId,
          location.description || "",
          location.visual_description || ""
        ]
      );
    } else {
      const inserted = await db.query(
        `
        INSERT INTO locations (
          workspace_id,
          name,
          description,
          visual_description,
          metadata
        )
        VALUES ($1,$2,$3,$4,$5::jsonb)
        RETURNING id
        `,
        [
          workspaceId,
          location.name,
          location.description || "",
          location.visual_description || "",
          JSON.stringify({
            source_generation_job_id: job.id
          })
        ]
      );

      id = inserted.rows[0].id;
    }

    locationIds[location.name] = id;
  }


  for (const scenePlan of plan.scene_plans) {
    const scene = script.scenes[
      scenePlan.scene_number - 1
    ];

    const sceneResult = await db.query(
      `
      SELECT id
      FROM scenes
      WHERE script_id = $1
        AND scene_number = $2
      `,
      [
        scriptId,
        scenePlan.scene_number
      ]
    );

    if (!sceneResult.rows.length) {
      throw new Error(
        `Scene ${scenePlan.scene_number} missing.`
      );
    }

    const sceneId = sceneResult.rows[0].id;

    await db.query(
      `
      UPDATE scenes
      SET
        location_id = $2,
        visual_prompt = $3,
        camera_prompt = $4,
        lighting_prompt = $5,
        audio_prompt = $6,
        metadata = metadata || $7::jsonb
      WHERE id = $1
      `,
      [
        sceneId,
        locationIds[scenePlan.location] || null,
        scenePlan.visual_prompt || scene.visual || "",
        scenePlan.camera_prompt || "",
        scenePlan.lighting_prompt || "",
        scene.audio_prompt || "",
        JSON.stringify({
          production_plan_source: job.id
        })
      ]
    );


    for (const characterName of scenePlan.characters || []) {
      const characterId = characterIds[characterName];

      if (!characterId) {
        throw new Error(
          `Character ${characterName} not found.`
        );
      }

      await db.query(
        `
        INSERT INTO character_appearances (
          scene_id,
          character_id,
          action,
          dialogue,
          metadata
        )
        VALUES ($1,$2,$3,$4,$5::jsonb)
        ON CONFLICT (scene_id, character_id)
        DO UPDATE SET
          action = EXCLUDED.action,
          dialogue = EXCLUDED.dialogue,
          metadata = EXCLUDED.metadata
        `,
        [
          sceneId,
          characterId,
          scene.action || "",
          scene.dialogue || "",
          JSON.stringify({
            source_generation_job_id: job.id
          })
        ]
      );
    }
  }

  await db.query(
    `
    UPDATE generation_jobs
    SET output_data =
      output_data || $2::jsonb
    WHERE id = $1
    `,
    [
      job.id,
      JSON.stringify({
        production_plan: plan
      })
    ]
  );

  console.log(
    `Production Bible persisted: ` +
    `${plan.characters.length} characters, ` +
    `${plan.locations.length} locations.`
  );
}


async function createShots(job, scriptId, script) {
  console.log("Creating shot list...");

  for (const scene of script.scenes) {
    const sceneResult = await db.query(
      `
      SELECT id
      FROM scenes
      WHERE script_id = $1
        AND scene_number = $2
      `,
      [scriptId, scene.scene_number]
    );

    if (!sceneResult.rows.length) {
      throw new Error(
        `Scene ${scene.scene_number} not found.`
      );
    }

    const sceneId = sceneResult.rows[0].id;

    /*
     * Initial deterministic shot decomposition.
     *
     * This deliberately does not ask the AI to rewrite
     * dialogue or story content.
     */

    const duration = Number(scene.duration_seconds || 5);

    const shotCount =
      duration >= 8 ? 3 :
      duration >= 5 ? 2 :
      1;

    const shotDuration = duration / shotCount;

    for (let i = 1; i <= shotCount; i++) {
      const shotType =
        shotCount === 1 ? "master" :
        i === 1 ? "establishing" :
        i === shotCount ? "reaction" :
        "medium";

      await db.query(
        `
        INSERT INTO shots (
          script_id,
          scene_id,
          shot_number,
          shot_type,
          purpose,
          duration_seconds,
          characters,
          action,
          dialogue,
          voiceover,
          visual_prompt,
          camera_prompt,
          lighting_prompt,
          motion_prompt,
          audio_prompt,
          continuity,
          metadata
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,
          $7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,
          $16::jsonb,$17::jsonb
        )
        ON CONFLICT (scene_id, shot_number)
        DO UPDATE SET
          shot_type = EXCLUDED.shot_type,
          purpose = EXCLUDED.purpose,
          duration_seconds = EXCLUDED.duration_seconds,
          action = EXCLUDED.action,
          dialogue = EXCLUDED.dialogue,
          voiceover = EXCLUDED.voiceover,
          visual_prompt = EXCLUDED.visual_prompt,
          camera_prompt = EXCLUDED.camera_prompt,
          lighting_prompt = EXCLUDED.lighting_prompt,
          motion_prompt = EXCLUDED.motion_prompt,
          audio_prompt = EXCLUDED.audio_prompt,
          continuity = EXCLUDED.continuity,
          metadata = EXCLUDED.metadata
        `,
        [
          scriptId,
          sceneId,
          i,
          shotType,
          `Shot ${i} of scene ${scene.scene_number}`,
          shotDuration,
          JSON.stringify([]),
          scene.action || "",
          scene.dialogue || "",
          scene.voiceover || "",
          scene.visual || "",
          "",
          "",
          "",
          "",
          JSON.stringify({
            same_scene: true,
            preserve_characters: true
          }),
          JSON.stringify({
            source_generation_job_id: job.id
          })
        ]
      );
    }
  }

  console.log("Shot list created.");
}


async function createAssetRequirements(
  job,
  scriptId
) {
  console.log("Creating generation requirements...");

  const scenes = await db.query(
    `
    SELECT
      sc.id AS scene_id,
      sc.location_id,
      sc.dialogue,
      sc.voiceover,
      sc.metadata,
      sh.id AS shot_id,
      sh.visual_prompt,
      sh.duration_seconds
    FROM scenes sc
    JOIN shots sh ON sh.scene_id = sc.id
    WHERE sc.script_id = $1
    ORDER BY sc.scene_number, sh.shot_number
    `,
    [scriptId]
  );

  for (const row of scenes.rows) {

    await db.query(
      `
      INSERT INTO asset_requirements (
        workspace_id,
        script_id,
        scene_id,
        shot_id,
        asset_type,
        location_id,
        status,
        idempotency_key,
        prompt,
        input_data
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::uuid,
        'video_shot',
        $5::uuid,
        'planned',
        'video:' || $4::text,
        $6,
        $7::jsonb
      )
      `,
      [
        job.workspace_id,
        scriptId,
        row.scene_id,
        row.shot_id,
        row.location_id,
        row.visual_prompt || "",
        JSON.stringify({
          duration_seconds: row.duration_seconds,
          dialogue: row.dialogue || "",
          voiceover: row.voiceover || ""
        })
      ]
    );


    if (row.dialogue || row.voiceover) {
      await db.query(
        `
        INSERT INTO asset_requirements (
          workspace_id,
          script_id,
          scene_id,
          shot_id,
          asset_type,
          status,
          idempotency_key,
          prompt,
          input_data
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          'voice',
          'planned',
          'voice:' || $4::text,
          $5,
          $6::jsonb
        )
        `,
        [
          job.workspace_id,
          scriptId,
          row.scene_id,
          row.shot_id,
          row.dialogue || row.voiceover || "",
          JSON.stringify({
            dialogue: row.dialogue || "",
            voiceover: row.voiceover || ""
          })
        ]
      );
    }
  }

  /*
   * Character reference requirements.
   */

  const characters = await db.query(
    `
    SELECT DISTINCT
      c.id,
      c.name,
      c.description,
      c.appearance,
      c.wardrobe
    FROM characters c
    JOIN character_appearances ca
      ON ca.character_id = c.id
    JOIN scenes sc
      ON sc.id = ca.scene_id
    WHERE sc.script_id = $1
    `,
    [scriptId]
  );

  for (const character of characters.rows) {
    await db.query(
      `
      INSERT INTO asset_requirements (
        workspace_id,
        script_id,
        character_id,
        asset_type,
        status,
        idempotency_key,
        prompt,
        input_data
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        'character_reference',
        'planned',
        'character_reference:' || $3::text,
        $4,
        $5::jsonb
      )
      `,
      [
        job.workspace_id,
        scriptId,
        character.id,
        `${character.description || ""}. Appearance: ${JSON.stringify(character.appearance || {})}. Wardrobe: ${JSON.stringify(character.wardrobe || {})}`,
        JSON.stringify({
          character_name: character.name
        })
      ]
    );
  }


  /*
   * Location reference requirements.
   */

  const locations = await db.query(
    `
    SELECT DISTINCT
      l.id,
      l.name,
      l.description,
      l.visual_description
    FROM locations l
    JOIN scenes sc
      ON sc.location_id = l.id
    WHERE sc.script_id = $1
    `,
    [scriptId]
  );

  for (const location of locations.rows) {
    await db.query(
      `
      INSERT INTO asset_requirements (
        workspace_id,
        script_id,
        location_id,
        asset_type,
        status,
        idempotency_key,
        prompt,
        input_data
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        'location_reference',
        'planned',
        'location_reference:' || $3::text,
        $4,
        $5::jsonb
      )
      `,
      [
        job.workspace_id,
        scriptId,
        location.id,
        `${location.description || ""}. ${location.visual_description || ""}`,
        JSON.stringify({
          location_name: location.name
        })
      ]
    );
  }

  console.log("Generation requirements created.");
}


async function createPipelineRun(job, scriptId) {
  const result = await db.query(
    `
    INSERT INTO pipeline_runs (
      workspace_id,
      source_job_id,
      status,
      current_stage,
      input_data
    )
    VALUES (
      $1,$2,'running','production_bible',$3::jsonb
    )
    RETURNING id
    `,
    [
      job.workspace_id,
      job.id,
      JSON.stringify({
        script_id: scriptId,
        factory_version: "2.0"
      })
    ]
  );

  return result.rows[0].id;
}


async function processScriptGeneration(job) {
  const modelId = await resolveModel(job);

  const parsed = await generateScript(
    job,
    modelId
  );

  const scriptId = await saveScript(
    job,
    parsed
  );

  /*
   * The script is now draft.
   * Production planning follows automatically.
   */

  await db.query(
    `
    INSERT INTO generation_jobs (
      workspace_id,
      provider_id,
      model_id,
      job_type,
      status,
      input_data
    )
    VALUES (
      $1,
      $2,
      $3,
      'production_planning',
      'queued',
      $4::jsonb
    )
    `,
    [
      job.workspace_id,
      job.provider_id,
      job.model_id,
      JSON.stringify({
        script_id: scriptId,
        source_job_id: job.id
      })
    ]
  );

  return {
    script_id: scriptId,
    next_stage: "production_planning"
  };
}


async function processProductionPlanning(job) {
  const modelId = await resolveModel(job);

  const scriptId = job.input_data.script_id;

  const result = await db.query(
    `
    SELECT *
    FROM scripts
    WHERE id = $1
    `,
    [scriptId]
  );

  if (!result.rows.length) {
    throw new Error(
      `Script ${scriptId} not found.`
    );
  }

  const scriptRow = result.rows[0];

  const scenes = await db.query(
    `
    SELECT *
    FROM scenes
    WHERE script_id = $1
    ORDER BY scene_number
    `,
    [scriptId]
  );

  const script = {
    title: scriptRow.title,
    duration_seconds:
      scriptRow.duration_seconds,
    scenes: scenes.rows.map(row => ({
      scene_number: row.scene_number,
      duration_seconds: row.duration_seconds,
      action: row.action,
      dialogue: row.dialogue,
      voiceover: row.voiceover,
      visual: row.visual_prompt,
      on_screen_text:
        row.metadata?.on_screen_text || ""
    }))
  };

  const plan = await generateProductionPlan(
    job,
    scriptId,
    script,
    modelId
  );

  await persistProductionPlan(
    job,
    scriptId,
    script,
    plan
  );

  await createShots(
    job,
    scriptId,
    script
  );

  await createAssetRequirements(
    job,
    scriptId
  );

  const continuity = await validateContinuity(job, scriptId);
  if (!continuity.scenes) throw new Error("Continuity validation produced no scenes.");

  const pipelineId =
    await createPipelineRun(
      job,
      scriptId
    );

  /*
   * The text/planning factory is now complete.
   *
   * Actual image/video/voice generation is provider
   * specific and consumes asset_requirements.
   */

  await db.query(
    `
    UPDATE pipeline_runs
    SET
      status = 'waiting_approval',
      current_stage = 'asset_generation',
      output_data = output_data || $2::jsonb
    WHERE id = $1
    `,
    [
      pipelineId,
      JSON.stringify({
        script_id: scriptId,
        continuity: {
          scenes: continuity.scenes,
          snapshots: continuity.snapshots
        },
        message:
          "Production package ready for asset generation."
      })
    ]
  );

  return {
    script_id: scriptId,
    pipeline_run_id: pipelineId,
    next_stage: "asset_generation"
  };
}


async function processJob(job) {
  console.log(`Processing ${job.job_type}: ${job.id}`);

  const ctx = await ensurePipelineStage(job);
  let output;
  let artifactId;

  try {
    switch (job.job_type) {
      case "script_generation":
        output = await processScriptGeneration(job);
        if (!output?.script_id) throw new Error("Script stage returned no script_id.");

        const scriptResult = await db.query(
          `SELECT id,title,script_text,duration_seconds,language,version
           FROM scripts WHERE id=$1`, [output.script_id]
        );
        if (!scriptResult.rows.length) throw new Error("Script artifact was not persisted.");

        artifactId = await createArtifact({
          job, stageId:ctx.stageId, pipelineId:ctx.pipelineId,
          artifactType:"script",
          logicalKey:`script:${output.script_id}`,
          contentJson: {
            script_id: output.script_id,
            title: scriptResult.rows[0].title,
            duration_seconds: scriptResult.rows[0].duration_seconds,
            language: scriptResult.rows[0].language,
            version: scriptResult.rows[0].version,
            script: JSON.parse(scriptResult.rows[0].script_text)
          },
          metadata:{source_job_id:job.id}
        });
        await recordValidation(ctx.stageId, artifactId, "script_schema", "passed", [], 1);
        break;

      case "production_planning":
        output = await processProductionPlanning(job);
        if (!output?.script_id || !output?.pipeline_run_id) {
          throw new Error("Production stage returned incomplete output.");
        }

        const shotCheck = await db.query(
          `SELECT COUNT(*)::int AS count FROM shots WHERE script_id=$1`,
          [output.script_id]
        );
        if (shotCheck.rows[0].count < 1) {
          throw new Error("Shot planning produced no shots.");
        }

        const plan = await db.query(
          `SELECT jsonb_agg(jsonb_build_object(
             'scene_id',scene_id,'shot_number',shot_number,'shot_type',shot_type,
             'duration_seconds',duration_seconds,'visual_prompt',visual_prompt,
             'camera_prompt',camera_prompt,'lighting_prompt',lighting_prompt,
             'motion_prompt',motion_prompt,'audio_prompt',audio_prompt,
             'continuity',continuity
           ) ORDER BY scene_id,shot_number) AS shots
           FROM shots WHERE script_id=$1`, [output.script_id]
        );

        artifactId = await createArtifact({
          job, stageId:ctx.stageId, pipelineId:ctx.pipelineId,
          artifactType:"shot_plan",
          logicalKey:`shot-plan:${output.script_id}`,
          contentJson:{script_id:output.script_id, shots:plan.rows[0].shots || []},
          metadata:{source_job_id:job.id}
        });
        await recordValidation(ctx.stageId, artifactId, "shot_plan", "passed", [], 1);
        await recordValidation(ctx.stageId, artifactId, "continuity", "passed", [], 1);
        break;

      default:
        throw new Error(`Unsupported job type: ${job.job_type}`);
    }

    await completeStage(ctx, artifactId, output);

    await db.query(
      `
      UPDATE generation_jobs
      SET status='completed',
          output_data=output_data || $2::jsonb,
          completed_at=now()
      WHERE id=$1
      `,
      [job.id, JSON.stringify({...output, artifact_id:artifactId, factory_version:V2_VERSION})]
    );

    console.log(`Completed V2 stage ${ctx.stageKey}: ${job.id}`);
  } catch (error) {
    await failJob(job, error, ctx);
    throw error;
  }
}

async function failJob(job, error, ctx) {
  const retry = job.attempts < job.max_attempts;
  const delaySeconds = Math.min(300, Math.pow(2, Math.max(0, job.attempts - 1)) * 10);

  await recordStageFailure(ctx, error, retry);

  if (retry) {
    await db.query(
      `
      UPDATE generation_jobs
      SET status='retrying',
          next_attempt_at=now() + ($2 * interval '1 second'),
          error_data=$3::jsonb
      WHERE id=$1
      `,
      [job.id, delaySeconds, JSON.stringify({
        message:error.message, stack:error.stack,
        retry_in_seconds:delaySeconds
      })]
    );
    return;
  }

  await db.query(
    `
    UPDATE generation_jobs
    SET status='dead_letter', completed_at=now(),
        error_data=$2::jsonb
    WHERE id=$1
    `,
    [job.id, JSON.stringify({message:error.message, stack:error.stack})]
  );

  await db.query(
    `
    UPDATE pipeline_runs
    SET status='dead_letter', error_data=$2::jsonb, completed_at=now()
    WHERE id=$1
    `,
    [ctx.pipelineId, JSON.stringify({message:error.message, stack:error.stack})]
  );

  await db.query(
    `
    INSERT INTO dead_letter_jobs
      (pipeline_run_id,stage_id,source_job_id,reason,payload,attempts)
    VALUES($1,$2,$3,$4,$5::jsonb,$6)
    ON CONFLICT DO NOTHING
    `,
    [
      ctx.pipelineId, ctx.stageId, job.id, error.message,
      JSON.stringify({job, stage:ctx.stageKey}),
      job.attempts
    ]
  );
}


async function main() {
  await db.connect();

  console.log("======================================");
  console.log("CONTENT FACTORY WORKER V2");
  console.log("======================================");

  const job = await claimJob();

  if (!job) {
    console.log("No queued jobs.");
    await db.end();
    return;
  }

  try {
    await processJob(job);
  } catch (error) {
    console.error("FACTORY ERROR:", error);
    await failJob(job, error);
  }

  await db.end();
}


main().catch(error => {
  console.error("FATAL:", error);
  process.exit(1);
});
