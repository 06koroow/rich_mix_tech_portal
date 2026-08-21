/* ============================================================
   auth.js — accounts, sessions & permissions (prototype)
   ------------------------------------------------------------
   IMPORTANT: this is a browser-only prototype. The password
   "hash" below is a fast non-cryptographic digest and everything
   lives in localStorage — it is NOT secure and must be replaced
   by real server-side auth (Entra ID / Supabase Auth — see
   docs/BACKEND.md). It exists so the sign-in / approval FLOW is
   real and portable. The capability list in can() is the policy
   the backend should enforce; client checks stay as convenience.

   Accounts:
     - email + password, status 'active' | 'pending'.
     - Sign-up creates a PENDING account; an admin approves it.
     - admin (boolean) -> everything; trainer -> sign off training.
   ============================================================ */
RMTP.auth = (function () {
  const KEY = 'currentUser';
  const SALT = 'rmtp-v1';
  const POSITIONS = ['Technical Manager', 'Senior Tech', 'Duty Tech', 'Freelancer'];

  // Non-cryptographic digest (djb2). Placeholder only — see header.
  function hashPassword(pw) {
    let h = 5381;
    const s = String(pw) + SALT;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) + s.charCodeAt(i); h |= 0; }
    return 'h' + (h >>> 0).toString(16);
  }

  function displayName(u) { return u ? ((u.firstName || '') + ' ' + (u.lastName || '')).trim() : ''; }
  function initials(u) { return u ? (((u.firstName || ' ')[0] + (u.lastName || ' ')[0]).trim().toUpperCase() || '?') : '?'; }

  function currentId() { return RMTP.store.read(KEY, null); }
  function current() {
    const id = currentId();
    const u = id ? RMTP.store.find('users', id) : null;
    return u && u.status !== 'pending' ? u : null;   // pending/removed => not signed in
  }
  function setCurrent(id) { RMTP.store.write(KEY, id); }

  function byEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    return RMTP.store.all('users').find((u) => String(u.email || '').toLowerCase() === e) || null;
  }
  function pendingUsers() { return RMTP.store.all('users').filter((u) => u.status === 'pending'); }

  /* ---- Sessions ---- */
  function login(email, password) {
    const u = byEmail(email);
    if (!u) return { ok: false, reason: 'not-found' };
    if (u.status === 'pending') return { ok: false, reason: 'pending' };
    if (u.password !== hashPassword(password)) return { ok: false, reason: 'bad-password' };
    setCurrent(u.id);
    return { ok: true, user: u };
  }
  function signUp(data) {
    if (!data.firstName && !data.lastName) return { ok: false, reason: 'name' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email || '')) return { ok: false, reason: 'email' };
    if ((data.password || '').length < 6) return { ok: false, reason: 'password' };
    if (byEmail(data.email)) return { ok: false, reason: 'exists' };
    const u = {
      id: RMTP.store.uid('user'),
      firstName: data.firstName || '', lastName: data.lastName || '',
      email: String(data.email).trim(), password: hashPassword(data.password),
      position: data.position || 'Duty Tech',
      admin: false, trainer: false, status: 'pending', requestedAt: new Date().toISOString(),
    };
    RMTP.store.upsert('users', u);
    return { ok: true, user: u };
  }
  // Position drives roles: Technical Managers & Senior Techs are always
  // admins + trainers; Duty Techs / Freelancers are base and can be made
  // a trainer by an admin (never auto-admin).
  const AUTO_ADMIN_POSITIONS = ['Technical Manager', 'Senior Tech'];
  function isAutoAdminPosition(position) { return AUTO_ADMIN_POSITIONS.indexOf(position) > -1; }
  function rolesForPosition(position, existingTrainer) {
    if (isAutoAdminPosition(position)) return { admin: true, trainer: true };
    return { admin: false, trainer: !!existingTrainer };
  }

  function approveUser(id) {
    const u = RMTP.store.find('users', id);
    if (u) {
      const roles = rolesForPosition(u.position, u.trainer);
      RMTP.store.upsert('users', Object.assign({}, u, { status: 'active' }, roles));
      refreshShell();
    }
  }
  function rejectUser(id) {
    RMTP.store.all('signoffs').filter((s) => s.userId === id).forEach((s) => RMTP.store.remove('signoffs', s.id));
    RMTP.store.remove('users', id);
  }
  async function signOut() {
    if (sbActive()) { try { await RMTP.supabase.signOut(); } catch (e) { /* ignore */ } }
    setCurrent(null); refreshShell(); showLogin();
  }

  // True when the Supabase backend is configured + loaded.
  function sbActive() { return !!(RMTP.supabase && RMTP.supabase.isConfigured()); }

  /* Backend mode: map the signed-in Entra account to a Users record
     by email and make them the current user. Returns false if there's
     no active account for that email (they'd need adding/approving). */
  function signInGraphAccount(acct) {
    const email = acct && (acct.username || (acct.idTokenClaims && acct.idTokenClaims.preferred_username));
    return signInEmail(email || '');
  }
  // Same, by plain email (used by the Supabase path).
  function signInEmail(email) {
    const u = byEmail(email || '');
    if (u && u.status !== 'pending') { setCurrent(u.id); return true; }
    return false;
  }

  /* ---- Capabilities (policy; enforce server-side later) ---- */
  function can(cap) {
    const u = current();
    if (!u) return false;
    if (cap === 'training.signoff') return !!u.trainer;   // ONLY trainers, even admins
    if (u.admin) return true;
    switch (cap) {
      case 'inventory.move':
      case 'report.edit':
      case 'maintenance.report':
      case 'users.view':
        return true;
      default:
        return false;
    }
  }

  function badges(u) {
    let out = '';
    if (u.admin)   out += RMTP.ui.pill('Admin', 'var(--accent)');
    if (u.trainer) out += RMTP.ui.pill('Trainer', 'var(--info)');
    if (u.status === 'pending') out += RMTP.ui.pill('Pending', 'var(--muted)');
    return out ? '<span class="flex gap-1.5 shrink-0">' + out + '</span>' : '';
  }

  /* ---- Sign in / request access (locked, mandatory) ---- */
  function showLogin() {
    const ui = RMTP.ui;
    let mode = 'signin';
    const m = ui.modal({ title: RMTP.meta.name + ' \u00b7 ' + RMTP.meta.product, size: 'md:max-w-md', locked: true, body: '<div id="auth-body"></div>' });

    function fieldRow(label, control) { return '<div><label class="block text-sm font-medium mb-2">' + ui.esc(label) + '</label>' + control + '</div>'; }
    function draw() {
      const body = m.root.querySelector('#auth-body');
      if (mode === 'signin') {
        body.innerHTML =
          '<p class="text-sm text-muted mb-4">Sign in with your work email.</p>' +
          '<div class="grid gap-4">' +
            fieldRow('Email', '<input id="a-email" type="email" class="field" autocomplete="username" placeholder="you@richmix.local" />') +
            fieldRow('Password', '<input id="a-pass" type="password" class="field" autocomplete="current-password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" />') +
            '<button id="a-signin" class="btn btn-primary w-full justify-center" data-primary>Sign in</button>' +
          '</div>' +
          '<p class="text-sm text-muted mt-4 text-center">No account? ' +
            '<button id="a-to-signup" class="text-accent hover:underline">Request access</button></p>';
        const go = async () => {
          const email = body.querySelector('#a-email').value.trim();
          const pass = body.querySelector('#a-pass').value;
          if (sbActive()) {
            const res = await RMTP.supabase.signIn(email, pass);
            if (!res.ok) {
              const msg = res.message || '';
              if (/confirm/i.test(msg)) ui.toast('That email hasn\u2019t been confirmed yet \u2014 confirm it in Supabase (or turn off email confirmation) and try again', 'danger');
              else if (/invalid login/i.test(msg)) ui.toast('Email or password not recognised. If you were added by an admin, use \u201cRequest access\u201d to set your own password.', 'danger');
              else ui.toast(msg || 'Could not sign in', 'danger');
              return;
            }
            try { await RMTP.syncSb.pullCollection('users'); } catch (e) { /* use cached */ }
            if (signInEmail(email)) { m.close(); refreshShell(); RMTP.router.render(); ui.toast('Signed in', 'ok'); }
            else ui.toast('Signed in, but there\u2019s no active Tech Portal account for this email yet \u2014 an admin needs to approve you', 'info');
            return;
          }
          const res = login(email, pass);
          if (res.ok) { m.close(); refreshShell(); RMTP.router.render(); ui.toast('Signed in as ' + displayName(res.user), 'ok'); }
          else if (res.reason === 'pending') ui.toast('Your access request is awaiting approval', 'info');
          else ui.toast('Email or password not recognised', 'danger');
        };
        body.querySelector('#a-signin').addEventListener('click', go);
        body.querySelector('#a-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        body.querySelector('#a-to-signup').addEventListener('click', () => { mode = 'signup'; draw(); });
      } else {
        const opt = (arr) => arr.map((v) => '<option>' + v + '</option>').join('');
        body.innerHTML =
          '<p class="text-sm text-muted mb-4">Request an account. An admin approves access before you can sign in.</p>' +
          '<div class="grid gap-4">' +
            '<div class="grid grid-cols-2 gap-4">' +
              fieldRow('First name', '<input id="s-first" class="field" />') +
              fieldRow('Last name', '<input id="s-last" class="field" />') +
            '</div>' +
            fieldRow('Email', '<input id="s-email" type="email" class="field" placeholder="you@richmix.local" />') +
            fieldRow('Password', '<input id="s-pass" type="password" class="field" placeholder="At least 6 characters" />') +
            '<div class="grid grid-cols-2 gap-4">' +
              fieldRow('Position', '<select id="s-position" class="field">' + opt(POSITIONS) + '</select>') +
            '</div>' +
            '<button id="s-submit" class="btn btn-primary w-full justify-center" data-primary>Request access</button>' +
          '</div>' +
          '<p class="text-sm text-muted mt-4 text-center">Have an account? ' +
            '<button id="s-to-signin" class="text-accent hover:underline">Sign in</button></p>';
        body.querySelector('#s-submit').addEventListener('click', async () => {
          const data = {
            firstName: body.querySelector('#s-first').value.trim(), lastName: body.querySelector('#s-last').value.trim(),
            email: body.querySelector('#s-email').value.trim(), password: body.querySelector('#s-pass').value,
            position: body.querySelector('#s-position').value,
          };
          if (sbActive()) {
            if (!data.firstName && !data.lastName) { ui.toast('Enter your name', 'danger'); return; }
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) { ui.toast('Enter a valid email', 'danger'); return; }
            if ((data.password || '').length < 6) { ui.toast('Password needs 6+ characters', 'danger'); return; }
            const res = await RMTP.supabase.signUp(data.email, data.password);
            if (!res.ok) { ui.toast(res.message || 'Could not create the account', 'danger'); return; }
            RMTP.store.upsert('users', {
              id: RMTP.store.uid('user'), firstName: data.firstName, lastName: data.lastName, email: data.email,
              position: data.position, admin: false, trainer: false, status: 'pending',
            });
            mode = 'signin'; draw(); ui.toast('Request sent \u2014 an admin will approve your account', 'ok');
            return;
          }
          const res = signUp(data);
          if (res.ok) { mode = 'signin'; draw(); ui.toast('Request sent \u2014 an admin will approve your account', 'ok'); }
          else ui.toast({ name: 'Enter your name', email: 'Enter a valid email', password: 'Password needs 6+ characters', exists: 'That email already has an account' }[res.reason] || 'Check your details', 'danger');
        });
        body.querySelector('#s-to-signin').addEventListener('click', () => { mode = 'signin'; draw(); });
      }
    }
    draw();
  }

  /* Back-fill accounts created before email/password existed, so an
     upgraded install isn't locked out. Idempotent. */
  function migrateAccounts() {
    const users = RMTP.store.all('users');
    const seen = {};
    users.forEach((u) => { if (u.email) seen[String(u.email).toLowerCase()] = true; });
    users.forEach((u) => {
      let patch = null;
      if (!u.status) { patch = patch || {}; patch.status = 'active'; }
      if (!u.email) {
        const base = (String(u.firstName || 'user').toLowerCase().replace(/[^a-z0-9]/g, '') || 'user');
        let email = base + '@richmix.local', n = 1;
        while (seen[email]) { email = base + (++n) + '@richmix.local'; }
        seen[email] = true; patch = patch || {}; patch.email = email;
      }
      if (!u.password) { patch = patch || {}; patch.password = hashPassword('demo1234'); }
      if (patch) RMTP.store.upsert('users', Object.assign({}, u, patch));
    });
  }

  /* Ensure a valid session, else show login. Bootstraps a fallback
     admin only if there are somehow no active accounts at all. */
  function ensureSession() {
    migrateAccounts();
    const active = RMTP.store.all('users').filter((u) => u.status !== 'pending');
    if (!active.length) {
      const admin = { id: RMTP.store.uid('user'), firstName: 'Admin', lastName: 'User', email: 'admin@richmix.local',
        password: hashPassword('demo1234'), position: 'Technical Manager', admin: true, trainer: true, status: 'active' };
      RMTP.store.upsert('users', admin);
      setCurrent(admin.id);
      return;
    }
    if (!current()) showLogin();
  }

  function refreshShell() {
    if (RMTP.shell && typeof RMTP.shell.refreshIdentity === 'function') RMTP.shell.refreshIdentity();
  }

  return {
    POSITIONS,
    displayName, initials, badges, hashPassword,
    rolesForPosition, isAutoAdminPosition,
    current, currentId, setCurrent, can,
    login, signUp, signOut, signInGraphAccount, signInEmail, showLogin, ensureSession,
    pendingUsers, approveUser, rejectUser, refreshShell,
  };
})();
