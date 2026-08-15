# 🏭 Content Factory

Cross-platform video production system for creating TikTok, Instagram, and YouTube videos.

## 🌍 Supported Platforms

- ✅ **Mac** (macOS 12+)
- ✅ **Windows** (Windows 10/11)
- ✅ **Linux** (Ubuntu 20.04+, Debian 11+)
- ✅ **iPhone** (iOS 14+, Safari/Chrome)
- ✅ **Android** (Android 8+, Chrome/Samsung Browser)
- ✅ **iPad** (iPadOS 14+)

## 🚀 Quick Start

### Option 1: Docker (Recommended for Windows/Linux)

```bash
# Clone repository
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant

# Copy environment file
cp .env.example .env

# Edit .env with your NVIDIA_API_KEY, BUSINESS_ID, BRAND_ID

# Start everything
docker-compose up
```

Open http://localhost:3000

### Option 2: Native Setup (Mac/Linux)

```bash
# Clone repository
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant

# Run setup script
chmod +x setup.sh
./setup.sh

# Edit configuration files
nano apps/api/.env  # Add NVIDIA_API_KEY
nano apps/dashboard/.env  # Add BUSINESS_ID, BRAND_ID

# Start all services
./start.sh
```

Open http://localhost:3000

### Option 3: Native Setup (Windows)

```powershell
# Clone repository
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant

# Run setup script
.\setup.bat

# Edit configuration files
notepad apps\api\.env  # Add NVIDIA_API_KEY
notepad apps\dashboard\.env  # Add BUSINESS_ID, BRAND_ID

# Start all services
.\start.bat
```

Open http://localhost:3000

## 📱 Mobile Usage

### iPhone (Safari)

1. Open http://your-ip:3000
2. Tap **Share** button
3. Tap **Add to Home Screen**
4. App installs as PWA
5. Open from home screen (full-screen, no browser UI)

### Android (Chrome)

1. Open http://your-ip:3000
2. Tap **⋮** menu
3. Tap **Add to Home screen**
4. App installs as PWA
5. Open from home screen (full-screen, no browser UI)

### Access from Mobile

**On same network:**

1. Find your computer's IP:
   - Mac: `ipconfig getifaddr en0`
   - Windows: `ipconfig` (look for IPv4)
   - Linux: `ip addr show`

2. Update `apps/dashboard/.env`:
   ```env
   NEXT_PUBLIC_API_URL=http://YOUR_IP:3001
   ```

3. Restart dashboard

4. On mobile, open: `http://YOUR_IP:3000`

## 📋 Prerequisites

### Native Setup (All Platforms)

- **Node.js 18+** — https://nodejs.org
- **PostgreSQL 15+** — https://www.postgresql.org
- **Git** — https://git-scm.com

### Docker Setup (All Platforms)

- **Docker Desktop** — https://www.docker.com
  - Windows: Enable WSL2
  - Mac: Docker Desktop for Mac
  - Linux: Docker Engine + Compose

## 🔧 Configuration

### API Configuration (apps/api/.env)

```env
DATABASE_URL=postgresql://content_factory:content_factory@localhost:5432/content_factory
NVIDIA_API_KEY=your-nvidia-api-key
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
PORT=3001
NODE_ENV=development
```

### Dashboard Configuration (apps/dashboard/.env)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_BUSINESS_ID=your-business-uuid
NEXT_PUBLIC_BRAND_ID=your-brand-uuid
```

### Docker Configuration (.env)

```env
NVIDIA_API_KEY=your-nvidia-api-key
NEXT_PUBLIC_BUSINESS_ID=your-business-uuid
NEXT_PUBLIC_BRAND_ID=your-brand-uuid
```

## 🎯 Features

1. **Create Videos** — Fill form with topic and platforms
2. **Auto-Generate Scripts** — Worker uses NVIDIA Nemotron
3. **Video Preview** — Watch generated videos in dashboard
4. **Approve & Publish** — One-click approval and publishing
5. **Multi-Platform** — TikTok, Instagram, YouTube
6. **Mobile-First** — Works perfectly on iPhone/Android
7. **PWA Support** — Install as native app on mobile
8. **Cross-Platform** — Mac, Windows, Linux support

## 📊 Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Dashboard  │────▶│     API      │────▶│  Database   │
│  (Next.js)  │     │  (Express)   │     │ (PostgreSQL)│
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                     ┌──────────────┐
                     │    Worker     │
                     │   (Node.js)   │
                     └──────────────┘
                           │
                           ▼
                  ┌────────────────┐
                  │ NVIDIA Nemotron │
                  │     (API)       │
                  └────────────────┘
```

## 🐛 Troubleshooting

### Port Already in Use

```bash
# Mac/Linux
lsof -i :3000  # Find process
kill -9 <PID>  # Kill process

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### PostgreSQL Connection Error

```bash
# Check if PostgreSQL is running
# Mac/Linux
pg_isready

# Windows
pg_isready -h localhost

# Start PostgreSQL
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
```

### Mobile Can't Connect

1. Ensure computer and mobile are on same WiFi network
2. Check firewall allows port 3000 and 3001
3. Use computer's local IP (not localhost)
4. Restart dashboard after changing .env

## 📖 Documentation

- **API Usage** — See `HOW_TO_USE_API.md`
- **Complete Guide** — See `HOW_TO_USE_API_FULL.md`
- **Architecture** — See `ARCHITECTURE_CONTRACT_V2.1_MULTI_TENANT.md`

## 🎉 Next Steps

1. Create your first video from dashboard
2. Watch worker generate script
3. Preview video in dashboard
4. Approve and publish to TikTok
5. Add authentication for team access
6. Deploy to cloud (Vercel + Railway)

## 📞 Support

For issues or questions:
- Check troubleshooting section above
- Review documentation files
- Open GitHub issue
