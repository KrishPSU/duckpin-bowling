const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');

require('dotenv').config();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';
const SESSION_SECRET = process.env.SESSION_SECRET || 'chelmsford-lanes-change-me-in-production';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Simple rate limiter: max 5 failed login attempts per IP per 60 seconds
const loginAttempts = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return false;
  if (now > record.resetAt) { loginAttempts.delete(ip); return false; }
  return record.count >= 5;
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  let record = loginAttempts.get(ip);
  if (!record || now > record.resetAt) record = { count: 0, resetAt: now + 60_000 };
  record.count++;
  loginAttempts.set(ip, record);
}

// ── Middleware ───────────────────────────────────────────────────
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'app')));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,   // JS cannot read this cookie
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// ── Auth guard middleware ─────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

// ── Public routes ────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'app', 'index.html'));
});

app.get('/reserve', (req, res) => {
  res.sendFile(path.join(__dirname, 'app', 'reserve.html'));
});

// ── Admin login ──────────────────────────────────────────────────
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.isAdmin) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

app.post('/admin/login', (req, res) => {
  const ip = req.ip;

  if (isRateLimited(ip)) {
    return res.redirect('/admin/login?error=rate');
  }

  const { password } = req.body;

  if (!password || password !== ADMIN_PASSWORD) {
    recordFailedAttempt(ip);
    return res.redirect('/admin/login?error=wrong');
  }

  // Correct — regenerate session to prevent session fixation, then mark as admin
  req.session.regenerate((err) => {
    if (err) return res.redirect('/admin/login?error=wrong');
    req.session.isAdmin = true;
    loginAttempts.delete(ip);
    res.redirect('/admin');
  });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ── Protected admin dashboard ────────────────────────────────────
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// ── Socket.IO ────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('connection:', socket.id);
  socket.on('disconnect', () => console.log('disconnected:', socket.id));
});

// ── Start ────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
