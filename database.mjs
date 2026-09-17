import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DB_PATH = path.resolve('./database.json');

let db = null;

export async function connectDB() {
  const data = fs.readFileSync(DB_PATH, 'utf-8');
  db = JSON.parse(data);
  console.log('Connected to JSON database');
}

export async function disconnectDB() {
  db = null;
  console.log('Disconnected from JSON database');
}

export function getDB() {
  if (!db) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return db;
}

function saveDB() {
  const data = JSON.stringify(db, null, 2);
  fs.writeFileSync(DB_PATH, data, 'utf-8');
}

function generateId() {
  return 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

export async function findUserByEmail(email) {
  const database = getDB();
  return database.users.find(user => user.email === email);
}

export async function createUser(user) {
  const database = getDB();
  user._id = generateId();
  database.users.push(user);
  saveDB();
  return user;
}

export async function findUserById(id) {
  const database = getDB();
  return database.users.find(user => user._id === id);
}

export async function updateUser(id, updates) {
  const database = getDB();
  const user = database.users.find(user => user._id === id);
  if (user) {
    Object.assign(user, updates);
    saveDB();
  }
  return user;
}

export async function findVerificationToken(token) {
  const database = getDB();
  return database.email_verifications.find(v => v.token === token);
}

export async function createVerificationToken(tokenData) {
  const database = getDB();
  database.email_verifications.push(tokenData);
  saveDB();
  return tokenData;
}

export async function deleteVerificationToken(token) {
  const database = getDB();
  const index = database.email_verifications.findIndex(v => v.token === token);
  if (index !== -1) {
    database.email_verifications.splice(index, 1);
    saveDB();
  }
}

export async function findResetToken(token) {
  const database = getDB();
  return database.password_reset_tokens.find(v => v.token === token);
}

export async function createResetToken(tokenData) {
  const database = getDB();
  database.password_reset_tokens.push(tokenData);
  saveDB();
  return tokenData;
}

export async function deleteResetToken(token) {
  const database = getDB();
  const index = database.password_reset_tokens.findIndex(v => v.token === token);
  if (index !== -1) {
    database.password_reset_tokens.splice(index, 1);
    saveDB();
  }
}