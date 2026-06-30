'use strict';
const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_FILE = path.join(__dirname, '..', 'users.json');

function load() {
  if (!fs.existsSync(DB_FILE)) return { users: [] };
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return { users: [] }; }
}
function save(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

const getAll    = ()    => load().users;
const byEmail   = e     => load().users.find(u => u.email.toLowerCase() === e.toLowerCase());
const byId      = id    => load().users.find(u => u.id === id);
const byGoogle  = gid   => load().users.find(u => u.googleId === gid);
const byToken   = tok   => load().users.find(u => u.inviteToken === tok);
const hasAdmin  = ()    => load().users.some(u => u.role === 'admin' && u.status === 'active');

function create({ name, email, role = 'viewer', googleId = null, passwordHash = null, inviteToken = null, status = 'pending' }) {
  const db = load();
  const user = {
    id: uuidv4(), name, email: email.toLowerCase(), role,
    googleId, passwordHash,
    inviteToken,
    inviteExpiry: inviteToken ? Date.now() + 7 * 86400000 : null,
    status,
    createdAt: new Date().toISOString(),
    lastLogin: null
  };
  db.users.push(user);
  save(db);
  return user;
}

function update(id, patch) {
  const db = load();
  const i  = db.users.findIndex(u => u.id === id);
  if (i === -1) return null;
  db.users[i] = { ...db.users[i], ...patch };
  save(db);
  return db.users[i];
}

function remove(id) {
  const db = load();
  db.users = db.users.filter(u => u.id !== id);
  save(db);
}

function safe(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

module.exports = { getAll, byEmail, byId, byGoogle, byToken, hasAdmin, create, update, remove, safe };
