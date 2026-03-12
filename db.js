// db.js
const { Pool } = require('pg');
require('dotenv').config();

// For Heroku's DATABASE_URL or traditional connection params
const connectionString = process.env.DATABASE_URL;

let pool;

try {
  if (connectionString) {
    console.log('✅ Veritabanı bağlantısı: Connection string kullanılıyor');
    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false // Required for Heroku PostgreSQL
      }
    });
  } else {
    console.log('✅ Veritabanı bağlantısı: Parametre kullanılıyor');
    console.log('Database parameters:', {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT
    });
    
    pool = new Pool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT
    });
  }
} catch (error) {
  console.error('⚠️ Database connection error during setup:', error.message);
  throw error;
}

// Test database connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('⚠️ Database connection error:', err.message);
  } else {
    console.log('✅ Database connected successfully at:', res.rows[0].now);
  }
});

// Try to check if users table exists
pool.query('SELECT COUNT(*) FROM users', (err, res) => {
  if (err) {
    console.error('⚠️ Users table check error (table may not exist):', err.message);
  } else {
    console.log('✅ Users table exists with count:', res.rows[0].count);
  }
});

// Helper methods for common DB operations
module.exports = {
  query: (text, params) => {
    console.log('Executing query:', { text, params });
    return pool.query(text, params);
  },
  getClient: async () => {
    const client = await pool.connect();
    const query = client.query;
    const release = client.release;
    
    // Set a timeout of 5 seconds on idle clients
    const timeout = setTimeout(() => {
      console.error('A client has been checked out for too long.');
      console.error(`The last executed query on this client was: ${client.lastQuery}`);
    }, 5000);
    
    // Monkey patch the query method to keep track of the last query executed
    client.query = (...args) => {
      client.lastQuery = args;
      return query.apply(client, args);
    };
    
    client.release = () => {
      clearTimeout(timeout);
      client.query = query;
      client.release = release;
      return release.apply(client);
    };
    
    return client;
  }
};