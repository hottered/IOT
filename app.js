const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const multer = require('multer');
const Minio = require('minio');
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

const minioClient = new Minio.Client({
    endPoint: 'minio',
    port: 9000,
    useSSL: false,
    accessKey: 'minio',
    secretKey: 'minio123'
});

const BUCKET_NAME = 'project-files';

(async () => {
    try {
        const exists = await minioClient.bucketExists(BUCKET_NAME);
        if (!exists) {
            await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
            console.log(`Bucket '${BUCKET_NAME}' created`);
        }
    } catch (err) {
        console.error('Error checking/creating bucket:', err);
    }
})();

const upload = multer({ storage: multer.memoryStorage() });

// POST /api/projects/:id/upload
// form-data: file: <file>, userId: <id korisnika> (opciono)
app.post('/api/projects/:id/upload', upload.single('file'), async (req, res) => {
    const projectId = req.params.id;
    const file = req.file;
    const userId = req.body.userId ? parseInt(req.body.userId, 10) : null;

    if (!file) {
        return res.status(400).json({ error: 'Fajl je obavezan (form-data key: file)' });
    }

    try {
        // generiši jedinstveno ime objekta u bucketu
        const safeOriginal = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const objectName = `project-${projectId}/${Date.now()}-${safeOriginal}`;

        // upload u MinIO
        await minioClient.putObject(
            BUCKET_NAME,
            objectName,
            file.buffer,
            file.size,
            { 'Content-Type': file.mimetype }
        );

        // upiši meta u MySQL
        await pool.execute(
            `INSERT INTO project_files (project_id, user_id, object_name, original_name, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [projectId, userId, objectName, file.originalname, file.mimetype, file.size]
        );

        // URL za preuzimanje kroz naš proxy
        const downloadUrl = `/files?key=${encodeURIComponent(objectName)}`;

        res.json({
            success: true,
            message: 'Fajl uspešno uploadovan',
            file: {
                objectName,
                originalName: file.originalname,
                size: file.size,
                mime: file.mimetype,
                downloadUrl
            }
        });
    } catch (err) {
        console.error('Error uploading file:', err);
        res.status(500).json({ error: 'Greška pri uploadu fajla' });
    }
});

// Proxy za preuzimanje fajlova
app.get('/files/:projectId/:filename', async (req, res) => {
    const { projectId, filename } = req.params;
    const objectName = `project-${projectId}/${filename}`;

    try {
        minioClient.getObject(BUCKET_NAME, objectName, (err, dataStream) => {
            if (err) {
                console.error('Error fetching file:', err);
                return res.status(404).json({ error: 'Fajl nije pronađen' });
            }
            dataStream.pipe(res);
        });
    } catch (err) {
        console.error('Error retrieving file:', err);
        res.status(500).json({ error: 'Greška pri preuzimanju fajla' });
    }
});

app.get('/files', async (req, res) => {
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: 'Nedostaje parametar key' });

    try {
        minioClient.getObject(BUCKET_NAME, key, (err, dataStream) => {
            if (err) {
                console.error('Error fetching file:', err);
                return res.status(404).json({ error: 'Fajl nije pronađen' });
            }
            // opcionalno: postaviti Content-Type iz baze
            dataStream.pipe(res);
        });
    } catch (err) {
        console.error('Error retrieving file:', err);
        res.status(500).json({ error: 'Greška pri preuzimanju fajla' });
    }
});

app.get('/api/projects/:id/files', async (req, res) => {
    const projectId = req.params.id;
    try {
        const [rows] = await pool.execute(
            `SELECT id, project_id, user_id, object_name, original_name, mime_type, size_bytes, created_at
       FROM project_files
       WHERE project_id = ?
       ORDER BY created_at DESC`,
            [projectId]
        );

        const withUrls = rows.map(r => ({
            ...r,
            downloadUrl: `/files?key=${encodeURIComponent(r.object_name)}`
        }));

        res.json(withUrls);
    } catch (err) {
        console.error('Error listing files:', err);
        res.status(500).json({ error: 'Greška pri dobijanju liste fajlova' });
    }
});

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

app.get('/api/projects', async (req, res) => {
    try {
        // Query za projekte sa autorima, brojem glasova i pregleda
        const projectsQuery = `
            SELECT 
                p.id,
                p.naziv,
                p.opis,
                p.tehnologije,
                p.ciljevi,
                p.plan_rada,
                p.created_at,
                u.name as author,
                COALESCE(SUM(CASE WHEN v.vote_type = 'upvote' THEN 1 ELSE 0 END), 0) as upvotes,
                COALESCE(SUM(CASE WHEN v.vote_type = 'downvote' THEN 1 ELSE 0 END), 0) as downvotes,
                COALESCE(view_counts.view_count, 0) as views
            FROM projects p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN votes v ON p.id = v.project_id
            LEFT JOIN (
                SELECT project_id, COUNT(*) as view_count 
                FROM project_views 
                GROUP BY project_id
            ) view_counts ON p.id = view_counts.project_id
            GROUP BY p.id, p.naziv, p.opis, p.tehnologije, p.ciljevi, p.plan_rada, p.created_at, u.name, view_counts.view_count
            ORDER BY p.created_at DESC
        `;

        const [projects] = await pool.execute(projectsQuery);

        // Za svaki projekat dobavi komentare
        for (let project of projects) {
            const commentsQuery = `
                SELECT c.comment, c.created_at, u.name as author
                FROM comments c
                JOIN users u ON c.user_id = u.id
                WHERE c.project_id = ?
                ORDER BY c.created_at ASC
            `;
            const [comments] = await pool.execute(commentsQuery, [project.id]);
            project.comments = comments;
        }

        res.json(projects);
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});


app.post('/api/projects', upload.array('files'), async (req, res) => {
    const files = req.files; // niz fajlova (može biti prazno)
    const { user_id, naziv, opis, tehnologije, ciljevi, plan_rada } = req.body;

    let projectId;

    try {
        // 1️⃣ Kreiranje projekta
        const [result] = await pool.execute(
            'INSERT INTO projects (user_id, naziv, opis, tehnologije, ciljevi, plan_rada) VALUES (?, ?, ?, ?, ?, ?)',
            [user_id, naziv, opis, tehnologije, ciljevi, plan_rada]
        );
        projectId = result.insertId;

        const uploadedFiles = [];

        // 2️⃣ Ako postoje fajlovi, uploaduj u MinIO i upiši u bazu
        if (files && files.length > 0) {
            console.log(files)
            for (const file of files) {
                const safeOriginal = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                const objectName = `project-${projectId}/${Date.now()}-${safeOriginal}`;

                // Upload u MinIO
                await minioClient.putObject(
                    BUCKET_NAME,
                    objectName,
                    file.buffer,
                    file.size,
                    { 'Content-Type': file.mimetype }
                );

                // Upis u MySQL
                await pool.execute(
                    `INSERT INTO project_files (project_id, user_id, object_name, original_name, mime_type, size_bytes)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [projectId, user_id, objectName, file.originalname, file.mimetype, file.size]
                );

                uploadedFiles.push({
                    objectName,
                    originalName: file.originalname,
                    size: file.size,
                    mime: file.mimetype,
                    downloadUrl: `/files?key=${encodeURIComponent(objectName)}`
                });
            }
        }

        // 3️⃣ Vrati odgovor
        res.status(201).json({
            success: true,
            project: {
                id: projectId,
                naziv,
                user_id
            },
            files: uploadedFiles,
            message: 'Projekat je uspešno kreiran' + (uploadedFiles.length ? ' i fajlovi uploadovani' : '')
        });

    } catch (error) {
        console.error('Error creating project:', error);
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

app.get('/project/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'project-details.html'));
});

