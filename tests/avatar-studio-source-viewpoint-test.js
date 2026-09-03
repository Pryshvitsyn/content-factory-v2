'use strict';

const assert = require('node:assert/strict');
const { effectiveViewpoint, viewpointSnapshot, viewpointSnapshotMatches } = require('../src/avatar-studio/source-viewpoint');

const source = { id: 'source-a', sourceType: 'IMAGE', gate0Status: 'PASS', provenance: { identityViewpoint: 'UNKNOWN' }, viewpointClassifications: [] };
assert.equal(effectiveViewpoint(source), 'UNKNOWN', 'existing evidence remains unknown without human action');
const original = JSON.stringify(source.provenance);
const frontal = { id: 'classification-1', viewpoint: 'FRONTAL', humanApproved: true };
const revised = { ...source, viewpointClassifications: [frontal] };
assert.equal(effectiveViewpoint(revised), 'FRONTAL');
assert.equal(JSON.stringify(source.provenance), original, 'original source provenance is immutable');
assert.equal(viewpointSnapshot([revised])[0].viewpoint, 'FRONTAL', 'coverage consumers receive the effective human classification');
const profile = { id: 'classification-2', viewpoint: 'PROFILE_LEFT', humanApproved: true };
const latest = { ...source, viewpointClassifications: [profile,frontal] };
assert.equal(effectiveViewpoint(latest), 'PROFILE_LEFT', 'later append-only classification wins');
const before = viewpointSnapshot([revised]);
assert.equal(viewpointSnapshotMatches(before,[revised]), true);
assert.equal(viewpointSnapshotMatches(before,[latest]), false, 'classification change invalidates Passport planning snapshot');
console.log('Avatar Studio human source viewpoint classification tests passed; provider calls = 0.');
