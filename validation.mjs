import validator from 'validator';

export function validateEmail(email) {
  return validator.isEmail(email);
}

export function validatePassword(password) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
}

export function validateName(name) {
  return name && name.trim().length >= 2 && name.trim().length <= 80;
}

export function sanitizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function sanitizeName(name) {
  return typeof name === 'string' ? name.trim() : '';
}