import express from 'express';
import { ObjectId } from 'mongodb';
import { getDB } from '../config/database.mjs';
import { hashPassword, verifyPassword, generateToken, generateRandomToken } from '../config/auth.mjs';
import { sendVerificationEmail, sendPasswordResetEmail } from '../config/email.mjs';
import { authenticateToken, optionalAuth } from '../middleware/auth.mjs';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimiter.mjs';
import { validateEmail, validatePassword, validateName, sanitizeEmail, sanitizeName } from '../middleware/validation.mjs';

const router = express.Router();

// Get current user
router.get('/me', authenticateToken, (req, res) => {
  const user = req.user;
  res.json({
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      isVerified: user.isVerified,
      createdAt: user.createdAt
    }
  });
});

// Register
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;
    
    // Validation
    const sanitizedName = sanitizeName(name);
    const sanitizedEmail = sanitizeEmail(email);
    
    if (!validateName(sanitizedName)) {
      return res.status(400).json({ error: 'Name must be between 2 and 80 characters.' });
    }
    
    if (!validateEmail(sanitizedEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    
    if (!validatePassword(password)) {
      return res.status(400).json({ 
        error: 'Password must be at least 8 characters with uppercase, lowercase, and a number.' 
      });
    }
    
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
    
    const db = getDB();
    
    // Check if user exists
    const existingUser = await db.collection('users').findOne({ email: sanitizedEmail });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    
    // Hash password
    const hashedPassword = await hashPassword(password);
    
    // Create user
    const user = {
      name: sanitizedName,
      email: sanitizedEmail,
      passwordHash: hashedPassword,
      isVerified: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await db.collection('users').insertOne(user);
    user._id = result.insertedId;
    
    // Generate verification token
    const verificationToken = generateRandomToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    await db.collection('email_verifications').insertOne({
      userId: result.insertedId,
      token: verificationToken,
      expiresAt
    });
    
    // Send verification email
    await sendVerificationEmail(sanitizedEmail, verificationToken, sanitizedName);
    
    // Generate JWT
    const token = generateToken(result.insertedId.toString());
    
    res.status(201).json({
      message: 'Registration successful. Please check your email to verify your account.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// Login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validation
    const sanitizedEmail = sanitizeEmail(email);
    
    if (!validateEmail(sanitizedEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    
    if (!password) {
      return res.status(400).json({ error: 'Password is required.' });
    }
    
    const db = getDB();
    const user = await db.collection('users').findOne({ email: sanitizedEmail });
    
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    
    // Generate JWT
    const token = generateToken(user._id.toString());
    
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// Verify email
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required.' });
    }
    
    const db = getDB();
    const verification = await db.collection('email_verifications').findOne({ token });
    
    if (!verification) {
      return res.status(400).json({ error: 'Invalid or expired verification token.' });
    }
    
    // Update user
    await db.collection('users').updateOne(
      { _id: verification.userId },
      { $set: { isVerified: true, updatedAt: new Date() } }
    );
    
    // Delete verification token
    await db.collection('email_verifications').deleteOne({ _id: verification._id });
    
    res.json({ message: 'Email verified successfully!' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Server error during email verification.' });
  }
});

// Request password reset
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const sanitizedEmail = sanitizeEmail(email);
    
    if (!validateEmail(sanitizedEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    
    const db = getDB();
    const user = await db.collection('users').findOne({ email: sanitizedEmail });
    
    if (!user) {
      // Don't reveal if email exists
      return res.json({ message: 'If an account exists, a password reset email has been sent.' });
    }
    
    // Generate reset token
    const resetToken = generateRandomToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    
    await db.collection('password_reset_tokens').insertOne({
      userId: user._id,
      token: resetToken,
      expiresAt
    });
    
    // Send reset email
    await sendPasswordResetEmail(sanitizedEmail, resetToken, user.name);
    
    res.json({ message: 'If an account exists, a password reset email has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error during password reset request.' });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Reset token is required.' });
    }
    
    if (!validatePassword(password)) {
      return res.status(400).json({ 
        error: 'Password must be at least 8 characters with uppercase, lowercase, and a number.' 
      });
    }
    
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
    
    const db = getDB();
    const resetToken = await db.collection('password_reset_tokens').findOne({ token });
    
    if (!resetToken) {
      return res.status(400).json({ error: 'Invalid or expired reset token.' });
    }
    
    // Hash new password
    const hashedPassword = await hashPassword(password);
    
    // Update user
    await db.collection('users').updateOne(
      { _id: resetToken.userId },
      { $set: { passwordHash: hashedPassword, updatedAt: new Date() } }
    );
    
    // Delete reset token
    await db.collection('password_reset_tokens').deleteOne({ _id: resetToken._id });
    
    res.json({ message: 'Password reset successfully!' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error during password reset.' });
  }
});

// Change password (for authenticated users)
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    if (!validatePassword(newPassword)) {
      return res.status(400).json({ 
        error: 'Password must be at least 8 characters with uppercase, lowercase, and a number.' 
      });
    }
    
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
    
    if (!(await verifyPassword(currentPassword, req.user.passwordHash))) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    
    const hashedPassword = await hashPassword(newPassword);
    const db = getDB();
    
    await db.collection('users').updateOne(
      { _id: req.user._id },
      { $set: { passwordHash: hashedPassword, updatedAt: new Date() } }
    );
    
    res.json({ message: 'Password changed successfully!' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error during password change.' });
  }
});

export default router;
