const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/feedback_db'
});

async function clearDevices() {
  const client = await pool.connect();
  try {
    console.log('Clearing devices for license FD-59E2EC25-E5DB-33D3...');
    
    // Delete all devices for this license
    const result = await client.query(
      'DELETE FROM license_devices WHERE license_key = $1',
      ['FD-59E2EC25-E5DB-33D3']
    );
    
    console.log(`Cleared ${result.rowCount} devices successfully!`);
    console.log('You can now activate the license with your system.');
    
  } catch (error) {
    console.error('Error clearing devices:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

clearDevices();


