#!/bin/bash

# Content Factory Start Script (Mac/Linux)

echo "🏭 Starting Content Factory..."
echo ""

# Start API (Terminal 1)
echo "🚀 Starting API server..."
cd apps/api
npm start &
API_PID=$!
echo "✅ API started (PID: $API_PID)"

# Start Worker (Terminal 2)
echo "🔨 Starting worker..."
cd ../../worker
export DATABASE_URL='postgresql://localhost:5432/content_factory'
node factory-worker-v2.js &
WORKER_PID=$!
echo "✅ Worker started (PID: $WORKER_PID)"

# Start Dashboard (Terminal 3)
echo "📱 Starting dashboard..."
cd ../apps/dashboard
npm run dev &
DASHBOARD_PID=$!
echo "✅ Dashboard started (PID: $DASHBOARD_PID)"

echo ""
echo "✅ All services started!"
echo ""
echo "Open your browser: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for user to press Ctrl+C
wait
