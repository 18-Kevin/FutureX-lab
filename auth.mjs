import express from 'express';
import { findUserByEmail, createUser, updateUser, findVerificationToken, createVerificationToken, deleteVerificationToken, findResetToken, createResetToken, deleteResetToken } from '../config/database.mjs';
import { hashPassword, verifyPassword, generateToken, generateRandomToken } from '../config/auth.mjs';
import { sendVerificationEmail, sendPasswordResetEmail } from '../config/email.mjs';
import { authenticateToken } from '../middleware/auth.mjs';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimiter.mjs';
import { validateEmail, validatePassword, validateName, sanitizeEmail, sanitizeName } from '../middleware/validation.mjs';

const router = express.Router();

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

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
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
    
    const existingUser = await findUserByEmail(sanitizedEmail);
    if (existingUser) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    
    const hashedPassword = await hashPassword(password);
    
    const user = {
      name: sanitizedName,
      email: sanitizedEmail,
      passwordHash: hashedPassword,
      isVerified: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await createUser(user);
    
    const verificationToken = generateRandomToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    await createVerificationToken({
      userId: user._id,
      token: verificationToken,
      expiresAt
    });
    
    await sendVerificationEmail(sanitizedEmail, verificationToken, sanitizedName);
    
    const token = generateToken(user._id.toString());
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    
    res.status(201).json({
      message: 'Registration successful. Please check your email to verify your account.',
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

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    
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
    
    const token = generateToken(user._id.toString());
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    
    res.json({
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

router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required.' });
    }
    
    const verification = await findVerificationToken(token);
    
    if (!verification) {
      return res.status(400).json({ error: 'Invalid or expired verification token.' });
    }
    
    await updateUser(verification.userId, { isVerified: true, updatedAt: new Date() });
    
    await deleteVerificationToken(token);
    
    res.json({ message: 'Email verified successfully!' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Server error during email verification.' });
  }
});

router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const sanitizedEmail = sanitizeEmail(email);
    
    if (!validateEmail(sanitizedEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    
    const user = await findUserByEmail(sanitizedEmail);
    
    if (!user) {
      return res.json({ message: 'If an account exists, a password reset email has been sent.' });
    }
    
    const resetToken = generateRandomToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    
    await createResetToken({
      userId: user._id,
      token: resetToken,
      expiresAt
    });
    
    await sendPasswordResetEmail(sanitizedEmail, resetToken, user.name);
    
    res.json({ message: 'If an account exists, a password reset email has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error during password reset request.' });
  }
});

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
    
    const hashedPassword = await hashPassword(password);
    
    await updateUser(resetToken.userId, { passwordHash: hashedPassword, updatedAt: new Date() });
    
    await deleteResetToken(token);
    
    res.json({ message: 'Password reset successfully!' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error during password reset.' });
  }
});

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