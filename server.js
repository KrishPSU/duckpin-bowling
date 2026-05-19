const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';
const SESSION_SECRET = process.env.SESSION_SECRET || 'chelmsford-lanes-change-me-in-production';

// Server-side Supabase client (service role — never expose this key to the browser)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

// Exposes only the anon key — safe for the browser, never the service role key
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// ── Reservations API ─────────────────────────────────────────────
app.get('/api/reservations', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('reservation_date', date)
    .in('status', ['pending', 'seated']);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/reservations', async (req, res) => {
  const { party_name, lane_id, reservation_date, start_time, adults, children } = req.body;

  if (!party_name || !lane_id || !reservation_date || !start_time || !adults) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const { data: conflict, error: checkError } = await supabase
    .from('reservations')
    .select('id')
    .eq('lane_id', lane_id)
    .eq('reservation_date', reservation_date)
    .eq('start_time', start_time)
    .in('status', ['pending', 'seated'])
    .maybeSingle();

  if (checkError) return res.status(500).json({ error: checkError.message });
  if (conflict) return res.status(409).json({ error: 'That time slot is already taken.' });

  const { data, error } = await supabase
    .from('reservations')
    .insert({
      party_name: party_name.trim(),
      lane_id: parseInt(lane_id),
      reservation_date,
      start_time,
      duration_rounds: 1,
      adults: parseInt(adults),
      children: parseInt(children) || 0,
      status: 'pending',
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  io.emit('reservation:new', data);
  res.status(201).json(data);
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
