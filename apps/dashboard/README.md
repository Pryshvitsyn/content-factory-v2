# Content Factory Dashboard

Mobile-first Next.js dashboard for creating and managing video productions.

## Quick Start

```bash
# Install dependencies
cd apps/dashboard
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your API URL and business ID

# Start development server
npm run dev
```

Open http://localhost:3000 on your iPhone (same network) or desktop.

## Configuration

Edit `.env`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_BUSINESS_ID=your-business-uuid
NEXT_PUBLIC_BRAND_ID=your-brand-uuid
```

## Features

1. **Mobile-First Design**
   - Responsive layout (iPhone, iPad, desktop)
   - Touch-friendly buttons (44px minimum tap targets)
   - Optimized for small screens
   - Fast loading (Next.js + Tailwind)

2. **Create Video Form**
   - Topic input (textarea)
   - Platform selection (TikTok, Instagram, YouTube)
   - Series selector (optional)
   - Create button with loading state
   - Success/error feedback

3. **Productions List**
   - Shows all videos for business
   - Status badges (queued, in_progress, completed)
   - Platform icons
   - Created date

4. **Production Card**
   - Title and topic
   - Status indicator
   - Platform badges
   - Approve button
   - Publish button

## Pages

- `/` — Main dashboard (create form + productions list)

## API Integration

The dashboard calls the API at `NEXT_PUBLIC_API_URL`:

- `POST /api/productions` — Create video
- `GET /api/productions?business_id=xxx` — List videos
- `POST /api/productions/:id/approve` — Approve video
- `POST /api/productions/:id/publish` — Publish video

## Development

```bash
# Development mode (auto-reload)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Mobile Testing

To test on your iPhone:

1. Make sure your computer and iPhone are on the same WiFi network
2. Find your computer's local IP (e.g., `192.168.1.100`)
3. Update `.env`: `NEXT_PUBLIC_API_URL=http://192.168.1.100:3001`
4. Start the dashboard: `npm run dev`
5. On iPhone, open: `http://192.168.1.100:3000`

## Next Steps

1. Add authentication (login/logout)
2. Add real-time updates (WebSocket or polling)
3. Add video preview player
4. Add publish flow (select date/time)
5. Add analytics dashboard
