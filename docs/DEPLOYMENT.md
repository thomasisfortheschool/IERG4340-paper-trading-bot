# Deployment Guide - IERG4340 Trading System

## Overview

This guide covers deploying both the frontend (to Vercel) and backend (cloud options).

---

## Frontend Deployment (Vercel)

### Step 1: Prepare Repository

```bash
cd frontend
git init
git add .
git commit -m "Initial commit"
```

### Step 2: Push to GitHub

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

### Step 3: Connect to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Authorize GitHub & select your repository
4. Configure:
   - **Framework Preset**: Next.js
   - **Root Directory**: `frontend`
   - **Environment Variables**:
     ```
     NEXT_PUBLIC_API_URL=https://your-api-domain.com/api
     ```
5. Click "Deploy"

Vercel will automatically build and deploy on every push to `main`.

### Step 4: Custom Domain (Optional)

In Vercel dashboard:
1. Go to Project Settings
2. Domains → Add → Enter your domain
3. Update DNS records per Vercel instructions

---

## Backend Deployment Options

### Option 1: Railway (Recommended for beginners)

Railway makes Python hosting easy.

**Setup:**
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. New Project → GitHub Repo
4. Select your project
5. Add variables:
   ```
   IB_HOST=127.0.0.1
   IB_PORT=7497
   FLASK_ENV=production
   ```
6. Deploy

Railway provides a public URL automatically.

### Option 2: Heroku

**Create Procfile** in `backend/`:
```
web: gunicorn api.app:app
```

**Deploy:**
```bash
heroku login
heroku create <app-name>
git push heroku main
```

### Option 3: Google Cloud Run

**Create Dockerfile** in `backend/`:
```dockerfile
FROM python:3.11
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["gunicorn", "api.app:app", "--bind", "0.0.0.0:8080"]
```

**Deploy:**
```bash
gcloud run deploy ierg4340-bot \
  --source . \
  --platform managed \
  --region us-central1
```

### Option 4: AWS Elastic Beanstalk

**Create `.ebextensions/python.config`:**
```yaml
option_settings:
  aws:elasticbeanstalk:container:python:
    WSGIPath: api/app:app
```

**Deploy:**
```bash
eb init
eb create
eb deploy
```

---

## Environment Variables

### Backend

```bash
# API Server
FLASK_ENV=production
FLASK_DEBUG=false

# IBKR Broker (if using real account)
IB_HOST=127.0.0.1
IB_PORT=7497  # Paper trading
IB_CLIENT_ID=100

# Database (if added)
DATABASE_URL=postgresql://...

# CORS (for frontend domain)
ALLOWED_ORIGINS=https://yourdomain.vercel.app
```

### Frontend (.env.production)

```bash
NEXT_PUBLIC_API_URL=https://your-api-domain.com/api
```

---

## Database Setup (Optional)

For persistent data, add SQLite or PostgreSQL:

**Backend setup:**
```python
from sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///trading.db')
db = SQLAlchemy(app)

# Create models for trades, positions, logs
```

---

## Monitoring & Logging

### Backend Logs

**Railway/Heroku:**
```bash
# View logs
railway logs  # or 'heroku logs --tail'
```

**Enable detailed logging in Flask:**
```python
import logging
logging.basicConfig(level=logging.INFO)
```

### Frontend Errors

Vercel automatically captures frontend errors. Access in:
- Vercel Dashboard → Monitoring → Errors

---

## Performance Optimization

### Frontend (Next.js)

```bash
# Check build size
npm run build
npm run start  # Test production build

# Optimize images in components:
# Use next/image instead of <img>
```

### Backend (Flask)

```python
# Add caching for screener results
from flask_caching import Cache
cache = Cache(app, config={'CACHE_TYPE': 'simple'})

@app.route('/screen/blowup-stocks')
@cache.cached(timeout=300)  # Cache 5 minutes
def screen_stocks():
    ...
```

---

## Security Checklist

- [ ] Remove debug mode in production (`FLASK_DEBUG=false`)
- [ ] Use HTTPS (automatic on Vercel)
- [ ] Set `CORS_ORIGINS` to frontend domain only
- [ ] Store secrets in environment variables (never in code)
- [ ] Add rate limiting to API endpoints
- [ ] Enable authentication for API (add in production)
- [ ] Validate all user inputs
- [ ] Use CSRF protection for POST requests

---

## Cost Estimates

| Service | Free Tier | Pricing |
|---------|-----------|---------|
| Vercel (Frontend) | 100GB bandwidth/month | $0 for most projects |
| Railway (Backend) | $5/month credit | $5-30/month typical |
| Heroku | Deprecated free tier | $7/month dyno |
| GCP Cloud Run | 2M invocations/month | Pay-per-use (~$0.20/M calls) |

---

## Troubleshooting Deployment

### Frontend won't build
```bash
# Check build output
npm run build

# Fix Next.js config issues
# Ensure tsconfig.json is valid
```

### API returns 502 Bad Gateway
- Backend might be starting too slowly
- Check environment variables are set
- Verify all dependencies installed

### CORS errors
```python
# Backend must allow frontend domain
CORS(app, resources={
    r"/api/*": {
        "origins": [
            "http://localhost:3000",  # Dev
            "https://yourdomain.vercel.app"  # Prod
        ]
    }
})
```

### Cold starts (API slow on first request)
- Normal on serverless platforms
- Add warmup requests or use a dedicated server

---

## Monitoring Health

Add health check endpoint:

**Frontend (.env):**
```
NEXT_PUBLIC_HEALTH_CHECK_URL=https://your-api.com/api/status/health
```

**Dashboard can poll periodically:**
```typescript
useEffect(() => {
  const checkHealth = async () => {
    try {
      await fetch(process.env.NEXT_PUBLIC_HEALTH_CHECK_URL);
    } catch {
      // Alert user API is down
    }
  };
  
  const interval = setInterval(checkHealth, 60000);
  return () => clearInterval(interval);
}, []);
```

---

## Next Steps

1. Deploy frontend to Vercel
2. Deploy backend to Railway/Heroku
3. Test endpoints with deployed API URL
4. Monitor logs for errors
5. Add authentication before going live with real data

Congratulations! Your trading system is now live. 🎉

