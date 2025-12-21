const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  res.redirect('/login');
});

router.get('/login', (req, res) => {
  res.render('login');
});

router.post('/login', async (req, res) => {
  const { user, password } = req.body;
  try {
    const result = await db.query(
      'SELECT * FROM users WHERE "user"=$1 AND password=$2',
      [user, password]
    );

    if (result.rowCount === 0) return res.redirect('/login');

    const u = result.rows[0];
    req.session.user = {
      id: u.id,
      user: u.user,
      role: u.role
    };

    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.redirect('/login');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;