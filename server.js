'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express        = require('express');
const fetch          = require('node-fetch');
const path           = require('path');
const https          = require('https');
const fs             = require('fs');
const session        = require('express-session');
const passport       = require('passport');
const LocalStrategy  = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt         = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db             = require('./auth/db');
const { sendInvite } = require('./auth/email');

const hiverAgent    = new https.Agent({ rejectUnauthorized: false });
const aircallAgent  = new https.Agent({ rejectUnauthorized: false });

const app      = express();
const PORT     = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'ops-hub-dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure:   BASE_URL.startsWith('https'),
    maxAge:   7 * 24 * 60 * 60 * 1000
  }
}));

// ── Passport ──────────────────────────────────────────────────────────────────
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = db.byId(id);
  done(null, user || false);
});

passport.use(new LocalStrategy({ usernameField: 'email' }, (email, password, done) => {
  const user = db.byEmail(email);
  if (!user) return done(null, false, { message: 'Invalid email or password.' });
  if (user.status === 'suspended') return done(null, false, { message: 'Account suspended. Contact your administrator.' });
  if (!user.passwordHash) return done(null, false, { message: 'Use Google Sign-In for this account.' });
  if (!bcrypt.compareSync(password, user.passwordHash)) return done(null, false, { message: 'Invalid email or password.' });
  return done(null, user);
}));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  `${BASE_URL}/auth/google/callback`
  }, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value;
    if (!email) return done(null, false);
    let user = db.byGoogle(profile.id) || db.byEmail(email);
    if (!user) return done(null, false, { message: 'no-access' });
    if (user.status === 'suspended') return done(null, false, { message: 'suspended' });
    if (!user.googleId) db.update(user.id, { googleId: profile.id, status: 'active' });
    return done(null, db.byId(user.id));
  }));
}

app.use(passport.initialize());
app.use(passport.session());

// ── Auth helpers ──────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (req.headers.accept?.includes('application/json') || req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'admin') {
    if (req.headers.accept?.includes('application/json') || req.path.startsWith('/admin/api/')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    return res.redirect('/');
  }
  next();
}

function stampLogin(user) {
  db.update(user.id, { lastLogin: new Date().toISOString() });
}

// ── Aircall message store ─────────────────────────────────────────────────────
const MESSAGES_FILE = path.join(__dirname, 'aircall-messages.json');
function loadStoredMessages() {
  try { if (fs.existsSync(MESSAGES_FILE)) return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')); } catch(e) {}
  return [];
}
function saveStoredMessages(msgs) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(msgs, null, 2));
}

// ════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES  (no auth required)
// ════════════════════════════════════════════════════════════════════

// Aircall webhook — called by Aircall servers, must stay public
app.post('/aircall-webhook', (req, res) => {
  try {
    const { event, timestamp, data } = req.body || {};
    console.log('[webhook]', event, JSON.stringify(data || {}).slice(0, 120));
    if (event === 'message.sent' || event === 'message.received') {
      const msgs = loadStoredMessages();
      const msg = {
        id:               String(data.id || `${Date.now()}`),
        direction:        data.direction || (event === 'message.received' ? 'inbound' : 'outbound'),
        content:          data.content || data.body || data.text || '',
        from:             data.from || '',
        to:               data.to || '',
        created_at:       data.created_at || timestamp || Math.floor(Date.now() / 1000),
        conversation_key: data.conversation_key || data.conversation_id || `conv-${(data.from||data.to||'unknown').replace(/\D/g,'')}`,
        user:             data.user   || null,
        number:           data.number || null,
        read:             false,
        event,
      };
      if (!msgs.find(m => m.id === msg.id)) {
        msgs.push(msg);
        saveStoredMessages(msgs);
        console.log(`[webhook] stored ${event}, total messages: ${msgs.length}`);
      }
    }
    res.json({ ok: true });
  } catch(e) {
    console.error('[webhook error]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Auth config — tells login page whether to show setup or sign-in
app.get('/auth/config', (req, res) => {
  res.json({
    needsSetup:    !db.hasAdmin(),
    googleEnabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  });
});

// First-time setup — creates the initial admin account
app.post('/setup', async (req, res) => {
  if (db.hasAdmin()) return res.status(400).json({ error: 'Setup already complete.' });
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (db.byEmail(email)) return res.status(400).json({ error: 'Email already registered.' });
  const hash = bcrypt.hashSync(password, 12);
  const user = db.create({ name, email, role: 'admin', passwordHash: hash, status: 'active' });
  req.login(user, err => {
    if (err) return res.status(500).json({ error: 'Account created but login failed.' });
    stampLogin(user);
    res.json({ ok: true, redirect: '/' });
  });
});

// Email / password login
app.post('/auth/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials.' });
    req.login(user, err2 => {
      if (err2) return next(err2);
      stampLogin(user);
      res.json({ ok: true, redirect: '/' });
    });
  })(req, res, next);
});

