# Production Deployment Script for PowerShell

Write-Host "Starting Production Deployment..." -ForegroundColor Green

# Step 1: Prepare Production Files
Write-Host "Preparing production files..." -ForegroundColor Yellow
Copy-Item "server.heroku.js" "server.js" -Force
Copy-Item "package.heroku.json" "package.json" -Force

# Step 2: Install Dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install

# Step 3: Initialize Git (if not already done)
if (-not (Test-Path ".git")) {
    Write-Host "Initializing Git repository..." -ForegroundColor Yellow
    git init
}

# Step 4: Commit Changes
Write-Host "Committing changes..." -ForegroundColor Yellow
git add .
git commit -m "Production deployment with S3 backups"

# Step 5: Heroku Login
Write-Host "Logging into Heroku..." -ForegroundColor Yellow
Write-Host "Please complete the login in your browser..." -ForegroundColor Cyan
npx heroku login

# Step 6: Create Heroku App
Write-Host "Creating Heroku app..." -ForegroundColor Yellow
$appName = "fiddyscript-feedback-api"
npx heroku create $appName

# Step 7: Add PostgreSQL
Write-Host "Adding PostgreSQL database..." -ForegroundColor Yellow
npx heroku addons:create heroku-postgresql:mini

# Step 8: Set Environment Variables
Write-Host "Setting environment variables..." -ForegroundColor Yellow
npx heroku config:set NODE_ENV=production
npx heroku config:set CORS_ORIGIN=https://fiddyscript.com
npx heroku config:set APP_VERSION=1.0.0

# Step 9: Deploy
Write-Host "Deploying to Heroku..." -ForegroundColor Yellow
npx heroku git:remote -a $appName
git push heroku main

# Step 10: Verify Deployment
Write-Host "Verifying deployment..." -ForegroundColor Yellow
Write-Host "Checking health endpoint..." -ForegroundColor Cyan
Start-Sleep -Seconds 10
try {
    $healthResponse = Invoke-RestMethod -Uri "https://$appName.herokuapp.com/api/health" -Method Get
    Write-Host "Health check passed: $($healthResponse.status)" -ForegroundColor Green
} catch {
    Write-Host "Health check failed. Check logs with: npx heroku logs --tail" -ForegroundColor Yellow
}

# Step 11: Display Information
Write-Host "`nDeployment Complete!" -ForegroundColor Green
Write-Host "Your API is available at: https://$appName.herokuapp.com" -ForegroundColor Cyan
Write-Host "Health check: https://$appName.herokuapp.com/api/health" -ForegroundColor Cyan
Write-Host "Backup endpoint: https://$appName.herokuapp.com/api/backup" -ForegroundColor Cyan

Write-Host "`nNext Steps:" -ForegroundColor Yellow
Write-Host "1. Set AWS S3 credentials: npx heroku config:set AWS_ACCESS_KEY_ID=YOUR_KEY" -ForegroundColor White
Write-Host "2. Set AWS S3 secret: npx heroku config:set AWS_SECRET_ACCESS_KEY=YOUR_SECRET" -ForegroundColor White
Write-Host "3. Set S3 bucket: npx heroku config:set S3_BACKUP_BUCKET=YOUR_BUCKET" -ForegroundColor White
Write-Host "4. Update mobile app environment config" -ForegroundColor White
Write-Host "5. Test backup: curl -X POST https://$appName.herokuapp.com/api/backup" -ForegroundColor White

Write-Host "`nUseful Commands:" -ForegroundColor Yellow
Write-Host "• View logs: npx heroku logs --tail" -ForegroundColor White
Write-Host "• Check config: npx heroku config" -ForegroundColor White
Write-Host "• Database: npx heroku pg:psql" -ForegroundColor White
Write-Host "• Restart: npx heroku restart" -ForegroundColor White

Write-Host "`nDeployment script completed!" -ForegroundColor Green
