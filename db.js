// db.js

const { Pool } = require('pg');
require('dotenv').config();

// For Heroku's DATABASE_URL or traditional connection params
const connectionString = process.env.DATABASE_URL;

const pool = connectionString 
  ? new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false // Required for Heroku PostgreSQL
      }
    })
  : new Pool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT
    });

// Test database connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('⚠️ Database connection error:', err.message);
  } else {
    console.log('✅ Database connected successfully at:', res.rows[0].now);
  }
});

// Helper methods for common DB operations
module.exports = {
  query: (text, params) => pool.query(text, params),
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