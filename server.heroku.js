const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const AWS = require('aws-sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'production';

// AWS S3 Configuration
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));

// Database setup - PostgreSQL for production
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create feedback table
const createTable = async () => {
  const client = await db.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'new',
        date TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Database table created/verified');
  } catch (error) {
    console.error('Database setup error:', error);
  } finally {
    client.release();
  }
};

createTable();

// S3 Backup Functions
const backupToS3 = async () => {
  try {
    const client = await db.connect();
    const result = await client.query('SELECT * FROM feedback ORDER BY created_at DESC');
    client.release();

    const backupData = {
      timestamp: new Date().toISOString(),
      count: result.rows.length,
      data: result.rows
    };

    await s3.upload({
      Bucket: process.env.S3_BACKUP_BUCKET || 'fiddyscript-backups',
      Key: `feedback-backup-${Date.now()}.json`,
      Body: JSON.stringify(backupData, null, 2),
      ContentType: 'application/json'
    }).promise();

    console.log(`Backup created: ${result.rows.length} records`);
  } catch (error) {
    console.error('Backup failed:', error);
  }
};

// Auto-backup every 24 hours
setInterval(backupToS3, 24 * 60 * 60 * 1000);

// Routes

// GET all feedback
app.get('/api/feedback', async (req, res) => {
  try {
    const { search, status, date } = req.query;
    
    let query = 'SELECT * FROM feedback';
    let params = [];
    
    // Build WHERE clause based on filters
    const conditions = [];
    
    if (search) {
      conditions.push('(name ILIKE $1 OR email ILIKE $2 OR message ILIKE $3)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }
    
    if (status && status !== 'all') {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }
    
    if (date && date !== 'all') {
      let filterDate = new Date();
      
      switch (date) {
        case 'today':
          filterDate.setHours(0, 0, 0, 0);
          break;
        case 'week':
          filterDate.setDate(filterDate.getDate() - 7);
          break;
        case 'month':
          filterDate.setMonth(filterDate.getMonth() - 1);
          break;
      }
      
      conditions.push(`date >= $${params.length + 1}`);
      params.push(filterDate.toISOString());
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY created_at DESC';
    
    const client = await db.connect();
    try {
      const result = await client.query(query, params);
      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST new feedback
app.post('/api/feedback', async (req, res) => {
  try {
    const { name, email, type, message } = req.body;
    
    if (!name || !email || !type || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const feedback = {
      name: name.trim(),
      email: email.trim(),
      type: type.toLowerCase(),
      message: message.trim(),
      status: 'new',
      date: new Date().toISOString()
    };
    
    const client = await db.connect();
    try {
      const result = await client.query(
        'INSERT INTO feedback (name, email, type, message, status, date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [feedback.name, feedback.email, feedback.type, feedback.message, feedback.status, feedback.date]
      );
      
      const createdFeedback = result.rows[0];
      res.status(201).json(createdFeedback);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating feedback:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update feedback status
app.put('/api/feedback/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }
    
    const client = await db.connect();
    try {
      const result = await client.query(
        'UPDATE feedback SET status = $1 WHERE id = $2 RETURNING *',
        [status, id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Feedback not found' });
      }
      
      res.json({ message: 'Status updated successfully' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating feedback status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET feedback summary
app.get('/api/feedback/summary', async (req, res) => {
  try {
    const client = await db.connect();
    try {
      const result = await client.query(
        'SELECT status, COUNT(*) as count FROM feedback GROUP BY status'
      );
      
      const summary = {
        total: 0,
        new: 0,
        'in-progress': 0,
        resolved: 0
      };
      
      result.rows.forEach(row => {
        summary[row.status] = parseInt(row.count);
        summary.total += parseInt(row.count);
      });
      
      res.json(summary);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching feedback summary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manual backup endpoint
app.post('/api/backup', async (req, res) => {
  try {
    await backupToS3();
    res.json({ message: 'Backup completed successfully' });
  } catch (error) {
    console.error('Manual backup failed:', error);
    res.status(500).json({ error: 'Backup failed' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    version: process.env.APP_VERSION || '1.0.0',
    database: 'PostgreSQL',
    backup: 'S3'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`Feedback API server running on port ${PORT}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Database: PostgreSQL`);
  console.log(`Backup: S3`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;

