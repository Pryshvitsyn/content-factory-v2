# Content Factory API

Minimal Express.js API for creating and managing video productions.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your database URL and NVIDIA API key

# Start server
npm start

# Or development mode (auto-reload)
npm run dev
```

## Endpoints

### Create Production

```bash
POST /api/productions
Content-Type: application/json

{
  "business_id": "uuid",
  "brand_id": "uuid",
  "topic": "Why Roman pizza is thin",
  "platforms": ["tiktok", "instagram", "youtube"],
  "series_id": "uuid" (optional),
  "audience_id": "uuid" (optional),
  "product_id": "uuid" (optional)
}
```

Response:

```json
{
  "id": "production-uuid",
  "status": "queued",
  "message": "Production created. Script generation started."
}
```

### List Productions

```bash
GET /api/productions?business_id=uuid&limit=20&offset=0
```

Response:

```json
[
  {
    "id": "uuid",
    "title": "Why Roman pizza is thin",
    "status": "completed",
    "created_at": "2026-08-16T00:00:00Z",
    "platforms": ["tiktok", "instagram"]
  }
]
```

### Get Production Status

```bash
GET /api/productions/:id
```

Response:

```json
{
  "id": "uuid",
  "title": "Why Roman pizza is thin",
  "status": "completed",
  "progress": 100,
  "jobs": [...],
  "artifacts": [...],
  "editions": [...]
}
```

### Approve Production

```bash
POST /api/productions/:id/approve
```

### Publish Production

```bash
POST /api/productions/:id/publish
Content-Type: application/json

{
  "platforms": ["tiktok", "instagram"],
  "scheduled_at": "2026-08-16T18:00:00Z"
}
```

## Health Check

```bash
GET /health
```

## Error Handling

All errors return JSON:

```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

Status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request (invalid input)
- `404` - Not Found
- `500` - Internal Server Error

## Development

The API uses `--watch` mode in development, so it auto-reloads when you change files.

## Testing

Test with curl:

```bash
# Create production
curl -X POST http://localhost:3001/api/productions \
  -H "Content-Type: application/json" \
  -d '{
    "business_id": "your-business-uuid",
    "brand_id": "your-brand-uuid",
    "topic": "Test video",
    "platforms": ["tiktok"]
  }'

# List productions
curl http://localhost:3001/api/productions?business_id=your-business-uuid

# Get production status
curl http://localhost:3001/api/productions/production-uuid
```

## Next Steps

After API is running:

1. Start the worker: `node worker/factory-worker-v2.js`
2. Build the dashboard (Next.js app)
3. Deploy to production (Vercel for dashboard, Railway/your server for API)
