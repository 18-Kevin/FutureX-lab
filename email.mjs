import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

let transporter = null;

export function initEmailService() {
  transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });
}

export async function sendVerificationEmail(email, token, userName) {
  if (!transporter) initEmailService();
  
  const verificationLink = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Verify your FutureX Lab email',
    html: `
      <h2>Welcome to FutureX Lab, ${userName}!</h2>
      <p>Please verify your email address by clicking the button below:</p>
      <a href="${verificationLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
        Verify Email
      </a>
      <p>Or copy this link: ${verificationLink}</p>
      <p>This link will expire in 24 hours.</p>
      <p>If you didn't create this account, please ignore this email.</p>
    `
  };
  
  try {
    await transporter.sendMail(mailOptions);
    console.log('Verification email sent to ' + email);
    return true;
  } catch (error) {
    console.error('Failed to send verification email:', error.message);
    return false;
  }
}

export async function sendPasswordResetEmail(email, token, userName) {
  if (!transporter) initEmailService();
  
  const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Reset your FutureX Lab password',
    html: `
      <h2>Password Reset Request</h2>
      <p>Hi ${userName},</p>
      <p>Click the button below to reset your password:</p>
      <a href="${resetLink}" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
        Reset Password
      </a>
      <p>Or copy this link: ${resetLink}</p>
      <p>This link will expire in 1 hour.</p>
      <p>If you didn't request a password reset, please ignore this email.</p>
    `
  };
  
  try {
    await transporter.sendMail(mailOptions);
    console.log('Password reset email sent to ' + email);
    return true;
  } catch (error) {
    console.error('Failed to send password reset email:', error.message);
    return false;
  }
}