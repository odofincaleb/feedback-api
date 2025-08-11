const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg'); // PostgreSQL for production
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

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

// Database setup
let db;
if (NODE_ENV === 'production') {
  // PostgreSQL for production
  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  // SQLite for development
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = path.join(__dirname, 'feedback.db');
  db = new sqlite3.Database(dbPath);
}

// Create feedback table (PostgreSQL)
const createTable = async () => {
  if (NODE_ENV === 'production') {
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
    } finally {
      client.release();
    }
  } else {
    // SQLite table creation (existing code)
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          type TEXT NOT NULL,
          message TEXT NOT NULL,
          status TEXT DEFAULT 'new',
          date TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    });
  }
};

createTable();

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
      const now = new Date();
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
    
    if (NODE_ENV === 'production') {
      const client = await db.connect();
      try {
        const result = await client.query(query, params);
        res.json(result.rows);
      } finally {
        client.release();
      }
    } else {
      db.all(query, params, (err, rows) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        res.json(rows);
      });
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
    
    if (NODE_ENV === 'production') {
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
    } else {
      db.run(
        'INSERT INTO feedback (name, email, type, message, status, date) VALUES (?, ?, ?, ?, ?, ?)',
        [feedback.name, feedback.email, feedback.type, feedback.message, feedback.status, feedback.date],
        function(err) {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to save feedback' });
          }
          
          const createdFeedback = {
            id: this.lastID,
            ...feedback
          };
          
          res.status(201).json(createdFeedback);
        }
      );
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
    
    if (NODE_ENV === 'production') {
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
    } else {
      db.run(
        'UPDATE feedback SET status = ? WHERE id = ?',
        [status, id],
        function(err) {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to update status' });
          }
          
          if (this.changes === 0) {
            return res.status(404).json({ error: 'Feedback not found' });
          }
          
          res.json({ message: 'Status updated successfully' });
        }
      );
    }
  } catch (error) {
    console.error('Error updating feedback status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET feedback summary
app.get('/api/feedback/summary', async (req, res) => {
  try {
    if (NODE_ENV === 'production') {
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
    } else {
      db.all(
        'SELECT status, COUNT(*) as count FROM feedback GROUP BY status',
        [],
        (err, rows) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
          }
          
          const summary = {
            total: 0,
            new: 0,
            'in-progress': 0,
            resolved: 0
          };
          
          rows.forEach(row => {
            summary[row.status] = row.count;
            summary.total += row.count;
          });
          
          res.json(summary);
        }
      );
    }
  } catch (error) {
    console.error('Error fetching feedback summary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    version: process.env.APP_VERSION || '1.0.0'
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
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;