// Google OAuth
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=no-access' }),
  (req, res) => { stampLogin(req.user); res.redirect('/'); }
);

// Logout
app.post('/auth/logout', (req, res) => {
  req.logout(() => res.json({ ok: true }));
});

// Invite acceptance page (GET = serve HTML, POST = accept)
app.get('/invite/:token', (req, res) => {
  const user = db.byToken(req.params.token);
  if (!user || Date.now() > user.inviteExpiry) return res.redirect('/login?error=expired');
  res.sendFile(path.join(__dirname, 'login', 'invite.html'));
});

app.post('/invite/:token', (req, res) => {
  const user = db.byToken(req.params.token);
  if (!user) return res.status(400).json({ error: 'Invalid or expired invite link.' });
  if (Date.now() > user.inviteExpiry) return res.status(400).json({ error: 'This invite link has expired.' });
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Name and password required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const hash    = bcrypt.hashSync(password, 12);
  const updated = db.update(user.id, {
    name, passwordHash: hash,
    inviteToken: null, inviteExpiry: null,
    status: 'active'
  });
  req.login(updated, err => {
    if (err) return res.status(500).json({ error: 'Account created but login failed.' });
    stampLogin(updated);
    res.json({ ok: true, redirect: '/' });
  });
});

// Login page — served without auth
app.use('/login', express.static(path.join(__dirname, 'login')));

// ════════════════════════════════════════════════════════════════════
// AUTH GUARD — everything below requires a logged-in session
// ════════════════════════════════════════════════════════════════════
// AUTH GUARD DISABLED — remove the comment below to re-enable login protection
// app.use((req, res, next) => {
//   if (!db.hasAdmin()) return res.redirect('/login');
//   requireAuth(req, res, next);
// });

// ── Admin page ────────────────────────────────────────────────────────────────
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// ── Admin API ─────────────────────────────────────────────────────────────────
app.get('/admin/api/me', (req, res) => {
  res.json(db.safe(req.user));
});

app.get('/admin/api/users', requireAdmin, (req, res) => {
  res.json(db.getAll().map(db.safe));
});

app.post('/admin/api/invite', requireAdmin, async (req, res) => {
  const { name, email, role = 'viewer' } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required.' });
  if (db.byEmail(email)) return res.status(400).json({ error: 'A user with this email already exists.' });
  const token   = uuidv4();
  const user    = db.create({ name, email, role, inviteToken: token, status: 'pending' });
  const inviteUrl = `${BASE_URL}/invite/${token}`;
  let smtp = false;
  try {
    await sendInvite({ to: email, name, inviteUrl, invitedBy: req.user.name });
    smtp = !!process.env.SMTP_USER;
  } catch(e) {
    console.error('[invite email error]', e.message);
  }
  res.json({ ok: true, smtp, inviteUrl });
});

app.post('/admin/api/invite/resend', requireAdmin, async (req, res) => {
  const user = db.byId(req.body.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.status !== 'pending') return res.status(400).json({ error: 'User has already accepted the invite.' });
  const token = uuidv4();
  db.update(user.id, { inviteToken: token, inviteExpiry: Date.now() + 7 * 86400000 });
  const inviteUrl = `${BASE_URL}/invite/${token}`;
  try { await sendInvite({ to: user.email, name: user.name, inviteUrl, invitedBy: req.user.name }); }
  catch(e) { console.error('[resend email error]', e.message); }
  res.json({ ok: true });
});

