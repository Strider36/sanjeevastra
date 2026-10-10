const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('./server/config/db');

// Initialize Express app
const app = express();

// Connect to Database
connectDB();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Static Frontend Files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes Integration
app.use('/api/auth', require('./server/routes/authRoutes'));
app.use('/api/medicines', require('./server/routes/medicineRoutes'));
app.use('/api/prescriptions', require('./server/routes/prescriptionRoutes'));
app.use('/api/appointments', require('./server/routes/appointmentRoutes'));
app.use('/api/records', require('./server/routes/recordRoutes'));
app.use('/api/notifications', require('./server/routes/notificationRoutes'));
app.use('/api/sos', require('./server/routes/sosRoutes'));
app.use('/api/rag', require('./server/routes/ragRoutes'));
app.use('/api/doctors', require('./server/routes/doctorRoutes'));
app.use('/api/shares', require('./server/routes/shareRoutes'));
app.use('/api/voice', require('./server/routes/voiceRoutes'));

// Operational Health & Readiness Check Endpoint
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: {
      status: dbStatus,
      name: mongoose.connection.name || 'swasthyasetu'
    },
    services: {
      llm: process.env.LLM_PROVIDER || 'gemini',
      embedding: process.env.EMBEDDING_PROVIDER || 'gemini',
      embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '768', 10)
    }
  });
});

// Wildcard router: redirect unknown paths to landing index.html
app.get(/.*/, (req, res, next) => {
  // If requesting API, skip static redirect
  if (req.url.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Port Configuration
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});
