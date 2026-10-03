# FutureX Lab Backend - Authentication System v2.0

## Overview

This is a production-ready authentication backend with advanced security features, email verification, password management, and MongoDB integration.

## Features

✅ **User Authentication**
- Registration with email verification
- Login with JWT tokens
- Password reset via email
- Change password for authenticated users

✅ **Security**
- Bcrypt password hashing
- JWT token-based authentication
- Rate limiting (login attempts, password reset)
- CORS protection
- Helmet security headers
- Input validation and sanitization
- Secure password requirements (8+ chars, uppercase, lowercase, number)

✅ **Database**
- MongoDB with automatic indexing
- TTL indexes for automatic token cleanup
- Unique email constraint

✅ **Email Services**
- Email verification on registration
- Password reset emails
- Customizable email templates
- Support for multiple email providers (Gmail, etc.)

✅ **AI Integration**
- Gemini API integration for chatbot
- Retry logic for failed requests
- Protected endpoints requiring authentication

## Installation

### Prerequisites
- Node.js 18+
- MongoDB Atlas account (or local MongoDB)
- Gmail account (for email service) or other email provider
- Gemini API key

### Setup Steps

1. **Install dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Then edit `.env` with your credentials:
   ```
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/futurex
   JWT_SECRET=your_super_secret_key_here
   EMAIL_SERVICE=gmail
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASSWORD=your-app-password
   GEMINI_API_KEY=your_gemini_api_key
   FRONTEND_URL=http://localhost:5173
   ```

3. **Start the server**
   ```bash
   npm start          # Production
   npm run dev        # Development with auto-reload
   ```

## API Endpoints

### Authentication

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123",
  "confirmPassword": "SecurePass123"
}
```

**Response (201)**
```json
{
  "message": "Registration successful. Please check your email to verify your account.",
  "token": "eyJhbGc...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "isVerified": false
  }
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "SecurePass123"
}
```

**Response (200)**
```json
{
  "token": "eyJhbGc...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "isVerified": true
  }
}
```

#### Get Current User
```http
GET /api/auth/me
Authorization: Bearer eyJhbGc...
```

**Response (200)**
```json
{
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "isVerified": true,
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

#### Verify Email
```http
POST /api/auth/verify-email
Content-Type: application/json

{
  "token": "verification_token_from_email"
}
```

#### Forgot Password
```http
POST /api/auth/forgot-password
Content-Type: application/json

{
  "email": "john@example.com"
}
```

#### Reset Password
```http
POST /api/auth/reset-password
Content-Type: application/json

{
  "token": "reset_token_from_email",
  "password": "NewSecurePass456",
  "confirmPassword": "NewSecurePass456"
}
```

#### Change Password (Authenticated)
```http
POST /api/auth/change-password
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "currentPassword": "SecurePass123",
  "newPassword": "NewSecurePass456",
  "confirmPassword": "NewSecurePass456"
}
```

### Chat

#### Send Message
```http
POST /api/chat
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "message": "Hello, how does AI work?"
}
```

**Response (200)**
```json
{
  "reply": "AI works by..."
}
```

## Security Best Practices

1. **Environment Variables** - Never commit `.env` to version control
2. **HTTPS** - Use HTTPS in production (Secure cookie flag enabled)
3. **CORS** - Configure to match your frontend domain
4. **Rate Limiting** - Protects against brute force attacks
5. **Password Hashing** - Bcryptjs with salt rounds
6. **JWT Expiration** - Tokens expire after 7 days
7. **Email Verification** - Prevents spam registrations
8. **Input Validation** - All inputs validated and sanitized

## Database Schema

### users
```javascript
{
  _id: ObjectId,
  name: String,
  email: String (unique),
  passwordHash: String,
  isVerified: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### email_verifications
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  token: String,
  expiresAt: Date (TTL: 24 hours)
}
```

### password_reset_tokens
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  token: String,
  expiresAt: Date (TTL: 1 hour)
}
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|----------|
| MONGODB_URI | MongoDB connection string | mongodb+srv://user:pass@cluster.mongodb.net/futurex |
| JWT_SECRET | Secret key for JWT signing | your_super_secret_key |
| JWT_EXPIRES_IN | JWT expiration time | 7d |
| EMAIL_SERVICE | Email provider | gmail |
| EMAIL_USER | Email account | your-email@gmail.com |
| EMAIL_PASSWORD | Email password or app password | your-app-password |
| EMAIL_FROM | Sender email address | noreply@futurex-lab.com |
| GEMINI_API_KEY | Google Gemini API key | your_api_key |
| FRONTEND_URL | Frontend application URL | http://localhost:5173 |
| NODE_ENV | Environment | development/production |
| PORT | Server port | 3000 |

## Error Handling

All endpoints return appropriate HTTP status codes:

- `200` - Success
- `201` - Created
- `400` - Bad request (validation error)
- `401` - Unauthorized
- `409` - Conflict (email already exists)
- `500` - Server error

Error responses follow this format:
```json
{
  "error": "Error message describing what went wrong"
}
```

## Rate Limiting

- **General** - 100 requests per 15 minutes per IP
- **Auth (Login/Register)** - 5 requests per 15 minutes per IP
- **Password Reset** - 3 requests per hour per IP

## Troubleshooting

### Email not sending?
1. Check Gmail app password (not regular password)
2. Enable "Less secure app access" if using Gmail
3. Verify EMAIL_USER and EMAIL_PASSWORD in .env
4. Check spam folder

### MongoDB connection fails?
1. Verify MONGODB_URI is correct
2. Whitelist your IP in MongoDB Atlas
3. Check database user credentials

### JWT token expired?
1. Implement token refresh logic on frontend
2. Adjust JWT_EXPIRES_IN if needed
3. Clear browser storage and login again

## Frontend Integration

Update your frontend to:

1. **Store JWT token** - Save to localStorage after login/register
2. **Send in headers** - Include `Authorization: Bearer {token}` with requests
3. **Handle 401** - Redirect to login if token expired
4. **Update endpoints** - All chat and authenticated endpoints now require tokens

Example:
```javascript
const token = localStorage.getItem('futurex_token');

fetch('/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ message: 'Hello!' })
});
```

## Support

For issues or questions, please open an issue in the repository.