app.patch('/admin/api/users/:id', requireAdmin, (req, res) => {
  const user = db.byId(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'Cannot modify your own account here.' });
  const patch = {};
  if (req.body.role   && ['viewer','manager','admin'].includes(req.body.role))   patch.role   = req.body.role;
  if (req.body.status && ['active','suspended'].includes(req.body.status))       patch.status = req.body.status;
  res.json({ ok: true, user: db.safe(db.update(req.params.id, patch)) });
});

app.delete('/admin/api/users/:id', requireAdmin, (req, res) => {
  const user = db.byId(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account.' });
  db.remove(req.params.id);
  res.json({ ok: true });
});

// ── Hubstaff proxy ────────────────────────────────────────────────────────────
const HUBSTAFF_REFRESH_TOKEN = process.env.HUBSTAFF_REFRESH_TOKEN;
let cachedToken = null;
let tokenExpiry = 0;

async function getHubstaffToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const r = await fetch('https://account.hubstaff.com/access_tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(HUBSTAFF_REFRESH_TOKEN)}`
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(d));
  cachedToken = d.access_token;
  tokenExpiry = Date.now() + (d.expires_in - 120) * 1000;
  console.log('[Hubstaff] Token refreshed, expires in', Math.round(d.expires_in/3600), 'hrs');
  return cachedToken;
}

// ── Upstream resilience: retry on rate-limit/5xx + per-API concurrency cap ────
// These third-party APIs (esp. Hiver) reject bursts of requests with HTTP 429.
// We retry those transparently with exponential backoff, and cap how many
// requests hit each upstream at once so a dashboard's burst never trips the limit.
async function fetchWithRetry(url, options = {}, { retries = 5, baseDelay = 500 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(url, options);
    } catch (e) {
      if (attempt >= retries) throw e;
      await new Promise(res => setTimeout(res, baseDelay * Math.pow(2, attempt)));
      continue;
    }
    if ([429, 502, 503, 504].includes(r.status) && attempt < retries) {
      const ra    = parseInt(r.headers.get('retry-after'), 10);
      const delay = (ra > 0 ? ra * 1000 : baseDelay * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
      console.log(`[retry] ${r.status} ${url.slice(8, 70)} — wait ${delay}ms (try ${attempt + 1}/${retries})`);
      await new Promise(res => setTimeout(res, delay));
      continue;
    }
    return r;
  }
}

// Concurrency limiter — caps simultaneous in-flight requests to one upstream.
function makeLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

const hubstaffLimit = makeLimiter(4);
const hiverLimit    = makeLimiter(2);
const aircallLimit  = makeLimiter(3);

