const AWS = require('aws-sdk');

// AWS S3 Configuration
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

async function checkS3Licenses() {
  try {
    console.log('🔍 Checking S3 bucket for licenses...');
    
    // List all objects in the bucket
    const listParams = {
      Bucket: process.env.S3_BUCKET_NAME || 'myfideanlicense'
    };
    
    const objects = await s3.listObjectsV2(listParams).promise();
    console.log('📁 Files in S3 bucket:');
    objects.Contents.forEach(obj => {
      console.log(`  - ${obj.Key} (${obj.Size} bytes)`);
    });
    
    // Try to read the licenses.json file
    const licensesParams = {
      Bucket: process.env.S3_BUCKET_NAME || 'myfideanlicense',
      Key: 'fdscriptlicense.json'
    };
    
    try {
      const licensesData = await s3.getObject(licensesParams).promise();
      const licenses = JSON.parse(licensesData.Body.toString());
      
      console.log('\n📋 Licenses found in licenses.json:');
      console.log('Structure:', JSON.stringify(licenses, null, 2));
      
      if (licenses.licenses && Array.isArray(licenses.licenses)) {
        console.log(`\n📊 Total licenses: ${licenses.licenses.length}`);
        licenses.licenses.forEach((license, index) => {
          console.log(`\n${index + 1}. License Details:`);
          console.log(`   Key: ${license.licenseKey}`);
          console.log(`   Email: ${license.email || license.customerEmail || 'N/A'}`);
          console.log(`   Name: ${license.customerName || license.name || 'N/A'}`);
          console.log(`   Plan: ${license.plan || 'N/A'}`);
          console.log(`   Status: ${license.status || 'N/A'}`);
          console.log(`   Duration: ${license.duration || license.licenseDuration || 'N/A'}`);
          console.log(`   Max Systems: ${license.maxSystems || license.maxDevices || 'N/A'}`);
          console.log(`   Expiry: ${license.expiryDate || 'N/A'}`);
        });
      }
      
      // Check for the specific licenses you mentioned
      const specificLicenses = [
        'FD-ZVFOQ8KI-U9V8-V801',
        'FD-W6H2A643-YSAP-MT27'
      ];
      
      console.log('\n🔍 Looking for specific licenses:');
      specificLicenses.forEach(key => {
        const found = licenses.licenses?.find(l => l.licenseKey === key);
        if (found) {
          console.log(`✅ Found: ${key}`);
          console.log(`   Email: ${found.email || found.customerEmail || 'N/A'}`);
          console.log(`   Name: ${found.customerName || found.name || 'N/A'}`);
        } else {
          console.log(`❌ Not found: ${key}`);
        }
      });
      
    } catch (error) {
      console.log('❌ Error reading licenses.json:', error.message);
      
      // Try alternative file names
      const alternativeFiles = ['licenses.txt', 'license-data.json', 'fiddyscript-licenses.json'];
      
      for (const filename of alternativeFiles) {
        try {
          console.log(`\n🔍 Trying ${filename}...`);
          const altParams = {
            Bucket: process.env.S3_BUCKET_NAME || 'myfideanlicense',
            Key: filename
          };
          const altData = await s3.getObject(altParams).promise();
          console.log(`✅ Found ${filename}:`);
          console.log('Content:', altData.Body.toString());
          break;
        } catch (altError) {
          console.log(`❌ ${filename} not found`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error checking S3:', error);
  }
}

// Run the check
checkS3Licenses();
