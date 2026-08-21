/**
 * Budget Governance
 * 
 * Tracks and manages video generation costs
 */

class BudgetGovernance {
  constructor() {
    this.budget = {
      daily: 100,
      monthly: 1000,
      spent: { daily: 0, monthly: 0 }
    };
  }

  async track(item) {
    const { type, cost, metadata } = item;
    
    console.log('[BudgetGovernance] Tracking cost:', { type, cost, metadata });
    
    this.budget.spent.daily += cost;
    this.budget.spent.monthly += cost;
    
    const withinBudget = 
      this.budget.spent.daily <= this.budget.daily &&
      this.budget.spent.monthly <= this.budget.monthly;
    
    console.log('[BudgetGovernance] Budget status:', {
      spent: this.budget.spent,
      withinBudget
    });
    
    return { withinBudget, spent: this.budget.spent };
  }

  async getBudget() {
    return this.budget;
  }
}

module.exports = { BudgetGovernance };
