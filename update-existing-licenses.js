const { Pool } = require('pg');

// Database configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/feedback_db',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function updateExistingLicenses() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking existing licenses...');
    
    // Get all licenses that have email but no customer_name
    const { rows } = await client.query(`
      SELECT license_key, email, customer_name 
      FROM licenses 
      WHERE email IS NOT NULL AND (customer_name IS NULL OR customer_name = '')
    `);
    
    console.log(`📊 Found ${rows.length} licenses to update`);
    
    if (rows.length === 0) {
      console.log('✅ No licenses need updating');
      return;
    }
    
    // Update each license
    for (const license of rows) {
      console.log(`🔄 Updating license: ${license.license_key}`);
      console.log(`   Email: ${license.email}`);
      console.log(`   Current customer_name: ${license.customer_name || 'NULL'}`);
      
      // Extract name from email (everything before @)
      const emailName = license.email.split('@')[0];
      const customerName = emailName.charAt(0).toUpperCase() + emailName.slice(1);
      
      await client.query(`
        UPDATE licenses 
        SET customer_name = $1 
        WHERE license_key = $2
      `, [customerName, license.license_key]);
      
      console.log(`   ✅ Updated customer_name to: ${customerName}`);
    }
    
    console.log('🎉 All licenses updated successfully!');
    
    // Verify the updates
    const { rows: verifyRows } = await client.query(`
      SELECT license_key, email, customer_name 
      FROM licenses 
      WHERE email IS NOT NULL
    `);
    
    console.log('\n📋 Verification - All licenses:');
    verifyRows.forEach(license => {
      console.log(`   ${license.license_key}: ${license.customer_name} (${license.email})`);
    });
    
  } catch (error) {
    console.error('❌ Error updating licenses:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the update
updateExistingLicenses()
  .then(() => {
    console.log('✅ Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
