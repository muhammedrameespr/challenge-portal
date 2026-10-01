import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { downloadAttachment, readableError } from '../api.js';

export function Icon({ name, size = 20, ...props }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    arrow: <path d="M5 12h14M13 6l6 6-6 6"/>,
    back: <path d="M19 12H5m6-6-6 6 6 6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></>,
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>,
    logout: <path d="M9 5H4v14h5M9 12h12m-5-5 5 5-5 5"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    edit: <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    code: <path d="m7 7-5 5 5 5m10-10 5 5-5 5m-3-14-4 18"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.grid}</svg>;
}

export function Brand() {
  return <span className="brand"><span className="brand-mark"><Icon name="code" size={22}/></span><span>challenge<span className="brand-light">portal</span><span className="brand-dot">.</span></span></span>;
}

export function Loading({ text = 'Loading…' }) { return <div className="loading-state" role="status"><span className="spinner"/>{text}</div>; }
export function Message({ children, type = 'error', className = '' }) { return children ? <div className={`message ${type} ${className}`} role={type === 'error' ? 'alert' : 'status'}><Icon name={type === 'success' ? 'check' : 'info'} size={18}/><span>{children}</span></div> : null; }
export function ErrorState({ message, retry }) { return <div className="empty-state"><span className="empty-icon"><Icon name="info" size={30}/></span><h2>Something needs another try</h2><p>{message}</p>{retry && <button className="button secondary" onClick={retry}>Try again <Icon name="arrow" size={16}/></button>}</div>; }
export function Difficulty({ value }) { return <span className={`difficulty ${value}`}><i aria-hidden="true"/>{value || 'easy'}</span>; }
export function ProgressStatus({ value = 'not_started' }) {
  const normalized = value?.replaceAll(' ', '_').toLowerCase();
  const completed = normalized === 'completed';
  const attempted = normalized === 'attempted';
  return <span className={`progress-status ${completed ? 'completed' : attempted ? 'attempted' : ''}`}><Icon name={completed ? 'check' : attempted ? 'clock' : 'code'} size={14}/>{completed ? 'Completed' : attempted ? 'Attempted' : 'Not started'}</span>;
}

export function Shell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function signOut() {
    setBusy(true); setError('');
    try { await logout(); navigate('/login', { replace: true }); }
    catch (e) { setError(readableError(e)); }
    finally { setBusy(false); }
  }
  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <Link className="brand-link" aria-label="Challenge Portal home" to={user.role === 'ADMIN' ? '/admin/challenges' : '/challenges'}><Brand/></Link>
      <nav className="primary-nav" aria-label="Main navigation">
        <NavLink to="/challenges"><Icon name="grid" size={17}/>{user.role === 'ADMIN' ? 'User preview' : 'Challenges'}</NavLink>
        {user.role === 'ADMIN' && <NavLink to="/admin/challenges"><Icon name="shield" size={17}/>Manage</NavLink>}
      </nav>
      <div className="account"><span className="avatar" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span><div className="account-text"><strong>{user.username}</strong><span>{user.role === 'ADMIN' ? 'Administrator' : 'Learner'}</span></div><button className="icon-button logout" title="Sign out" aria-label="Sign out" onClick={signOut} disabled={busy}><Icon name="logout" size={18}/></button></div>
    </div></header>
    <main id="main-content" className="main-content"><Message>{error}</Message>{children}</main>
    <footer className="site-footer"><span>Challenge Portal</span><span>Stay curious. Keep solving.</span><span className="footer-secure"><Icon name="lock" size={13}/>Private learning space</span></footer>
  </div>;
}

export function Attachment({ attachment, challengeId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!attachment) return null;
  const size = attachment.sizeBytes >= 1048576 ? `${(attachment.sizeBytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(attachment.sizeBytes / 1024))} KB`;
  async function download() {
    setBusy(true); setError('');
    try { await downloadAttachment(challengeId, attachment.name); }
    catch (e) { setError(readableError(e, 'Could not download the attachment. Please retry.')); }
    finally { setBusy(false); }
  }
  return <div><div className="attachment"><span className="attachment-icon"><Icon name="file" size={24}/></span><div className="attachment-info"><strong>{attachment.name}</strong><span>{size} · Challenge resource</span></div><button className="button secondary small" onClick={download} disabled={busy}><Icon name="download" size={16}/>{busy ? 'Downloading…' : 'Download file'}</button></div><Message>{error}</Message></div>;
}
