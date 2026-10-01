import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { readableError, request } from '../api.js';
import { Attachment, Difficulty, ErrorState, Icon, Loading, Message } from '../components/UI.jsx';

const emptyForm = { title: '', summary: '', question: '', expectedAnswer: '', difficulty: 'easy', displayOrder: '0', isPublished: false };
const toForm = challenge => ({ title: challenge.title, summary: challenge.summary, question: challenge.question, expectedAnswer: '', difficulty: challenge.difficulty, displayOrder: String(challenge.displayOrder), isPublished: challenge.isPublished });

function validate(form, editing) {
  if (form.title.length < 3 || form.title.length > 100 || /^\s*$/.test(form.title)) return 'Enter a title of 3 to 100 characters.';
  if (!form.summary || form.summary.length > 240 || /^\s*$/.test(form.summary)) return 'Enter a summary of 1 to 240 characters.';
  if (!form.question || form.question.length > 5000 || /^\s*$/.test(form.question)) return 'Enter a question of 1 to 5000 characters.';
  if (!editing || form.expectedAnswer !== '') {
    if (!form.expectedAnswer || form.expectedAnswer.length > 200 || /^\s|\s$|[\r\n]/.test(form.expectedAnswer)) return 'Enter an expected answer of 1 to 200 characters, without leading or trailing whitespace or line breaks.';
  }
  if (!/^\d+$/.test(form.displayOrder) || Number(form.displayOrder) > 9999) return 'Display order must be an integer from 0 to 9999.';
  return '';
}

