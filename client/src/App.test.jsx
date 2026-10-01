import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { onSessionExpired, setCsrfToken } from './api.js';

const learner = { id: 2, username: 'learner', role: 'USER' };
const admin = { id: 1, username: 'editor', role: 'ADMIN' };
const challenge = { id: 9, title: 'A careful observation', summary: 'Find the small detail in the resource.', difficulty: 'easy', displayOrder: 0, status: 'not_started', question: 'Read both lines.\nThen enter your answer.', attachment: null, isPublished: true };
const json = (body, status = 200, headers = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const error = (status, code = 'ERROR', message = 'Please retry.') => json({ error: { code, message } }, status);

function mockApi({ user = learner, handle } = {}) {
  return vi.stubGlobal('fetch', vi.fn(async (path, options = {}) => {
    const handled = await handle?.(path, options);
    if (handled) return handled;
    if (path === '/api/auth/csrf') return json({ csrfToken: 'anonymous-csrf' });
    if (path === '/api/auth/me') return user ? json({ user }) : error(401);
    if (path === '/api/challenges') return json({ challenges: [challenge] });
    if (path === '/api/challenges/9') return json({ challenge });
    if (path === '/api/admin/challenges') return json({ challenges: [challenge] });
    if (path === '/api/admin/challenges/9') return json({ challenge });
    throw new Error(`Unexpected request: ${options.method} ${path}`);
  }));
}
function open(path) {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App/></AuthProvider></MemoryRouter>);
}

beforeEach(() => {
  setCsrfToken(null);
  onSessionExpired(null);
  vi.unstubAllGlobals();
});

