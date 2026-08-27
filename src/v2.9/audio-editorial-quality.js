'use strict';

const { REASON_CODES, combineResults, normalizeTier, qualityCheck, qualityResult } = require('./quality-contract');

class AudioQualityEvaluator {
  evaluate({ mediaResults = [], expectedDurationMs, speechExpected = true, qualityTier = 'STANDARD' } = {}) {
    const tier = normalizeTier(qualityTier);
    const speech = mediaResults.find((media) => media.kind === 'voice');
    const speechPresent = Boolean(speech) && speech.mediaProbe?.hasAudio !== false;
    const checks = [];
    checks.push(qualityCheck({ code: REASON_CODES.REQUIRED_AUDIO_MISSING,
      status: !speechExpected || speechPresent ? 'PASS' : 'FAIL', qualityClass: 'AUDIO_QUALITY',
      reason: !speechExpected || speechPresent ? 'Required speech media is present.' : 'Required speech media is missing.' }));
    const speechDurationMs = speech?.mediaProbe?.durationMs || speech?.temporal?.durationMs || 0;
    if (speechDurationMs && expectedDurationMs) {
      const deltaMs = speechDurationMs - expectedDurationMs;
      const cutoff = deltaMs > 1000;
      const mismatch = Math.abs(deltaMs) > 750;
      checks.push(qualityCheck({ code: cutoff ? REASON_CODES.VOICEOVER_CUTOFF : REASON_CODES.SPEECH_DURATION_MISMATCH,
        status: cutoff ? 'FAIL' : mismatch ? 'WARN' : 'PASS', qualityClass: 'AUDIO_QUALITY', hardFailure: cutoff,
        reason: cutoff ? 'Speech is longer than the master window and would be cut off.'
          : mismatch ? 'Speech duration differs materially from the planned master.' : 'Speech duration fits the planned master window.',
        evidence: { speechDurationMs, expectedDurationMs, deltaMs, toleranceMs: 750 } }));
    }
    checks.push(qualityCheck({ code: REASON_CODES.AUDIO_SEMANTIC_QA_NOT_CONFIGURED, status: 'WARN',
      qualityClass: 'AUDIO_QUALITY', hardFailure: false,
      reason: 'Speech intelligibility and distortion require a future configured semantic/audio evaluator; no synthetic pass was assigned.' }));
    return qualityResult({ qualityClass: 'AUDIO_QUALITY', tier, checks, metadata: { evaluator: 'v2.9-audio-deterministic', externalCalls: 0 } });
  }
}

class EditorialQualityEvaluator {
  evaluate({ timeline, shotPlan, script, qualityTier = 'STANDARD' } = {}) {
    const tier = normalizeTier(qualityTier); const clips = timeline?.clips || [];
    const visualClips = clips.filter((clip) => clip.track === 'video-main');
    const duplicateAssets = visualClips.filter((clip, index) => visualClips.findIndex((other) => other.assetId === clip.assetId) !== index);
    const ordered = [...visualClips].sort((a, b) => a.startMs - b.startMs);
    const deadTime = ordered.some((clip, index) => index > 0 && clip.startMs > ordered[index - 1].startMs + ordered[index - 1].durationMs + 50);
    const hookPresent = typeof script?.hook === 'string' && script.hook.trim().length > 0;
    const ctaPresent = typeof script?.cta === 'string' && script.cta.trim().length > 0;
    const checks = [
      qualityCheck({ code: REASON_CODES.DUPLICATE_SHOT_UNEXPECTED, status: duplicateAssets.length ? 'WARN' : 'PASS', qualityClass: 'EDITORIAL_QUALITY', hardFailure: false,
        reason: duplicateAssets.length ? 'The same generated visual asset is reused across multiple shots.' : 'No accidental duplicate generated shot asset was detected.',
        evidence: { assetIds: duplicateAssets.map((clip) => clip.assetId) } }),
      qualityCheck({ code: REASON_CODES.EDITORIAL_DEAD_TIME, status: deadTime ? 'FAIL' : 'PASS', qualityClass: 'EDITORIAL_QUALITY', hardFailure: false,
        reason: deadTime ? 'The planned visual timeline contains unexplained dead time.' : 'The planned visual timeline is contiguous.' }),
      qualityCheck({ code: 'HOOK_PLANNED_EARLY', status: hookPresent ? 'PASS' : 'FAIL', qualityClass: 'EDITORIAL_QUALITY', hardFailure: false,
        reason: hookPresent ? 'Canonical hook is present at the start of the spoken-copy plan.' : 'Canonical hook is missing.' }),
      qualityCheck({ code: 'CTA_PLANNED', status: ctaPresent ? 'PASS' : 'FAIL', qualityClass: 'EDITORIAL_QUALITY', hardFailure: false,
        reason: ctaPresent ? 'Canonical CTA is present in the editorial plan.' : 'Canonical CTA is missing.' }),
    ];
    return qualityResult({ qualityClass: 'EDITORIAL_QUALITY', tier, checks, metadata: { shotCount: shotPlan?.shots?.length || 0 } });
  }
}

function buildProductionQuality({ tier, preExecution, sourceQuality, audioQuality, editorialQuality,
  masterTechnical = null, finalQuality = null } = {}) {
  const results = [preExecution, sourceQuality, audioQuality, editorialQuality, masterTechnical, finalQuality].filter(Boolean);
  const sourceTechnicalFailed = (sourceQuality?.checks || []).some((check) => check.status === 'FAIL'
    && (check.qualityClass === 'SOURCE_TECHNICAL' || check.code === REASON_CODES.FRAME_CORRUPTION));
  const creativeStatuses = [sourceQuality?.semantic?.status, sourceQuality?.continuity?.status].filter(Boolean);
  const creativeStatus = creativeStatuses.includes('FAIL') ? 'FAIL' : creativeStatuses.includes('WARN') ? 'WARN'
    : creativeStatuses.length ? 'PASS' : 'NOT_STARTED';
  const combined = combineResults({ qualityClass: 'FINAL_MASTER_QUALITY', tier, results,
    metadata: { humanApprovalRequired: true, autoPublish: false } });
  return Object.freeze({ ...combined,
    readyForHumanReview: combined.status !== 'FAIL' && Boolean(masterTechnical) && Boolean(finalQuality),
    publicationAllowed: false,
    approvalStatus: combined.status === 'FAIL' ? 'BLOCKED' : 'AWAITING_HUMAN_APPROVAL',
    lifecycle: Object.freeze({
      preExecution: preExecution?.status || 'NOT_STARTED', providerGeneration: sourceQuality ? 'PASS' : 'NOT_STARTED',
      sourceTechnical: sourceTechnicalFailed ? 'FAIL' : sourceQuality ? 'PASS' : 'NOT_STARTED',
      sourceVisual: sourceQuality?.deterministicVisual?.status || sourceQuality?.status || 'NOT_STARTED',
      temporalQuality: sourceQuality?.temporal?.status || 'NOT_STARTED',
      creativeCompliance: creativeStatus,
      masterAssembly: masterTechnical ? 'PASS' : 'BLOCKED', masterTechnical: masterTechnical?.status || 'NOT_STARTED',
      finalQuality: finalQuality?.status || 'NOT_STARTED', audioQuality: audioQuality?.status || 'NOT_STARTED',
      editorialQuality: editorialQuality?.status || 'NOT_STARTED',
      humanReview: combined.status === 'FAIL' ? 'BLOCKED' : masterTechnical && finalQuality ? 'AWAITING' : 'BLOCKED',
    }),
  });
}

module.exports = { AudioQualityEvaluator, EditorialQualityEvaluator, buildProductionQuality };
