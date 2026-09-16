import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

let db = null;
let client = null;

export async function connectDB() {
  if (db) return db;

  try {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('futurex');
    
    // Create indexes for better performance
    await createIndexes();
    
    console.log('✓ Connected to MongoDB');
    return db;
  } catch (error) {
    console.error('✗ MongoDB connection failed:', error.message);
    process.exit(1);
  }
}

export async function disconnectDB() {
  if (client) {
    await client.close();
    db = null;
    client = null;
    console.log('✓ Disconnected from MongoDB');
  }
}

export function getDB() {
  if (!db) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return db;
}

async function createIndexes() {
  const users = db.collection('users');
  const tokens = db.collection('password_reset_tokens');
  const emailVerifications = db.collection('email_verifications');
  
  // Unique email index
  await users.createIndex({ email: 1 }, { unique: true });
  
  // TTL indexes for automatic cleanup
  await tokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await emailVerifications.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
