-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    "user" VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('spv', 'teknisi'))
);

-- Create jadwal table (FCU units)
CREATE TABLE IF NOT EXISTS jadwal (
    id SERIAL PRIMARY KEY,
    lantai VARCHAR(10) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    tanggal DATE,
    alias VARCHAR(100)
);

-- Create task_assignments table
CREATE TABLE IF NOT EXISTS task_assignments (
    id SERIAL PRIMARY KEY,
    fcu_id INTEGER REFERENCES jadwal(id),
    teknisi_id INTEGER REFERENCES users(id),
    assigned_by INTEGER REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_progress', 'completed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create task_reports table
CREATE TABLE IF NOT EXISTS task_reports (
    id SERIAL PRIMARY KEY,
    assignment_id INTEGER REFERENCES task_assignments(id),
    findings TEXT,
    actions_taken TEXT,
    next_maintenance_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert dummy data for users
INSERT INTO users ("user", password, role) VALUES
    ('spv', 'spv123', 'spv'),
    ('teknisi1', 'tek123', 'teknisi'),
    ('teknisi2', 'tek123', 'teknisi')
ON CONFLICT ("user") DO NOTHING;

-- Insert dummy data for jadwal (FCU units)
INSERT INTO jadwal (lantai, unit, tanggal, alias) VALUES
    ('Lantai 1', 'FCU-001', '2025-12-22', 'Ruang Meeting 1'),
    ('Lantai 1', 'FCU-002', '2025-12-22', 'Lobby Utama'),
    ('Lantai 2', 'FCU-003', '2025-12-22', 'Ruang Server'),
    ('Lantai 2', 'FCU-004', '2025-12-22', 'Ruang Kerja Open Space'),
    ('Lantai 3', 'FCU-005', '2025-12-22', 'Kantin'),
    ('Lantai 3', 'FCU-006', '2025-12-22', 'Ruang Direksi')
ON CONFLICT DO NOTHING;

-- Insert dummy data for task assignments
-- Note: Assuming IDs 1, 2, 3 correspond to the inserted users
-- And IDs 1-6 correspond to the inserted jadwal
INSERT INTO task_assignments (fcu_id, teknisi_id, assigned_by, status) VALUES
    (1, 2, 1, 'assigned'),
    (2, 3, 1, 'completed')
ON CONFLICT DO NOTHING;

-- Insert dummy data for task reports
-- Note: Assuming assignment ID 2 is the completed one
INSERT INTO task_reports (assignment_id, findings, actions_taken, next_maintenance_date) VALUES
    (2, 'Filter kotor', 'Pembersihan filter dan pengecekan freon', '2026-01-22')
ON CONFLICT DO NOTHING;
