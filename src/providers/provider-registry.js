/**
 * Provider Registry
 * 
 * Registry for managing and selecting media providers
 */

class ProviderRegistry {
  constructor() {
    this.providers = new Map();
  }

  /**
   * Register a provider
   * @param {string} name - Provider name
   * @param {Object} provider - Provider instance
   */
  register(name, provider) {
    this.providers.set(name, provider);
    console.log(`[ProviderRegistry] Registered provider: ${name}`);
  }

  /**
   * Get a provider by name
   * @param {string} name - Provider name
   * @returns {Object} - Provider instance
   */
  get(name) {
    const provider = this.providers.get(name);
    
    if (!provider) {
      const available = Array.from(this.providers.keys()).join(', ');
      throw new Error(`Provider '${name}' is not registered. Available providers: ${available || 'none'}`);
    }
    
    return provider;
  }

  /**
   * Select a provider by name (alias for get)
   * @param {string} name - Provider name
   * @returns {Object} - Provider instance
   */
  select(name) {
    return this.get(name);
  }

  /**
   * List all registered providers
   * @returns {Array<string>} - Provider names
   */
  list() {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a provider is registered
   * @param {string} name - Provider name
   * @returns {boolean} - True if registered
   */
  has(name) {
    return this.providers.has(name);
  }
}

module.exports = { ProviderRegistry };
