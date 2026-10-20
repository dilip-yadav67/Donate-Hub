import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from './api';

const CATS = ['food', 'books', 'medical', 'clothes', 'other'];
const dist = d => (d == null ? '' : d >= 1000 ? `${(d / 1000).toFixed(1)} km away` : `${Math.round(d)} m away`);
const left = t => { if (!t) return ''; const h = (new Date(t) - Date.now()) / 36e5; return h <= 0 ? 'Expired' : h < 1 ? 'Under 1 hour left' : `${Math.round(h)} h left`; };

function Auth({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ role: 'donor' });
  const [err, setErr] = useState('');
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const submit = async e => {
    e.preventDefault();
    try { onAuth(await api(`/auth/${mode}`, { method: 'POST', body: f })); } catch (x) { setErr(x.message); }
  };
  return (
    <main className="auth">
      <h1>Surplus should reach someone, not the bin.</h1>
      <p>List extra food, books or medicines. Nearby NGOs claim them in minutes.</p>
      <form onSubmit={submit}>
        {mode === 'register' && <>
          <input placeholder="Name or organisation" onChange={set('name')} required />
          <input placeholder="Phone number" onChange={set('phone')} required />
          <select value={f.role} onChange={set('role')}><option value="donor">I want to donate</option><option value="ngo">We are an NGO</option></select>
        </>}
        <input type="email" placeholder="Email" onChange={set('email')} required />
        <input type="password" placeholder="Password (6+ characters)" onChange={set('password')} required />
        {err && <p className="err">{err}</p>}
        <button>{mode === 'login' ? 'Log in' : 'Create account'}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}
        </button>
      </form>
    </main>
  );
}

