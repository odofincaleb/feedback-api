const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const AWS = require('aws-sdk');
const path = require('path');

const app = express();
app.set('trust proxy', 1);
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

// Root route to handle Railway redirects
app.get('/', (req, res) => {
  res.json({ 
    message: 'Feedback API Server',
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    version: process.env.APP_VERSION || '1.0.0'
  });
});

// Database setup - PostgreSQL for production
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create tables (feedback + licensing)
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
    // Licenses table
    await client.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        license_key VARCHAR(64) PRIMARY KEY,
        email VARCHAR(255),
        plan VARCHAR(50) DEFAULT 'standard',
        status VARCHAR(32) DEFAULT 'active',
        max_devices INTEGER DEFAULT 2,
        seats INTEGER DEFAULT 1,
        max_devices_per_user INTEGER DEFAULT 2,
        expiry_date TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 year',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Ensure new columns exist for older deployments
    await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS seats INTEGER DEFAULT 1`);
    await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS max_devices_per_user INTEGER DEFAULT 2`);
    // License devices table
    await client.query(`
      CREATE TABLE IF NOT EXISTS license_devices (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(64) REFERENCES licenses(license_key) ON DELETE CASCADE,
        user_email VARCHAR(255),
        device_id VARCHAR(128) NOT NULL,
        platform VARCHAR(32) NOT NULL,
        device_name VARCHAR(255),
        first_activated_at TIMESTAMPTZ DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ DEFAULT NOW(),
        status VARCHAR(32) DEFAULT 'active',
        UNIQUE (license_key, device_id)
      )
    `);
    await client.query(`ALTER TABLE license_devices ADD COLUMN IF NOT EXISTS user_email VARCHAR(255)`);

    // License users table (for multi-user seats)
    await client.query(`
      CREATE TABLE IF NOT EXISTS license_users (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(64) REFERENCES licenses(license_key) ON DELETE CASCADE,
        user_email VARCHAR(255) NOT NULL,
        role VARCHAR(32) DEFAULT 'member',
        max_devices INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        revoked_at TIMESTAMPTZ,
        UNIQUE (license_key, user_email)
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

// ===== License Management Endpoints =====
const GRACE_DAYS = parseInt(process.env.GRACE_DAYS || '7', 10);

// Utility: prune stale devices beyond grace period
async function pruneStaleDevices(client, licenseKey) {
  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await client.query(
    `UPDATE license_devices SET status='revoked' WHERE license_key=$1 AND status='active' AND last_seen_at < $2`,
    [licenseKey, cutoff]
  );
}

// Utility: get active devices list
async function getActiveDevices(client, licenseKey) {
  const { rows } = await client.query(
    `SELECT device_id, platform, device_name, last_seen_at FROM license_devices WHERE license_key=$1 AND status='active' ORDER BY last_seen_at DESC`,
    [licenseKey]
  );
  return rows;
}

// Ensure a license exists (for testing/dev you can auto-create)
async function ensureLicense(client, licenseKey) {
  const { rows } = await client.query(`SELECT * FROM licenses WHERE license_key=$1`, [licenseKey]);
  if (rows.length === 0) {
    await client.query(
      `INSERT INTO licenses (license_key, status, max_devices) VALUES ($1, 'active', $2)`,
      [licenseKey, 2]
    );
    return { license_key: licenseKey, status: 'active', max_devices: 2 };
  }
  return rows[0];
}

// Activate device (supports optional userEmail for multi-user licenses)
app.post('/api/licenses/activate', async (req, res) => {
  const { licenseKey, deviceId, platform, deviceName, userEmail } = req.body || {};
  if (!licenseKey || !deviceId || !platform) {
    return res.status(400).json({ error: 'licenseKey, deviceId and platform are required' });
  }
  const client = await db.connect();
  try {
    const lic = await ensureLicense(client, licenseKey);
    if (lic.status !== 'active') {
      return res.status(403).json({ error: 'license_inactive' });
    }
    await pruneStaleDevices(client, licenseKey);

    // If userEmail provided, ensure assignment and per-user device policy
    if (userEmail) {
      // Ensure user exists or create if seats available
      const userRows = await client.query(`SELECT * FROM license_users WHERE license_key=$1 AND user_email=$2`, [licenseKey, userEmail]);
      if (userRows.rows.length === 0) {
        // Count current active users
        const activeUsers = await client.query(`SELECT COUNT(*)::int AS cnt FROM license_users WHERE license_key=$1 AND revoked_at IS NULL`, [licenseKey]);
        const cnt = activeUsers.rows[0].cnt || 0;
        if (cnt >= (lic.seats || 1)) {
          return res.status(409).json({ error: 'seat_limit_reached', seats: lic.seats || 1 });
        }
        await client.query(`INSERT INTO license_users (license_key, user_email, role, max_devices) VALUES ($1, $2, 'member', $3)`, [licenseKey, userEmail, lic.max_devices_per_user || 2]);
      }

      // Enforce per-user device limit
      const perUserMax = (userRows.rows[0]?.max_devices) || lic.max_devices_per_user || 2;
      const perUserActive = await client.query(`SELECT COUNT(*)::int AS cnt FROM license_devices WHERE license_key=$1 AND user_email=$2 AND status='active'`, [licenseKey, userEmail]);
      if ((perUserActive.rows[0].cnt || 0) >= perUserMax) {
        const devices = await client.query(`SELECT device_id, platform, device_name, last_seen_at FROM license_devices WHERE license_key=$1 AND user_email=$2 AND status='active' ORDER BY last_seen_at DESC`, [licenseKey, userEmail]);
        return res.status(409).json({ error: 'per_user_limit_reached', maxDevicesPerUser: perUserMax, activeDevices: devices.rows });
      }
    }

    // If device exists, mark active and update last_seen
    const existing = await client.query(
      `SELECT * FROM license_devices WHERE license_key=$1 AND device_id=$2`,
      [licenseKey, deviceId]
    );
    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE license_devices SET status='active', platform=$3, device_name=$4, user_email=$5, last_seen_at=NOW() WHERE license_key=$1 AND device_id=$2`,
        [licenseKey, deviceId, platform, deviceName || null, userEmail || null]
      );
      const active = await getActiveDevices(client, licenseKey);
      return res.json({ ok: true, maxDevices: lic.max_devices, activeDevices: active });
    }

    // Check limit
    const active = await getActiveDevices(client, licenseKey);
    if (active.length >= lic.max_devices) {
      return res.status(409).json({ error: 'limit_reached', maxDevices: lic.max_devices, activeDevices: active });
    }
    await client.query(
      `INSERT INTO license_devices (license_key, device_id, platform, device_name, user_email) VALUES ($1, $2, $3, $4, $5)` ,
      [licenseKey, deviceId, platform, deviceName || null, userEmail || null]
    );
    const updated = await getActiveDevices(client, licenseKey);
    res.json({ ok: true, maxDevices: lic.max_devices, activeDevices: updated });
  } catch (e) {
    console.error('Activate error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Deactivate device
app.post('/api/licenses/deactivate', async (req, res) => {
  const { licenseKey, deviceId } = req.body || {};
  if (!licenseKey || !deviceId) return res.status(400).json({ error: 'licenseKey and deviceId are required' });
  const client = await db.connect();
  try {
    await client.query(`UPDATE license_devices SET status='revoked' WHERE license_key=$1 AND device_id=$2`, [licenseKey, deviceId]);
    const active = await getActiveDevices(client, licenseKey);
    res.json({ ok: true, activeDevices: active });
  } catch (e) {
    console.error('Deactivate error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Heartbeat
app.post('/api/licenses/heartbeat', async (req, res) => {
  const { licenseKey, deviceId } = req.body || {};
  if (!licenseKey || !deviceId) return res.status(400).json({ error: 'licenseKey and deviceId are required' });
  const client = await db.connect();
  try {
    await client.query(`UPDATE license_devices SET last_seen_at=NOW() WHERE license_key=$1 AND device_id=$2 AND status='active'`, [licenseKey, deviceId]);
    const licRows = await client.query(`SELECT max_devices, status FROM licenses WHERE license_key=$1`, [licenseKey]);
    if (licRows.rows.length === 0) return res.status(404).json({ error: 'license_not_found' });
    const lic = licRows.rows[0];
    const active = await getActiveDevices(client, licenseKey);
    res.json({ ok: true, status: lic.status, maxDevices: lic.max_devices, activeDevices: active });
  } catch (e) {
    console.error('Heartbeat error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Status
app.get('/api/licenses/status', async (req, res) => {
  const { licenseKey, deviceId } = req.query;
  if (!licenseKey) return res.status(400).json({ error: 'licenseKey is required' });
  const client = await db.connect();
  try {
    const licRows = await client.query(`SELECT max_devices, status, expiry_date FROM licenses WHERE license_key=$1`, [licenseKey]);
    if (licRows.rows.length === 0) return res.status(404).json({ valid: false, reason: 'license_not_found' });
    const lic = licRows.rows[0];
    await pruneStaleDevices(client, licenseKey);
    const active = await getActiveDevices(client, licenseKey);
    const thisDeviceActive = deviceId ? active.some(d => d.device_id === deviceId) : false;
    res.json({ valid: lic.status === 'active', maxDevices: lic.max_devices, activeDevices: active, thisDeviceActive });
  } catch (e) {
    console.error('Status error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Admin revoke
app.post('/api/licenses/devices/revoke', async (req, res) => {
  const { licenseKey, deviceId } = req.body || {};
  if (!licenseKey || !deviceId) return res.status(400).json({ error: 'licenseKey and deviceId are required' });
  const client = await db.connect();
  try {
    await client.query(`UPDATE license_devices SET status='revoked' WHERE license_key=$1 AND device_id=$2`, [licenseKey, deviceId]);
    const active = await getActiveDevices(client, licenseKey);
    res.json({ ok: true, activeDevices: active });
  } catch (e) {
    console.error('Revoke error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Manage users (add/remove)
app.post('/api/licenses/users/add', async (req, res) => {
  const { licenseKey, userEmail, role, maxDevices } = req.body || {};
  if (!licenseKey || !userEmail) return res.status(400).json({ error: 'licenseKey and userEmail are required' });
  const client = await db.connect();
  try {
    const licRows = await client.query(`SELECT seats, max_devices_per_user FROM licenses WHERE license_key=$1`, [licenseKey]);
    if (licRows.rows.length === 0) return res.status(404).json({ error: 'license_not_found' });
    const lic = licRows.rows[0];
    const activeUsers = await client.query(`SELECT COUNT(*)::int AS cnt FROM license_users WHERE license_key=$1 AND revoked_at IS NULL`, [licenseKey]);
    if ((activeUsers.rows[0].cnt || 0) >= (lic.seats || 1)) {
      return res.status(409).json({ error: 'seat_limit_reached', seats: lic.seats || 1 });
    }
    await client.query(`INSERT INTO license_users (license_key, user_email, role, max_devices) VALUES ($1, $2, $3, $4) ON CONFLICT (license_key, user_email) DO UPDATE SET revoked_at=NULL, role=EXCLUDED.role, max_devices=COALESCE(EXCLUDED.max_devices, license_users.max_devices)`,
      [licenseKey, userEmail, role || 'member', maxDevices || lic.max_devices_per_user || 2]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Users add error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

app.post('/api/licenses/users/remove', async (req, res) => {
  const { licenseKey, userEmail } = req.body || {};
  if (!licenseKey || !userEmail) return res.status(400).json({ error: 'licenseKey and userEmail are required' });
  const client = await db.connect();
  try {
    await client.query(`UPDATE license_users SET revoked_at=NOW() WHERE license_key=$1 AND user_email=$2`, [licenseKey, userEmail]);
    await client.query(`UPDATE license_devices SET status='revoked' WHERE license_key=$1 AND user_email=$2`, [licenseKey, userEmail]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Users remove error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

app.get('/api/licenses/users', async (req, res) => {
  const { licenseKey } = req.query;
  if (!licenseKey) return res.status(400).json({ error: 'licenseKey is required' });
  const client = await db.connect();
  try {
    const { rows } = await client.query(`SELECT user_email, role, max_devices, revoked_at FROM license_users WHERE license_key=$1`, [licenseKey]);
    res.json(rows);
  } catch (e) {
    console.error('Users list error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
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

// Health check (handle both with and without trailing slash, no redirects)
function sendHealth(res) {
  res.set('Cache-Control', 'no-store');
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    version: process.env.APP_VERSION || '1.0.0',
    database: 'PostgreSQL',
    backup: 'S3'
  });
}
app.get('/api/health', (req, res) => sendHealth(res));
app.get('/api/health/', (req, res) => sendHealth(res));

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
