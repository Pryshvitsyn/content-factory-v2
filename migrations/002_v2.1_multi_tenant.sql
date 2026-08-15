-- V2.1-B — Multi-Tenant Business Architecture
-- Transforms factory from "video generator" to "content production OS"
-- Supports unlimited businesses, brands, series, and content universes

-- ============================================
-- 1. TENANT & BUSINESS LAYER
-- ============================================

-- Tenants (top-level installation - can be SaaS tenant or single-business)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE,
    tier VARCHAR(50) DEFAULT 'standard',
    settings JSONB,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Businesses (the actual companies using the factory)
CREATE TABLE IF NOT EXISTS businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100),
    industry VARCHAR(100),
    description TEXT,
    website VARCHAR(500),
    settings JSONB,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. BRAND LAYER (Independent from Business)
-- ============================================

-- Brands (a business can own multiple brands)
CREATE TABLE IF NOT EXISTS brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100),
    tagline VARCHAR(500),
    mission TEXT,
    settings JSONB,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brand Identity (visual + voice)
CREATE TABLE IF NOT EXISTS brand_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    version INTEGER DEFAULT 1,
    voice_profile JSONB,
    tone VARCHAR(100),
    personality_traits JSONB,
    visual_language JSONB,
    color_palette JSONB,
    typography JSONB,
    logo_uri VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brand Rules (compliance, constraints, prohibited content)
CREATE TABLE IF NOT EXISTS brand_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    rule_type VARCHAR(50) NOT NULL,
    category VARCHAR(100),
    description TEXT NOT NULL,
    constraint_type VARCHAR(50),
    constraint_value JSONB,
    severity VARCHAR(50) DEFAULT 'medium',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. AUDIENCE LAYER
-- ============================================

-- Audiences (target segments)
CREATE TABLE IF NOT EXISTS audiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    demographics JSONB,
    psychographics JSONB,
    behaviors JSONB,
    pain_points JSONB,
    goals JSONB,
    platforms JSONB,
    size_estimate INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brand-Audience relationships (many-to-many)
CREATE TABLE IF NOT EXISTS brand_audiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    audience_id UUID NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 0,
    settings JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(brand_id, audience_id)
);

-- ============================================
-- 4. PRODUCT / SERVICE LAYER
-- ============================================

-- Products/Services
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    price DECIMAL,
    currency VARCHAR(10),
    features JSONB,
    benefits JSONB,
    target_audience UUID REFERENCES audiences(id),
    images JSONB,
    metadata JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brand-Product relationships
CREATE TABLE IF NOT EXISTS brand_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    is_featured BOOLEAN DEFAULT false,
    priority INTEGER DEFAULT 0,
    settings JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(brand_id, product_id)
);

-- ============================================
-- 5. CONTENT STRATEGY LAYER
-- ============================================

-- Content Strategies (per brand)
CREATE TABLE IF NOT EXISTS content_strategies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    objectives JSONB,
    kpis JSONB,
    content_pillars JSONB,
    messaging_framework JSONB,
    posting_frequency JSONB,
    platform_priorities JSONB,
    competitive_positioning JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 6. CONTENT UNIVERSE / SERIES LAYER
-- ============================================

-- Content Universes (campaigns, series, recurring formats)
CREATE TABLE IF NOT EXISTS content_universes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    parent_universe_id UUID REFERENCES content_universes(id),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    description TEXT,
    format_rules JSONB,
    recurring_elements JSONB,
    target_audience UUID REFERENCES audiences(id),
    target_products JSONB,
    settings JSONB,
    status VARCHAR(50) DEFAULT 'active',
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Universe Characters (characters belonging to a universe)
CREATE TABLE IF NOT EXISTS universe_characters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    universe_id UUID NOT NULL REFERENCES content_universes(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    role VARCHAR(100),
    importance VARCHAR(50) DEFAULT 'supporting',
    settings JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(universe_id, character_id)
);

