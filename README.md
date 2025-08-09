# Feedback API Server

A simple Express.js API server that manages feedback data between the main app and license manager.

## 🚀 Quick Setup

### 1. Install Dependencies
```bash
cd feedback-api
npm install
```

### 2. Start the Server
```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

The server will start on `http://localhost:3001`

## 📋 API Endpoints

### Health Check
- **GET** `/api/health`
- Returns server status

### Feedback Management
- **GET** `/api/feedback` - Get all feedback (with optional filters)
- **POST** `/api/feedback` - Create new feedback
- **PUT** `/api/feedback/:id/status` - Update feedback status
- **GET** `/api/feedback/summary` - Get feedback summary statistics

### Query Parameters for GET /api/feedback
- `search` - Search in name, email, or message
- `status` - Filter by status (new, in-progress, resolved)
- `date` - Filter by date (today, week, month)

## 🗄️ Database

Uses SQLite for simplicity. Database file: `feedback.db`

### Table Structure
```sql
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'new',
  date TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 🔧 Configuration

### Environment Variables
- `PORT` - Server port (default: 3001)

### CORS
Configured to allow requests from:
- Main app: `http://localhost:3000`
- License manager: `http://localhost:3002`

## 📝 Example Usage

### Submit Feedback
```javascript
const response = await fetch('http://localhost:3001/api/feedback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'John Doe',
    email: 'john@example.com',
    type: 'feedback',
    message: 'Great app!'
  })
});
```

### Get Feedback with Filters
```javascript
const response = await fetch('http://localhost:3001/api/feedback?status=new&date=today');
const feedback = await response.json();
```

### Update Status
```javascript
const response = await fetch('http://localhost:3001/api/feedback/1/status', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'resolved' })
});
```

## 🛠️ Development

### File Structure
```
feedback-api/
├── server.js          # Main server file
├── package.json       # Dependencies
├── feedback.db        # SQLite database (auto-created)
└── README.md         # This file
```

### Testing
Test the API endpoints using curl or Postman:

```bash
# Health check
curl http://localhost:3001/api/health

# Submit feedback
curl -X POST http://localhost:3001/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","type":"feedback","message":"Test message"}'

# Get all feedback
curl http://localhost:3001/api/feedback
```

## 🔒 Security Notes

- CORS is enabled for development
- Input validation is implemented
- SQL injection protection via parameterized queries
- For production, consider adding authentication and HTTPS

