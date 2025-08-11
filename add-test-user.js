const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/feedback_db'
});

async function addTestUser() {
  const client = await pool.connect();
  try {
    console.log('Adding test user to mobile test license...');
    
    // Check if user already exists
    const existingUser = await client.query(
      'SELECT * FROM license_users WHERE license_key = $1 AND user_email = $2',
      ['FD-TEST-MOBILE-2024', 'test@example.com']
    );
    
    if (existingUser.rows.length > 0) {
      console.log('User already exists:', existingUser.rows[0]);
      return;
    }
    
    // Add the test user
    const result = await client.query(
      'INSERT INTO license_users (license_key, user_email, role, max_devices) VALUES ($1, $2, $3, $4)',
      ['FD-TEST-MOBILE-2024', 'test@example.com', 'member', 2]
    );
    
    console.log('Test user added successfully!');
    console.log('License: FD-TEST-MOBILE-2024');
    console.log('User: test@example.com');
    console.log('Role: member');
    
  } catch (error) {
    console.error('Error adding test user:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

addTestUser();