-- ============================================
-- 7. KNOWLEDGE BASE (Business-specific)
-- ============================================

-- Knowledge Base (facts, FAQs, product info, industry knowledge)
CREATE TABLE IF NOT EXISTS knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    brand_id UUID REFERENCES brands(id),
    category VARCHAR(100),
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    tags JSONB,
    sources JSONB,
    confidence DECIMAL DEFAULT 1.0,
    is_verified BOOLEAN DEFAULT false,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 8. INDUSTRY POLICY & COMPLIANCE
-- ============================================

-- Industry Policies (regulatory/compliance rules by industry)
CREATE TABLE IF NOT EXISTS industry_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    industry VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    rules JSONB NOT NULL,
    regions JSONB,
    severity VARCHAR(50) DEFAULT 'high',
    is_mandatory BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Business Compliance (which policies apply to which business)
CREATE TABLE IF NOT EXISTS business_compliance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    policy_id UUID NOT NULL REFERENCES industry_policies(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'active',
    exemptions JSONB,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(business_id, policy_id)
);

-- ============================================
-- 9. TREND ENGINE (Tenant-aware)
-- ============================================

-- Global Trends
CREATE TABLE IF NOT EXISTS global_trends (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(100),
    trend_id VARCHAR(255),
    title VARCHAR(500) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    platforms JSONB,
    regions JSONB,
    volume_score DECIMAL,
    velocity_score DECIMAL,
    engagement_score DECIMAL,
    started_at TIMESTAMPTZ,
    peaked_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trend Relevance (per business/brand)
CREATE TABLE IF NOT EXISTS trend_relevance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trend_id UUID NOT NULL REFERENCES global_trends(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
    audience_id UUID REFERENCES audiences(id) ON DELETE CASCADE,
    relevance_score DECIMAL NOT NULL,
    opportunity_score DECIMAL,
    risk_score DECIMAL,
    recommended_action VARCHAR(100),
    reasoning TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 10. LEARNING SYSTEM (Hierarchical)
-- ============================================

-- Global Learnings (cross-tenant patterns)
CREATE TABLE IF NOT EXISTS global_learnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern VARCHAR(100) NOT NULL,
    category VARCHAR(100),
    description TEXT,
    evidence_count INTEGER DEFAULT 0,
    confidence DECIMAL,
    platforms JSONB,
    industries JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Business Learnings (specific to one business)
CREATE TABLE IF NOT EXISTS business_learnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    parent_global_id UUID REFERENCES global_learnings(id),
    pattern VARCHAR(100) NOT NULL,
    category VARCHAR(100),
    description TEXT,
    evidence_count INTEGER DEFAULT 0,
    confidence DECIMAL,
    sources JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brand Learnings (specific to one brand)
CREATE TABLE IF NOT EXISTS brand_learnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    parent_business_id UUID REFERENCES business_learnings(id),
    pattern VARCHAR(100) NOT NULL,
    category VARCHAR(100),
    description TEXT,
    evidence_count INTEGER DEFAULT 0,
    confidence DECIMAL,
    sources JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Series Learnings (specific to one content universe)
CREATE TABLE IF NOT EXISTS series_learnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    universe_id UUID NOT NULL REFERENCES content_universes(id) ON DELETE CASCADE,
    parent_brand_id UUID REFERENCES brand_learnings(id),
    pattern VARCHAR(100) NOT NULL,
    category VARCHAR(100),
    description TEXT,
    evidence_count INTEGER DEFAULT 0,
    confidence DECIMAL,
    sources JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 11. UPDATE EXISTING TABLES (from V2.1-A)
-- ============================================

-- Add tenant_id to projects
ALTER TABLE projects 
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Add business_id to contents (if not already present)
ALTER TABLE contents 
    ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- Add brand_id to content_variants
ALTER TABLE content_variants 
    ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;

-- Add universe_id to productions (link to content universe/series)
ALTER TABLE productions 
    ADD COLUMN IF NOT EXISTS universe_id UUID REFERENCES content_universes(id) ON DELETE SET NULL;

-- Add inheritance fields to production_bible
ALTER TABLE production_bible_references 
    ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id),
    ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id),
    ADD COLUMN IF NOT EXISTS universe_id UUID REFERENCES content_universes(id);

