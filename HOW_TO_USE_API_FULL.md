# How to Use the Content Factory API (Complete Guide)

Cross-platform guide for creating TikTok, Instagram, and YouTube videos on Mac, Windows, Linux, iPhone, and Android.

> The API creates content-production records and queues a script-generation job. The worker then processes the job using PostgreSQL and your NVIDIA API configuration.

## Table of Contents

1. [Before You Start](#before-you-start)
2. [Choose Your Platform](#choose-your-platform)
3. [Quick Start by Platform](#quick-start-by-platform)
4. [Docker Setup (Recommended)](#docker-setup-recommended)
5. [Native Setup (Mac/Linux)](#native-setup-maclinux)
6. [Native Setup (Windows)](#native-setup-windows)
7. [Mobile Setup (iPhone/Android)](#mobile-setup-iphoneandroid)
8. [Create Business Data](#create-business-data)
9. [Create a Video Production](#create-a-video-production)
10. [Start the Worker](#start-the-worker)
11. [View Your Videos](#view-your-videos)
12. [Video Preview](#video-preview)
13. [Approve and Publish](#approve-and-publish)
14. [API Endpoints](#api-endpoints)
15. [Troubleshooting](#troubleshooting)

---

## Before You Start

### Prerequisites

**For Native Setup:**
- Node.js 18 or later — https://nodejs.org
- PostgreSQL 15 or later — https://www.postgresql.org
- Git — https://git-scm.com

**For Docker Setup:**
- Docker Desktop — https://www.docker.com
  - Windows: Enable WSL2 backend
  - Mac: Docker Desktop for Mac
  - Linux: Docker Engine + Compose

**For Mobile:**
- iPhone (iOS 14+) or Android (8+)
- Same WiFi network as your computer
- Safari (iPhone) or Chrome (Android)

### Get Your NVIDIA API Key

1. Go to https://build.nvidia.com
2. Sign up or log in
3. Go to API Keys
4. Copy your API key

Never commit real credentials. Keep them only in local `.env` files.

---

## Choose Your Platform

| Platform | Recommended Method | Setup Time |
|----------|-------------------|------------|
| **Mac** | Native (setup.sh) or Docker | 5 minutes |
| **Windows** | Docker (easiest) or Native (setup.bat) | 10 minutes |
| **Linux** | Native (setup.sh) or Docker | 5 minutes |
| **iPhone** | PWA (Add to Home Screen) | 2 minutes |
| **Android** | PWA (Add to Home Screen) | 2 minutes |

---

## Quick Start by Platform

### Mac (Fastest)

```bash
# 1. Clone repository
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant

# 2. Run setup script
chmod +x setup.sh
./setup.sh

# 3. Edit configuration
nano apps/api/.env        # Add NVIDIA_API_KEY
nano apps/dashboard/.env  # Add BUSINESS_ID, BRAND_ID (from setup output)

# 4. Start all services
./start.sh

# 5. Open browser
http://localhost:3000
```

### Windows (Easy)

```powershell
# 1. Clone repository
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant

# 2. Run setup script
.\setup.bat

# 3. Edit configuration
notepad apps\api\.env        # Add NVIDIA_API_KEY
notepad apps\dashboard\.env  # Add BUSINESS_ID, BRAND_ID (from setup output)

# 4. Start all services
.\start.bat

# 5. Open browser
http://localhost:3000
```

### Linux (Fast)

```bash
# Same as Mac
chmod +x setup.sh
./setup.sh
./start.sh
```

### Docker (Any Platform - Most Reliable)

```bash
# 1. Clone repository
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant

# 2. Copy and edit environment file
cp .env.example .env
nano .env  # Add NVIDIA_API_KEY, BUSINESS_ID, BRAND_ID

# 3. Start everything
docker-compose up

# 4. Open browser
http://localhost:3000
```

### iPhone/Android (Mobile)

1. **Start on your computer first** (see above)
2. **Find your computer's IP:**
   - Mac: `ipconfig getifaddr en0`
   - Windows: `ipconfig` (look for IPv4)
3. **Update dashboard config:**
   ```bash
   # Edit apps/dashboard/.env
   NEXT_PUBLIC_API_URL=http://YOUR_IP:3001
   ```
4. **Restart dashboard**
5. **On mobile, open:** `http://YOUR_IP:3000`
6. **Add to Home Screen:**
   - iPhone: Share → Add to Home Screen
   - Android: ⋮ menu → Add to Home screen
7. **Use as native app!**

---

## Docker Setup (Recommended)

Docker is the easiest and most reliable way to run Content Factory on any platform.

### Step 1: Install Docker

- **Windows:** https://www.docker.com/products/docker-desktop/
  - During installation, enable WSL2 backend
- **Mac:** https://www.docker.com/products/docker-desktop/
  - Standard installation
- **Linux:** https://docs.docker.com/engine/install/
  - Follow distribution-specific instructions

### Step 2: Clone Repository

```bash
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant
```

### Step 3: Configure Environment

```bash
cp .env.example .env
nano .env
```

Add your values:

```env
NVIDIA_API_KEY=nvapi-your-key-here
NEXT_PUBLIC_BUSINESS_ID=uuid-from-database
NEXT_PUBLIC_BRAND_ID=uuid-from-database
```

### Step 4: Start All Services

```bash
docker-compose up
```

You'll see:

```
✅ Database connected
🚀 API server running on http://localhost:3001
🏭 Worker started
📱 Dashboard running on http://localhost:3000
```

### Step 5: Open Dashboard

Open http://localhost:3000 in your browser.

### Step 6: Stop Services

```bash
docker-compose down
```

### Benefits of Docker

- ✅ No manual Node.js/PostgreSQL installation
- ✅ Works identically on all platforms
- ✅ One command to start/stop
- ✅ Production-ready
- ✅ Easy to deploy to cloud
- ✅ Isolated from your system

---

## Native Setup (Mac/Linux)

### Step 1: Install Prerequisites

```bash
# Install Node.js (macOS with Homebrew)
brew install node@18

# Install PostgreSQL (macOS with Homebrew)
brew install postgresql@15
brew services start postgresql@15

# Install Git (if not installed)
brew install git
```

### Step 2: Clone Repository

```bash
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant
```

### Step 3: Run Setup Script

```bash
chmod +x setup.sh
./setup.sh
```

The script will:
- ✅ Check Node.js and PostgreSQL
- ✅ Install API dependencies
- ✅ Install Dashboard dependencies
- ✅ Create database
- ✅ Run migrations
- ✅ Create test business/brand data
- ✅ Show you the UUIDs to copy

### Step 4: Edit Configuration

Save the UUIDs from the setup output, then:

```bash
nano apps/api/.env
```

Add your NVIDIA API key:

```env
DATABASE_URL=postgresql://localhost:5432/content_factory
NVIDIA_API_KEY=nvapi-your-key-here
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
PORT=3001
NODE_ENV=development
```

```bash
nano apps/dashboard/.env
```

Add your UUIDs:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_BUSINESS_ID=paste-business-uuid-here
NEXT_PUBLIC_BRAND_ID=paste-brand-uuid-here
```

### Step 5: Start All Services

```bash
./start.sh
```

You'll see:

```
🚀 Starting API server...
✅ API started
🔨 Starting worker...
✅ Worker started
📱 Starting dashboard...
✅ Dashboard started

Open your browser: http://localhost:3000
```

### Step 6: Open Dashboard

Open http://localhost:3000 in your browser.

---

## Native Setup (Windows)

### Step 1: Install Prerequisites

- **Node.js 18+:** https://nodejs.org (download Windows installer)
- **PostgreSQL 15+:** https://www.postgresql.org/download/windows/
- **Git:** https://git-scm.com/download/win

During PostgreSQL installation:
- Remember the password you set
- Keep default port (5432)

### Step 2: Clone Repository

Open PowerShell or Git Bash:

```powershell
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant
```

### Step 3: Run Setup Script

```powershell
.\setup.bat
```

The script will:
- ✅ Check Node.js and PostgreSQL
- ✅ Install API dependencies
- ✅ Install Dashboard dependencies
- ✅ Create database
- ✅ Run migrations
- ✅ Create test business/brand data
- ✅ Show you the UUIDs to copy

### Step 4: Edit Configuration

Save the UUIDs from the setup output, then:

Open Notepad:
```powershell
notepad apps\api\.env
```

Add your NVIDIA API key:

```env
DATABASE_URL=postgresql://localhost:5432/content_factory
NVIDIA_API_KEY=nvapi-your-key-here
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
PORT=3001
NODE_ENV=development
```

```powershell
notepad apps\dashboard\.env
```

Add your UUIDs:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_BUSINESS_ID=paste-business-uuid-here
NEXT_PUBLIC_BRAND_ID=paste-brand-uuid-here
```

### Step 5: Start All Services

```powershell
.\start.bat
```

Three terminal windows will open:
- API Server (port 3001)
- Worker (processing jobs)
- Dashboard (port 3000)

### Step 6: Open Dashboard

Open http://localhost:3000 in your browser.

---

## Mobile Setup (iPhone/Android)

### Step 1: Start on Your Computer

First, start the system on your computer using one of the methods above.

### Step 2: Find Your Computer's IP Address

**Mac:**
```bash
ipconfig getifaddr en0
# Example: 192.168.1.100
```

**Windows:**
```powershell
ipconfig
# Look for "IPv4 Address" under your WiFi adapter
# Example: 192.168.1.100
```

**Linux:**
```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
# Example: 192.168.1.100
```

### Step 3: Update Dashboard Configuration

```bash
# Edit apps/dashboard/.env
nano apps/dashboard/.env
```

Change:
```env
NEXT_PUBLIC_API_URL=http://YOUR_IP:3001
# Example: NEXT_PUBLIC_API_URL=http://192.168.1.100:3001
```

### Step 4: Restart Dashboard

```bash
cd apps/dashboard
npm run dev
```

### Step 5: Open on Mobile

**iPhone (Safari):**
1. Open Safari
2. Go to `http://YOUR_IP:3000`
3. Tap **Share** button (box with arrow)
4. Tap **Add to Home Screen**
5. Name it "Content Factory"
6. Tap **Add**
7. App icon appears on home screen
8. Tap to open (full-screen, no browser UI)

**Android (Chrome):**
1. Open Chrome
2. Go to `http://YOUR_IP:3000`
3. Tap **⋮** menu (three dots)
4. Tap **Add to Home screen**
5. Name it "Content Factory"
6. Tap **Add**
7. App icon appears on home screen
8. Tap to open (full-screen, no browser UI)

### Step 6: Use as Native App

Now you can:
- ✅ Create videos from your phone
- ✅ Watch video previews
- ✅ Approve and publish
- ✅ Access from anywhere on same network

---

## Create Business Data

If you used the setup scripts, test data is already created. If not, or if you want to create your own:

### Using SQL

```sql
-- Create tenant
INSERT INTO tenants (name, slug)
VALUES ('My Factory', 'my-factory')
RETURNING id;

-- Create business
INSERT INTO businesses (tenant_id, name, slug, industry)
VALUES ('TENANT_UUID', 'Roma Pizza', 'roma-pizza', 'food_beverage')
RETURNING id;

-- Create brand
INSERT INTO brands (business_id, name, slug)
VALUES ('BUSINESS_UUID', 'Roma Pizza', 'roma-pizza')
RETURNING id;

-- Create brand identity
INSERT INTO brand_identities (brand_id, tone, visual_language)
VALUES (
  'BRAND_UUID',
  'funny and local',
  '{"style":"warm_cinematic","lighting_type":"natural"}'::jsonb
);

-- Create content universe (series)
INSERT INTO content_universes (brand_id, name, type, format_rules)
VALUES (
  'BRAND_UUID',
  'Marco Explains Pizza',
  'series',
  '{"duration_ms":20000,"aspect_ratio":"9:16","hook_style":"unexpected","cta":"visit"}'::jsonb
)
RETURNING id;
```

Replace `TENANT_UUID`, `BUSINESS_UUID`, and `BRAND_UUID` with actual IDs.

### Get Your UUIDs

```sql
SELECT 
  b.id as business_id,
  br.id as brand_id
FROM businesses b
JOIN brands br ON br.business_id = b.id
WHERE b.slug = 'roma-pizza';
```

Copy these UUIDs for the next step.

---

## Create a Video Production

### Using the Dashboard (Easiest)

1. Open http://localhost:3000 (or http://YOUR_IP:3000 on mobile)
2. Fill the form:
   - **Topic:** "Why Roman pizza is thin"
   - **Platforms:** Select TikTok, Instagram, YouTube
   - **Series:** Optional (leave empty for first video)
3. Click **Create Video**
4. See success message ✅
5. Video appears in "Your Videos" list

### Using curl (API)

```bash
curl -X POST http://localhost:3001/api/productions \
  -H "Content-Type: application/json" \
  -d '{
    "business_id": "BUSINESS_UUID",
    "brand_id": "BRAND_UUID",
    "topic": "Why Roman pizza is thin",
    "platforms": ["tiktok", "instagram", "youtube"]
  }'
```

Response:

```json
{
  "id": "PRODUCTION_UUID",
  "status": "queued",
  "message": "Production created. Script generation started."
}
```

### Required Fields

| Field | Description |
|---|---|
| `business_id` | UUID of the business that owns the production |
| `brand_id` | UUID of the relevant brand |
| `topic` | Video idea; minimum 10 characters |
| `platforms` | One or more of `tiktok`, `instagram`, `youtube` |

### Optional Fields

| Field | Description |
|---|---|
| `series_id` | UUID of the content universe / recurring series |
| `audience_id` | UUID of a target audience |
| `product_id` | UUID of a product or service |

---

## Start the Worker

The worker processes jobs automatically. If you used the setup scripts or Docker, it's already running.

### Manual Start (if needed)

```bash
export DATABASE_URL='postgresql://localhost:5432/content_factory'
export NVIDIA_API_KEY='your-nvidia-api-key'
export NVIDIA_BASE_URL='https://integrate.api.nvidia.com/v1'
node worker/factory-worker-v2.js
```

You'll see:

```
🏭 Content Factory Worker v2.1 started
📊 Polling for jobs...
🔨 Claimed job SCRIPT_GENERATION for production abc-123
📝 Generated script for abc-123
✅ Job completed
```

---

## View Your Videos

### Using the Dashboard

1. Open http://localhost:3000
2. Scroll to "Your Videos" section
3. See all videos with:
   - Status badges (queued, in_progress, completed)
   - Platform icons (🎵 TikTok, 📸 Instagram, 📺 YouTube)
   - Created date
   - Video thumbnails

### Using curl (API)

```bash
curl "http://localhost:3001/api/productions?business_id=BUSINESS_UUID"
```

Response:

```json
[
  {
    "id": "PRODUCTION_UUID",
    "title": "Why Roman pizza is thin",
    "status": "completed",
    "created_at": "2026-08-16T00:00:00Z",
    "platforms": ["tiktok", "instagram"]
  }
]
```

---

## Video Preview

### Watch Videos in Dashboard

1. Open http://localhost:3000
2. Find your video in "Your Videos"
3. Click on video thumbnail
4. Video player opens in fullscreen
5. Controls:
   - ▶️ Play/Pause
   - ⏭️ Progress bar (drag to seek)
   - ⏱️ Time display
   - ⊞ Fullscreen
   - ✕ Close

### Mobile Video Preview

1. Open app on iPhone/Android
2. Tap video thumbnail
3. Video plays in fullscreen
4. Tap to show/hide controls
5. Swipe down to close

---

## Approve and Publish

### Approve a Production

**Dashboard:**
1. When video status is "completed"
2. Click **Approve** button
3. Status changes to "approved"

**API:**
```bash
curl -X POST http://localhost:3001/api/productions/PRODUCTION_UUID/approve
```

### Publish a Production

**Dashboard:**
1. When video status is "approved"
2. Click **Publish** button
3. Status changes to "published"

**API:**
```bash
curl -X POST http://localhost:3001/api/productions/PRODUCTION_UUID/publish \
  -H "Content-Type: application/json" \
  -d '{
    "platforms": ["tiktok", "instagram"],
    "scheduled_at": "2026-08-16T18:00:00Z"
  }'
```

---

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Confirm that the API server is running |
| `POST` | `/api/productions` | Create a production and queue script generation |
| `GET` | `/api/productions?business_id=...` | List a business's productions |
| `GET` | `/api/productions/:id` | Get production status, jobs, artifacts, and editions |
| `POST` | `/api/productions/:id/approve` | Mark a production as approved |
| `POST` | `/api/productions/:id/publish` | Create scheduled publication records |

### Test API

```bash
# Health check
curl http://localhost:3001/health

# Create production
curl -X POST http://localhost:3001/api/productions \
  -H "Content-Type: application/json" \
  -d '{"business_id":"UUID","brand_id":"UUID","topic":"Test video","platforms":["tiktok"]}'

# List productions
curl "http://localhost:3001/api/productions?business_id=UUID"

# Get production details
curl http://localhost:3001/api/productions/PRODUCTION_UUID
```

---

## Troubleshooting

### Port Already in Use

**Mac/Linux:**
```bash
# Find process
lsof -i :3000
lsof -i :3001

# Kill process
kill -9 <PID>
```

**Windows:**
```powershell
# Find process
netstat -ano | findstr :3000
netstat -ano | findstr :3001

# Kill process
taskkill /PID <PID> /F
```

### PostgreSQL Connection Error

**Check if PostgreSQL is running:**

```bash
# Mac/Linux
pg_isready

# Windows
pg_isready -h localhost
```

**Start PostgreSQL:**

```bash
# Mac (Homebrew)
brew services start postgresql@15

# Windows
net start postgresql-x64-15

# Linux
sudo systemctl start postgresql
```

### Docker Issues

```bash
# Check Docker is running
docker ps

# Rebuild containers
docker-compose down
docker-compose up --build

# View logs
docker-compose logs -f

# Remove all containers and volumes
docker-compose down -v
docker-compose up
```

### Mobile Can't Connect

1. Ensure computer and mobile are on same WiFi network
2. Check firewall allows port 3000 and 3001:
   - Mac: System Preferences → Security → Firewall
   - Windows: Windows Defender Firewall → Allow an app
3. Use computer's local IP (not localhost)
4. Restart dashboard after changing .env
5. Try accessing from computer browser first

### NVIDIA API Fails

1. Verify `NVIDIA_API_KEY` is present in .env
2. Check key is valid at https://build.nvidia.com
3. Check worker logs for error messages
4. Verify model name matches NVIDIA endpoint

### Worker Does Not Claim Jobs

```sql
-- Inspect queued jobs
SELECT id, production_id, job_type, status, attempts, created_at
FROM jobs
ORDER BY created_at DESC;

-- Check DATABASE_URL is set in worker terminal
```

### Dashboard Shows "Failed to load productions"

1. Check API server is running: http://localhost:3001/health
2. Verify `NEXT_PUBLIC_BUSINESS_ID` in dashboard .env
3. Check browser console for errors (F12)
4. Ensure API and dashboard are on same network

---

## Next Steps

Once everything is working:

1. ✅ Create your first video from dashboard
2. ✅ Watch worker generate script
3. ✅ Preview video in dashboard
4. ✅ Approve and publish to TikTok
5. ✅ Add authentication for team access
6. ✅ Deploy to cloud (Vercel + Railway)
7. ✅ Set up automatic publishing

---

## Documentation

- **Quick Start:** See `README.md`
- **Architecture:** See `ARCHITECTURE_CONTRACT_V2.1_MULTI_TENANT.md`
- **API Reference:** See `apps/api/README.md`
- **Dashboard:** See `apps/dashboard/README.md`

---

## Support

For issues or questions:
- Check troubleshooting section above
- Review documentation files
- Open GitHub issue
