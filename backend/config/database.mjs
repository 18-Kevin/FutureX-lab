import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const MONGODB_URI = (process.env.MONGODB_URI || '').trim();
const DB_PATH = path.resolve('./database.json');

let db = null;
let client = null;
let collections = null;

export function usingMongo() {
  return Boolean(
    MONGODB_URI &&
    !MONGODB_URI.includes('PASTE_') &&
    !MONGODB_URI.includes('your_mongodb') &&
    !MONGODB_URI.includes('<')
  );
}

function isExpired(record) {
  return Boolean(record?.expiresAt && new Date(record.expiresAt) < new Date());
}

function generateId() {
  return 'usr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
}

function saveDB() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

export async function connectDB() {
  if (usingMongo()) {
    client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const mongo = client.db();
    collections = {
      users: mongo.collection('users'),
      email_verifications: mongo.collection('email_verifications'),
      password_reset_tokens: mongo.collection('password_reset_tokens')
    };
    await collections.users.createIndex({ email: 1 }, { unique: true });
    await collections.email_verifications.createIndex({ token: 1 }, { unique: true });
    await collections.password_reset_tokens.createIndex({ token: 1 }, { unique: true });
    await collections.email_verifications.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await collections.password_reset_tokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    console.log('✓ Connected to MongoDB Atlas');
    return;
  }

  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify({ users: [], email_verifications: [], password_reset_tokens: [] }, null, 2),
      'utf-8'
    );
  }

  db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  db.users ||= [];
  db.email_verifications ||= [];
  db.password_reset_tokens ||= [];
  console.log('✓ Connected to JSON database');
}

export async function disconnectDB() {
  if (usingMongo()) {
    if (client) await client.close();
    client = null;
    collections = null;
    console.log('✓ Disconnected from MongoDB Atlas');
    return;
  }
  db = null;
  console.log('✓ Disconnected from JSON database');
}

export function getDB() {
  if (usingMongo()) {
    if (!client) throw new Error('Database not connected. Call connectDB() first.');
    return client.db();
  }
  if (!db) throw new Error('Database not connected. Call connectDB() first.');
  return db;
}

/* ---------- Users ---------- */

export async function findUserByEmail(email) {
  if (usingMongo()) return collections.users.findOne({ email });
  return db.users.find(user => user.email === email) || null;
}

export async function findUserById(id) {
  if (usingMongo()) return collections.users.findOne({ _id: id });
  return db.users.find(user => user._id === id) || null;
}

export async function createUser(user) {
  user._id = generateId();
  if (usingMongo()) {
    await collections.users.insertOne(user);
    return user;
  }
  db.users.push(user);
  saveDB();
  return user;
}

export async function updateUser(id, updates) {
  if (usingMongo()) {
    return collections.users.findOneAndUpdate(
      { _id: id },
      { $set: updates },
      { returnDocument: 'after' }
    );
  }
  const user = db.users.find(item => item._id === id);
  if (user) {
    Object.assign(user, updates);
    saveDB();
  }
  return user || null;
}

export async function deleteUser(id) {
  if (usingMongo()) {
    await collections.users.deleteOne({ _id: id });
    return;
  }
  const before = db.users.length;
  db.users = db.users.filter(user => user._id !== id);
  if (db.users.length !== before) saveDB();
}

export async function deleteVerificationTokensForUser(userId) {
  if (usingMongo()) {
    await collections.email_verifications.deleteMany({ userId });
    return;
  }
  const before = db.email_verifications.length;
  db.email_verifications = db.email_verifications.filter(item => item.userId !== userId);
  if (db.email_verifications.length !== before) saveDB();
}

export async function deleteResetTokensForUser(userId) {
  if (usingMongo()) {
    await collections.password_reset_tokens.deleteMany({ userId });
    return;
  }
  const before = db.password_reset_tokens.length;
  db.password_reset_tokens = db.password_reset_tokens.filter(item => item.userId !== userId);
  if (db.password_reset_tokens.length !== before) saveDB();
}

/* ---------- Email verification tokens ---------- */

export async function findVerificationToken(token) {
  if (usingMongo()) {
    const record = await collections.email_verifications.findOne({ token });
    if (!record) return null;
    if (isExpired(record)) {
      await collections.email_verifications.deleteOne({ token });
      return null;
    }
    return record;
  }
  const record = db.email_verifications.find(item => item.token === token);
  if (!record) return null;
  if (isExpired(record)) {
    db.email_verifications = db.email_verifications.filter(item => item.token !== token);
    saveDB();
    return null;
  }
  return record;
}

export async function createVerificationToken(tokenData) {
  if (usingMongo()) {
    await collections.email_verifications.insertOne(tokenData);
    return tokenData;
  }
  db.email_verifications.push(tokenData);
  saveDB();
  return tokenData;
}

export async function deleteVerificationToken(token) {
  if (usingMongo()) {
    await collections.email_verifications.deleteOne({ token });
    return;
  }
  const before = db.email_verifications.length;
  db.email_verifications = db.email_verifications.filter(item => item.token !== token);
  if (db.email_verifications.length !== before) saveDB();
}

/* ---------- Password reset tokens ---------- */

export async function findResetToken(token) {
  if (usingMongo()) {
    const record = await collections.password_reset_tokens.findOne({ token });
    if (!record) return null;
    if (isExpired(record)) {
      await collections.password_reset_tokens.deleteOne({ token });
      return null;
    }
    return record;
  }
  const record = db.password_reset_tokens.find(item => item.token === token);
  if (!record) return null;
  if (isExpired(record)) {
    db.password_reset_tokens = db.password_reset_tokens.filter(item => item.token !== token);
    saveDB();
    return null;
  }
  return record;
}

export async function createResetToken(tokenData) {
  if (usingMongo()) {
    await collections.password_reset_tokens.insertOne(tokenData);
    return tokenData;
  }
  db.password_reset_tokens.push(tokenData);
  saveDB();
  return tokenData;
}

export async function deleteResetToken(token) {
  if (usingMongo()) {
    await collections.password_reset_tokens.deleteOne({ token });
    return;
  }
  const before = db.password_reset_tokens.length;
  db.password_reset_tokens = db.password_reset_tokens.filter(item => item.token !== token);
  if (db.password_reset_tokens.length !== before) saveDB();
}
