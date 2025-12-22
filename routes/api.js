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

// API: Get jadwal FCU for today
router.get('/jadwal', auth, role('spv'), async (req, res) => {
  try {
    const result = await db.query('SELECT id, lantai, unit, tanggal, alias FROM jadwal ORDER BY id');
    res.json(result.rows);
  } catch (err) {
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
  try {
    const { assignment_id, teknisi_id } = req.body;
    
    if (!assignment_id || !teknisi_id) {
      return res.json({ success: false, error: 'ID penugasan dan teknisi tidak boleh kosong' });
    }

    await db.query(
      'UPDATE task_assignments SET teknisi_id = $1 WHERE id = $2',
      [teknisi_id, assignment_id]
    );
    
    res.json({ success: true });
  } catch (err) {
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
      WHERE ta.status IN ('assigned', 'pending')
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

module.exports = router;
