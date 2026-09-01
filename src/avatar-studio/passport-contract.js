'use strict';

const PASSPORT_PANEL_COUNT = 3;
const PASSPORT_OUTPUT = Object.freeze({
  width: 1536,
  height: 1024,
  size: '1536x1024',
  panelCount: PASSPORT_PANEL_COUNT,
  canonicalPanelAspectRatio: 0.5,
  minimumPanelAspectRatio: 0.45,
  maximumPanelAspectRatio: 1.35,
});

module.exports = { PASSPORT_OUTPUT, PASSPORT_PANEL_COUNT };
