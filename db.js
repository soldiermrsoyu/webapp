const { Pool } = require('pg');
require('dotenv').config();

// Pool koneksi ke PostgreSQL lokal
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',       // username PostgreSQL lokal
  host: process.env.DB_HOST || 'localhost',      // host lokal
  database: process.env.DB_NAME || 'mydb',       // nama database
  password: process.env.DB_PASSWORD || 'password', // password user
  port: process.env.DB_PORT || 5432,             // port default PostgreSQL
  // ssl tidak perlu untuk lokal
});

module.exports = pool;
