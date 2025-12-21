const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

router.get('/dashboard', auth, (req, res) => {
  if (req.session.user.role === 'spv') return res.redirect('/spv');
  if (req.session.user.role === 'teknisi') return res.redirect('/teknisi');
});

module.exports = router;