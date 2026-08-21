'use strict';

class MultiBrainRouter {
  constructor({ brains = {}, routes = {} } = {}) { this.brains = new Map(Object.entries(brains)); this.routes = new Map(Object.entries(routes)); }
  registerBrain(id, brain) { if (!id || !brain || typeof brain.generate !== 'function') throw new TypeError('invalid brain'); this.brains.set(id, brain); }
  route(stage, request) {
    const config = this.routes.get(stage);
    if (!config) throw new Error(`stage not routed: ${stage}`);
    const brain = this.brains.get(config.brain_id);
    if (!brain) throw new Error(`brain not registered: ${config.brain_id}`);
    return brain.generate(request);
  }
}

module.exports = { MultiBrainRouter };
