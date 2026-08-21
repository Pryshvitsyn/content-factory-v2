'use strict';

class ProviderAdapter {
  constructor({ generate }) {
    if (typeof generate !== 'function') throw new TypeError('generate must be a function');
    this.generate = generate;
  }

  async generateStage({ stage, inputs, instructions }) {
    const result = await this.generate({ stage, inputs, instructions });
    if (result == null) throw new Error(`Provider returned empty result for ${stage}`);
    return result;
  }
}

function buildStageInstructions(stage) {
  const instructions = {
    INTENT: 'Extract the user objective, audience, constraints, success criteria, and explicit non-goals. Do not invent missing facts.',
    RESEARCH: 'Produce evidence-oriented research requirements and findings. Separate known facts, assumptions, and open questions. Do not present assumptions as facts.',
    BIBLE: 'Create the canonical content bible: audience, promise, tone, narrative rules, factual constraints, visual rules, continuity rules, and production constraints. Preserve upstream truth.'
  };
  if (!instructions[stage]) throw new Error(`Unsupported provider stage: ${stage}`);
  return instructions[stage];
}

module.exports = { ProviderAdapter, buildStageInstructions };