describe('session and role navigation', () => {
  it('keeps protected content hidden until session restoration finishes', async () => {
    let resolveSession;
    mockApi({ handle: path => path === '/api/auth/me' ? new Promise(resolve => { resolveSession = resolve; }) : undefined });
    open('/challenges');
    expect(screen.getByText('Opening your workspace…')).toBeInTheDocument();
    expect(screen.queryByText(challenge.title)).not.toBeInTheDocument();
    await waitFor(() => expect(resolveSession).toBeTypeOf('function'));
    resolveSession(json({ user: learner }));
    expect(await screen.findByText(challenge.title)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/auth/csrf', expect.objectContaining({ cache: 'no-store', headers: expect.objectContaining({ 'Cache-Control': 'no-store' }) }));
  });

  it('logs in without a role picker, replaces CSRF, and refreshes it after logout', async () => {
    const user = userEvent.setup();
    let loginOptions;
    let logoutOptions;
    mockApi({ user: null, handle: (path, options) => {
      if (path === '/api/auth/login') { loginOptions = options; return json({ user: learner, csrfToken: 'rotated-on-login' }); }
      if (path === '/api/auth/logout') { logoutOptions = options; return json(null, 204); }
    } });
    open('/login');
    await screen.findByRole('heading', { name: 'Welcome back.' });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Username'), 'learner');
    await user.type(screen.getByLabelText('Password'), 'fixture password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    await screen.findByText(challenge.title);
    expect(JSON.parse(loginOptions.body)).toEqual({ username: 'learner', password: 'fixture password' });
    expect(loginOptions.headers['X-CSRF-Token']).toBe('anonymous-csrf');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Welcome back.' });
    expect(logoutOptions.headers['X-CSRF-Token']).toBe('rotated-on-login');
    expect(fetch.mock.calls.filter(([path]) => path === '/api/auth/csrf')).toHaveLength(2);
  });

  it('shows generic invalid-login feedback and the retry interval on throttling', async () => {
    const user = userEvent.setup();
    let calls = 0;
    mockApi({ user: null, handle: path => {
      if (path === '/api/auth/login') {
        calls += 1;
        return calls === 1 ? error(401, 'AUTH_FAILED', 'Invalid username or password.') : json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }, 429, { 'Retry-After': '42' });
      }
    } });
    open('/login');
    await user.type(await screen.findByLabelText('Username'), 'learner');
    await user.type(screen.getByLabelText('Password'), 'fixture password');
    await user.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    expect(await screen.findByText('Invalid username or password.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    expect(await screen.findByText('Too many requests. Try again in 42 seconds.')).toBeInTheDocument();
  });

  it('redirects User away from admin routes without requesting admin data', async () => {
    mockApi();
    open('/admin/challenges/9/edit');
    expect(await screen.findByText(challenge.title)).toBeInTheDocument();
    expect(fetch.mock.calls.some(([path]) => path.startsWith('/api/admin'))).toBe(false);
  });

  it('clears protected UI and obtains a new CSRF token when a session expires', async () => {
    const user = userEvent.setup();
    mockApi({ handle: path => path === '/api/challenges/9' ? error(401, 'UNAUTHENTICATED') : undefined });
    open('/challenges');
    await user.click(await screen.findByRole('link', { name: 'Open challenge' }));
    expect(await screen.findByText('Please sign in again.')).toBeInTheDocument();
    expect(screen.queryByText(challenge.question)).not.toBeInTheDocument();
    await waitFor(() => expect(fetch.mock.calls.filter(([path]) => path === '/api/auth/csrf')).toHaveLength(2));
  });
});

describe('answer interaction', () => {
  it('sends the exact original string, preserves feedback, and keeps completed status after a wrong answer', async () => {
    const user = userEvent.setup();
    const submitted = [];
    mockApi({ handle: (path, options) => {
      if (path === '/api/challenges/9') return json({ challenge: { ...challenge, status: 'completed' } });
      if (path.endsWith('/attempts')) {
        submitted.push(JSON.parse(options.body));
        return json({ correct: false, status: 'completed', message: 'Fail. Incorrect answer. Try again.' });
      }
    } });
    open('/challenges/9');
    const input = await screen.findByLabelText('Answer');
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByText(/Read both lines/)).toHaveTextContent('Read both lines. Then enter your answer.');
    await user.type(input, ' 00MiXeD e\u0301 ');
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(await screen.findByText('Fail. Incorrect answer. Try again.')).toBeInTheDocument();
    expect(submitted).toEqual([{ answer: ' 00MiXeD e\u0301 ' }]);
    expect(screen.getByText('Challenge completed')).toBeInTheDocument();
    expect(screen.getByText('Completed', { exact: true })).toBeInTheDocument();
    await user.type(input, 'x');
    expect(screen.getByText('Fail. Incorrect answer. Try again.')).toBeInTheDocument();
  });

  it('blocks whitespace-only answers without recording a request', async () => {
    const user = userEvent.setup();
    mockApi(); open('/challenges/9');
    await user.type(await screen.findByLabelText('Answer'), '   ');
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(await screen.findByText('Enter an answer.')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([path]) => path.endsWith('/attempts'))).toBe(false);
  });

  it('distinguishes service failure from a wrong answer and permits retry', async () => {
    const user = userEvent.setup();
    let calls = 0;
    mockApi({ handle: path => {
      if (path.endsWith('/attempts')) { calls += 1; return calls === 1 ? error(503, 'UNAVAILABLE') : json({ correct: true, status: 'completed' }); }
      if (path === '/api/challenges/9' && calls === 2) return json({ challenge: { ...challenge, status: 'completed' } });
    } });
    open('/challenges/9');
    await user.type(await screen.findByLabelText('Answer'), 'sample response');
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(await screen.findByText('Could not check your answer. Please retry.')).toBeInTheDocument();
    expect(screen.queryByText('Fail. Incorrect answer. Try again.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(await screen.findByText('Success! Correct answer.')).toBeInTheDocument();
    expect(await screen.findByText('Challenge completed')).toBeInTheDocument();
  });

  it('prevents repeat submissions while verification runs, and handles changed challenges', async () => {
    const user = userEvent.setup();
    let finish;
    mockApi({ handle: path => path.endsWith('/attempts') ? new Promise(resolve => { finish = resolve; }) : undefined });
    open('/challenges/9');
    await user.type(await screen.findByLabelText('Answer'), 'sample response');
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    finish(error(409, 'CHALLENGE_CHANGED'));
    expect(await screen.findByText('Challenge changed. Refresh and try again.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh challenge' }));
    expect(await screen.findByLabelText('Answer')).toBeInTheDocument();
  });
});

describe('challenge authoring', () => {
  it('omits an unchanged expected answer when saving metadata', async () => {
    const user = userEvent.setup();
    let savedBody;
    mockApi({ user: admin, handle: (path, options) => {
      if (path === '/api/admin/challenges/9' && options.method === 'PATCH') { savedBody = JSON.parse(options.body); return json({ challenge: { ...challenge, ...savedBody } }); }
    } });
    open('/admin/challenges/9/edit');
    const answer = await screen.findByLabelText('New expected answer - leave blank to keep current.');
    expect(answer).toHaveValue('');
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'An updated title');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Challenge saved. Existing attempts and completions are preserved.')).toBeInTheDocument();
    expect(savedBody).toMatchObject({ title: 'An updated title', displayOrder: 0, isPublished: true });
    expect(savedBody).not.toHaveProperty('expectedAnswer');
    expect(answer).toHaveValue('');
  });

  it('starts new challenges as drafts and rejects accidental whitespace in authored answers', async () => {
    const user = userEvent.setup();
    mockApi({ user: admin }); open('/admin/challenges/new');
    await screen.findByLabelText('Title');
    expect(screen.getByRole('checkbox', { name: 'Publish challenge' })).not.toBeChecked();
    await user.type(screen.getByLabelText('Title'), 'A new challenge');
    await user.type(screen.getByLabelText('Summary'), 'A short summary.');
    await user.type(screen.getByLabelText('Question'), 'A plain question?');
    await user.type(screen.getByLabelText('Expected answer'), ' space');
    await user.click(screen.getByRole('button', { name: 'Create challenge' }));
    expect(await screen.findByText('Enter an expected answer of 1 to 200 characters, without leading or trailing whitespace or line breaks.')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([path, options]) => path === '/api/admin/challenges' && options.method === 'POST')).toBe(false);
  });

  it('uploads separately using CSRF and preserves the previous attachment on failure', async () => {
    const user = userEvent.setup();
    let uploadOptions;
    const attachment = { name: 'existing.txt', sizeBytes: 1024, downloadUrl: '/api/challenges/9/attachment' };
    mockApi({ user: admin, handle: (path, options) => {
      if (path === '/api/admin/challenges/9') return json({ challenge: { ...challenge, attachment } });
      if (path.endsWith('/attachment') && options.method === 'POST') { uploadOptions = options; return error(415, 'UNSUPPORTED_TYPE', 'The file contents are not supported.'); }
    } });
    open('/admin/challenges/9/edit');
    const input = await screen.findByLabelText('Replace attachment');
    await user.upload(input, new File(['invalid file content'], 'replacement.txt', { type: 'text/plain' }));
    await user.click(screen.getByRole('button', { name: 'Upload file' }));
    expect(await screen.findByText('The file contents are not supported.')).toBeInTheDocument();
    expect(screen.getByText('existing.txt')).toBeInTheDocument();
    expect(uploadOptions.body).toBeInstanceOf(FormData);
    expect(uploadOptions.body.get('file').name).toBe('replacement.txt');
    expect(uploadOptions.headers['X-CSRF-Token']).toBe('anonymous-csrf');
    expect(uploadOptions.headers).not.toHaveProperty('Content-Type');
  });
});
