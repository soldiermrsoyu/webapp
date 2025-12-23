const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const role = require('../middleware/role');
const db = require('../db');

// Contoh API: list teknisi (spv only)
router.get('/teknisi', auth, role('spv'), async (req, res) => {
  try {
    const result = await db.query('SELECT id, "user" FROM users WHERE role=$1', ['teknisi']);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get jadwal FCU for today with assignment status and technician info
router.get('/jadwal', auth, role('spv'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        j.id, 
        j.lantai, 
        j.unit, 
        j.tanggal, 
        j.alias,
        ta.assignment_status,
        ta.teknisi_names,
        ta.assignment_ids
      FROM jadwal j
      LEFT JOIN (
        SELECT 
          fcu_id, 
          -- Status tertinggi: in_progress > pending > assigned
          CASE 
            WHEN 'in_progress' = ANY(ARRAY_AGG(status)) THEN 'in_progress'
            WHEN 'pending' = ANY(ARRAY_AGG(status)) THEN 'pending'
            ELSE 'assigned'
          END as assignment_status,
          string_agg(u.user, ', ') as teknisi_names,
          string_agg(ta.id::text, ',') as assignment_ids
        FROM task_assignments ta
        JOIN users u ON ta.teknisi_id = u.id
        WHERE ta.status != 'completed'
        GROUP BY fcu_id
      ) ta ON j.id = ta.fcu_id
      WHERE ta.assignment_status IS NULL OR ta.assignment_status = 'not_assigned'
      ORDER BY j.id
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching jadwal:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Change password
router.post('/change-password', auth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.trim() === '') {
      return res.json({ success: false, error: 'Password tidak boleh kosong' });
    }
    
    await db.query(
      'UPDATE users SET password=$1 WHERE id=$2',
      [password, req.session.user.id]
    );
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Assign task to technician
router.post('/assign-task', auth, role('spv'), async (req, res) => {
  try {
    const { fcu_id, teknisi_id, teknisi_ids } = req.body;
    
    if (!fcu_id) {
      return res.json({ success: false, error: 'FCU ID tidak boleh kosong' });
    }

    // Check if this unit already has an active task (not completed)
    const activeTask = await db.query(
      'SELECT id FROM task_assignments WHERE fcu_id = $1 AND status != $2',
      [fcu_id, 'completed']
    );

    if (activeTask.rows.length > 0) {
      return res.json({ 
        success: false, 
        error: 'Unit ini sedang dalam pengerjaan atau sudah ditugaskan. Selesaikan tugas sebelumnya terlebih dahulu.' 
      });
    }
    
    const idsToAssign = teknisi_ids || (teknisi_id ? [teknisi_id] : []);
    
    if (idsToAssign.length === 0) {
      return res.json({ success: false, error: 'Teknisi ID tidak boleh kosong' });
    }

    const assignments = [];
    for (const techId of idsToAssign) {
      const result = await db.query(
        'INSERT INTO task_assignments (fcu_id, teknisi_id, assigned_by) VALUES ($1, $2, $3) RETURNING id',
        [fcu_id, techId, req.session.user.id]
      );
      assignments.push(result.rows[0].id);
    }
    
    res.json({ success: true, assignment_ids: assignments });
  } catch (err) {
    console.error('Error assigning task:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Reassign technician
router.post('/reassign-task', auth, role('spv'), async (req, res) => {
  const { fcu_id, old_assignment_ids, new_teknisi_ids } = req.body;
  console.log('Reassign Task Payload:', { fcu_id, old_assignment_ids, new_teknisi_ids });
  
  if (!fcu_id) return res.json({ success: false, error: 'FCU ID tidak lengkap' });
  if (!old_assignment_ids || (Array.isArray(old_assignment_ids) && old_assignment_ids.length === 0)) {
    return res.json({ success: false, error: 'ID penugasan lama tidak ditemukan' });
  }
  if (!new_teknisi_ids || !Array.isArray(new_teknisi_ids) || new_teknisi_ids.length === 0) {
    return res.json({ success: false, error: 'Teknisi baru belum dipilih' });
  }

  try {
    await db.query('BEGIN');

    // 1. Get progress from old assignments if any
    const progressResult = await db.query(`
      SELECT * FROM temporary_checklist 
      WHERE assignment_id = ANY($1)
      ORDER BY updated_at DESC LIMIT 1
    `, [old_assignment_ids]);

    console.log('Progress found for old assignments:', progressResult.rows.length > 0);

    // 2. Delete old assignments
    // Note: temporary_checklist and task_reports have ON DELETE CASCADE on assignment_id
    await db.query(`DELETE FROM task_assignments WHERE id = ANY($1)`, [old_assignment_ids]);

    // 3. Create new assignments
    const newAssignmentIds = [];
    for (const techId of new_teknisi_ids) {
      const result = await db.query(
        'INSERT INTO task_assignments (fcu_id, teknisi_id, assigned_by) VALUES ($1, $2, $3) RETURNING id',
        [fcu_id, techId, req.session.user.id]
      );
      newAssignmentIds.push(result.rows[0].id);
    }

    // 4. Transfer progress to new assignments if exists
    if (progressResult.rows.length > 0) {
      const progress = progressResult.rows[0];
      // Pastikan checklist_data adalah valid JSON string jika itu objek/array
      const checklistData = typeof progress.checklist_data === 'string' 
        ? progress.checklist_data 
        : JSON.stringify(progress.checklist_data);

      for (const newId of newAssignmentIds) {
        await db.query(`
          INSERT INTO temporary_checklist 
            (assignment_id, current_step, checklist_data, findings, actions_taken, next_maintenance_date)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          newId, 
          progress.current_step, 
          checklistData, 
          progress.findings, 
          progress.actions_taken, 
          progress.next_maintenance_date
        ]);
      }
    }

    await db.query('COMMIT');
    res.json({ success: true, new_assignment_ids: newAssignmentIds });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error reassigning task:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get work plan (assigned and pending only, with pending reason)
router.get('/rencana-kerja', auth, role('spv'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        ta.id, 
        ta.status, 
        ta.created_at,
        ta.pending_reason,
        ta.pending_at,
        u_tech.user as teknisi_name,
        u_spv.user as spv_name,
        j.unit,
        j.lantai,
        j.alias
      FROM task_assignments ta
      JOIN users u_tech ON ta.teknisi_id = u_tech.id
      JOIN users u_spv ON ta.assigned_by = u_spv.id
      JOIN jadwal j ON ta.fcu_id = j.id
      WHERE ta.status IN ('assigned', 'pending', 'in_progress')
      ORDER BY ta.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching work plan:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Get all maintenance reports for SPV
router.get('/laporan-maintenance', auth, role('spv'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        tr.id as report_id,
        tr.findings,
        tr.actions_taken,
        tr.next_maintenance_date,
        tr.created_at as report_date,
        ta.id as assignment_id,
        u_tech.user as teknisi_name,
        j.unit,
        j.lantai,
        j.alias
      FROM task_reports tr
      JOIN task_assignments ta ON tr.assignment_id = ta.id
      JOIN users u_tech ON ta.teknisi_id = u_tech.id
      JOIN jadwal j ON ta.fcu_id = j.id
      WHERE ta.status = 'completed'
      ORDER BY tr.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching reports:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Get assigned tasks for technician (assigned and pending only)
router.get('/my-tasks', auth, role('teknisi'), async (req, res) => {
  try {
    const result = await db.query(
      "SELECT ta.id, ta.fcu_id, ta.status, j.lantai, j.alias, j.unit FROM task_assignments ta LEFT JOIN jadwal j ON ta.fcu_id = j.id WHERE ta.teknisi_id = $1 AND ta.status IN ('assigned', 'pending') ORDER BY ta.created_at DESC",
      [req.session.user.id]
    );
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Pending task with optional form data (save progress)
router.post('/pending-task', auth, role('teknisi'), async (req, res) => {
  try {
    const { assignment_id, reason, current_step, checklist_data, findings, actions_taken, next_maintenance_date } = req.body;
    
    if (!assignment_id || !reason) {
      return res.json({ success: false, error: 'ID penugasan dan alasan tidak boleh kosong' });
    }

    // Start transaction
    await db.query('BEGIN');

    // Update assignment status and pending time
    await db.query(
      "UPDATE task_assignments SET status = 'pending', pending_reason = $1, pending_at = NOW() WHERE id = $2",
      [reason, assignment_id]
    );

    // Save temporary progress if provided
    if (checklist_data) {
      const nextMaintenanceDate = next_maintenance_date && next_maintenance_date.trim() !== '' ? next_maintenance_date : null;
      await db.query(`
        INSERT INTO temporary_checklist 
          (assignment_id, current_step, checklist_data, findings, actions_taken, next_maintenance_date)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (assignment_id) DO UPDATE SET
          current_step = EXCLUDED.current_step,
          checklist_data = EXCLUDED.checklist_data,
          findings = EXCLUDED.findings,
          actions_taken = EXCLUDED.actions_taken,
          next_maintenance_date = EXCLUDED.next_maintenance_date,
          updated_at = NOW()
      `, [assignment_id, current_step || 0, JSON.stringify(checklist_data), findings, actions_taken, nextMaintenanceDate]);
    }

    // Also add to unit history as a pending report
    await db.query(
      "INSERT INTO task_reports (assignment_id, findings, actions_taken, checklist_data) VALUES ($1, $2, $3, $4)",
      [assignment_id, `PENDING: ${reason}`, 'Tugas ditunda oleh teknisi', JSON.stringify([])]
    );

    await db.query('COMMIT');
    
    res.json({ success: true });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error pending task:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get temporary progress
router.get('/temp-progress/:assignmentId', auth, role('teknisi'), async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM temporary_checklist WHERE assignment_id = $1',
      [req.params.assignmentId]
    );
    
    if (result.rows.length === 0) {
      return res.json({ found: false });
    }
    
    res.json({ found: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Submit task report
router.post('/submit-report', auth, role('teknisi'), async (req, res) => {
  try {
    const { assignment_id, findings, actions_taken, next_maintenance_date, checklist_items } = req.body;
    
    // Start transaction
    await db.query('BEGIN');

    const nextMaintenanceDate = next_maintenance_date && next_maintenance_date.trim() !== '' ? next_maintenance_date : null;

    const result = await db.query(
      'INSERT INTO task_reports (assignment_id, findings, actions_taken, next_maintenance_date, checklist_data) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [assignment_id, findings, actions_taken, nextMaintenanceDate, JSON.stringify(checklist_items)]
    );
    
    // Update assignment status
    await db.query('UPDATE task_assignments SET status = $1 WHERE id = $2', ['completed', assignment_id]);

    // Delete temporary progress if it exists
    await db.query('DELETE FROM temporary_checklist WHERE assignment_id = $1', [assignment_id]);
    
    await db.query('COMMIT');

    res.json({ success: true, report_id: result.rows[0].id });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error submitting report:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get report for assignment
router.get('/report/:assignmentId', auth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM task_reports WHERE assignment_id = $1',
      [req.params.assignmentId]
    );
    
    if (result.rows.length === 0) {
      return res.json({ found: false });
    }
    
    res.json({ found: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get FCU maintenance history
router.get('/fcu-history/:fcuId', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        tr.id,
        tr.findings,
        tr.actions_taken,
        tr.next_maintenance_date,
        tr.created_at,
        tr.checklist_data,
        u.user as teknisi_name
      FROM task_reports tr
      JOIN task_assignments ta ON tr.assignment_id = ta.id
      JOIN users u ON ta.teknisi_id = u.id
      WHERE ta.fcu_id = $1
      ORDER BY tr.created_at DESC
    `, [req.params.fcuId]);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching FCU history:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Reset and seed database (SPV only)
router.post('/reset-db', auth, role('spv'), async (req, res) => {
  try {
    await db.query('BEGIN');
    
    // TRUNCATE with RESTART IDENTITY CASCADE will clear all tables and reset IDs
    await db.query('TRUNCATE TABLE task_reports, temporary_checklist, task_assignments, jadwal, users RESTART IDENTITY CASCADE');
    
    // 1. Seed Users
    await db.query(`INSERT INTO users ("user", password, role) VALUES 
      ('spv', 'spv123', 'spv'),
      ('teknisi1', 'tek123', 'teknisi'),
      ('teknisi2', 'tek123', 'teknisi')`);
    
    // 2. Seed Jadwal with current date
    await db.query(`INSERT INTO jadwal (lantai, unit, tanggal, alias) VALUES
      ('Lantai 1', 'FCU-001', CURRENT_DATE, 'Ruang Meeting 1'),
      ('Lantai 1', 'FCU-002', CURRENT_DATE, 'Lobby Utama'),
      ('Lantai 2', 'FCU-003', CURRENT_DATE, 'Ruang Server'),
      ('Lantai 2', 'FCU-004', CURRENT_DATE, 'Ruang Kerja Open Space'),
      ('Lantai 3', 'FCU-005', CURRENT_DATE, 'Kantin'),
      ('Lantai 3', 'FCU-006', CURRENT_DATE, 'Ruang Direksi')`);
    
    // 3. Create an active assignment for testing reassign
    // fcu_id 1 (FCU-001) assigned to teknisi1 (id 2)
    const assignResult = await db.query(
      'INSERT INTO task_assignments (fcu_id, teknisi_id, assigned_by, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [1, 2, 1, 'in_progress']
    );
    
    const assignmentId = assignResult.rows[0].id;
    
    // 4. Add temporary progress to that assignment
    await db.query(`
      INSERT INTO temporary_checklist 
        (assignment_id, current_step, checklist_data, findings, actions_taken) 
      VALUES ($1, $2, $3, $4, $5)`,
      [assignmentId, 2, JSON.stringify([{ item: 'Filter', status: 'ok' }, { item: 'Coil', status: 'dirty' }]), 'Filter oke, coil kotor', 'Rencana cuci coil']
    );
    
    // 5. Create a completed assignment for history
    const completedAssign = await db.query(
      'INSERT INTO task_assignments (fcu_id, teknisi_id, assigned_by, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [2, 3, 1, 'completed']
    );
    
    // 6. Add report for the completed assignment
    await db.query(
      'INSERT INTO task_reports (assignment_id, findings, actions_taken, next_maintenance_date) VALUES ($1, $2, $3, CURRENT_DATE + INTERVAL \'3 months\')',
      [completedAssign.rows[0].id, 'Normal maintenance', 'Cleaning done', null]
    );

    await db.query('COMMIT');
    res.json({ success: true, message: 'Database reset and seeded successfully' });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Reset DB Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
