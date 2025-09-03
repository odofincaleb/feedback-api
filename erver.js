warning: in the working copy of 'server.js', LF will be replaced by CRLF the next time Git touches it
[1mdiff --git a/server.js b/server.js[m
[1mindex bcd7b11..2dee6b2 100644[m
[1m--- a/server.js[m
[1m+++ b/server.js[m
[36m@@ -7,7 +7,6 @@[m [mconst AWS = require('aws-sdk');[m
 const path = require('path');[m
 [m
 const app = express();[m
[31m-app.set('trust proxy', 1);[m
 const PORT = process.env.PORT || 3001;[m
 const NODE_ENV = process.env.NODE_ENV || 'production';[m
 [m
[36m@@ -77,7 +76,6 @@[m [mconst createTable = async () => {[m
       CREATE TABLE IF NOT EXISTS licenses ([m
         license_key VARCHAR(64) PRIMARY KEY,[m
         email VARCHAR(255),[m
[31m-        customer_name VARCHAR(255),[m
         plan VARCHAR(50) DEFAULT 'standard',[m
         status VARCHAR(32) DEFAULT 'active',[m
         max_devices INTEGER DEFAULT 2,[m
[36m@@ -89,7 +87,6 @@[m [mconst createTable = async () => {[m
       )[m
     `);[m
     // Ensure new columns exist for older deployments[m
[31m-    await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255)`);[m
     await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS seats INTEGER DEFAULT 1`);[m
     await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS max_devices_per_user INTEGER DEFAULT 2`);[m
     // License devices table[m
[36m@@ -132,53 +129,6 @@[m [mconst createTable = async () => {[m
 [m
 createTable();[m
 [m
[31m-// Add sample license data for testing[m
[31m-const addSampleLicenses = async () => {[m
[31m-  const client = await db.connect();[m
[31m-  try {[m
[31m-    // Check if sample licenses already exist[m
[31m-    const existing = await client.query(`SELECT COUNT(*) FROM licenses WHERE license_key IN ('FD-59E2EC25-E5DB-33D3', 'FD-TEST-MOBILE-2024')`);[m
[31m-    if (existing.rows[0].count > 0) {[m
[31m-      console.log('Sample licenses already exist');[m
[31m-      return;[m
[31m-    }[m
[31m-[m
[31m-    // Add sample licenses[m
[31m-    await client.query(`[m
[31m-      INSERT INTO licenses (license_key, email, plan, status, max_devices, seats, max_devices_per_user, expiry_date) [m
[31m-      VALUES [m
[31m-        ('FD-59E2EC25-E5DB-33D3', 'admin@fiddyscript.com', 'premium', 'active', 5, 3, 2, NOW() + INTERVAL '1 year'),[m
[31m-        ('FD-TEST-MOBILE-2024', 'test@example.com', 'standard', 'active', 2, 1, 2, NOW() + INTERVAL '2 years')[m
[31m-    `);[m
[31m-[m
[31m-    // Add sample users[m
[31m-    await client.query(`[m
[31m-      INSERT INTO license_users (license_key, user_email, role, max_devices) [m
[31m-      VALUES [m
[31m-        ('FD-59E2EC25-E5DB-33D3', 'user1@company.com', 'member', 2),[m
[31m-        ('FD-59E2EC25-E5DB-33D3', 'user2@company.com', 'member', 2)[m
[31m-    `);[m
[31m-[m
[31m-    // Add sample devices[m
[31m-    await client.query(`[m
[31m-      INSERT INTO license_devices (license_key, user_email, device_id, platform, device_name, status) [m
[31m-      VALUES [m
[31m-        ('FD-59E2EC25-E5DB-33D3', 'user1@company.com', 'win_1234567890_abc123', 'windows', 'John''s Laptop', 'active'),[m
[31m-        ('FD-59E2EC25-E5DB-33D3', 'user1@company.com', 'mobile_web_9876543210_def456', 'web', 'John''s Mobile', 'active'),[m
[31m-        ('FD-59E2EC25-E5DB-33D3', 'user2@company.com', 'win_2345678901_ghi789', 'windows', 'Sarah''s Desktop', 'active')[m
[31m-    `);[m
[31m-[m
[31m-    console.log('Sample license data added successfully');[m
[31m-  } catch (error) {[m
[31m-    console.error('Error adding sample licenses:', error);[m
[31m-  } finally {[m
[31m-    client.release();[m
[31m-  }[m
[31m-};[m
[31m-[m
[31m-// Add sample data after table creation[m
[31m-setTimeout(addSampleLicenses, 2000);[m
[31m-[m
 // S3 Backup Functions[m
 const backupToS3 = async () => {[m
   try {[m
[36m@@ -340,6 +290,36 @@[m [mapp.put('/api/feedback/:id/status', async (req, res) => {[m
 // ===== License Management Endpoints =====[m
 const GRACE_DAYS = parseInt(process.env.GRACE_DAYS || '7', 10);[m
 [m
[32m+[m[32m// Get all licenses[m
[32m+[m[32mapp.get('/api/licenses', async (req, res) => {[m
[32m+[m[32m  const client = await db.connect();[m
[32m+[m[32m  try {[m
[32m+[m[32m    // Get all licenses with device count[m
[32m+[m[32m    const { rows } = await client.query(`[m
[32m+[m[32m      SELECT[m[41m [m
[32m+[m[32m        l.*,[m
[32m+[m[32m        COALESCE(device_counts.active_devices, 0) as registered_systems_count[m
[32m+[m[32m      FROM licenses l[m
[32m+[m[32m      LEFT JOIN ([m
[32m+[m[32m        SELECT[m[41m [m
[32m+[m[32m          license_key,[m
[32m+[m[32m          COUNT(*) as active_devices[m
[32m+[m[32m        FROM license_devices[m[41m [m
[32m+[m[32m        WHERE status = 'active'[m
[32m+[m[32m        GROUP BY license_key[m
[32m+[m[32m      ) device_counts ON l.license_key = device_counts.license_key[m
[32m+[m[32m      ORDER BY l.created_at DESC[m
[32m+[m[32m    `);[m
[32m+[m[41m    [m
[32m+[m[32m    res.json(rows);[m
[32m+[m[32m  } catch (e) {[m
[32m+[m[32m    console.error('Get licenses error:', e);[m
[32m+[m[32m    res.status(500).json({ error: 'internal_error' });[m
[32m+[m[32m  } finally {[m
[32m+[m[32m    client.release();[m
[32m+[m[32m  }[m
[32m+[m[32m});[m
[32m+[m
 // Utility: prune stale devices beyond grace period[m
 async function pruneStaleDevices(client, licenseKey) {[m
   const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();[m
[36m@@ -371,134 +351,12 @@[m [masync function ensureLicense(client, licenseKey) {[m
   return rows[0];[m
 }[m
 [m
[31m-// Role-based permission middleware[m
[31m-const checkUserPermission = (requiredRole = 'member') => {[m
[31m-  return async (req, res, next) => {[m
[31m-    try {[m
[31m-      const { licenseKey, userEmail } = req.body || req.query;[m
[31m-      [m
[31m-      if (!licenseKey || !userEmail) {[m
[31m-        return res.status(400).json({ error: 'licenseKey and userEmail are required for permission check' });[m
[31m-      }[m
[31m-[m
[31m-      const client = await db.connect();[m
[31m-      try {[m
[31m-        const userResult = await client.query([m
[31m-          'SELECT role FROM license_users WHERE license_key = $1 AND user_email = $2 AND revoked_at IS NULL',[m
[31m-          [licenseKey, userEmail][m
[31m-        );[m
[31m-[m
[31m-        if (userResult.rows.length === 0) {[m
[31m-          return res.status(403).json({ error: 'user_not_found_or_revoked' });[m
[31m-        }[m
[31m-[m
[31m-        const userRole = userResult.rows[0].role;[m
[31m-        [m
[31m-        // Role hierarchy: admin > member[m
[31m-        const roleHierarchy = { 'admin': 2, 'member': 1 };[m
[31m-        const requiredLevel = roleHierarchy[requiredRole] || 1;[m
[31m-        const userLevel = roleHierarchy[userRole] || 0;[m
[31m-[m
[31m-        if (userLevel < requiredLevel) {[m
[31m-          return res.status(403).json({ [m
[31m-            error: 'insufficient_permissions', [m
[31m-            requiredRole, [m
[31m-            userRole,[m
[31m-            message: `Requires ${requiredRole} role, user has ${userRole} role`[m
[31m-          });[m
[31m-        }[m
[31m-[m
[31m-        req.userRole = userRole;[m
[31m-        next();[m
[31m-      } finally {[m
[31m-        client.release();[m
[31m-      }[m
[31m-    } catch (error) {[m
[31m-      console.error('Permission check error:', error);[m
[31m-      res.status(500).json({ error: 'permission_check_failed' });[m
[31m-    }[m
[31m-  };[m
[31m-};[m
[31m-[m
[31m-// Create new license (for License Manager) - MUST come before /api/licenses/activate[m
[31m-// License Plans:[m
[31m-// - basic: Essential features for individuals (1-3 devices, basic support)[m
[31m-// - standard: Professional features for small teams (3-10 devices, email support)[m
[31m-// - premium: Advanced features for growing businesses (10-50 devices, priority support)[m
[31m-// - enterprise: Full features for large organizations (50+ devices, dedicated support)[m
[31m-app.post('/api/licenses', async (req, res) => {[m
[31m-  const { customerName, customerEmail, licenseDuration, maxSystems, plan = 'standard' } = req.body || {};[m
[31m-  [m
[31m-  if (!customerEmail || !licenseDuration || !maxSystems) {[m
[31m-    return res.status(400).json({ error: 'customerEmail, licenseDuration, and maxSystems are required' });[m
[31m-  }[m
[31m-  [m
[31m-  const client = await db.connect();[m
[31m-  try {[m
[31m-    // Generate license key[m
[31m-    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';[m
[31m-    let licenseKey = 'FD-';[m
[31m-    [m
[31m-    // Generate 8 characters for first part[m
[31m-    for (let i = 0; i < 8; i++) {[m
[31m-      licenseKey += chars.charAt(Math.floor(Math.random() * chars.length));[m
[31m-    }[m
[31m-    licenseKey += '-';[m
[31m-    [m
[31m-    // Generate 4 characters for second part[m
[31m-    for (let i = 0; i < 4; i++) {[m
[31m-      licenseKey += chars.charAt(Math.floor(Math.random() * chars.length));[m
[31m-    }[m
[31m-    licenseKey += '-';[m
[31m-    [m
[31m-    // Generate 4 characters for third part[m
[31m-    for (let i = 0; i < 4; i++) {[m
[31m-      licenseKey += chars.charAt(Math.floor(Math.random() * chars.length));[m
[31m-    }[m
[31m-    [m
[31m-    // Calculate expiry date[m
[31m-    const expiryDate = new Date();[m
[31m-    expiryDate.setDate(expiryDate.getDate() + parseInt(licenseDuration));[m
[31m-    [m
[31m-    // Insert license[m
[31m-    const result = await client.query(`[m
[31m-      INSERT INTO licenses (license_key, email, customer_name, plan, status, max_devices, seats, max_devices_per_user, expiry_date)[m
[31m-      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)[m
[31m-      RETURNING *[m
[31m-    `, [licenseKey, customerEmail, customerName, plan, 'active', parseInt(maxSystems), parseInt(maxSystems), 1, expiryDate]);[m
[31m-    [m
[31m-    const newLicense = result.rows[0];[m
[31m-    [m
[31m-    res.json({[m
[31m-      success: true,[m
[31m-      license: {[m
[31m-        licenseKey: newLicense.license_key,[m
[31m-        customerName: newLicense.customer_name || customerName || customerEmail,[m
[31m-        customerEmail: newLicense.email,[m
[31m-        plan: newLicense.plan,[m
[31m-        status: newLicense.status,[m
[31m-        maxSystems: newLicense.max_devices,[m
[31m-        seats: newLicense.seats,[m
[31m-        maxDevicesPerUser: newLicense.max_devices_per_user,[m
[31m-        expiryDate: newLicense.expiry_date,[m
[31m-        createdAt: newLicense.created_at[m
[31m-      }[m
[31m-    });[m
[31m-  } catch (e) {[m
[31m-    console.error('Create license error:', e);[m
[31m-    res.status(500).json({ error: 'internal_error' });[m
[31m-  } finally {[m
[31m-    client.release();[m
[31m-  }[m
[31m-});[m
[31m-[m
[31m-// Enhanced license activation with role support[m
[32m+[m[32m// Activate device (supports optional userEmail for multi-user licenses)[m
 app.post('/api/licenses/activate', async (req, res) => {[m
   const { licenseKey, deviceId, platform, deviceName, userEmail } = req.body || {};[m
   if (!licenseKey || !deviceId || !platform) {[m
     return res.status(400).json({ error: 'licenseKey, deviceId and platform are required' });[m
   }[m
[31m-  [m
   const client = await db.connect();[m
   try {[m
     const lic = await ensureLicense(client, licenseKey);[m
[36m@@ -525,38 +383,38 @@[m [mapp.post('/api/licenses/activate', async (req, res) => {[m
       const perUserMax = (userRows.rows[0]?.max_devices) || lic.max_devices_per_user || 2;[m
       const perUserActive = await client.query(`SELECT COUNT(*)::int AS cnt FROM license_devices WHERE license_key=$1 AND user_email=$2 AND status='active'`, [licenseKey, userEmail]);[m
       if ((perUserActive.rows[0].cnt || 0) >= perUserMax) {[m
[31m-        return res.status(409).json({ error: 'user_device_limit_reached', maxDevicesPerUser: perUserMax });[m
[32m+[m[32m        const devices = await client.query(`SELECT device_id, platform, device_name, last_seen_at FROM license_devices WHERE license_key=$1 AND user_email=$2 AND status='active' ORDER BY last_seen_at DESC`, [licenseKey, userEmail]);[m
[32m+[m[32m        return res.status(409).json({ error: 'per_user_limit_reached', maxDevicesPerUser: perUserMax, activeDevices: devices.rows });[m
       }[m
     }[m
 [m
[31m-    // Check total device limit[m
[31m-    const totalActive = await client.query(`SELECT COUNT(*)::int AS cnt FROM license_devices WHERE license_key=$1 AND status='active'`, [licenseKey]);[m
[31m-    if ((totalActive.rows[0].cnt || 0) >= (lic.max_devices || 5)) {[m
[31m-      return res.status(409).json({ error: 'total_device_limit_reached', maxDevices: lic.max_devices || 5 });[m
[32m+[m[32m    // If device exists, mark active and update last_seen[m
[32m+[m[32m    const existing = await client.query([m
[32m+[m[32m      `SELECT * FROM license_devices WHERE license_key=$1 AND device_id=$2`,[m
[32m+[m[32m      [licenseKey, deviceId][m
[32m+[m[32m    );[m
[32m+[m[32m    if (existing.rows.length > 0) {[m
[32m+[m[32m      await client.query([m
[32m+[m[32m        `UPDATE license_devices SET status='active', platform=$3, device_name=$4, user_email=$5, last_seen_at=NOW() WHERE license_key=$1 AND device_id=$2`,[m
[32m+[m[32m        [licenseKey, deviceId, platform, deviceName || null, userEmail || null][m
[32m+[m[32m      );[m
[32m+[m[32m      const active = await getActiveDevices(client, licenseKey);[m
[32m+[m[32m      return res.json({ ok: true, maxDevices: lic.max_devices, activeDevices: active });[m
     }[m
 [m
[31m-    // Insert or update device[m
[31m-    await client.query(`[m
[31m-      INSERT INTO license_devices (license_key, user_email, device_id, platform, device_name, status)[m
[31m-      VALUES ($1, $2, $3, $4, $5, 'active')[m
[31m-      ON CONFLICT (license_key, device_id) [m
[31m-      DO UPDATE SET [m
[31m-        user_email = EXCLUDED.user_email,[m
[31m-        platform = EXCLUDED.platform,[m
[31m-        device_name = EXCLUDED.device_name,[m
[31m-        last_seen_at = NOW(),[m
[31m-        status = 'active'[m
[31m-    `, [licenseKey, userEmail || null, deviceId, platform, deviceName || 'Unknown Device']);[m
[31m-[m
[31m-    res.json({ [m
[31m-      ok: true, [m
[31m-      deviceId, [m
[31m-      maxDevices: lic.max_devices || 5,[m
[31m-      maxDevicesPerUser: lic.max_devices_per_user || 2,[m
[31m-      userRole: userEmail ? (await client.query(`SELECT role FROM license_users WHERE license_key=$1 AND user_email=$2`, [licenseKey, userEmail])).rows[0]?.role : null[m
[31m-    });[m
[32m+[m[32m    // Check limit[m
[32m+[m[32m    const active = await getActiveDevices(client, licenseKey);[m
[32m+[m[32m    if (active.length >= lic.max_devices) {[m
[32m+[m[32m      return res.status(409).json({ error: 'limit_reached', maxDevices: lic.max_devices, activeDevices: active });[m
[32m+[m[32m    }[m
[32m+[m[32m    await client.query([m
[32m+[m[32m      `INSERT INTO license_devices (license_key, device_id, platform, device_name, user_email) VALUES ($1, $2, $3, $4, $5)` ,[m
[32m+[m[32m      [licenseKey, deviceId, platform, deviceName || null, userEmail || null][m
[32m+[m[32m    );[m
[32m+[m[32m    const updated = await getActiveDevices(client, licenseKey);[m
[32m+[m[32m    res.json({ ok: true, maxDevices: lic.max_devices, activeDevices: updated });[m
   } catch (e) {[m
[31m-    console.error('Activation error:', e);[m
[32m+[m[32m    console.error('Activate error:', e);[m
     res.status(500).json({ error: 'internal_error' });[m
   } finally {[m
     client.release();[m
[36m@@ -600,125 +458,180 @@[m [mapp.post('/api/licenses/heartbeat', async (req, res) => {[m
   }[m
 });[m
 [m
[31m-// List all licenses[m
[31m-app.get('/api/licenses', async (req, res) => {[m
[32m+[m[32m// Status[m
[32m+[m[32mapp.get('/api/licenses/status', async (req, res) => {[m
[32m+[m[32m  const { licenseKey, devwarning: in the working copy of 'server.js', LF will be replaced by CRLF the next time Git touches it
server.js
