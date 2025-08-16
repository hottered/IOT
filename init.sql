-- Ensure proper database selection
USE testdb;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample data
INSERT INTO users (name, email) VALUES 
    ('John Doe', 'john@example.com'),
    ('Jane Smith', 'jane@example.com'),
    ('Bob Johnson', 'bob@example.com');

-- Create products table (additional example)
-- Create projects table
CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    naziv VARCHAR(200) NOT NULL,
    opis TEXT,
    tehnologije VARCHAR(500),
    ciljevi TEXT,
    plan_rada TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS votes (
 id INT AUTO_INCREMENT PRIMARY KEY,
 project_id INT NOT NULL,
 user_id INT NOT NULL,
 vote_type ENUM('upvote', 'downvote') NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 UNIQUE KEY unique_vote (project_id, user_id)
);

-- Create comments table for project comments
CREATE TABLE IF NOT EXISTS comments (
 id INT AUTO_INCREMENT PRIMARY KEY,
 project_id INT NOT NULL,
 user_id INT NOT NULL,
 comment TEXT NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Insert sample projects
INSERT INTO projects (user_id, naziv, opis, tehnologije, ciljevi, plan_rada) VALUES
(1, 'E-commerce Platform', 'Kompletna e-commerce platforma sa admin panelom', 'HTML, CSS, JavaScript, PHP, MySQL', 'Kreirati funkcionalnu online prodavnicu', 'Faza 1: Design, Faza 2: Backend, Faza 3: Frontend'),
(2, 'Task Manager App', 'Aplikacija za upravljanje zadacima i projektima', 'React, Node.js, MongoDB', 'Poboljšati produktivnost timova', 'Planiranje - 2 nedelje, Razvoj - 6 nedelja, Testiranje - 2 nedelje'),
(3, 'AI Chatbot', 'Inteligentni chatbot za korisničku podršku', 'Python, TensorFlow, Flask, SQLite', 'Automatizovati korisničku podršku', 'Obuka modela, Integracija, Testiranje'),
(1, 'Mobile Weather App', 'Mobilna aplikacija za vremensku prognozu', 'React Native, OpenWeather API', 'Pružiti precizne vremenske informacije', 'UI/UX dizajn, API integracija, Optimizacija'),
(2, 'Blog Platform', 'Platforma za blogovanje sa CMS sistemom', 'Vue.js, Laravel, PostgreSQL', 'Omogućiti jednostavno kreiranje blogova', 'Backend API, Frontend interface, Admin panel');

-- Insert sample votes
INSERT INTO votes (project_id, user_id, vote_type) VALUES
(1, 2, 'upvote'),
(1, 3, 'upvote'),
(2, 1, 'upvote'),
(2, 3, 'downvote'),
(3, 1, 'upvote'),
(3, 2, 'upvote'),
(4, 2, 'upvote'),
(5, 1, 'upvote'),
(5, 3, 'upvote');

-- Insert sample comments
INSERT INTO comments (project_id, user_id, comment) VALUES
(1, 2, 'Odličan koncept! Kada planirate da završite?'),
(1, 3, 'Možda bi trebalo dodati PayPal integraciju.'),
(2, 1, 'Koristićemo ovu aplikaciju u našem timu!'),
(3, 2, 'AI chatbot je budućnost korisničke podrške.'),
(4, 1, 'Odlična ideja za mobilnu app!'),
(5, 3, 'Blog platforma izgleda veoma obećavajuće.');


CREATE TABLE IF NOT EXISTS project_views (
 id INT AUTO_INCREMENT PRIMARY KEY,
 project_id INT NOT NULL,
 user_id INT,
 ip_address VARCHAR(45),
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
 INDEX idx_project_views (project_id, created_at)
);

-- Insert sample views
INSERT INTO project_views (project_id, user_id, ip_address) VALUES
(1, 2, '192.168.1.100'),
(1, 3, '192.168.1.101'),
(1, NULL, '192.168.1.102'),
(2, 1, '192.168.1.100'),
(2, 3, '192.168.1.101'),
(3, 1, '192.168.1.100'),
(3, 2, '192.168.1.101'),
(3, NULL, '192.168.1.103'),
(4, 2, '192.168.1.101'),
(5, 1, '192.168.1.100'),
(5, 3, '192.168.1.101');
-- Grant permissions to root user from any host (for Docker networking)
GRANT ALL PRIVILEGES ON testdb.* TO 'root'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;