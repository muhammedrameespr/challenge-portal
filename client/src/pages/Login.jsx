import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { readableError } from '../api.js';
import { Brand, Icon, Message } from '../components/UI.jsx';

export default function Login() {
  const { login, notice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setError('');
    if (!username || !password) { setError('Enter your username and password.'); return; }
    setBusy(true);
    try {
      const user = await login(username, password);
      const from = location.state?.from;
      const safeReturn = typeof from === 'string' && /^\/challenges(?:\/\d+)?$/.test(from);
      navigate(user.role === 'ADMIN' ? '/admin/challenges' : safeReturn ? from : '/challenges', { replace: true });
    } catch (e) { setError(e.status === 401 ? 'Invalid username or password.' : readableError(e)); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-story" aria-label="Welcome to Challenge Portal">
      <Brand/>
      <div className="story-copy"><p className="eyebrow"><span/>A space for curious minds</p><h1>Small challenges.<br/><span>Real progress.</span></h1><p>Put your knowledge into practice.<br/>One question. One discovery. Your next step.</p></div>
      <div className="practice-art" aria-hidden="true"><div className="art-grid"/><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-core"><Icon name="code" size={54}/></div><div className="art-label label-one"><Icon name="file" size={16}/>Explore the question</div><div className="art-label label-two"><Icon name="check" size={16}/>Find your answer</div><span className="art-spark spark-one"/><span className="art-spark spark-two"/></div>
      <p className="story-footer">An open mind is your best tool.</p>
    </section>
    <section className="login-panel"><div className="login-form-wrap">
      <div className="login-mobile-brand"><Brand/></div>
      <span className="login-symbol"><Icon name="lock" size={23}/></span>
      <p className="eyebrow">Your learning workspace</p>
      <h2>Welcome back.</h2><p className="muted login-intro">Sign in and pick up where you left off.</p>
      <Message type="info">{notice}</Message>
      <form onSubmit={submit} noValidate>
        <div className="field"><label htmlFor="username">Username</label><input id="username" autoComplete="username" autoCapitalize="none" spellCheck="false" value={username} onChange={e => setUsername(e.target.value)} maxLength={30} placeholder="Your username" required disabled={busy}/></div>
        <div className="field"><label htmlFor="password">Password</label><div className="password-field"><input id="password" type={visible ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} maxLength={128} placeholder="Your password" required disabled={busy}/><button type="button" className="password-toggle" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible(!visible)}><Icon name="eye" size={18}/></button></div></div>
        <Message>{error}</Message>
        <button className="button primary login-submit" disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in'}<Icon name="arrow" size={18}/></button>
      </form>
      <div className="login-help"><Icon name="shield" size={17}/><p>Use the account provided by your administrator.<br/>Your progress is saved as you learn.</p></div>
    </div><div className="login-bottom">Challenge Portal <span>Learn by doing.</span></div></section>
  </main>;
}