-- ============================================
-- 12. INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_businesses_tenant ON businesses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_brands_business ON brands(business_id);
CREATE INDEX IF NOT EXISTS idx_brand_identities_brand ON brand_identities(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_rules_brand ON brand_rules(brand_id);
CREATE INDEX IF NOT EXISTS idx_audiences_business ON audiences(business_id);
CREATE INDEX IF NOT EXISTS idx_brand_audiences_brand ON brand_audiences(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id);
CREATE INDEX IF NOT EXISTS idx_brand_products_brand ON brand_products(brand_id);
CREATE INDEX IF NOT EXISTS idx_content_strategies_brand ON content_strategies(brand_id);
CREATE INDEX IF NOT EXISTS idx_content_universes_brand ON content_universes(brand_id);
CREATE INDEX IF NOT EXISTS idx_universe_characters_universe ON universe_characters(universe_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_business ON knowledge_base(business_id);
CREATE INDEX IF NOT EXISTS idx_industry_policies_industry ON industry_policies(industry);
CREATE INDEX IF NOT EXISTS idx_business_compliance_business ON business_compliance(business_id);
CREATE INDEX IF NOT EXISTS idx_trend_relevance_trend ON trend_relevance(trend_id);
CREATE INDEX IF NOT EXISTS idx_trend_relevance_business ON trend_relevance(business_id);
CREATE INDEX IF NOT EXISTS idx_global_learnings_pattern ON global_learnings(pattern);
CREATE INDEX IF NOT EXISTS idx_business_learnings_business ON business_learnings(business_id);
CREATE INDEX IF NOT EXISTS idx_brand_learnings_brand ON brand_learnings(brand_id);
CREATE INDEX IF NOT EXISTS idx_series_learnings_universe ON series_learnings(universe_id);

-- ============================================
-- 13. SEED DATA
-- ============================================

-- Default industry policies
INSERT INTO industry_policies (industry, name, description, rules) VALUES
    ('food_beverage', 'Food & Beverage Advertising', 'Compliance rules for restaurants and food businesses', 
     '[{"type":"prohibited","category":"health_claims","description":"Cannot make unverified health claims"},{"type":"required","category":"allergen_info","description":"Must disclose allergens if mentioned"}]'),
    ('healthcare', 'Healthcare Advertising', 'Strict compliance for medical/health content',
     '[{"type":"prohibited","category":"medical_claims","description":"Cannot make medical claims without approval"},{"type":"required","category":"disclaimer","description":"Must include medical disclaimer"}]'),
    ('finance', 'Financial Services Advertising', 'Compliance for financial content',
     '[{"type":"prohibited","category":"guaranteed_returns","description":"Cannot guarantee investment returns"},{"type":"required","category":"risk_disclosure","description":"Must include risk warnings"}]'),
    ('fashion', 'Fashion & Retail Advertising', 'Standard retail advertising rules',
     '[{"type":"prohibited","category":"false_scarcity","description":"Cannot fake urgency or scarcity"}]'),
     ('home_services', 'Home Services Advertising', 'Rules for renovation, repair, home services',
     '[{"type":"prohibited","category":"guaranteed_outcomes","description":"Cannot guarantee specific results"},{"type":"required","category":"licensing","description":"Must mention licensing if applicable"}]')
ON CONFLICT DO NOTHING;

-- Default tenant (for single-tenant installations)
INSERT INTO tenants (name, slug, tier) VALUES
    ('Default Tenant', 'default', 'standard')
ON CONFLICT (slug) DO NOTHING;
