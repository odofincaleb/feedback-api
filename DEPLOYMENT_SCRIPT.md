# 🚀 Production Deployment Script

## 📋 **Prerequisites**
- Heroku account (free)
- AWS S3 bucket (you already have this)
- Git repository

## 🔧 **Step-by-Step Deployment**

### **Step 1: Prepare Production Files**
```bash
# Navigate to feedback-api directory
cd feedback-api

# Copy production files
copy server.heroku.js server.js
copy package.heroku.json package.json

# Install dependencies
npm install
```

### **Step 2: Create Heroku App**
```bash
# Login to Heroku (will open browser)
npx heroku login

# Create new app
npx heroku create fiddyscript-feedback-api

# Add PostgreSQL database
npx heroku addons:create heroku-postgresql:mini
```

### **Step 3: Configure Environment Variables**
```bash
# Set basic environment variables
npx heroku config:set NODE_ENV=production
npx heroku config:set CORS_ORIGIN=https://fiddyscript.com
npx heroku config:set APP_VERSION=1.0.0

# Set AWS S3 credentials (replace with your actual values)
npx heroku config:set AWS_ACCESS_KEY_ID=YOUR_AWS_ACCESS_KEY
npx heroku config:set AWS_SECRET_ACCESS_KEY=YOUR_AWS_SECRET_KEY
npx heroku config:set AWS_REGION=us-east-1
npx heroku config:set S3_BACKUP_BUCKET=YOUR_S3_BUCKET_NAME
```

### **Step 4: Deploy to Heroku**
```bash
# Initialize git if not already done
git init
git add .
git commit -m "Production deployment with S3 backups"

# Add Heroku remote
npx heroku git:remote -a fiddyscript-feedback-api

# Deploy
git push heroku main
```

### **Step 5: Verify Deployment**
```bash
# Check logs
npx heroku logs --tail

# Test health endpoint
curl https://fiddyscript-feedback-api.herokuapp.com/api/health

# Test backup
curl -X POST https://fiddyscript-feedback-api.herokuapp.com/api/backup
```

## 📱 **Update Mobile App**

### **Update Environment Configuration:**
```typescript
// Mobile/FiddyscriptMobile/src/config/environment.ts
const productionConfig: EnvironmentConfig = {
  apiUrls: [
    'https://fiddyscript-feedback-api.herokuapp.com',
    'https://api.fiddyscript.com' // Custom domain
  ],
  environment: 'production',
  timeout: 15000,
  retryAttempts: 2
};
```

## 🔒 **Security Checklist**

### **AWS S3 Setup:**
1. **Create IAM User** with S3 permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR_BUCKET_NAME",
        "arn:aws:s3:::YOUR_BUCKET_NAME/*"
      ]
    }
  ]
}
```

2. **Get AWS Credentials:**
   - Access Key ID
   - Secret Access Key
   - Region (e.g., us-east-1)

### **Environment Variables to Set:**
```bash
NODE_ENV=production
CORS_ORIGIN=https://fiddyscript.com
APP_VERSION=1.0.0
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
S3_BACKUP_BUCKET=your_bucket_name
```

## 🗄️ **Database Management**

### **View Database:**
```bash
# Connect to PostgreSQL
npx heroku pg:psql

# View tables
\dt

# View feedback
SELECT * FROM feedback ORDER BY created_at DESC;
```

### **Export Data:**
```bash
# Export to SQL
npx heroku pg:dump > feedback_backup.sql

# Export to CSV
npx heroku pg:psql -c "COPY feedback TO STDOUT CSV HEADER" > feedback.csv
```

## 🔧 **Troubleshooting**

### **Common Issues:**

1. **Database Connection:**
```bash
# Check database status
npx heroku pg:info

# Reset database (if needed)
npx heroku pg:reset DATABASE_URL
```

2. **S3 Backup Issues:**
```bash
# Check AWS credentials
npx heroku config:get AWS_ACCESS_KEY_ID

# Test S3 access
npx heroku run node -e "
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
s3.listBuckets().promise().then(console.log);
"
```

3. **App Not Responding:**
```bash
# Check logs
npx heroku logs --tail

# Restart app
npx heroku restart

# Check dyno status
npx heroku ps
```

## 📊 **Monitoring**

### **Health Check:**
```bash
curl https://fiddyscript-feedback-api.herokuapp.com/api/health
```

### **Manual Backup:**
```bash
curl -X POST https://fiddyscript-feedback-api.herokuapp.com/api/backup
```

## 💰 **Cost Breakdown**

### **Monthly Costs:**
```
Heroku Dyno (Basic): $7/month
Heroku Postgres Mini: $5/month
S3 Storage (1GB): $0.023/month
S3 API Calls (1,000): $0.005/month
Total: ~$12/month
```

### **Free Tier Alternative:**
```
Railway: Free tier available
Render: Free tier available
Supabase: Free tier available
Total: $0/month (limited usage)
```

## 🎯 **Production Checklist**

- [ ] Heroku app created
- [ ] PostgreSQL database added
- [ ] S3 bucket configured
- [ ] Environment variables set
- [ ] Code deployed successfully
- [ ] Health check passes
- [ ] Backup system working
- [ ] Mobile app updated
- [ ] Custom domain configured (optional)
- [ ] SSL certificate active
- [ ] Monitoring tools set up

## 🚀 **Quick Deploy Commands**

```bash
# One-liner deployment (after setup)
cd feedback-api && copy server.heroku.js server.js && copy package.heroku.json package.json && npm install && git add . && git commit -m "Production deployment" && npx heroku git:remote -a fiddyscript-feedback-api && git push heroku main
```

## 📞 **Support**

If you encounter issues:
1. Check Heroku logs: `npx heroku logs --tail`
2. Verify environment variables: `npx heroku config`
3. Test database connection: `npx heroku pg:psql`
4. Test S3 backup: `curl -X POST https://your-app.herokuapp.com/api/backup`

Your production API will be available at: `https://fiddyscript-feedback-api.herokuapp.com`

