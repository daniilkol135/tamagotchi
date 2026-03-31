const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Session store in PostgreSQL
app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'tamagotchi-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production'
    }
}));

// Initialize database tables (БЕЗ EMAIL)
const initDatabase = async () => {
    try {
        // Users table - БЕЗ поля email
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Pets table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                hunger INTEGER DEFAULT 100,
                happiness INTEGER DEFAULT 100,
                energy INTEGER DEFAULT 100,
                age INTEGER DEFAULT 0,
                is_alive BOOLEAN DEFAULT true,
                last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Events table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS events (
                id SERIAL PRIMARY KEY,
                pet_id INTEGER REFERENCES pets(id) ON DELETE CASCADE,
                message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('✅ Database initialized');
    } catch (err) {
        console.error('❌ Database error:', err);
    }
};

// Helper functions
const updatePetStats = async (pet) => {
    if (!pet.is_alive) return pet;
    
    const lastUpdate = new Date(pet.last_update);
    const now = new Date();
    const minutesPassed = Math.floor((now - lastUpdate) / (1000 * 60));
    
    if (minutesPassed > 0) {
        pet.hunger = Math.max(0, pet.hunger - (minutesPassed * 2));
        pet.happiness = Math.max(0, pet.happiness - (minutesPassed * 1.5));
        pet.energy = Math.max(0, pet.energy - (minutesPassed * 1));
        pet.age += minutesPassed;
        
        if (pet.hunger <= 0 || pet.happiness <= 0 || pet.energy <= 0) {
            pet.is_alive = false;
            await pool.query(
                'INSERT INTO events (pet_id, message) VALUES ($1, $2)',
                [pet.id, `${pet.name} has passed away... 💔`]
            );
        }
        
        await pool.query(
            `UPDATE pets SET 
                hunger = $1, happiness = $2, energy = $3, 
                age = $4, is_alive = $5, last_update = CURRENT_TIMESTAMP 
            WHERE id = $6`,
            [pet.hunger, pet.happiness, pet.energy, pet.age, pet.is_alive, pet.id]
        );
    }
    
    return pet;
};

const requireAuth = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
};

// ============ AUTH ROUTES ============

// Register - БЕЗ EMAIL
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    if (password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
            [username, hashedPassword]
        );
        
        req.session.userId = result.rows[0].id;
        req.session.username = result.rows[0].username;
        
        res.json({ 
            success: true, 
            user: { id: result.rows[0].id, username: result.rows[0].username }
        });
    } catch (err) {
        if (err.code === '23505') {
            res.status(400).json({ error: 'Username already exists' });
        } else {
            res.status(500).json({ error: 'Registration failed' });
        }
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1',
            [username]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password);
        
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        req.session.userId = user.id;
        req.session.username = user.username;
        
        res.json({ 
            success: true, 
            user: { id: user.id, username: user.username }
        });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Check current user
app.get('/api/me', async (req, res) => {
    if (!req.session.userId) {
        return res.json({ user: null });
    }
    
    try {
        const result = await pool.query(
            'SELECT id, username FROM users WHERE id = $1',
            [req.session.userId]
        );
        
        if (result.rows.length === 0) {
            req.session.destroy();
            return res.json({ user: null });
        }
        
        res.json({ user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ PET ROUTES ============

// Get all pets
app.get('/api/pets', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM pets WHERE user_id = $1 ORDER BY created_at DESC',
            [req.session.userId]
        );
        
        const pets = [];
        for (const pet of result.rows) {
            const updatedPet = await updatePetStats(pet);
            pets.push(updatedPet);
        }
        
        res.json(pets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create new pet
app.post('/api/pets', requireAuth, async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Name is required' });
    }
    
    try {
        const result = await pool.query(
            'INSERT INTO pets (user_id, name) VALUES ($1, $2) RETURNING *',
            [req.session.userId, name.trim()]
        );
        
        await pool.query(
            'INSERT INTO events (pet_id, message) VALUES ($1, $2)',
            [result.rows[0].id, `${name} was born! 🎉`]
        );
        
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single pet
app.get('/api/pets/:id', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM pets WHERE id = $1 AND user_id = $2',
            [req.params.id, req.session.userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pet not found' });
        }
        
        const pet = await updatePetStats(result.rows[0]);
        res.json(pet);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Feed pet
app.post('/api/pets/:id/feed', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE pets SET hunger = LEAST(100, hunger + 20), last_update = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND is_alive = true RETURNING *',
            [req.params.id, req.session.userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pet not found or is dead' });
        }
        
        await pool.query(
            'INSERT INTO events (pet_id, message) VALUES ($1, $2)',
            [result.rows[0].id, `${result.rows[0].name} enjoyed a meal! 🍕`]
        );
        
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Play with pet
app.post('/api/pets/:id/play', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE pets SET happiness = LEAST(100, happiness + 15), energy = GREATEST(0, energy - 5), last_update = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND is_alive = true RETURNING *',
            [req.params.id, req.session.userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pet not found or is dead' });
        }
        
        await pool.query(
            'INSERT INTO events (pet_id, message) VALUES ($1, $2)',
            [result.rows[0].id, `${result.rows[0].name} had fun playing! 🎮`]
        );
        
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Put pet to sleep
app.post('/api/pets/:id/sleep', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE pets SET energy = LEAST(100, energy + 25), last_update = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND is_alive = true RETURNING *',
            [req.params.id, req.session.userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pet not found or is dead' });
        }
        
        await pool.query(
            'INSERT INTO events (pet_id, message) VALUES ($1, $2)',
            [result.rows[0].id, `${result.rows[0].name} had a good nap! 😴`]
        );
        
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get pet events
app.get('/api/pets/:id/events', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT e.* FROM events e JOIN pets p ON e.pet_id = p.id WHERE p.id = $1 AND p.user_id = $2 ORDER BY e.created_at DESC LIMIT 20',
            [req.params.id, req.session.userId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete pet
app.delete('/api/pets/:id', requireAuth, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM pets WHERE id = $1 AND user_id = $2',
            [req.params.id, req.session.userId]
        );
        res.json({ message: 'Pet deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
    });
});