export default function ChallengeEditor() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState(emptyForm);
  const [challenge, setChallenge] = useState(null);
  const [loading, setLoading] = useState(editing);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(location.state?.created ? 'Draft created. You can now add an attachment and publish when ready.' : '');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [file, setFile] = useState(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState('');
  const [fileSuccess, setFileSuccess] = useState('');
  const fileInput = useRef(null);
  const errorRef = useRef(null);
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setLoadError('');
    try { const data = await request(`/admin/challenges/${id}`); setChallenge(data.challenge); setForm(toForm(data.challenge)); }
    catch (e) { setLoadError(readableError(e)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  function update(event) {
    const { name, value, type, checked } = event.target;
    setForm(previous => ({ ...previous, [name]: type === 'checkbox' ? checked : value }));
    setSuccess('');
  }
  async function submit(event) {
    event.preventDefault(); setError(''); setSuccess('');
    const invalid = validate(form, editing);
    if (invalid) { setError(invalid); requestAnimationFrame(() => errorRef.current?.focus()); return; }
    setBusy(true);
    const body = { title: form.title, summary: form.summary, question: form.question, difficulty: form.difficulty, displayOrder: Number(form.displayOrder), isPublished: form.isPublished };
    if (!editing || form.expectedAnswer !== '') body.expectedAnswer = form.expectedAnswer;
    try {
      const { challenge: saved } = await request(editing ? `/admin/challenges/${id}` : '/admin/challenges', { method: editing ? 'PATCH' : 'POST', body });
      setChallenge(saved); setForm(toForm(saved));
      if (!editing) navigate(`/admin/challenges/${saved.id}/edit`, { replace: true, state: { created: true } });
      else setSuccess('Challenge saved. Existing attempts and completions are preserved.');
    } catch (e) { setError(readableError(e)); }
    finally { setBusy(false); }
  }
  async function upload(event) {
    event.preventDefault(); setFileError(''); setFileSuccess('');
    if (!file) { setFileError('Choose a TXT or PDF file.'); return; }
    if (file.size > 5 * 1024 * 1024) { setFileError('The attachment must be at most 5 MiB.'); return; }
    if (!/\.(txt|pdf)$/i.test(file.name)) { setFileError('Choose a TXT or PDF file.'); return; }
    setFileBusy(true);
    const body = new FormData(); body.append('file', file);
    try {
      const data = await request(`/admin/challenges/${id}/attachment`, { method: 'POST', body });
      setChallenge(data.challenge); setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      setFileSuccess('Attachment saved.');
    } catch (e) { setFileError(readableError(e)); }
    finally { setFileBusy(false); }
  }
  async function removeAttachment() {
    setFileBusy(true); setFileError(''); setFileSuccess('');
    try {
      await request(`/admin/challenges/${id}/attachment`, { method: 'DELETE' });
      setChallenge(previous => ({ ...previous, attachment: null }));
      setFileSuccess('Attachment removed.');
    } catch (e) { setFileError(readableError(e)); }
    finally { setFileBusy(false); }
  }
  return <>
    <Link className="back-link" to="/admin/challenges"><Icon name="back" size={17}/>Manage challenges</Link>
    <div className="page-heading editor-heading"><div><p className="eyebrow">Challenge editor</p><h1>{editing ? 'Edit challenge' : 'Create a challenge'}</h1><p className="muted">A clear question is the beginning of a good discovery.</p></div><button type="button" className="button secondary" aria-expanded={preview} aria-controls="challenge-preview" onClick={() => setPreview(!preview)}><Icon name="eye" size={17}/>{preview ? 'Close preview' : 'Preview'}</button></div>
    {loading ? <Loading text="Loading challenge editor…"/> : loadError ? <ErrorState message={loadError} retry={load}/> : <>
      <Message type="success">{success}</Message>
      <div className="editor-layout"><form id="metadata-form" className="panel editor-form" onSubmit={submit} noValidate>
        <div className="panel-heading"><span className="section-number">01</span><h2>Challenge details</h2></div>
        <div className="field"><label htmlFor="title">Title</label><input id="title" name="title" value={form.title} onChange={update} minLength={3} maxLength={100} required disabled={busy} placeholder="Give your challenge a clear title"/><p className="field-hint">3–100 characters</p></div>
        <div className="field"><label htmlFor="summary">Summary</label><textarea id="summary" name="summary" value={form.summary} onChange={update} maxLength={240} rows={2} required disabled={busy} placeholder="A short introduction for the challenge card"/><p className="field-hint">Up to 240 characters</p></div>
        <div className="field"><label htmlFor="question">Question</label><textarea id="question" name="question" value={form.question} onChange={update} maxLength={5000} rows={7} required disabled={busy} placeholder="What should the learner discover?"/><p className="field-hint">Plain text. Line breaks are preserved. Up to 5,000 characters.</p></div>
        <div className="field"><label htmlFor="expectedAnswer">{editing ? 'New expected answer - leave blank to keep current.' : 'Expected answer'}</label><input id="expectedAnswer" name="expectedAnswer" type="text" autoComplete="off" autoCapitalize="none" spellCheck="false" value={form.expectedAnswer} onChange={update} maxLength={200} required={!editing} disabled={busy} placeholder={editing ? 'Current answer is kept private' : 'Enter the exact answer'}/><p className="field-hint">Case sensitive. One line, up to 200 characters. No leading or trailing whitespace.</p></div>
        <div className="form-columns"><div className="field"><label htmlFor="difficulty">Difficulty</label><select id="difficulty" name="difficulty" value={form.difficulty} onChange={update} disabled={busy}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div><div className="field"><label htmlFor="displayOrder">Display order</label><input id="displayOrder" name="displayOrder" type="number" min="0" max="9999" step="1" value={form.displayOrder} onChange={update} disabled={busy}/><p className="field-hint">Lower numbers appear first. 0–9999.</p></div></div>
        <div className="publication-control"><div><h3>Publish challenge</h3><p>Published challenges are available to all users.</p></div><label className="switch"><input name="isPublished" type="checkbox" checked={form.isPublished} onChange={update} disabled={busy} aria-label="Publish challenge"/><span className="switch-track"/></label></div>
        <div ref={errorRef} tabIndex={-1}><Message>{error}</Message></div>
        <div className="editor-actions"><Link className="button ghost" to="/admin/challenges">Cancel</Link><button className="button primary" type="submit" disabled={busy || fileBusy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create challenge'}<Icon name="check" size={17}/></button></div>
      </form><aside className="editor-sidebar"><section className="panel attachment-editor"><div className="panel-heading"><Icon name="file" size={20}/><h2>Attachment</h2><span className="optional-label">Optional</span></div><p className="muted small-text">Add one TXT or PDF resource, up to 5 MiB. Files are downloaded by signed-in users.</p>{editing ? <>
        {challenge?.attachment && <><Attachment attachment={challenge.attachment} challengeId={id}/><button type="button" className="button ghost danger small" onClick={removeAttachment} disabled={fileBusy || busy}>Remove attachment</button></>}
        <form className="upload-form" onSubmit={upload}><label htmlFor="attachment-file">{challenge?.attachment ? 'Replace attachment' : 'Choose attachment'}</label><input ref={fileInput} id="attachment-file" type="file" accept=".txt,.pdf,text/plain,application/pdf" onChange={event => { setFile(event.target.files?.[0] || null); setFileError(''); setFileSuccess(''); }} disabled={fileBusy || busy}/><button type="submit" className="button secondary" disabled={fileBusy || busy}>{fileBusy ? 'Saving attachment…' : 'Upload file'}<Icon name="plus" size={16}/></button></form><Message>{fileError}</Message><Message type="success">{fileSuccess}</Message>
      </> : <div className="draft-attachment-note"><Icon name="info" size={18}/><p>Create the challenge first, then add its attachment.</p></div>}</section><div className="history-note"><Icon name="shield" size={21}/><h3>Keep learning history intact</h3><p>Editing the question or replacing its answer does not erase existing completion. For a substantially changed task that everyone should solve again, create a new challenge.</p></div></aside></div>
      {preview && <section id="challenge-preview" className="panel editor-preview" aria-label="Challenge preview"><div className="panel-heading"><Icon name="eye" size={20}/><h2>Preview</h2><span className="optional-label">Unsaved content</span></div><Difficulty value={form.difficulty}/><h2 className="preview-title">{form.title || 'Your challenge title'}</h2><p className="muted">{form.summary || 'Your summary appears here.'}</p><div className="question-text">{form.question || 'Your question appears here.'}</div>{challenge?.attachment && <Attachment attachment={challenge.attachment} challengeId={id}/>}</section>}
    </>}
  </>;
}
