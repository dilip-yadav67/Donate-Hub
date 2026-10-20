import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';

const { MONGO_URI = 'mongodb://127.0.0.1:27017/donatehub', JWT_SECRET = 'dev-secret', PORT = 5000, CLIENT_URL = 'http://localhost:5173' } = process.env;

const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['donor', 'ngo'], required: true },
  phone: { type: String, required: true },
}, { timestamps: true }));

const Donation = mongoose.model('Donation', new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  category: { type: String, enum: ['food', 'books', 'medical', 'clothes', 'other'], required: true },
  quantity: { type: String, required: true },
  description: String,
  address: String,
  location: { type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: { type: [Number], required: true } },
  status: { type: String, enum: ['available', 'claimed', 'completed'], default: 'available' },
  donor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  expiresAt: Date,
}, { timestamps: true }).index({ location: '2dsphere' }));

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_URL } });
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

const sign = u => jwt.sign({ id: u._id, role: u.role, name: u.name }, JWT_SECRET, { expiresIn: '7d' });
const safe = u => ({ id: u._id, name: u.name, role: u.role });
const auth = role => (req, res, next) => {
  try {
    req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET);
    if (role && req.user.role !== role) return res.status(403).json({ error: `Only ${role === 'ngo' ? 'NGOs' : 'donors'} can do this` });
    next();
  } catch { res.status(401).json({ error: 'Please log in again' }); }
};

io.use((s, next) => { try { s.user = jwt.verify(s.handshake.auth.token, JWT_SECRET); next(); } catch { next(new Error('unauthorized')); } });
io.on('connection', s => s.join(`user:${s.user.id}`));

// ---- Auth ----
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role, phone } = req.body;
  if (!name || !email || !phone || !['donor', 'ngo'].includes(role) || (password || '').length < 6)
    return res.status(400).json({ error: 'Fill every field. Password needs 6+ characters.' });
  const user = await User.create({ name, email, phone, role, password: await bcrypt.hash(password, 10) });
  res.status(201).json({ token: sign(user), user: safe(user) });
});
app.post('/api/auth/login', async (req, res) => {
  const user = await User.findOne({ email: (req.body.email || '').toLowerCase() });
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password))) return res.status(401).json({ error: 'Wrong email or password' });
  res.json({ token: sign(user), user: safe(user) });
});

// ---- Donations ----
app.get('/api/donations', auth(), async (req, res) => {
  const { lat, lng, radius = 10, category } = req.query;
  const q = { status: 'available', expiresAt: { $not: { $lt: new Date() } } };
  if (category) q.category = category;
  let items;
  if (lat && lng) {
    items = await Donation.aggregate([
      { $geoNear: { near: { type: 'Point', coordinates: [+lng, +lat] }, distanceField: 'distance', maxDistance: +radius * 1000, spherical: true, query: q } },
      { $limit: 50 },
    ]);
    items = await Donation.populate(items, { path: 'donor', select: 'name' });
  } else items = await Donation.find(q).sort('-createdAt').limit(50).populate('donor', 'name').lean();
  res.json(items);
});

app.get('/api/donations/mine', auth(), async (req, res) => {
  const donor = req.user.role === 'donor';
  const items = await Donation.find(donor ? { donor: req.user.id } : { claimedBy: req.user.id })
    .sort('-updatedAt').populate(donor ? 'claimedBy' : 'donor', 'name phone');
  res.json(items);
});

app.post('/api/donations', auth('donor'), async (req, res) => {
  const { title, category, quantity, description, address, lat, lng, expiresInHours } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'Location missing. Allow location access and try again.' });
  const d = await Donation.create({
    title, category, quantity, description, address, donor: req.user.id,
    location: { type: 'Point', coordinates: [+lng, +lat] },
    expiresAt: expiresInHours ? new Date(Date.now() + expiresInHours * 36e5) : undefined,
  });
  io.emit('donation:new', { _id: d._id, title: d.title, category: d.category });
  res.status(201).json(d);
});

app.post('/api/donations/:id/claim', auth('ngo'), async (req, res) => {
  const d = await Donation.findOneAndUpdate({ _id: req.params.id, status: 'available' }, { status: 'claimed', claimedBy: req.user.id }, { new: true });
  if (!d) return res.status(409).json({ error: 'Someone else already claimed this item' });
  io.to(`user:${d.donor}`).emit('donation:claimed', { title: d.title, ngo: req.user.name });
  io.emit('donation:update', d._id);
  res.json(d);
});

app.post('/api/donations/:id/complete', auth('donor'), async (req, res) => {
  const d = await Donation.findOneAndUpdate({ _id: req.params.id, donor: req.user.id, status: 'claimed' }, { status: 'completed' }, { new: true });
  if (!d) return res.status(404).json({ error: 'Nothing to complete' });
  res.json(d);
});

app.delete('/api/donations/:id', auth('donor'), async (req, res) => {
  const d = await Donation.findOneAndDelete({ _id: req.params.id, donor: req.user.id, status: 'available' });
  if (!d) return res.status(404).json({ error: 'Only unclaimed listings can be removed' });
  io.emit('donation:update', d._id);
  res.json({ ok: true });
});

app.use((err, req, res, next) => res.status(err.code === 11000 ? 409 : 400).json({ error: err.code === 11000 ? 'This email is already registered' : err.message }));

mongoose.connect(MONGO_URI).then(() => server.listen(PORT, () => console.log(`API on :${PORT}`)));
