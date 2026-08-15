@echo off
REM Content Factory Start Script (Windows)

echo 🏭 Starting Content Factory...
echo.

REM Start API
echo 🚀 Starting API server...
cd apps\api
start "API Server" cmd /k "npm start"
echo ✅ API started
echo.

REM Start Worker
echo 🔨 Starting worker...
cd ..\..\worker
set DATABASE_URL=postgresql://localhost:5432/content_factory
start "Worker" cmd /k "node factory-worker-v2.js"
echo ✅ Worker started
echo.

REM Start Dashboard
echo 📱 Starting dashboard...
cd ..\apps\dashboard
start "Dashboard" cmd /k "npm run dev"
echo ✅ Dashboard started
echo.

echo ✅ All services started!
echo.
echo Open your browser: http://localhost:3000
echo.
echo Close the terminal windows to stop services
echo.