app.get('/api/projects/:id', async (req, res) => {
    const projectId = req.params.id;

    try {
        // Query za projekat sa autorima, brojem glasova i pregleda
        const projectQuery = `
            SELECT 
                p.id,
                p.naziv,
                p.opis,
                p.tehnologije,
                p.ciljevi,
                p.plan_rada,
                p.created_at,
                u.name as author,
                u.email as author_email,
                COALESCE(SUM(CASE WHEN v.vote_type = 'upvote' THEN 1 ELSE 0 END), 0) as upvotes,
                COALESCE(SUM(CASE WHEN v.vote_type = 'downvote' THEN 1 ELSE 0 END), 0) as downvotes,
                COALESCE(view_counts.view_count, 0) as views
            FROM projects p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN votes v ON p.id = v.project_id
            LEFT JOIN (
                SELECT project_id, COUNT(*) as view_count 
                FROM project_views 
                GROUP BY project_id
            ) view_counts ON p.id = view_counts.project_id
            WHERE p.id = ?
            GROUP BY p.id, p.naziv, p.opis, p.tehnologije, p.ciljevi, p.plan_rada, p.created_at, u.name, u.email, view_counts.view_count
        `;

        const [projects] = await pool.execute(projectQuery, [projectId]);

        if (projects.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const project = projects[0];

        // Dobavi komentare
        const commentsQuery = `
            SELECT c.comment, c.created_at, u.name as author
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.project_id = ?
            ORDER BY c.created_at ASC
        `;
        const [comments] = await pool.execute(commentsQuery, [projectId]);
        project.comments = comments;

        res.json(project);
    } catch (error) {
        console.error('Error fetching project:', error);
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

app.post('/api/projects/:id/view', async (req, res) => {
    const projectId = req.params.id;
    const { userId } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress || '0.0.0.0';

    try {
        // Dodaj novi pregled
        await pool.execute(
            'INSERT INTO project_views (project_id, user_id, ip_address) VALUES (?, ?, ?)',
            [projectId, userId || null, ipAddress]
        );

        res.json({ success: true, message: 'View recorded successfully' });
    } catch (error) {
        console.error('Error recording view:', error);
        res.status(500).json({ error: 'Failed to record view' });
    }
});

app.post('/api/projects/:id/vote', async (req, res) => {
    const projectId = req.params.id;
    const { userId, voteType } = req.body;

    if (!userId || !voteType || !['upvote', 'downvote'].includes(voteType)) {
        return res.status(400).json({ error: 'Invalid vote data' });
    }

    try {
        // Proveri da li je korisnik već glasao
        const [existingVote] = await pool.execute(
            'SELECT id FROM votes WHERE project_id = ? AND user_id = ?',
            [projectId, userId]
        );

        if (existingVote.length > 0) {
            // Update postojeći glas
            await pool.execute(
                'UPDATE votes SET vote_type = ? WHERE project_id = ? AND user_id = ?',
                [voteType, projectId, userId]
            );
        } else {
            // Dodaj novi glas
            await pool.execute(
                'INSERT INTO votes (project_id, user_id, vote_type) VALUES (?, ?, ?)',
                [projectId, userId, voteType]
            );
        }

        res.json({ success: true, message: 'Vote recorded successfully' });
    } catch (error) {
        console.error('Error recording vote:', error);
        res.status(500).json({ error: 'Failed to record vote' });
    }
});

// POST /api/projects/:id/comments - Dodaj komentar
app.post('/api/projects/:id/comments', async (req, res) => {
    const projectId = req.params.id;
    const { userId, comment } = req.body;

    if (!userId || !comment || comment.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid comment data' });
    }

    try {
        await pool.execute(
            'INSERT INTO comments (project_id, user_id, comment) VALUES (?, ?, ?)',
            [projectId, userId, comment.trim()]
        );

        res.json({ success: true, message: 'Comment added successfully' });
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

// Galerija route
app.get('/gallery', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'gallery.html'));
});

// Route za deadlines.html
app.get('/deadlines', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'deadlines.html'));
});

// GET /api/deadlines - Dobij sve rokove
app.get('/api/deadlines', async (req, res) => {
    try {
        const query = `
            SELECT 
                d.id,
                d.title,
                d.description,
                d.deadline_date,
                d.created_at,
                u.name as created_by_name
            FROM deadlines d
            LEFT JOIN users u ON d.created_by = u.id
            ORDER BY d.deadline_date ASC
        `;

        const [deadlines] = await pool.execute(query);
        res.json(deadlines);
    } catch (error) {
        console.error('Error fetching deadlines:', error);
        res.status(500).json({ error: 'Failed to fetch deadlines' });
    }
});

// POST /api/deadlines - Dodaj novi rok
app.post('/api/deadlines', async (req, res) => {
    const { title, description, deadline_date, created_by } = req.body;

    if (!title || !deadline_date || !created_by) {
        return res.status(400).json({
            error: 'Naziv, datum i kreator su obavezni'
        });
    }

    try {
        const [result] = await pool.execute(
            'INSERT INTO deadlines (title, description, deadline_date, created_by) VALUES (?, ?, ?, ?)',
            [title, description || null, deadline_date, created_by]
        );

        res.status(201).json({
            success: true,
            deadline_id: result.insertId,
            message: 'Rok je uspešno kreiran'
        });
    } catch (error) {
        console.error('Error creating deadline:', error);
        res.status(500).json({
            error: 'Greška pri kreiranju roka'
        });
    }
});

// DELETE /api/deadlines/:id - Obriši rok
app.delete('/api/deadlines/:id', async (req, res) => {
    const deadlineId = req.params.id;

    try {
        const [result] = await pool.execute(
            'DELETE FROM deadlines WHERE id = ?',
            [deadlineId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Rok nije pronađen' });
        }

        res.json({
            success: true,
            message: 'Rok je uspešno obrisan'
        });
    } catch (error) {
        console.error('Error deleting deadline:', error);
        res.status(500).json({
            error: 'Greška pri brisanju roka'
        });
    }
});

// PUT /api/deadlines/:id - Ažuriraj rok
app.put('/api/deadlines/:id', async (req, res) => {
    const deadlineId = req.params.id;
    const { title, description, deadline_date } = req.body;

    if (!title || !deadline_date) {
        return res.status(400).json({
            error: 'Naziv i datum su obavezni'
        });
    }

    try {
        const [result] = await pool.execute(
            'UPDATE deadlines SET title = ?, description = ?, deadline_date = ? WHERE id = ?',
            [title, description || null, deadline_date, deadlineId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Rok nije pronađen' });
        }

        res.json({
            success: true,
            message: 'Rok je uspešno ažuriran'
        });
    } catch (error) {
        console.error('Error updating deadline:', error);
        res.status(500).json({
            error: 'Greška pri ažuriranju roka'
        });
    }
});


app.get('/api/registration-status', async (req, res) => {
    try {
        const now = new Date();

        // Pronađi rok za prijavu projekata
        const registrationQuery = `
            SELECT * FROM deadlines 
            WHERE title LIKE '%prijav%' 
            AND deadline_date >= ?
            ORDER BY deadline_date ASC 
            LIMIT 1
        `;

        const [registrationDeadlines] = await pool.execute(registrationQuery, [now]);

        if (registrationDeadlines.length === 0) {
            // Nema aktivnih rokova za prijavu
            return res.json({
                isOpen: false,
                message: 'Trenutno nema otvorenih prijava',
                deadline: null,
                daysLeft: 0
            });
        }

        const deadline = registrationDeadlines[0];
        const deadlineDate = new Date(deadline.deadline_date);
        const timeDiff = deadlineDate - now;
        const daysLeft = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

        if (timeDiff > 0) {
            // Prijave su otvorene
            let message = 'Prijave su otvorene';
            if (daysLeft <= 3) {
                message += ` - ${daysLeft} dana preostalo!`;
            } else {
                message += ` - ${daysLeft} dana preostalo`;
            }

            res.json({
                isOpen: true,
                message: message,
                deadline: deadline.deadline_date,
                daysLeft: daysLeft,
                deadlineTitle: deadline.title
            });
        } else {
            // Rok je istekao
            res.json({
                isOpen: false,
                message: 'Rok za prijave je istekao',
                deadline: deadline.deadline_date,
                daysLeft: 0
            });
        }

    } catch (error) {
        console.error('Error checking registration status:', error);
        res.status(500).json({
            isOpen: false,
            message: 'Greška pri proveri statusa prijava',
            error: error.message
        });
    }
});

// Modifikujte postojeću POST /api/projects rutu da proveri status prijava
// Zamenite postojeću rutu sa ovom:
app.post('/api/projects', async (req, res) => {
    try {
        // Prvo proveri da li su prijave otvorene
        const now = new Date();
        const registrationQuery = `
            SELECT * FROM deadlines 
            WHERE title LIKE '%prijav%' 
            AND deadline_date >= ?
            ORDER BY deadline_date ASC 
            LIMIT 1
        `;

        const [registrationDeadlines] = await pool.execute(registrationQuery, [now]);

        if (registrationDeadlines.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Trenutno nema otvorenih prijava za projekte'
            });
        }

        const deadline = registrationDeadlines[0];
        const deadlineDate = new Date(deadline.deadline_date);

        if (now >= deadlineDate) {
            return res.status(403).json({
                success: false,
                message: 'Rok za prijave je istekao'
            });
        }

        // Ako su prijave otvorene, nastavi sa kreiranjem projekta
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


// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Initialize database connection
initDatabase();