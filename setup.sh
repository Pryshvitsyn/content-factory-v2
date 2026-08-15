#!/bin/bash

# Content Factory Setup Script (Mac/Linux)

echo "🏭 Content Factory Setup"
echo "========================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Please install Node.js 18+ from https://nodejs.org"
  exit 1
fi

echo "✅ Node.js found: $(node --version)"

# Check PostgreSQL
if ! command -v psql &> /dev/null; then
  echo "❌ PostgreSQL not found. Please install PostgreSQL from https://www.postgresql.org"
  exit 1
fi

echo "✅ PostgreSQL found: $(psql --version)"

# Install API dependencies
echo ""
echo "📦 Installing API dependencies..."
cd apps/api
npm install
cp .env.example .env
echo "✅ API dependencies installed"

# Install Dashboard dependencies
echo ""
echo "📦 Installing Dashboard dependencies..."
cd ../dashboard
npm install
cp .env.example .env
echo "✅ Dashboard dependencies installed"

# Create database
echo ""
echo "🗄️  Creating database..."
createdb content_factory 2>/dev/null || echo "Database already exists"
echo "✅ Database created"

# Run migrations
echo ""
echo "📝 Running migrations..."
psql postgresql://localhost:5432/content_factory -f ../../migrations/001_v2.sql
psql postgresql://localhost:5432/content_factory -f ../../migrations/002_v2.1_multi_tenant.sql
echo "✅ Migrations completed"

# Create test data
echo ""
echo "🧪 Creating test data..."
psql postgresql://localhost:5432/content_factory << 'EOF'
INSERT INTO tenants (name, slug) VALUES ('My Factory', 'my-factory') ON CONFLICT (slug) DO NOTHING;
INSERT INTO businesses (tenant_id, name, slug, industry) VALUES ((SELECT id FROM tenants WHERE slug = 'my-factory'), 'Test Business', 'test-business', 'food_beverage') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brands (business_id, name, slug) VALUES ((SELECT id FROM businesses WHERE slug = 'test-business'), 'Test Brand', 'test-brand') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand_identities (brand_id, tone, visual_language) VALUES ((SELECT id FROM brands WHERE slug = 'test-brand'), 'funny and local', '{"style":"warm_cinematic","lighting_type":"natural"}'::jsonb) ON CONFLICT (brand_id) DO NOTHING;
EOF
echo "✅ Test data created"

# Get UUIDs
echo ""
echo "📋 Your Business and Brand UUIDs:"
psql postgresql://localhost:5432/content_factory -c "SELECT b.id as business_id, br.id as brand_id FROM businesses b JOIN brands br ON br.business_id = b.id WHERE b.slug = 'test-business';"

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit apps/api/.env with your NVIDIA_API_KEY"
echo "2. Edit apps/dashboard/.env with your BUSINESS_ID and BRAND_ID"
echo "3. Run ./start.sh to start all services"
echo ""
