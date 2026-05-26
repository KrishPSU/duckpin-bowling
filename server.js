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
const TOTAL_LANES = 6;

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
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized.' });
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

// Returns lightweight slot counts for a date range — used by the calendar view
app.get('/api/availability', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });
  const { data, error } = await supabase
    .from('reservations')
    .select('id, reservation_date, start_time')
    .gte('reservation_date', start)
    .lte('reservation_date', end)
    .in('status', ['pending', 'seated']);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Returns all pending/seated reservations for a date (used by reserve.html for slot availability)
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

// Create a reservation — no lane assigned at booking time; lane assigned in person on arrival.
// NOTE: The `lane_id` column in the `reservations` table must allow NULL.
// Run this in Supabase SQL editor if needed:
//   ALTER TABLE reservations ALTER COLUMN lane_id DROP NOT NULL;
app.post('/api/reservations', async (req, res) => {
  const { party_name, reservation_date, start_time, adults, children } = req.body;

  if (!party_name || !reservation_date || !start_time || !adults) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // Check capacity: each time slot supports at most TOTAL_LANES concurrent parties
  const { count, error: countError } = await supabase
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .eq('reservation_date', reservation_date)
    .eq('start_time', start_time)
    .in('status', ['pending', 'seated']);

  if (countError) return res.status(500).json({ error: countError.message });
  if (count >= TOTAL_LANES) {
    return res.status(409).json({ error: 'All lanes are fully booked for that time slot. Please choose a different time.' });
  }

  const { data, error } = await supabase
    .from('reservations')
    .insert({
      party_name: party_name.trim(),
      reservation_date,
      start_time,
      duration_rounds: 1,
      adults: parseInt(adults),
      children: parseInt(children) || 0,
      status: 'pending',
      // lane_id intentionally omitted — assigned by staff when party arrives
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  io.emit('reservation:new', data);
  res.status(201).json(data);
});

// ── Announcements API ────────────────────────────────────────────
// NOTE: The announcements table needs a `hidden` boolean column.
// Run this in Supabase SQL editor if needed:
//   ALTER TABLE announcements ADD COLUMN hidden BOOLEAN DEFAULT FALSE;

app.get('/api/announcements', async (req, res) => {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('hidden', false)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/admin/announcements', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('hidden', false)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/admin/announcements', requireAdmin, async (req, res) => {
  const { header, content, color } = req.body;
  if (!header || !content || !color) {
    return res.status(400).json({ error: 'Header, content, and color are required.' });
  }
  const validColors = ['grey', 'yellow', 'red', 'green'];
  if (!validColors.includes(color)) {
    return res.status(400).json({ error: 'Invalid color.' });
  }
  const { data, error } = await supabase
    .from('announcements')
    .insert({ header: header.trim(), content: content.trim(), color, hidden: false })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  io.emit('announcement:new', data);
  res.status(201).json(data);
});

app.patch('/api/admin/announcements/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { header, content, color } = req.body;
  if (!header || !content || !color) {
    return res.status(400).json({ error: 'Header, content, and color are required.' });
  }
  const validColors = ['grey', 'yellow', 'red', 'green'];
  if (!validColors.includes(color)) {
    return res.status(400).json({ error: 'Invalid color.' });
  }
  const { data, error } = await supabase
    .from('announcements')
    .update({ header: header.trim(), content: content.trim(), color })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  io.emit('announcement:updated', data);
  res.json(data);
});

app.patch('/api/admin/announcements/:id/hide', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('announcements')
    .update({ hidden: true })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  io.emit('announcement:hidden', { id });
  res.json(data);
});

// ── Admin Reservations API ───────────────────────────────────────

// Returns all pending/seated reservations for a date, ordered by time then creation
app.get('/api/admin/reservations', requireAdmin, async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('reservation_date', date)
    .in('status', ['pending', 'seated'])
    .order('start_time', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Seat a party: assign a lane and mark status as 'seated'
app.patch('/api/admin/reservations/:id/seat', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { lane_id } = req.body;

  const laneNum = parseInt(lane_id);
  if (!lane_id || isNaN(laneNum) || laneNum < 1 || laneNum > TOTAL_LANES) {
    return res.status(400).json({ error: `A valid lane (1–${TOTAL_LANES}) is required.` });
  }

  // Fetch the reservation to get its date and time for conflict check
  const { data: existing, error: fetchError } = await supabase
    .from('reservations')
    .select('id, start_time, reservation_date, status')
    .eq('id', id)
    .single();

  if (fetchError || !existing) return res.status(404).json({ error: 'Reservation not found.' });

  // Ensure the selected lane isn't already seated at this time slot
  const { data: laneConflict } = await supabase
    .from('reservations')
    .select('id')
    .eq('lane_id', laneNum)
    .eq('reservation_date', existing.reservation_date)
    .eq('start_time', existing.start_time)
    .eq('status', 'seated')
    .neq('id', id)
    .maybeSingle();

  if (laneConflict) {
    return res.status(409).json({ error: `Lane ${laneNum} is already occupied at that time slot.` });
  }

  const { data, error } = await supabase
    .from('reservations')
    .update({ status: 'seated', lane_id: laneNum })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  io.emit('reservation:seated', data);
  res.json(data);
});

// Remove a reservation (no-show or cancellation) — marks as cancelled rather than deleting
app.delete('/api/admin/reservations/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('reservations')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') return res.status(404).json({ error: 'Reservation not found.' });
    return res.status(500).json({ error: error.message });
  }

  io.emit('reservation:removed', { id });
  res.json({ success: true });
});

// ── Admin static assets (CSS/login JS — no sensitive content) ────
app.get('/admin/admin.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'admin.css'));
});
app.get('/admin/login.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'login.css'));
});
app.get('/admin/login.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'login.js'));
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

app.get('/admin/admin.js', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'admin.js'));
});

app.get('/admin/announcements', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'announcements.html'));
});

app.get('/admin/announcements.js', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'announcements.js'));
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
