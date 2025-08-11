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
        customer_name VARCHAR(255),
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
    await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255)`);
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

// Add sample license data for testing
const addSampleLicenses = async () => {
  const client = await db.connect();
  try {
    // Check if sample licenses already exist
    const existing = await client.query(`SELECT COUNT(*) FROM licenses WHERE license_key IN ('FD-59E2EC25-E5DB-33D3', 'FD-TEST-MOBILE-2024')`);
    if (existing.rows[0].count > 0) {
      console.log('Sample licenses already exist');
      return;
    }

    // Add sample licenses
    await client.query(`
      INSERT INTO licenses (license_key, email, plan, status, max_devices, seats, max_devices_per_user, expiry_date) 
      VALUES 
        ('FD-59E2EC25-E5DB-33D3', 'admin@fiddyscript.com', 'premium', 'active', 5, 3, 2, NOW() + INTERVAL '1 year'),
        ('FD-TEST-MOBILE-2024', 'test@example.com', 'standard', 'active', 2, 1, 2, NOW() + INTERVAL '2 years')
    `);

    // Add sample users
    await client.query(`
      INSERT INTO license_users (license_key, user_email, role, max_devices) 
      VALUES 
        ('FD-59E2EC25-E5DB-33D3', 'user1@company.com', 'member', 2),
        ('FD-59E2EC25-E5DB-33D3', 'user2@company.com', 'member', 2)
    `);

    // Add sample devices
    await client.query(`
      INSERT INTO license_devices (license_key, user_email, device_id, platform, device_name, status) 
      VALUES 
        ('FD-59E2EC25-E5DB-33D3', 'user1@company.com', 'win_1234567890_abc123', 'windows', 'John''s Laptop', 'active'),
        ('FD-59E2EC25-E5DB-33D3', 'user1@company.com', 'mobile_web_9876543210_def456', 'web', 'John''s Mobile', 'active'),
        ('FD-59E2EC25-E5DB-33D3', 'user2@company.com', 'win_2345678901_ghi789', 'windows', 'Sarah''s Desktop', 'active')
    `);

    console.log('Sample license data added successfully');
  } catch (error) {
    console.error('Error adding sample licenses:', error);
  } finally {
    client.release();
  }
};

// Add sample data after table creation
setTimeout(addSampleLicenses, 2000);

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

// Role-based permission middleware
const checkUserPermission = (requiredRole = 'member') => {
  return async (req, res, next) => {
    try {
      const { licenseKey, userEmail } = req.body || req.query;
      
      if (!licenseKey || !userEmail) {
        return res.status(400).json({ error: 'licenseKey and userEmail are required for permission check' });
      }

      const client = await db.connect();
      try {
        const userResult = await client.query(
          'SELECT role FROM license_users WHERE license_key = $1 AND user_email = $2 AND revoked_at IS NULL',
          [licenseKey, userEmail]
        );

        if (userResult.rows.length === 0) {
          return res.status(403).json({ error: 'user_not_found_or_revoked' });
        }

        const userRole = userResult.rows[0].role;
        
        // Role hierarchy: admin > member
        const roleHierarchy = { 'admin': 2, 'member': 1 };
        const requiredLevel = roleHierarchy[requiredRole] || 1;
        const userLevel = roleHierarchy[userRole] || 0;

        if (userLevel < requiredLevel) {
          return res.status(403).json({ 
            error: 'insufficient_permissions', 
            requiredRole, 
            userRole,
            message: `Requires ${requiredRole} role, user has ${userRole} role`
          });
        }

        req.userRole = userRole;
        next();
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ error: 'permission_check_failed' });
    }
  };
};

// Create new license (for License Manager) - MUST come before /api/licenses/activate
// License Plans:
// - basic: Essential features for individuals (1-3 devices, basic support)
// - standard: Professional features for small teams (3-10 devices, email support)
// - premium: Advanced features for growing businesses (10-50 devices, priority support)
// - enterprise: Full features for large organizations (50+ devices, dedicated support)
app.post('/api/licenses', async (req, res) => {
  const { customerName, customerEmail, licenseDuration, maxSystems, plan = 'standard' } = req.body || {};
  
  if (!customerEmail || !licenseDuration || !maxSystems) {
    return res.status(400).json({ error: 'customerEmail, licenseDuration, and maxSystems are required' });
  }
  
  const client = await db.connect();
  try {
    // Generate license key
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let licenseKey = 'FD-';
    
    // Generate 8 characters for first part
    for (let i = 0; i < 8; i++) {
      licenseKey += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    licenseKey += '-';
    
    // Generate 4 characters for second part
    for (let i = 0; i < 4; i++) {
      licenseKey += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    licenseKey += '-';
    
    // Generate 4 characters for third part
    for (let i = 0; i < 4; i++) {
      licenseKey += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Calculate expiry date
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + parseInt(licenseDuration));
    
    // Insert license
    const result = await client.query(`
      INSERT INTO licenses (license_key, email, customer_name, plan, status, max_devices, seats, max_devices_per_user, expiry_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [licenseKey, customerEmail, customerName, plan, 'active', parseInt(maxSystems), parseInt(maxSystems), 1, expiryDate]);
    
    const newLicense = result.rows[0];
    
    res.json({
      success: true,
      license: {
        licenseKey: newLicense.license_key,
        customerName: newLicense.customer_name || customerName || customerEmail,
        customerEmail: newLicense.email,
        plan: newLicense.plan,
        status: newLicense.status,
        maxSystems: newLicense.max_devices,
        seats: newLicense.seats,
        maxDevicesPerUser: newLicense.max_devices_per_user,
        expiryDate: newLicense.expiry_date,
        createdAt: newLicense.created_at
      }
    });
  } catch (e) {
    console.error('Create license error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Enhanced license activation with role support
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
        return res.status(409).json({ error: 'user_device_limit_reached', maxDevicesPerUser: perUserMax });
      }
    }

    // Check total device limit
    const totalActive = await client.query(`SELECT COUNT(*)::int AS cnt FROM license_devices WHERE license_key=$1 AND status='active'`, [licenseKey]);
    if ((totalActive.rows[0].cnt || 0) >= (lic.max_devices || 5)) {
      return res.status(409).json({ error: 'total_device_limit_reached', maxDevices: lic.max_devices || 5 });
    }

    // Insert or update device
    await client.query(`
      INSERT INTO license_devices (license_key, user_email, device_id, platform, device_name, status)
      VALUES ($1, $2, $3, $4, $5, 'active')
      ON CONFLICT (license_key, device_id) 
      DO UPDATE SET 
        user_email = EXCLUDED.user_email,
        platform = EXCLUDED.platform,
        device_name = EXCLUDED.device_name,
        last_seen_at = NOW(),
        status = 'active'
    `, [licenseKey, userEmail || null, deviceId, platform, deviceName || 'Unknown Device']);

    res.json({ 
      ok: true, 
      deviceId, 
      maxDevices: lic.max_devices || 5,
      maxDevicesPerUser: lic.max_devices_per_user || 2,
      userRole: userEmail ? (await client.query(`SELECT role FROM license_users WHERE license_key=$1 AND user_email=$2`, [licenseKey, userEmail])).rows[0]?.role : null
    });
  } catch (e) {
    console.error('Activation error:', e);
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

// List all licenses
app.get('/api/licenses', async (req, res) => {
  const client = await db.connect();
  try {
    const licRows = await client.query(`
      SELECT 
        license_key, 
        email, 
        customer_name,
        plan, 
        status, 
        max_devices, 
        seats, 
        max_devices_per_user, 
        expiry_date,
        created_at,
        updated_at
      FROM licenses 
      ORDER BY created_at DESC
    `);
    res.json(licRows.rows);
  } catch (e) {
    console.error('List licenses error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Status
app.get('/api/licenses/status', async (req, res) => {
  const { licenseKey, userEmail } = req.query;
  if (!licenseKey) return res.status(400).json({ error: 'licenseKey is required' });
  
  const client = await db.connect();
  try {
    const licRows = await client.query(`SELECT * FROM licenses WHERE license_key=$1`, [licenseKey]);
    if (licRows.rows.length === 0) return res.status(404).json({ error: 'license_not_found' });
    
    const license = licRows.rows[0];
    const result = {
      licenseKey: license.license_key,
      email: license.email,
      customerName: license.customer_name,
      plan: license.plan,
      status: license.status,
      maxDevices: license.max_devices,
      seats: license.seats,
      maxDevicesPerUser: license.max_devices_per_user,
      expiryDate: license.expiry_date,
      userRole: null,
      userPermissions: []
    };

    // If userEmail provided, get user role and permissions
    if (userEmail) {
      const userResult = await client.query(`SELECT role FROM license_users WHERE license_key=$1 AND user_email=$2 AND revoked_at IS NULL`, [licenseKey, userEmail]);
      if (userResult.rows.length > 0) {
        const userRole = userResult.rows[0].role;
        result.userRole = userRole;
        
        // Define permissions based on role
        if (userRole === 'admin') {
          result.userPermissions = [
            'manage_users',
            'manage_devices', 
            'view_analytics',
            'manage_license_settings',
            'revoke_devices',
            'add_remove_users'
          ];
        } else if (userRole === 'member') {
          result.userPermissions = [
            'view_own_devices',
            'use_software',
            'view_license_info'
          ];
        }
      }
    }

    res.json(result);
  } catch (e) {
    console.error('License status error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Admin revoke
app.post('/api/licenses/devices/revoke', checkUserPermission('admin'), async (req, res) => {
  const { licenseKey, deviceId, userEmail } = req.body || {};
  if (!licenseKey || !deviceId) return res.status(400).json({ error: 'licenseKey and deviceId are required' });
  
  const client = await db.connect();
  try {
    // Check if device exists and get its user
    const deviceResult = await client.query(`SELECT user_email FROM license_devices WHERE license_key=$1 AND device_id=$2`, [licenseKey, deviceId]);
    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'device_not_found' });
    }

    const deviceUser = deviceResult.rows[0].user_email;
    
    // If userEmail is provided, verify it matches the device owner
    if (userEmail && userEmail !== deviceUser) {
      return res.status(400).json({ error: 'device_user_mismatch' });
    }

    // Check if user is trying to revoke their own device (allowed for admins)
    if (req.userEmail === deviceUser && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'cannot_revoke_own_device' });
    }

    await client.query(`UPDATE license_devices SET status='revoked' WHERE license_key=$1 AND device_id=$2`, [licenseKey, deviceId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Device revoke error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Manage users (add/remove)
app.post('/api/licenses/users/add', checkUserPermission('admin'), async (req, res) => {
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

app.post('/api/licenses/users/remove', checkUserPermission('admin'), async (req, res) => {
  const { licenseKey, userEmail } = req.body || {};
  if (!licenseKey || !userEmail) return res.status(400).json({ error: 'licenseKey and userEmail are required' });
  
  const client = await db.connect();
  try {
    // Check if user exists and get their role
    const userResult = await client.query(`SELECT role FROM license_users WHERE license_key=$1 AND user_email=$2`, [licenseKey, userEmail]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    // Prevent admin from removing themselves
    if (req.userEmail === userEmail) {
      return res.status(400).json({ error: 'cannot_remove_self' });
    }

    // Prevent removing other admins (only super admin can do this)
    if (userResult.rows[0].role === 'admin' && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'cannot_remove_admin' });
    }

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
    const { rows } = await client.query(`
      SELECT 
        lu.user_email, 
        lu.role, 
        lu.max_devices, 
        lu.created_at,
        lu.revoked_at,
        COUNT(ld.device_id) as device_count
      FROM license_users lu
      LEFT JOIN license_devices ld ON lu.license_key = ld.license_key AND lu.user_email = ld.user_email AND ld.status = 'active'
      WHERE lu.license_key = $1
      GROUP BY lu.user_email, lu.role, lu.max_devices, lu.created_at, lu.revoked_at
      ORDER BY lu.created_at DESC
    `, [licenseKey]);
    
    // Get devices for each user
    const usersWithDevices = await Promise.all(rows.map(async (user) => {
      const deviceRows = await client.query(`
        SELECT 
          device_id,
          platform,
          device_name,
          first_activated_at,
          last_seen_at,
          status
        FROM license_devices 
        WHERE license_key = $1 AND user_email = $2
        ORDER BY last_seen_at DESC
      `, [licenseKey, user.user_email]);
      
      return {
        ...user,
        devices: deviceRows.rows
      };
    }));
    
    res.json(usersWithDevices);
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

// Clear devices for testing (development only)
app.delete('/api/licenses/devices/clear/:licenseKey', async (req, res) => {
  if (NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }
  
  try {
    const { licenseKey } = req.params;
    const client = await db.connect();
    
    try {
      const result = await client.query(
        'DELETE FROM license_devices WHERE license_key = $1',
        [licenseKey]
      );
      
      res.json({ 
        message: `Cleared ${result.rowCount} devices for license ${licenseKey}`,
        clearedCount: result.rowCount
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error clearing devices:', error);
    res.status(500).json({ error: 'Failed to clear devices' });
  }
});

// Add test user for development (development only)
app.post('/api/licenses/users/add-test', async (req, res) => {
  if (NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }
  
  try {
    const { licenseKey, userEmail, role } = req.body;
    const client = await db.connect();
    
    try {
      // Check if user already exists
      const existingUser = await client.query(
        'SELECT * FROM license_users WHERE license_key = $1 AND user_email = $2',
        [licenseKey, userEmail]
      );
      
      if (existingUser.rows.length > 0) {
        return res.json({ 
          message: 'User already exists',
          user: existingUser.rows[0]
        });
      }
      
      // Add the test user
      const result = await client.query(
        'INSERT INTO license_users (license_key, user_email, role, max_devices) VALUES ($1, $2, $3, $4)',
        [licenseKey, userEmail, role || 'member', 2]
      );
      
      res.json({ 
        message: 'Test user added successfully',
        licenseKey,
        userEmail,
        role: role || 'member'
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error adding test user:', error);
    res.status(500).json({ error: 'Failed to add test user' });
  }
});

// Clear users for testing (development only)
app.delete('/api/licenses/users/clear/:licenseKey', async (req, res) => {
  if (NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }
  
  try {
    const { licenseKey } = req.params;
    const client = await db.connect();
    
    try {
      // Delete all users for this license
      const result = await client.query(
        'DELETE FROM license_users WHERE license_key = $1',
        [licenseKey]
      );
      
      res.json({ 
        message: `Cleared ${result.rowCount} users for license ${licenseKey}`,
        clearedCount: result.rowCount
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error clearing users:', error);
    res.status(500).json({ error: 'Failed to clear users' });
  }
});



// Update license (for License Manager)
app.put('/api/licenses/:licenseKey', async (req, res) => {
  const { licenseKey } = req.params;
  const { customerName, customerEmail, maxSystems, status, expiryDate } = req.body || {};
  
  if (!licenseKey) return res.status(400).json({ error: 'licenseKey is required' });
  
  const client = await db.connect();
  try {
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;
    
    if (customerName !== undefined) {
      updateFields.push(`customer_name = $${paramCount++}`);
      updateValues.push(customerName);
    }
    
    if (customerEmail !== undefined) {
      updateFields.push(`email = $${paramCount++}`);
      updateValues.push(customerEmail);
    }
    
    if (maxSystems !== undefined) {
      updateFields.push(`max_devices = $${paramCount++}`);
      updateValues.push(parseInt(maxSystems));
    }
    
    if (status !== undefined) {
      updateFields.push(`status = $${paramCount++}`);
      updateValues.push(status);
    }
    
    if (expiryDate !== undefined) {
      updateFields.push(`expiry_date = $${paramCount++}`);
      updateValues.push(new Date(expiryDate));
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updateFields.push(`updated_at = NOW()`);
    updateValues.push(licenseKey);
    
    const result = await client.query(`
      UPDATE licenses 
      SET ${updateFields.join(', ')}
      WHERE license_key = $${paramCount}
      RETURNING *
    `, updateValues);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'license_not_found' });
    }
    
    const updatedLicense = result.rows[0];
    
    res.json({
      success: true,
      license: {
        licenseKey: updatedLicense.license_key,
        customerName: customerName || updatedLicense.email,
        customerEmail: updatedLicense.email,
        plan: updatedLicense.plan,
        status: updatedLicense.status,
        maxSystems: updatedLicense.max_devices,
        seats: updatedLicense.seats,
        maxDevicesPerUser: updatedLicense.max_devices_per_user,
        expiryDate: updatedLicense.expiry_date,
        updatedAt: updatedLicense.updated_at
      }
    });
  } catch (e) {
    console.error('Update license error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Extend license (for License Manager)
app.post('/api/licenses/:licenseKey/extend', async (req, res) => {
  const { licenseKey } = req.params;
  const { days } = req.body || {};
  
  if (!licenseKey || !days) {
    return res.status(400).json({ error: 'licenseKey and days are required' });
  }
  
  const client = await db.connect();
  try {
    const result = await client.query(`
      UPDATE licenses 
      SET expiry_date = expiry_date + INTERVAL '${parseInt(days)} days', updated_at = NOW()
      WHERE license_key = $1
      RETURNING *
    `, [licenseKey]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'license_not_found' });
    }
    
    const updatedLicense = result.rows[0];
    
    res.json({
      success: true,
      license: {
        licenseKey: updatedLicense.license_key,
        customerEmail: updatedLicense.email,
        plan: updatedLicense.plan,
        status: updatedLicense.status,
        maxSystems: updatedLicense.max_devices,
        seats: updatedLicense.seats,
        maxDevicesPerUser: updatedLicense.max_devices_per_user,
        expiryDate: updatedLicense.expiry_date,
        updatedAt: updatedLicense.updated_at
      }
    });
  } catch (e) {
    console.error('Extend license error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Get license devices (for License Manager)
app.get('/api/licenses/:licenseKey/devices', async (req, res) => {
  const { licenseKey } = req.params;
  
  if (!licenseKey) return res.status(400).json({ error: 'licenseKey is required' });
  
  const client = await db.connect();
  try {
    const result = await client.query(`
      SELECT 
        device_id, 
        user_email, 
        platform, 
        device_name, 
        status, 
        activated_at, 
        last_seen
      FROM license_devices 
      WHERE license_key = $1 AND status = 'active'
      ORDER BY activated_at DESC
    `, [licenseKey]);
    
    res.json(result.rows);
  } catch (e) {
    console.error('Get license devices error:', e);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Migrate S3 licenses to database (one-time operation)
app.post('/api/licenses/migrate-s3', async (req, res) => {
  try {
    const client = await db.connect();
    
    // Read licenses from S3
    const s3Params = {
      Bucket: process.env.S3_BUCKET_NAME || 'myfideanlicense',
      Key: 'fdscriptlicense.json'
    };
    
    let s3Licenses = [];
    try {
      const s3Data = await s3.getObject(s3Params).promise();
      const licensesData = JSON.parse(s3Data.Body.toString());
      s3Licenses = licensesData.licenses || [];
    } catch (s3Error) {
      console.log('No existing S3 licenses found or error reading S3:', s3Error.message);
      return res.json({ 
        success: true, 
        message: 'No S3 licenses found to migrate',
        migrated: 0,
        skipped: 0
      });
    }
    
    let migrated = 0;
    let skipped = 0;
    const errors = [];
    
    for (const s3License of s3Licenses) {
      try {
        // Check if license already exists in database
        const existing = await client.query(
          'SELECT license_key FROM licenses WHERE license_key = $1',
          [s3License.licenseKey]
        );
        
        if (existing.rows.length > 0) {
          skipped++;
          continue; // Skip if already exists
        }
        
        // Parse expiry date
        let expiryDate = new Date();
        if (s3License.expiryDate) {
          expiryDate = new Date(s3License.expiryDate);
        } else if (s3License.duration) {
          expiryDate.setDate(expiryDate.getDate() + parseInt(s3License.duration));
        } else {
          expiryDate.setFullYear(expiryDate.getFullYear() + 1); // Default 1 year
        }
        
        // Determine status from isActive field
        const status = s3License.isActive === false ? 'inactive' : 'active';
        
        // Determine plan from the S3 data
        let plan = 'standard';
        if (s3License.plan) {
          plan = s3License.plan.toLowerCase();
        }
        
        // Insert license into database
        await client.query(`
          INSERT INTO licenses (
            license_key, 
            email, 
            plan, 
            status, 
            max_devices, 
            seats, 
            max_devices_per_user, 
            expiry_date
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          s3License.licenseKey,
          s3License.email || s3License.customerEmail || 'migrated@fiddyscript.com',
          plan,
          status,
          s3License.maxSystems || s3License.maxDevices || 2,
          s3License.seats || 1,
          s3License.maxDevicesPerUser || 2,
          expiryDate
        ]);
        
        // Migrate devices if they exist
        if (s3License.systems && Array.isArray(s3License.systems)) {
          for (const system of s3License.systems) {
            try {
              // Determine device status from isActive field
              const deviceStatus = system.isActive === false ? 'revoked' : 'active';
              
              // Extract platform from user agent if available
              let platform = 'unknown';
              if (system.fingerprint && system.fingerprint.userAgent) {
                const userAgent = system.fingerprint.userAgent.toLowerCase();
                if (userAgent.includes('windows')) platform = 'windows';
                else if (userAgent.includes('mac')) platform = 'mac';
                else if (userAgent.includes('linux')) platform = 'linux';
                else if (userAgent.includes('android')) platform = 'android';
                else if (userAgent.includes('ios')) platform = 'ios';
                else if (userAgent.includes('web')) platform = 'web';
              }
              
              await client.query(`
                INSERT INTO license_devices (
                  license_key, 
                  user_email, 
                  device_id, 
                  platform, 
                  device_name, 
                  status,
                  first_activated_at,
                  last_seen_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (license_key, device_id) DO NOTHING
              `, [
                s3License.licenseKey,
                s3License.email || s3License.customerEmail,
                system.systemId,
                platform,
                `Migrated Device (${system.systemId})`,
                deviceStatus,
                system.activatedAt || system.firstActivatedAt || new Date(),
                system.lastSeen || system.lastSeenAt || new Date()
              ]);
            } catch (deviceError) {
              console.error('Error migrating device:', deviceError);
            }
          }
        }
        
        migrated++;
        
      } catch (licenseError) {
        console.error('Error migrating license:', s3License.licenseKey, licenseError);
        errors.push({
          licenseKey: s3License.licenseKey,
          error: licenseError.message
        });
      }
    }
    
    client.release();
    
    res.json({
      success: true,
      message: `Migration completed: ${migrated} licenses migrated, ${skipped} skipped`,
      migrated,
      skipped,
      errors: errors.length > 0 ? errors : undefined
    });
    
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({ 
      error: 'Migration failed', 
      details: error.message 
    });
  }
});

// Get migration status
app.get('/api/licenses/migration-status', async (req, res) => {
  try {
    const client = await db.connect();
    
    // Count database licenses
    const dbCount = await client.query('SELECT COUNT(*) as count FROM licenses');
    
    // Try to count S3 licenses
    let s3Count = 0;
    try {
      const s3Params = {
        Bucket: process.env.S3_BUCKET_NAME || 'myfideanlicense',
        Key: 'fdscriptlicense.json'
      };
      const s3Data = await s3.getObject(s3Params).promise();
      const licensesData = JSON.parse(s3Data.Body.toString());
      s3Count = (licensesData.licenses || []).length;
    } catch (s3Error) {
      // S3 file doesn't exist or can't be read
    }
    
    client.release();
    
    res.json({
      databaseLicenses: dbCount.rows[0].count,
      s3Licenses: s3Count,
      migrationNeeded: s3Count > 0
    });
    
  } catch (error) {
    console.error('Migration status error:', error);
    res.status(500).json({ error: 'Failed to get migration status' });
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
