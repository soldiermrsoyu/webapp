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
    status VARCHAR(20) DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_progress', 'completed', 'pending')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create task_reports table
CREATE TABLE IF NOT EXISTS task_reports (
    id SERIAL PRIMARY KEY,
    assignment_id INTEGER REFERENCES task_assignments(id) ON DELETE CASCADE,
    findings TEXT,
    actions_taken TEXT,
    next_maintenance_date DATE,
    checklist_data JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create temporary_checklist table for progress preservation
CREATE TABLE IF NOT EXISTS temporary_checklist (
    id SERIAL PRIMARY KEY,
    assignment_id INTEGER REFERENCES task_assignments(id) ON DELETE CASCADE,
    current_step INTEGER DEFAULT 0,
    checklist_data JSONB DEFAULT '[]',
    findings TEXT,
    actions_taken TEXT,
    next_maintenance_date DATE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(assignment_id)
);

-- TRUNCATE existing data
TRUNCATE TABLE task_reports, temporary_checklist, task_assignments, jadwal, users RESTART IDENTITY CASCADE;

-- Insert dummy data for users
INSERT INTO users ("user", password, role) VALUES
    ('spv', 'spv123', 'spv'),
    ('teknisi1', 'tek123', 'teknisi'),
    ('teknisi2', 'tek123', 'teknisi');

-- Insert dummy data for jadwal (FCU units)
INSERT INTO jadwal (lantai, unit, tanggal, alias) VALUES
    ('Lantai 1', 'FCU-001', CURRENT_DATE, 'Ruang Meeting 1'),
    ('Lantai 1', 'FCU-002', CURRENT_DATE, 'Lobby Utama'),
    ('Lantai 2', 'FCU-003', CURRENT_DATE, 'Ruang Server'),
    ('Lantai 2', 'FCU-004', CURRENT_DATE, 'Ruang Kerja Open Space'),
    ('Lantai 3', 'FCU-005', CURRENT_DATE, 'Kantin'),
    ('Lantai 3', 'FCU-006', CURRENT_DATE, 'Ruang Direksi');

-- Insert dummy data for task assignments
INSERT INTO task_assignments (fcu_id, teknisi_id, assigned_by, status) VALUES
    (1, 2, 1, 'in_progress'),
    (2, 3, 1, 'completed');

-- Insert dummy data for task reports
INSERT INTO task_reports (assignment_id, findings, actions_taken, next_maintenance_date) VALUES
    (2, 'Filter kotor', 'Pembersihan filter dan pengecekan freon', CURRENT_DATE + INTERVAL '1 month');

-- Insert temporary progress
INSERT INTO temporary_checklist (assignment_id, current_step, checklist_data, findings, actions_taken) VALUES
    (1, 2, '[{"item": "Filter", "status": "ok"}]', 'Filter oke', 'Pengecekan rutin');
