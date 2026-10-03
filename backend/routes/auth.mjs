import express from 'express';
import { findUserByEmail, createUser, findUserById, updateUser, findVerificationToken, createVerificationToken, deleteVerificationToken, findResetToken, createResetToken, deleteResetToken } from '../config/database.mjs';
import { hashPassword, verifyPassword, generateToken, generateRandomToken } from '../config/auth.mjs';
import { sendVerificationEmail, sendPasswordResetEmail, emailConfigured } from '../config/email.mjs';
import { authenticateToken, optionalAuth } from '../middleware/auth.mjs';
import { authLimiter, passwordResetLimiter, verificationLimiter } from '../middleware/rateLimiter.mjs';
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
    const { name, email, password } = req.body;
    
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
    
    // Check if user exists
    const existingUser = await findUserByEmail(sanitizedEmail);
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
    
    await createUser(user);
    
    // Generate verification token
    const verificationToken = generateRandomToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    await createVerificationToken({
      userId: user._id,
      token: verificationToken,
      expiresAt
    });
    
    // Send verification email (background — never blocks the response)
    const emailSent = emailConfigured();
    if (emailSent) {
      sendVerificationEmail(sanitizedEmail, verificationToken, sanitizedName).catch((err) =>
        console.error('✗ Background verification email failed:', err.message)
      );
    }
    
    // Generate JWT
    const token = generateToken(user._id.toString());
    
    res.status(201).json({
      message: emailSent
        ? 'Registration successful. Please check your email to verify your account.'
        : 'Registration successful, but the verification email could not be sent. You can still use the site.',
      emailSent,
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
    
    const user = await findUserByEmail(sanitizedEmail);
    
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
router.post('/verify-email', verificationLimiter, async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required.' });
    }
    
    const verification = await findVerificationToken(token);
    
    if (!verification) {
      return res.status(400).json({ error: 'Invalid or expired verification token.' });
    }
    
    // Update user
    await updateUser(verification.userId, { isVerified: true, updatedAt: new Date() });
    
    // Delete verification token
    await deleteVerificationToken(token);
    
    res.json({ message: 'Email verified successfully!' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Server error during email verification.' });
  }
});

// Resend verification email
router.post('/resend-verification', verificationLimiter, optionalAuth, async (req, res) => {
  try {
    let user = null;
    if (req.user?.id) {
      user = await findUserById(req.user.id);
    }

    const email = sanitizeEmail(req.body?.email || user?.email || '');

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (!user) {
      user = await findUserByEmail(email);
    }

    if (!user) {
      return res.json({ message: 'If an account exists, a verification email has been sent.' });
    }

    if (user.isVerified) {
      return res.json({ message: 'This email is already verified.', alreadyVerified: true });
    }

    const verificationToken = generateRandomToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await createVerificationToken({
      userId: user._id,
      token: verificationToken,
      expiresAt
    });

    const sent = emailConfigured();
    if (sent) {
      sendVerificationEmail(user.email, verificationToken, user.name).catch((err) =>
        console.error('✗ Background verification email failed:', err.message)
      );
    }

    res.json({
      message: sent
        ? 'Verification email sent. Check your inbox.'
        : 'The email could not be sent right now. Please try again later.',
      sent
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Server error while sending the verification email.' });
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
    
    const user = await findUserByEmail(sanitizedEmail);
    
    if (!user) {
      // Don't reveal if email exists
      return res.json({ message: 'If an account exists, a password reset email has been sent.' });
    }
    
    // Generate reset token
    const resetToken = generateRandomToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    
    await createResetToken({
      userId: user._id,
      token: resetToken,
      expiresAt
    });
    
    // Send reset email (background — never blocks the response)
    sendPasswordResetEmail(sanitizedEmail, resetToken, user.name).catch((err) =>
      console.error('✗ Background reset email failed:', err.message)
    );
    
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
    
    const resetToken = await findResetToken(token);
    
    if (!resetToken) {
      return res.status(400).json({ error: 'Invalid or expired reset token.' });
    }
    
    // Hash new password
    const hashedPassword = await hashPassword(password);
    
    // Update user
    await updateUser(resetToken.userId, { passwordHash: hashedPassword, updatedAt: new Date() });
    
    // Delete reset token
    await deleteResetToken(token);
    
    res.json({ message: 'Password reset successfully!' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error during password reset.' });
  }
});

// Logout (stateless - client discards token)
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
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
    
    await updateUser(req.user._id, { passwordHash: hashedPassword, updatedAt: new Date() });
    
    res.json({ message: 'Password changed successfully!' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error during password change.' });
  }
});

export default router;
