# 🚀 Render Deployment Guide (Free)

## 📋 **Why Render?**
- ✅ **Free tier available**
- ✅ **No payment verification required**
- ✅ **Automatic deployments**
- ✅ **PostgreSQL included**
- ✅ **Custom domains**

## 🔧 **Step-by-Step Render Deployment**

### **Step 1: Prepare Files**
```bash
# Navigate to feedback-api directory
cd feedback-api

# Copy production files
copy server.heroku.js server.js
copy package.heroku.json package.json

# Install dependencies
npm install
```

### **Step 2: Create Render Account**
1. Go to [Render.com](https://render.com)
2. Sign up with GitHub
3. Create new Web Service

### **Step 3: Connect Repository**
1. In Render dashboard, click "New +"
2. Select "Web Service"
3. Connect your GitHub repository
4. Select the `feedback-api` folder

### **Step 4: Configure Web Service**
- **Name**: `fiddyscript-feedback-api`
- **Environment**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Plan**: `Free`

### **Step 5: Add PostgreSQL**
1. In Render dashboard, click "New +"
2. Select "PostgreSQL"
3. Name: `fiddyscript-db`
4. Plan: `Free`

### **Step 6: Set Environment Variables**
In your Web Service settings, add these environment variables:

```env
NODE_ENV=production
CORS_ORIGIN=https://fiddyscript.com
APP_VERSION=1.0.0
DATABASE_URL=your_postgresql_url_from_render
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
S3_BACKUP_BUCKET=your_s3_bucket_name
```

### **Step 7: Deploy**
Render will automatically deploy when you push to your GitHub repository:

```bash
git add .
git commit -m "Render deployment"
git push origin main
```

### **Step 8: Get Your URL**
Render will provide a URL like: `https://fiddyscript-feedback-api.onrender.com`

## 📱 **Update Mobile App**

### **Update Environment Configuration:**
```typescript
// Mobile/FiddyscriptMobile/src/config/environment.ts
const productionConfig: EnvironmentConfig = {
  apiUrls: [
    'https://fiddyscript-feedback-api.onrender.com',
    'https://api.fiddyscript.com'
  ],
  environment: 'production',
  timeout: 15000,
  retryAttempts: 2
};
```

## 🔒 **AWS S3 Setup**

### **1. Create S3 Bucket:**
1. Go to AWS Console → S3
2. Create bucket: `fiddyscript-backups`
3. Set region: `us-east-1`

### **2. Create IAM User:**
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
        "arn:aws:s3:::fiddyscript-backups",
        "arn:aws:s3:::fiddyscript-backups/*"
      ]
    }
  ]
}
```

### **3. Get AWS Credentials:**
- Access Key ID
- Secret Access Key
- Region (e.g., us-east-1)

## 🗄️ **Database Management**

### **View Database:**
Render provides a PostgreSQL admin interface in the dashboard.

### **Export Data:**
```bash
# Connect to Render PostgreSQL
psql $DATABASE_URL

# Export data
pg_dump $DATABASE_URL > feedback_backup.sql
```

## 📊 **Monitoring**

### **Health Check:**
```bash
curl https://fiddyscript-feedback-api.onrender.com/api/health
```

### **Manual Backup:**
```bash
curl -X POST https://fiddyscript-feedback-api.onrender.com/api/backup
```

## 💰 **Cost Breakdown**

### **Render Free Tier:**
```
Render Web Service: Free (750 hours/month)
PostgreSQL: Free (1GB storage)
S3 Storage: ~$0.023/month (1GB)
S3 API Calls: ~$0.005/month (1,000 requests)
Total: ~$0.03/month
```

## 🎯 **Production Checklist**

- [ ] Render account created
- [ ] GitHub repository connected
- [ ] Web Service created
- [ ] PostgreSQL database added
- [ ] Environment variables set
- [ ] Code deployed successfully
- [ ] Health check passes
- [ ] S3 bucket configured
- [ ] AWS credentials set
- [ ] Mobile app updated
- [ ] Backup system tested

## 🔧 **Troubleshooting**

### **Common Issues:**

1. **Deployment Failed:**
   - Check Render logs in dashboard
   - Verify environment variables
   - Check `package.json` and `server.js`

2. **Database Connection:**
   - Verify `DATABASE_URL` is set
   - Check Render PostgreSQL status

3. **S3 Backup Issues:**
   - Verify AWS credentials
   - Check S3 bucket permissions
   - Test S3 access manually

## 🚀 **Quick Deploy Commands**

```bash
# After setting up Render
cd feedback-api
copy server.heroku.js server.js
copy package.heroku.json package.json
npm install
git add .
git commit -m "Render deployment"
git push origin main
```

## 📞 **Support**

If you encounter issues:
1. Check Render logs in dashboard
2. Verify environment variables
3. Test database connection
4. Test S3 backup manually

Your production API will be available at: `https://fiddyscript-feedback-api.onrender.com`

