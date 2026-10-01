import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { readableError, request } from '../api.js';
import { Difficulty, ErrorState, Icon, Loading, ProgressStatus } from '../components/UI.jsx';

export default function Challenges() {
  const { user } = useAuth();
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setChallenges((await request('/challenges')).challenges); }
    catch (e) { setError(readableError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const completed = challenges.filter(c => c.status === 'completed').length;
  const attempted = challenges.filter(c => c.status === 'attempted').length;
  const percent = challenges.length ? Math.round(completed / challenges.length * 100) : 0;
  const isAdmin = user.role === 'ADMIN';
  return <>
    <div className="page-heading"><div><p className="eyebrow">{isAdmin ? 'The learner experience' : 'Your learning space'}</p><h1>{isAdmin ? 'Challenge preview' : `Let’s make progress, ${user.username}.`}</h1><p className="muted">Explore a challenge, find your answer, and learn something along the way.</p></div><span className="heading-mark" aria-hidden="true"><Icon name="code" size={34}/></span></div>
    {loading ? <Loading text="Loading challenges…"/> : error ? <ErrorState message={error} retry={load}/> : <>
      {!isAdmin && <section className="progress-panel" aria-label="Your progress"><div className="progress-intro"><span className="progress-icon"><Icon name="check" size={23}/></span><div><h2>Your progress</h2><p>{completed === challenges.length && challenges.length ? 'All caught up. Nicely done.' : 'Every completed challenge is a step forward.'}</p></div></div><div className="progress-meter"><div className="progress-meter-label"><span><strong>{completed}</strong> of {challenges.length} completed</span><span>{percent}%</span></div><progress max={Math.max(1, challenges.length)} value={completed} aria-label={`${completed} of ${challenges.length} challenges completed`}/></div></section>}
      <div className="section-heading"><div><h2>All challenges <span className="count-badge">{challenges.length}</span></h2><p>Pick a place to start. Every challenge is open to you.</p></div>{!isAdmin && attempted > 0 && <span className="muted small-text">{attempted} in progress</span>}</div>
      {challenges.length === 0 ? <div className="empty-state"><span className="empty-icon"><Icon name="grid" size={30}/></span><h2>No challenges available yet.</h2><p>Check back when your administrator publishes a challenge.</p><button className="button secondary" onClick={load}>Refresh challenges</button></div> : <div className="challenge-grid">{challenges.map((challenge, index) => <article key={challenge.id} className={`challenge-card ${challenge.status === 'completed' ? 'is-completed' : ''}`}>
        <div className="card-art" aria-hidden="true"><div className={`card-emblem emblem-${index % 3}`}><Icon name={['code', 'file', 'shield'][index % 3]} size={38}/></div><span className="card-number">{String(index + 1).padStart(2, '0')}</span><div className="card-art-line"/></div>
        <div className="card-body"><div className="card-meta"><Difficulty value={challenge.difficulty}/>{!isAdmin && <ProgressStatus value={challenge.status}/>}</div><h3>{challenge.title}</h3><p>{challenge.summary}</p><Link className="card-link" to={`/challenges/${challenge.id}`}>{isAdmin ? 'Preview challenge' : 'Open challenge'}<Icon name="arrow" size={18}/></Link></div>
      </article>)}</div>}
      <div className="learning-note"><Icon name="info" size={17}/><span>Take your time. You can try again, and your completed challenges stay saved.</span></div>
    </>}
  </>;
}
