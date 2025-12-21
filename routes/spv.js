const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const role = require('../middleware/role');

router.get('/spv', auth, role('spv'), (req, res) => {
  res.render('spv', { user: req.session.user });
});

router.get('/spv/task', auth, role('spv'), (req, res) => {
  res.render('spv-task', { user: req.session.user });
});

router.get('/spv/profile', auth, role('spv'), (req, res) => {
  res.render('spv-profile', { user: req.session.user });
});

module.exports = router;