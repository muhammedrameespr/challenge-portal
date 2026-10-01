import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { readableError, request } from '../api.js';
import { Attachment, Difficulty, ErrorState, Icon, Loading, Message, ProgressStatus } from '../components/UI.jsx';

export default function ChallengeDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [challenge, setChallenge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [refreshError, setRefreshError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setChallenge((await request(`/challenges/${id}`)).challenge); }
    catch (e) { setError(e.status === 404 ? 'This challenge is unavailable. It may have been hidden by an administrator.' : readableError(e)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { setAnswer(''); setResult(null); setRefreshError(''); load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    if (answer.length === 0 || /^\s+$/.test(answer)) { setResult({ type: 'error', message: 'Enter an answer.' }); return; }
    if (answer.length > 200 || /[\r\n]/.test(answer)) { setResult({ type: 'error', message: 'Use a single-line answer of 1 to 200 characters.' }); return; }
    setBusy(true); setRefreshError('');
    try {
      const response = await request(`/challenges/${id}/attempts`, { method: 'POST', body: { answer } });
      if (typeof response.correct !== 'boolean' || !['attempted', 'completed'].includes(response.status)) throw new Error('Invalid response');
      setResult({ type: response.correct ? 'success' : 'incorrect', message: response.correct ? 'Success! Correct answer.' : 'Fail. Incorrect answer. Try again.' });
      setChallenge(previous => ({ ...previous, status: response.status }));
      try { setChallenge((await request(`/challenges/${id}`)).challenge); }
      catch (e) { setRefreshError(e.status === 404 ? 'This challenge is no longer available.' : 'Your result was received, but the latest challenge could not be loaded. Refresh to check.'); }
    } catch (e) {
      if (e.status === 409) setResult({ type: 'error', message: 'Challenge changed. Refresh and try again.', conflict: true });
      else if (e.status === 429) setResult({ type: 'error', message: readableError(e) });
      else setResult({ type: 'error', message: 'Could not check your answer. Please retry.' });
    } finally { setBusy(false); }
  }

  return <>
    <Link className="back-link" to="/challenges"><Icon name="back" size={17}/>All challenges</Link>
    {loading ? <Loading text="Loading challenge…"/> : error ? <ErrorState message={error} retry={load}/> : challenge && <>
      <div className="detail-heading"><div className="detail-meta"><Difficulty value={challenge.difficulty}/><span className="meta-separator"/>{user.role === 'USER' ? <ProgressStatus value={challenge.status}/> : <span className="muted small-text">Admin preview</span>}</div><h1>{challenge.title}</h1><p>{challenge.summary}</p></div>
      <div className="detail-layout"><div className="detail-main">
        <section className="panel question-panel"><div className="panel-heading"><span className="section-number">01</span><h2>The challenge</h2></div><div className="question-text">{challenge.question}</div>{challenge.attachment && <div className="resource-section"><h3>Challenge resource</h3><Attachment attachment={challenge.attachment} challengeId={challenge.id}/></div>}</section>
        {user.role === 'USER' ? <section className="panel answer-panel"><div className="panel-heading"><span className="section-number">02</span><h2>Your answer</h2></div><form onSubmit={submit} noValidate><label htmlFor="challenge-answer">Answer</label><p id="answer-hint" className="field-hint">Match the answer exactly, including capitalization and spaces.</p><div className="answer-row"><input id="challenge-answer" name="answer" type="text" value={answer} onChange={e => setAnswer(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck="false" maxLength={200} aria-describedby="answer-hint answer-result" placeholder="Type your answer here" disabled={busy}/><button type="submit" className="button primary" disabled={busy}>{busy ? 'Checking…' : 'Submit answer'}<Icon name="arrow" size={17}/></button></div><div id="answer-result" aria-live="polite" aria-atomic="true" className={`answer-result ${result?.type || ''}`}>{result && <><Icon name={result.type === 'success' ? 'check' : result.type === 'incorrect' ? 'close' : 'info'} size={19}/><span>{result.message}</span></>}</div>{result?.conflict && <button type="button" className="button secondary small" onClick={load}>Refresh challenge</button>}<Message>{refreshError}</Message></form></section> : <Message type="info">You are previewing this challenge as an administrator. Use a User account to submit an answer.</Message>}
      </div><aside className="detail-sidebar"><div className="sidebar-note"><span className="sidebar-icon"><Icon name="code" size={24}/></span><h2>A little curiosity<br/>goes a long way.</h2><p>Read the question carefully, explore any attached resource, and give it a try.</p><div className="note-divider"/><div className="sidebar-point"><Icon name="check" size={16}/><span>One question, one answer</span></div><div className="sidebar-point"><Icon name="clock" size={16}/><span>Learn at your own pace</span></div><div className="sidebar-point"><Icon name="lock" size={16}/><span>Your progress stays saved</span></div></div>{challenge.status === 'completed' && <div className="completed-note"><Icon name="check" size={21}/><div><strong>Challenge completed</strong><p>This progress is saved to your account.</p></div></div>}</aside></div>
    </>}
  </>;
}
