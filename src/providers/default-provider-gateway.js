'use strict';

const { ProviderGateway } = require('./provider-gateway');
const { createNvidiaProvider } = require('./nvidia-provider');

function createDefaultProviderGateway({
  nvidia = {},
  priorities = { nvidia: 10 },
  routing = {},
} = {}) {
  return new ProviderGateway({
    providers: {
      nvidia: createNvidiaProvider(nvidia),
    },
    priorities,
    routing,
  });
}

module.exports = { createDefaultProviderGateway };
