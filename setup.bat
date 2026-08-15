@echo off
REM Content Factory Setup Script (Windows)

echo 🏭 Content Factory Setup
echo ========================
echo.

REM Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo ❌ Node.js not found. Please install Node.js 18+ from https://nodejs.org
  exit /b 1
)

echo ✅ Node.js found
node --version
echo.

REM Check PostgreSQL
where psql >nul 2>nul
if %errorlevel% neq 0 (
  echo ❌ PostgreSQL not found. Please install PostgreSQL from https://www.postgresql.org
  exit /b 1
)

echo ✅ PostgreSQL found
psql --version
echo.

REM Install API dependencies
echo 📦 Installing API dependencies...
cd apps\api
call npm install
copy .env.example .env
echo ✅ API dependencies installed
echo.

REM Install Dashboard dependencies
echo 📦 Installing Dashboard dependencies...
cd ..\dashboard
call npm install
copy .env.example .env
echo ✅ Dashboard dependencies installed
echo.

REM Create database
echo 🗄️  Creating database...
createdb content_factory 2>nul
if %errorlevel% neq 0 (
  echo Database already exists
) else (
  echo ✅ Database created
)
echo.

REM Run migrations
echo 📝 Running migrations...
psql postgresql://localhost:5432/content_factory -f ../../migrations/001_v2.sql
psql postgresql://localhost:5432/content_factory -f ../../migrations/002_v2.1_multi_tenant.sql
echo ✅ Migrations completed
echo.

REM Create test data
echo 🧪 Creating test data...
psql postgresql://localhost:5432/content_factory -c "INSERT INTO tenants (name, slug) VALUES ('My Factory', 'my-factory') ON CONFLICT (slug) DO NOTHING;"
psql postgresql://localhost:5432/content_factory -c "INSERT INTO businesses (tenant_id, name, slug, industry) VALUES ((SELECT id FROM tenants WHERE slug = 'my-factory'), 'Test Business', 'test-business', 'food_beverage') ON CONFLICT (slug) DO NOTHING;"
psql postgresql://localhost:5432/content_factory -c "INSERT INTO brands (business_id, name, slug) VALUES ((SELECT id FROM businesses WHERE slug = 'test-business'), 'Test Brand', 'test-brand') ON CONFLICT (slug) DO NOTHING;"
psql postgresql://localhost:5432/content_factory -c "INSERT INTO brand_identities (brand_id, tone, visual_language) VALUES ((SELECT id FROM brands WHERE slug = 'test-brand'), 'funny and local', '{\"style\":\"warm_cinematic\",\"lighting_type\":\"natural\"}'::jsonb) ON CONFLICT (brand_id) DO NOTHING;"
echo ✅ Test data created
echo.

REM Get UUIDs
echo 📋 Your Business and Brand UUIDs:
psql postgresql://localhost:5432/content_factory -c "SELECT b.id as business_id, br.id as brand_id FROM businesses b JOIN brands br ON br.business_id = b.id WHERE b.slug = 'test-business';"

echo.
echo ✅ Setup complete!
echo.
echo Next steps:
echo 1. Edit apps\api\.env with your NVIDIA_API_KEY
echo 2. Edit apps\dashboard\.env with your BUSINESS_ID and BRAND_ID
echo 3. Run start.bat to start all services
echo.
