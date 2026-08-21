/**
 * Provider Gateway
 * 
 * Unified interface for interacting with different media providers
 * (NVIDIA, and future providers)
 */

const { ProviderRegistry } = require('./provider-registry');

class ProviderGateway {
  /**
   * @param {ProviderRegistry} registry - Optional registry instance (for testing)
   */
  constructor(registry = null) {
    this.registry = registry || new ProviderRegistry();
  }

  /**
   * Select a provider by name
   * @param {string} providerName - Provider name
   * @returns {Object} - Provider instance
   */
  select(providerName) {
    return this.registry.select(providerName);
  }

  /**
   * Generate content using a specific provider
   * @param {Object} options - Generation options
   * @param {string} options.provider - Provider name
   * @param {string} options.type - Content type (text, audio, image)
   * @param {Object} options.input - Input data
   * @returns {Promise<Object>} - Generated content
   */
  async generate(options) {
    const { provider, type, input } = options;
    
    const providerInstance = this.select(provider);
    
    return providerInstance.generate({
      type,
      input
    });
  }

  /**
   * Register a provider (convenience method)
   * @param {string} name - Provider name
   * @param {Object} provider - Provider instance
   */
  register(name, provider) {
    this.registry.register(name, provider);
  }
}

module.exports = { ProviderGateway };
