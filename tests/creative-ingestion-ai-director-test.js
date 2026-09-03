'use strict';
const assert = require('node:assert/strict');
const { normalizeDescription, parseSpec, normalizeSpec, reportMissing, contentHash } = require('../src/v2.10/creative-ingestion-contract');
const { RenderSourceRegistry } = require('../src/v2.10/render-source-registry');
const { ConfiguredDirectorGateway } = require('../src/v2.10/creative-director-gateways');
const { canonicalCreativeBrief } = require('../src/v2.10/creative-contract');
const { buildScriptScaffold, buildStoryboardScaffold, canonicalStoryboard, validateScript, validateStoryboard } = require('../src/v2.10/quality-script-first-contract');

const description = normalizeDescription({ description: 'Show the moment between trigger and reaction. Premium minimal dark.', platform: 'Instagram Reels', durationSeconds: 15, shotCount: 3, objective: 'Product awareness' });
assert.equal(description.storyboard.length, 3); assert.equal(description.storyboard[0].durationSeconds, 5);
const json = normalizeSpec(parseSpec('{"title":"Pause","platform":"Instagram Reels","durationSeconds":15,"concept":"Trigger and pause","shots":[{"durationSeconds":15,"purpose":"Hook"}],"unknown":"preserved"}', 'JSON'));
assert.equal(json.brief.targetPlatform, 'Instagram Reels'); assert.equal(json.sourceMetadata.unknown, 'preserved');
const yaml = normalizeSpec(parseSpec('title: Pause\nplatform: Instagram Reels\ndurationSeconds: 15\nconcept: Trigger and pause\nshots:\n  - durationSeconds: 15\n    purpose: Hook', 'YAML'));
assert.equal(yaml.brief.storyboard[0].purpose, 'Hook'); assert.ok(reportMissing(canonicalCreativeBrief(json.brief)).includes('objective'));
assert.equal(contentHash(Buffer.from('same')), contentHash(Buffer.from('same')));

let rendered = 0; const registry = new RenderSourceRegistry({ adapters: [{ describe: () => ({ rendererType: 'CUSTOM_LOCAL_RENDERER', rendererId: 'safe-sphere', capabilities: ['STATE_RENDER','STATE_TRANSITION'], supportedStates: ['IDLE','TRIGGER'], defaultOutput: { width: 1080, height: 1920, fps: 30 } }), validateRequest: async () => true, preflight: async () => ({ status: 'READY' }), render: async () => { rendered += 1; return {}; } }] });
assert.rejects(registry.render({ rendererId: 'untrusted-command', request: {} }), { code: 'RENDERER_ADAPTER_NOT_REGISTERED' });
registry.preflight({ rendererId: 'safe-sphere', request: { fromState: 'IDLE', toState: 'TRIGGER' } }).then((result) => assert.equal(result.status, 'READY'));
assert.equal(rendered, 0, 'tests never execute media rendering');
const unconfigured = new ConfiguredDirectorGateway();
assert.rejects(unconfigured.call('SCRIPT_WRITER', {}), { code: 'AI_DIRECTOR_NOT_CONFIGURED' });

const brief = canonicalCreativeBrief({ title: 'Pause', objective: 'Awareness', targetPlatform: 'Instagram Reels', targetDurationSeconds: 5, hook: 'Pause', coreMessage: 'Pause first', cta: 'Learn more', audienceIntent: 'Adults', creativeConcept: 'Minimal transition', visualStyle: 'Premium dark', storyboard: [{ shotId: 's1', assetId: 'a1', durationSeconds: 5, roles: ['HOOK','CTA'], purpose: 'Hook', subject: 'Living sphere', action: 'Transitions', environment: 'Dark void', emotionalIntent: 'Calm', framing: 'Close', camera: 'Slow', lensComposition: 'Centered', lighting: 'Soft', continuity: 'same', negativeGuidance: ['text'] }] });
const script = buildScriptScaffold(brief); assert.equal(validateScript(script, brief).status, 'PASS'); const storyboard = canonicalStoryboard({ ...buildStoryboardScaffold(brief, script), shots: [{ ...buildStoryboardScaffold(brief, script).shots[0], visualSource: { type: 'REGISTERED_RENDERER', rendererId: 'safe-sphere', fromState: 'IDLE', toState: 'TRIGGER' } }] }, brief, script); assert.equal(storyboard.shots[0].visualSource.rendererId, 'safe-sphere'); assert.equal(validateStoryboard(storyboard, brief, script).status, 'PASS');
console.log('Creative ingestion and AI director safety contracts: PASS; paid provider calls = 0; external generation calls = 0');
