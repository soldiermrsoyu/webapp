const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const role = require('../middleware/role');

router.get('/teknisi', auth, role('teknisi'), (req, res) => {
  res.render('teknisi', { user: req.session.user });
});

router.get('/teknisi/task', auth, role('teknisi'), (req, res) => {
  res.render('teknisi-task', { user: req.session.user });
});

router.get('/teknisi/profile', auth, role('teknisi'), (req, res) => {
  res.render('teknisi-profile', { user: req.session.user });
});

module.exports = router;