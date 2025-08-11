const AWS = require('aws-sdk');

// AWS S3 Configuration
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const API_BASE = 'https://feedback-api-production-fd15.up.railway.app';

async function manualMigration() {
  try {
    console.log('🚀 Starting manual migration from S3 to Railway API...');
    
    // Read licenses from S3
    const s3Params = {
      Bucket: process.env.S3_BUCKET_NAME || 'myfideanlicense',
      Key: 'fdscriptlicense.json'
    };
    
    console.log('📖 Reading licenses from S3...');
    const s3Data = await s3.getObject(s3Params).promise();
    const licensesData = JSON.parse(s3Data.Body.toString());
    const s3Licenses = licensesData.licenses || [];
    
    console.log(`📊 Found ${s3Licenses.length} licenses in S3`);
    
    let migrated = 0;
    let skipped = 0;
    const errors = [];
    
    // Process each license
    for (const s3License of s3Licenses) {
      try {
        console.log(`\n🔄 Processing license: ${s3License.licenseKey}`);
        
        // Check if license already exists in database
        const statusResponse = await fetch(`${API_BASE}/api/licenses/status?licenseKey=${s3License.licenseKey}`);
        if (statusResponse.ok) {
          console.log(`⏭️  License ${s3License.licenseKey} already exists, skipping...`);
          skipped++;
          continue;
        }
        
        // Prepare license data for API
        const licenseData = {
          customerName: s3License.customerName || s3License.name || 'Migrated User',
          customerEmail: s3License.email || s3License.customerEmail || 'migrated@fiddyscript.com',
          licenseDuration: calculateDuration(s3License.expiryDate),
          maxSystems: s3License.maxSystems || s3License.maxDevices || 2,
          plan: s3License.plan ? s3License.plan.toLowerCase() : 'standard'
        };
        
        console.log(`📝 License data:`, licenseData);
        
        // Create license via API
        const createResponse = await fetch(`${API_BASE}/api/licenses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(licenseData)
        });
        
        if (createResponse.ok) {
          const result = await createResponse.json();
          console.log(`✅ Successfully migrated: ${s3License.licenseKey}`);
          console.log(`   Generated key: ${result.license.licenseKey}`);
          migrated++;
          
          // If the generated key is different, we need to update it to match the original
          if (result.license.licenseKey !== s3License.licenseKey) {
            console.log(`🔄 Updating license key to match original: ${s3License.licenseKey}`);
            
            // Note: This would require an endpoint to update license keys
            // For now, we'll just note that the key is different
            console.log(`⚠️  Note: Generated key (${result.license.licenseKey}) differs from original (${s3License.licenseKey})`);
          }
          
        } else {
          const errorText = await createResponse.text();
          console.log(`❌ Failed to migrate ${s3License.licenseKey}: ${errorText}`);
          errors.push({
            licenseKey: s3License.licenseKey,
            error: errorText
          });
        }
        
      } catch (licenseError) {
        console.error(`❌ Error processing license ${s3License.licenseKey}:`, licenseError.message);
        errors.push({
          licenseKey: s3License.licenseKey,
          error: licenseError.message
        });
      }
    }
    
    console.log('\n📋 Migration Summary:');
    console.log(`✅ Successfully migrated: ${migrated} licenses`);
    console.log(`⏭️  Skipped (already exist): ${skipped} licenses`);
    console.log(`❌ Errors: ${errors.length} licenses`);
    
    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach(error => {
        console.log(`   - ${error.licenseKey}: ${error.error}`);
      });
    }
    
    console.log('\n🎉 Manual migration completed!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

function calculateDuration(expiryDate) {
  if (!expiryDate) return 365; // Default 1 year
  
  const expiry = new Date(expiryDate);
  const now = new Date();
  const diffTime = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return Math.max(1, diffDays); // Minimum 1 day
}

// Run the migration
manualMigration();
