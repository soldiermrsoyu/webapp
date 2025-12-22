require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

// views & static
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// session
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// routes
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/spv'));
app.use('/', require('./routes/teknisi'));
app.use('/api', require('./routes/api'));

app.listen(5000, () => console.log('Server running on port 5000'));