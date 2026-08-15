const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');

// Load environment variables
dotenv.config();

// Import routes
const productionsRouter = require('./routes/productions');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
global.db = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Test database connection
global.db.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  } else {
    console.log('✅ Database connected:', res.rows[0].now);
  }
});

// Routes
app.use('/api/productions', productionsRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 API server running on http://localhost:${PORT}`);
  console.log(`📝 Endpoints:`);
  console.log(`   POST   /api/productions - Create video`);
  console.log(`   GET    /api/productions - List videos`);
  console.log(`   GET    /api/productions/:id - Get video status`);
  console.log(`   GET    /health - Health check`);
});

module.exports = app;