app.use('/hubstaff-proxy', async (req, res) => {
  try {
    const token = await getHubstaffToken();
    const url   = `https://api.hubstaff.com${req.url}`;
    const upstream = await hubstaffLimit(() => fetchWithRetry(url, { headers: { 'Authorization': `Bearer ${token}` } }));
    res.json(await upstream.json());
  } catch (e) {
    console.error('[Hubstaff proxy error]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Hiver proxy ───────────────────────────────────────────────────────────────
const HIVER_API_KEY = process.env.HIVER_API_KEY;
app.use('/hiver-proxy', async (req, res) => {
  try {
    const url = `https://api2.hiverhq.com${req.url}`;
    const upstream = await hiverLimit(() => fetchWithRetry(url, {
      headers: { 'Authorization': `Bearer ${HIVER_API_KEY}` },
      agent: hiverAgent
    }));
    res.json(await upstream.json());
  } catch (e) {
    console.error('[Hiver proxy error]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Asana proxy ───────────────────────────────────────────────────────────────
const ASANA_ACCESS_TOKEN = process.env.ASANA_ACCESS_TOKEN;
const asanaLimit = makeLimiter(4);
app.use('/asana-proxy', async (req, res) => {
  try {
    const url = `https://app.asana.com/api/1.0${req.url}`;
    const upstream = await asanaLimit(() => fetchWithRetry(url, {
      headers: { 'Authorization': `Bearer ${ASANA_ACCESS_TOKEN}`, 'Accept': 'application/json' }
    }));
    res.status(upstream.status).json(await upstream.json());
  } catch (e) {
    console.error('[Asana proxy error]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Aircall ───────────────────────────────────────────────────────────────────
const AIRCALL_API_ID    = process.env.AIRCALL_API_ID;
const AIRCALL_API_TOKEN = process.env.AIRCALL_API_TOKEN;
const AIRCALL_AUTH      = Buffer.from(`${AIRCALL_API_ID}:${AIRCALL_API_TOKEN}`).toString('base64');

function mapAircallCall(c) {
  return {
    id:                 String(c.id),
    agent:              c.user?.name || 'Unanswered / Voicemail',
    agent_email:        c.user?.email || null,
    phone:              c.raw_digits || c.contact?.phone_numbers?.[0]?.value || 'Unknown',
    direction:          c.direction || 'inbound',
    duration:           c.duration || 0,
    wait_duration:      c.wait_duration || 0,
    timestamp:          new Date((c.started_at || 0) * 1000).toISOString(),
    status:             c.status || 'done',
    missed:             c.status === 'missed' || c.missed === true,
    voicemail:          c.status === 'voicemail' || !!(c.voicemail),
    transferred:        !!(c.transferred),
    missed_call_reason: c.missed_call_reason || null,
    line_name:          c.number?.name || c.number?.digits || null,
    tags:               (c.tags || []).map(t => typeof t === 'string' ? t : t.name).filter(Boolean),
    contact_name:       c.contact?.name || null,
    contact_company:    c.contact?.company_name || null,
    sentiment:          'neutral',
    sentiment_score:    0.5,
    call_outcome:       c.status === 'missed' ? 'unresolved' : 'resolved',
    key_topics:         [],
    action_items:       (c.comments || []).map(cm => cm.content).filter(Boolean),
    follow_up_required: c.status === 'missed',
    summary:            c.recording ? 'Recording available.' : (c.comments?.length ? c.comments.map(cm => cm.content).join(' ') : 'No notes yet.'),
    recording:          c.recording || null,
    analyzed:           false,
  };
}

app.get('/aircall-messages', (req, res) => {
  const msgs = loadStoredMessages();
  const from = req.query.from ? parseInt(req.query.from) : 0;
  const to   = req.query.to   ? parseInt(req.query.to)   : Infinity;
  res.json({ messages: msgs.filter(m => m.created_at >= from && m.created_at <= to), total: msgs.length });
});

app.use('/aircall-proxy', async (req, res) => {
  try {
    const urlObj    = new URL('http://localhost' + req.url);
    const pathParam = urlObj.searchParams.get('path') || 'calls';
    urlObj.searchParams.delete('path');
    const apiVersion = urlObj.searchParams.get('_v') || 'v1';
    urlObj.searchParams.delete('_v');
    const apiUrl = `https://api.aircall.io/${apiVersion}/${pathParam}?${urlObj.searchParams.toString()}`;
    console.log('[aircall-proxy]', apiUrl);
    const upstream = await aircallLimit(() => fetchWithRetry(apiUrl, {
      headers: { 'Authorization': `Basic ${AIRCALL_AUTH}`, 'Content-Type': 'application/json' },
      agent: aircallAgent
    }));
    const rawText = await upstream.text();
    console.log(`[aircall-proxy] status=${upstream.status} body=${rawText.slice(0,200)}`);
    const data = JSON.parse(rawText);
    if (!upstream.ok) return res.status(upstream.status).json({ ...data, _status: upstream.status, _url: apiUrl });
    if (pathParam === 'calls' && Array.isArray(data.calls)) {
      res.json({ source: 'aircall', calls: data.calls.map(mapAircallCall), meta: data.meta, contacts_loaded: 0 });
    } else {
      res.json(data);
    }
  } catch(e) {
    console.error('[aircall-proxy error]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Admin static guard — blocks direct file access for non-admins ─────────────
app.use('/admin', requireAdmin);

// ── Protected static files ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const hasAdmin = db.hasAdmin();
  console.log(`\n  Operations Hub → http://localhost:${PORT}`);
  if (!hasAdmin) console.log(`  No admin yet — visit http://localhost:${PORT}/login to set up\n`);
  else console.log(`  Login at http://localhost:${PORT}/login\n`);
});
