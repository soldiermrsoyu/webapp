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
    const { fcu_id, teknisi_id } = req.body;
    
    console.log('Assigning task:', { fcu_id, teknisi_id, assigned_by: req.session.user.id });
    
    if (!fcu_id || !teknisi_id) {
      return res.json({ success: false, error: 'FCU ID dan Teknisi ID tidak boleh kosong' });
    }
    
    const result = await db.query(
      'INSERT INTO task_assignments (fcu_id, teknisi_id, assigned_by) VALUES ($1, $2, $3) RETURNING id',
      [fcu_id, teknisi_id, req.session.user.id]
    );
    
    console.log('Task assigned successfully:', result.rows[0]);
    res.json({ success: true, assignment_id: result.rows[0].id });
  } catch (err) {
    console.error('Error assigning task:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get assigned tasks for technician
router.get('/my-tasks', auth, role('teknisi'), async (req, res) => {
  try {
    const result = await db.query(
      'SELECT ta.id, ta.fcu_id, ta.status, j.lantai, j.alias, j.unit FROM task_assignments ta LEFT JOIN jadwal j ON ta.fcu_id = j.id WHERE ta.teknisi_id = $1 ORDER BY ta.created_at DESC',
      [req.session.user.id]
    );
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Submit task report
router.post('/submit-report', auth, role('teknisi'), async (req, res) => {
  try {
    const { assignment_id, findings, actions_taken, next_maintenance_date } = req.body;
    
    const result = await db.query(
      'INSERT INTO task_reports (assignment_id, findings, actions_taken, next_maintenance_date) VALUES ($1, $2, $3, $4) RETURNING id',
      [assignment_id, findings, actions_taken, next_maintenance_date]
    );
    
    // Update assignment status
    await db.query('UPDATE task_assignments SET status = $1 WHERE id = $2', ['completed', assignment_id]);
    
    res.json({ success: true, report_id: result.rows[0].id });
  } catch (err) {
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

module.exports = router;
