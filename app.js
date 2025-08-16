const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const PORT = 3000;

// MySQL connection configuration
const dbConfig = {
  host: 'mysql',
  user: 'root',
  password: 'rootpassword',
  database: 'testdb'
};

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Create MySQL connection pool
let pool;

async function initDatabase() {
  const maxRetries = 10;
  const retryDelay = 3000; // 3 seconds
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      pool = mysql.createPool({
        ...dbConfig,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        acquireTimeout: 60000,
        timeout: 60000
      });
      
      // Test the connection
      await pool.execute('SELECT 1');
      console.log('Connected to MySQL database successfully');
      return;
    } catch (error) {
      console.log(`Database connection attempt ${i + 1}/${maxRetries} failed:`, error.message);
      if (i === maxRetries - 1) {
        console.error('Failed to connect to database after all retries');
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login route
app.post('/api/login', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ error: 'Email je obavezan' });
    }
    
    try {
        const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
        
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Korisnik ne postoji' });
        }
        
        res.json({ success: true, user: rows[0] });
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ error: 'Greška pri prijavi' });
    }
});

app.post('/api/register', async (req, res) => {
    const { name, email } = req.body;
    
    if (!name || !email) {
        return res.status(400).json({ error: 'Ime i email su obavezni' });
    }
    
    try {
        // Check if user already exists
        const [existingUsers] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
        
        if (existingUsers.length > 0) {
            return res.status(400).json({ error: 'Korisnik sa tim email-om već postoji' });
        }
        
        // Create new user
        const [result] = await pool.execute(
            'INSERT INTO users (name, email) VALUES (?, ?)',
            [name, email]
        );
        
        res.json({ id: result.insertId, name, email });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Greška pri registraciji' });
    }
});


app.post('/api/projects', async (req, res) => {
    try {
        const { user_id, naziv, opis, tehnologije, ciljevi, plan_rada } = req.body;
        
        const [result] = await pool.execute(
            'INSERT INTO projects (user_id, naziv, opis, tehnologije, ciljevi, plan_rada) VALUES (?, ?, ?, ?, ?, ?)',
            [user_id, naziv, opis, tehnologije, ciljevi, plan_rada]
        );
        
        res.status(201).json({
            success: true,
            project_id: result.insertId,
            message: 'Projekat je uspešno kreiran'
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Greška pri kreiranju projekta',
            error: error.message
        });
    }
});


app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM users');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', async (req, res) => {
  const { name, email } = req.body;
  
  try {
    const [result] = await pool.execute(
      'INSERT INTO users (name, email) VALUES (?, ?)',
      [name, email]
    );
    res.json({ id: result.insertId, name, email });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Initialize database connection
initDatabase();