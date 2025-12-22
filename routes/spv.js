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

router.get('/spv/rencana', auth, role('spv'), (req, res) => {
  res.render('spv-rencana', { user: req.session.user });
});

router.get('/spv/laporan', auth, role('spv'), (req, res) => {
  res.render('spv-laporan', { user: req.session.user });
});

router.get('/spv/notifikasi', auth, role('spv'), (req, res) => {
  res.render('spv-notifikasi', { user: req.session.user });
});

router.get('/spv/profile', auth, role('spv'), (req, res) => {
  res.render('spv-profile', { user: req.session.user });
});

module.exports = router;