function Card({ d, children }) {
  const [lng, lat] = d.location?.coordinates || [];
  return (
    <article className={`card c-${d.category}`}>
      <div className="row"><h3>{d.title}</h3><span className="tag">{d.category}</span></div>
      <p>{d.quantity}{d.description ? ` · ${d.description}` : ''}</p>
      <p className="meta">{[d.donor?.name, dist(d.distance), left(d.expiresAt), d.status !== 'available' && d.status].filter(Boolean).join(' · ')}</p>
      {d.address && <p className="meta"><a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">{d.address}</a></p>}
      {children}
    </article>
  );
}

function Feed({ pos, role, tick, say }) {
  const [items, setItems] = useState(null);
  const [cat, setCat] = useState('');
  const [radius, setRadius] = useState(10);
  useEffect(() => {
    const qs = new URLSearchParams({ ...(pos && { lat: pos.lat, lng: pos.lng, radius }), ...(cat && { category: cat }) });
    api('/donations?' + qs).then(setItems).catch(e => say(e.message));
  }, [pos, cat, radius, tick]);
  const claim = id => api(`/donations/${id}/claim`, { method: 'POST' }).then(() => say('Claimed. Contact details are in My claims.')).catch(e => say(e.message));
  return (
    <>
      <div className="filters">
        <select value={cat} onChange={e => setCat(e.target.value)}><option value="">All categories</option>{CATS.map(c => <option key={c}>{c}</option>)}</select>
        {pos && <select value={radius} onChange={e => setRadius(e.target.value)}>{[2, 5, 10, 25, 50].map(r => <option key={r} value={r}>Within {r} km</option>)}</select>}
      </div>
      {items === null ? <p>Loading…</p> : items.length === 0 ? <p className="empty">Nothing listed nearby yet. New items appear here the moment they are posted.</p> :
        <div className="grid">{items.map(d => <Card key={d._id} d={d}>{role === 'ngo' && <button onClick={() => claim(d._id)}>Claim this item</button>}</Card>)}</div>}
    </>
  );
}

function Donate({ pos, say, done }) {
  const [f, setF] = useState({ category: 'food', expiresInHours: 6 });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const submit = async e => {
    e.preventDefault();
    if (!pos) return say('Allow location access so NGOs can find you.');
    try { await api('/donations', { method: 'POST', body: { ...f, ...pos } }); say('Listed. NGOs nearby have been notified.'); done(); } catch (x) { say(x.message); }
  };
  return (
    <form className="panel" onSubmit={submit}>
      <input placeholder="What are you giving? (e.g. 20 meal boxes)" onChange={set('title')} required />
      <select value={f.category} onChange={set('category')}>{CATS.map(c => <option key={c}>{c}</option>)}</select>
      <input placeholder="Quantity (e.g. 20 boxes, 3 bags)" onChange={set('quantity')} required />
      <input placeholder="Pickup address or landmark" onChange={set('address')} />
      <textarea placeholder="Anything NGOs should know" onChange={set('description')} />
      <label>Available for <select value={f.expiresInHours} onChange={set('expiresInHours')}>{[2, 6, 12, 24, 72].map(h => <option key={h} value={h}>{h} hours</option>)}</select></label>
      <button>List item</button>
    </form>
  );
}

function Mine({ role, tick, say }) {
  const [items, setItems] = useState(null);
  const load = () => api('/donations/mine').then(setItems).catch(e => say(e.message));
  useEffect(() => { load(); }, [tick]);
  const act = (id, path, method = 'POST') => api(`/donations/${id}${path}`, { method }).then(load).catch(e => say(e.message));
  if (!items) return <p>Loading…</p>;
  if (!items.length) return <p className="empty">{role === 'ngo' ? 'You have not claimed anything yet. Open Nearby to find items.' : 'You have not listed anything yet.'}</p>;
  return <div className="grid">{items.map(d => {
    const other = role === 'donor' ? d.claimedBy : d.donor;
    return (
      <Card key={d._id} d={{ ...d, donor: role === 'donor' ? null : d.donor }}>
        {other && <p className="contact">{role === 'donor' ? 'Claimed by' : 'Donor'}: {other.name} · <a href={`tel:${other.phone}`}>{other.phone}</a></p>}
        {role === 'donor' && d.status === 'available' && <button className="ghost" onClick={() => act(d._id, '', 'DELETE')}>Remove listing</button>}
        {role === 'donor' && d.status === 'claimed' && <button onClick={() => act(d._id, '/complete')}>Mark as picked up</button>}
      </Card>
    );
  })}</div>;
}

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const [tab, setTab] = useState('nearby');
  const [toast, setToast] = useState('');
  const [pos, setPos] = useState(null);
  const [geoErr, setGeoErr] = useState('');
  const [tick, setTick] = useState(0);
  const say = m => { setToast(m); setTimeout(() => setToast(''), 4500); };

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(p => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }), () => setGeoErr('Location is off. Allow it in your browser to see items near you.'));
  }, []);
  useEffect(() => {
    if (!user) return;
    const s = io({ auth: { token: localStorage.getItem('token') } });
    s.on('donation:new', d => { setTick(t => t + 1); if (user.role === 'ngo') say(`New ${d.category} listed: ${d.title}`); });
    s.on('donation:update', () => setTick(t => t + 1));
    s.on('donation:claimed', d => { setTick(t => t + 1); say(`${d.ngo} claimed "${d.title}"`); });
    return () => s.disconnect();
  }, [user]);

  const onAuth = ({ token, user }) => { localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); setUser(user); };
  const logout = () => { localStorage.clear(); setUser(null); };
  if (!user) return <Auth onAuth={onAuth} />;

  const tabs = user.role === 'donor' ? [['nearby', 'Nearby'], ['donate', 'Donate'], ['mine', 'My donations']] : [['nearby', 'Nearby'], ['mine', 'My claims']];
  return (
    <>
      <header><b>DonateHub</b><nav>{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
        <span>{user.name} <button className="link" onClick={logout}>Log out</button></span></header>
      <main>
        {geoErr && !pos && <p className="err">{geoErr}</p>}
        {tab === 'nearby' && <Feed pos={pos} role={user.role} tick={tick} say={say} />}
        {tab === 'donate' && <Donate pos={pos} say={say} done={() => setTab('mine')} />}
        {tab === 'mine' && <Mine role={user.role} tick={tick} say={say} />}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
