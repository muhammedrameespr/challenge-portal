import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { readableError, request } from '../api.js';
import { Difficulty, ErrorState, Icon, Loading, Message } from '../components/UI.jsx';

export default function AdminChallenges() {
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setChallenges((await request('/admin/challenges')).challenges); }
    catch (e) { setError(readableError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function toggle(challenge) {
    setBusy(challenge.id); setActionError('');
    try {
      const { challenge: updated } = await request(`/admin/challenges/${challenge.id}`, { method: 'PATCH', body: { isPublished: !challenge.isPublished } });
      setChallenges(previous => previous.map(item => item.id === updated.id ? { ...item, ...updated } : item));
    } catch (e) { setActionError(readableError(e)); }
    finally { setBusy(null); }
  }
  return <>
    <div className="page-heading admin-heading"><div><p className="eyebrow">Administrator workspace</p><h1>Manage challenges</h1><p className="muted">Create thoughtful questions. Give curiosity somewhere to go.</p></div><Link className="button primary" to="/admin/challenges/new"><Icon name="plus" size={18}/>Create challenge</Link></div>
    {loading ? <Loading text="Loading your challenges…"/> : error ? <ErrorState message={error} retry={load}/> : <>
      <div className="admin-summary"><div><strong>{challenges.length}</strong><span>Total challenges</span></div><div><strong>{challenges.filter(c => c.isPublished).length}</strong><span>Published</span></div><div><strong>{challenges.filter(c => !c.isPublished).length}</strong><span>Drafts</span></div></div>
      <Message>{actionError}</Message>
      {challenges.length === 0 ? <div className="empty-state"><span className="empty-icon"><Icon name="file" size={30}/></span><h2>Your first challenge starts here.</h2><p>Create a draft, add the question, then publish when it is ready.</p><Link className="button secondary" to="/admin/challenges/new">Create challenge</Link></div> : <div className="table-wrap"><table className="challenge-table"><caption className="sr-only">All published and draft challenges</caption><thead><tr><th scope="col">Order</th><th scope="col">Challenge</th><th scope="col">Difficulty</th><th scope="col">Visibility</th><th scope="col" className="table-actions">Actions</th></tr></thead><tbody>{challenges.map(challenge => <tr key={challenge.id}><td className="order-cell">{String(challenge.displayOrder).padStart(2, '0')}</td><td className="title-cell"><Link to={`/admin/challenges/${challenge.id}/edit`}>{challenge.title}</Link><p>{challenge.summary}</p></td><td><Difficulty value={challenge.difficulty}/></td><td><span className={`publication ${challenge.isPublished ? 'published' : ''}`}><i/>{challenge.isPublished ? 'Published' : 'Draft'}</span></td><td><div className="row-actions"><button className="button ghost small" disabled={busy !== null} onClick={() => toggle(challenge)} aria-label={`${challenge.isPublished ? 'Hide' : 'Publish'} ${challenge.title}`}>{busy === challenge.id ? 'Saving…' : challenge.isPublished ? 'Hide' : 'Publish'}</button><Link className="icon-button" aria-label={`Edit ${challenge.title}`} to={`/admin/challenges/${challenge.id}/edit`}><Icon name="edit" size={17}/></Link></div></td></tr>)}</tbody></table></div>}
      <div className="learning-note"><Icon name="info" size={17}/><span>Hiding a challenge preserves attempts and completions. Publish it again to restore access.</span></div>
    </>}
  </>;
}
