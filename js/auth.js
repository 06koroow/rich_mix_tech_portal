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

  function displayName(u) {
    if (!u) return '';
    const full = ((u.firstName || '') + ' ' + (u.lastName || '')).trim();
    if (full) return full;
    return u.name || u.displayName || u.email || 'Technician';
  }
  function initials(u) {
    if (!u) return '?';
    const dn = displayName(u);
    const parts = dn.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase();
    return (dn[0] || '?').toUpperCase();
  }

  const DEV_OVERRIDE_KEY = 'rmtp_dev_override';
  let devOverride = null;
  try {
    const saved = sessionStorage.getItem(DEV_OVERRIDE_KEY);
    if (saved) devOverride = JSON.parse(saved);
  } catch (e) {}

  function realCurrentId() { return RMTP.store.read(KEY, null); }
  function realCurrent() {
    const id = realCurrentId();
    const u = id ? RMTP.store.find('users', id) : null;
    return u && u.status !== 'pending' ? u : null;
  }

  function isRealTechManager() {
    const u = realCurrent();
    if (!u) return false;
    const pos = String(u.position || '').trim().toLowerCase();
    const role = String(u.role || '').trim().toLowerCase();
    const email = String(u.email || '').trim().toLowerCase();
    return pos === 'technical manager' || pos === 'tech manager' ||
           pos.includes('technical manager') || pos.includes('tech manager') ||
           role === 'tech_manager' || role === 'technical_manager' ||
           email.startsWith('admin@') ||
           email.includes('okoronka') || email.includes('oscar.koronka');
  }

  function currentId() {
    if (isRealTechManager() && devOverride && devOverride.type === 'user' && devOverride.userId) {
      return devOverride.userId;
    }
    return realCurrentId();
  }

  function current() {
    const real = realCurrent();
    if (!real) return null;
    if (!isRealTechManager() || !devOverride) {
      return real;
    }

    if (devOverride.type === 'user' && devOverride.userId) {
      const target = RMTP.store.find('users', devOverride.userId);
      if (target && target.status !== 'pending') {
        return Object.assign({}, target, {
          _devPreview: true,
          _devOverride: devOverride,
          _realUser: real,
          _previewLabel: displayName(target) + ' (' + (target.position || 'Tech') + ')'
        });
      }
    }

    const simulatedPos = devOverride.position || real.position || 'Duty Tech';
    const simulatedAdmin = devOverride.admin !== undefined ? !!devOverride.admin : false;
    const simulatedTrainer = devOverride.trainer !== undefined ? !!devOverride.trainer : false;

    return Object.assign({}, real, {
      position: simulatedPos,
      role: simulatedPos,
      admin: simulatedAdmin,
      trainer: simulatedTrainer,
      _devPreview: true,
      _devOverride: devOverride,
      _realUser: real,
      _previewLabel: simulatedPos + (simulatedAdmin ? ' \u00b7 Admin' : '') + (simulatedTrainer ? ' \u00b7 Trainer' : '')
    });
  }

  function getDevOverride() {
    if (!isRealTechManager()) return null;
    return devOverride;
  }

  function setDevOverride(override) {
    if (!isRealTechManager()) return;
    devOverride = override;
    try {
      if (override) sessionStorage.setItem(DEV_OVERRIDE_KEY, JSON.stringify(override));
      else sessionStorage.removeItem(DEV_OVERRIDE_KEY);
    } catch (e) {}
    refreshShell();
    if (RMTP.router && typeof RMTP.router.render === 'function') {
      RMTP.router.render();
    }
  }

  function clearDevOverride() {
    setDevOverride(null);
  }

  function setCurrent(id) {
    clearDevOverride();
    RMTP.store.write(KEY, id);
  }

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
  function isTechManager(u) {
    const user = u || current();
    if (!user) return false;
    const pos = String(user.position || '').trim().toLowerCase();
    const role = String(user.role || '').trim().toLowerCase();
    return pos === 'technical manager' || pos === 'tech manager' ||
           pos.includes('technical manager') || pos.includes('tech manager') ||
           role === 'tech_manager' || role === 'technical_manager';
  }
  function isAdmin(u) {
    const user = u || current();
    return !!(user && user.admin);
  }
  function isTechManagerOrAdmin(u) {
    const user = u || current();
    return isTechManager(user) || isAdmin(user);
  }
  function isFreelancer(u) {
    const user = u || current();
    if (!user) return false;
    const pos = String(user.position || '').trim().toLowerCase();
    const role = String(user.role || '').trim().toLowerCase();
    return pos === 'freelancer' || pos.includes('freelancer') || role === 'freelancer';
  }
  function canViewDcp(u) {
    const user = u || current();
    if (!user) return false;
    return !isFreelancer(user);
  }
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

  /* (Disabled Graph/Entra SSO helper)
  function signInGraphAccount(acct) {
    const email = acct && (acct.username || (acct.idTokenClaims && acct.idTokenClaims.preferred_username));
    return signInEmail(email || '');
  }
  */
  // Map signed-in user by email (used by the Supabase path).
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
    if (isTechManagerOrAdmin(u)) return true;
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

  function openDevModal() {
    if (!isRealTechManager()) {
      RMTP.ui.toast('Dev sandbox is restricted to Technical Managers.', 'danger');
      return;
    }
    const real = realCurrent();
    const cur = current();
    const activeOverride = getDevOverride();
    const allUsers = RMTP.store.all('users')
      .filter((u) => u.status !== 'pending' && u.id !== real.id)
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));

    const activeRole = cur.position || 'Technical Manager';
    const isAdminActive = !!cur.admin;
    const isTrainerActive = !!cur.trainer;

    const m = RMTP.ui.modal({
      title: 'Dev Sandbox: Role & Permission Switcher',
      size: 'md:max-w-xl',
      body:
        '<div class="grid gap-4 text-xs">' +
          '<div class="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 text-ink">' +
            '<div class="flex items-center justify-between gap-2 mb-1">' +
              '<span class="font-semibold text-purple-400 flex items-center gap-1.5 text-xs">' +
                RMTP.ui.icon('gear', 'w-4 h-4') +
                '<span>Technical Manager Dev Tools</span>' +
              '</span>' +
              (activeOverride
                ? '<span class="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-200 font-mono text-[10px] uppercase font-bold tracking-wide border border-purple-400/40">Preview Active</span>'
                : '<span class="px-2 py-0.5 rounded-full bg-panel text-muted font-mono text-[10px] uppercase font-medium border border-line">Actual Account</span>') +
            '</div>' +
            '<p class="text-muted leading-relaxed text-[11px]">' +
              'Swap permissions and simulate the portal as duty technicians, freelancers, or specific crew members. Changes apply immediately to all views and menus.' +
            '</p>' +
          '</div>' +

          // 1. Role Presets
          '<div>' +
            '<label class="block font-semibold text-ink mb-1.5 text-[11px] uppercase tracking-wider text-muted">1. Quick Role Presets</label>' +
            '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">' +
              '<button type="button" data-preset="tm" class="p-2.5 rounded-lg border text-left flex flex-col justify-between transition-all ' + (!activeOverride ? 'border-purple-500 bg-purple-500/15 text-ink ring-1 ring-purple-500' : 'border-line hover:border-line2 bg-panel hover:bg-panel2') + '">' +
                '<span class="font-bold text-xs text-ink flex items-center gap-1">' + RMTP.ui.icon('shield', 'w-3.5 h-3.5 text-purple-400') + 'Tech Manager</span>' +
                '<span class="text-[10px] text-muted mt-1">Full Admin &middot; Lead</span>' +
              '</button>' +
              '<button type="button" data-preset="senior" class="p-2.5 rounded-lg border text-left flex flex-col justify-between transition-all ' + (activeOverride && activeOverride.position === 'Senior Tech' ? 'border-purple-500 bg-purple-500/15 text-ink ring-1 ring-purple-500' : 'border-line hover:border-line2 bg-panel hover:bg-panel2') + '">' +
                '<span class="font-bold text-xs text-ink flex items-center gap-1">' + RMTP.ui.icon('check', 'w-3.5 h-3.5 text-blue-400') + 'Senior Tech</span>' +
                '<span class="text-[10px] text-muted mt-1">Admin + Trainer</span>' +
              '</button>' +
              '<button type="button" data-preset="duty" class="p-2.5 rounded-lg border text-left flex flex-col justify-between transition-all ' + (activeOverride && activeOverride.position === 'Duty Tech' && !activeOverride.admin ? 'border-purple-500 bg-purple-500/15 text-ink ring-1 ring-purple-500' : 'border-line hover:border-line2 bg-panel hover:bg-panel2') + '">' +
                '<span class="font-bold text-xs text-ink flex items-center gap-1">' + RMTP.ui.icon('wrench', 'w-3.5 h-3.5 text-amber-400') + 'Duty Tech</span>' +
                '<span class="text-[10px] text-muted mt-1">Staff Tech &middot; Standard</span>' +
              '</button>' +
              '<button type="button" data-preset="freelancer" class="p-2.5 rounded-lg border text-left flex flex-col justify-between transition-all ' + (activeOverride && activeOverride.position === 'Freelancer' ? 'border-purple-500 bg-purple-500/15 text-ink ring-1 ring-purple-500' : 'border-line hover:border-line2 bg-panel hover:bg-panel2') + '">' +
                '<span class="font-bold text-xs text-ink flex items-center gap-1">' + RMTP.ui.icon('users', 'w-3.5 h-3.5 text-emerald-400') + 'Freelancer</span>' +
                '<span class="text-[10px] text-muted mt-1">Guest Tech &middot; Restricted</span>' +
              '</button>' +
            '</div>' +
          '</div>' +

          // 2. View As Specific User
          '<div>' +
            '<label class="block font-semibold text-ink mb-1.5 text-[11px] uppercase tracking-wider text-muted">2. View As Specific Crew Member</label>' +
            '<div class="flex items-center gap-2">' +
              '<select id="dev-user-select" class="field text-xs flex-1">' +
                '<option value="">-- Select a registered technician or freelancer --</option>' +
                allUsers.map((u) => {
                  const isSel = activeOverride && activeOverride.type === 'user' && activeOverride.userId === u.id;
                  return '<option value="' + RMTP.ui.esc(u.id) + '" ' + (isSel ? 'selected' : '') + '>' +
                    RMTP.ui.esc(displayName(u)) + ' &mdash; ' + RMTP.ui.esc(u.position || 'Tech') + (u.admin ? ' (Admin)' : '') +
                  '</option>';
                }).join('') +
              '</select>' +
              '<button type="button" id="dev-user-apply-btn" class="btn border border-line bg-panel hover:bg-panel2 text-xs font-semibold shrink-0">Switch User</button>' +
            '</div>' +
          '</div>' +

          // 3. Custom Permission Sandbox
          '<div class="p-3 rounded-lg border border-line bg-panel2/30">' +
            '<label class="block font-semibold text-ink mb-2 text-[11px] uppercase tracking-wider text-muted">3. Custom Permission Sandbox</label>' +
            '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">' +
              '<div>' +
                '<label class="block text-[11px] text-muted mb-1 font-medium">Position / Role</label>' +
                '<select id="dev-custom-pos" class="field text-xs">' +
                  POSITIONS.map((p) => '<option value="' + p + '" ' + (activeRole === p ? 'selected' : '') + '>' + p + '</option>').join('') +
                '</select>' +
              '</div>' +
              '<div class="space-y-1.5 pt-1 sm:pt-0">' +
                '<label class="flex items-center gap-2 cursor-pointer">' +
                  '<input type="checkbox" id="dev-custom-admin" class="w-4 h-4 rounded accent-purple-500" ' + (isAdminActive ? 'checked' : '') + ' />' +
                  '<span class="text-xs font-medium text-ink">Admin Privileges</span>' +
                '</label>' +
                '<label class="flex items-center gap-2 cursor-pointer">' +
                  '<input type="checkbox" id="dev-custom-trainer" class="w-4 h-4 rounded accent-purple-500" ' + (isTrainerActive ? 'checked' : '') + ' />' +
                  '<span class="text-xs font-medium text-ink">Trainer Sign-off Rights</span>' +
                '</label>' +
              '</div>' +
              '<div class="text-right">' +
                '<button type="button" id="dev-custom-apply-btn" class="btn btn-primary !py-1.5 text-xs w-full sm:w-auto">Apply Permissions</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>',
      footer:
        (activeOverride
          ? '<button type="button" id="dev-reset-btn" class="btn border border-purple-500/50 text-purple-300 hover:bg-purple-500/20 mr-auto text-xs">' +
              RMTP.ui.icon('reset', 'w-3.5 h-3.5') + 'Reset to Technical Manager' +
            '</button>'
          : '') +
        '<button type="button" class="btn btn-ghost text-xs" data-cancel>Close</button>'
    });

    const root = m.root;
    root.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-preset');
        if (p === 'tm') {
          clearDevOverride();
          m.close();
          RMTP.ui.toast('Reset to Technical Manager (Full Access)', 'ok');
        } else if (p === 'senior') {
          setDevOverride({ type: 'preset', position: 'Senior Tech', admin: true, trainer: true, label: 'Senior Tech' });
          m.close();
          RMTP.ui.toast('Switched preview to Senior Tech (Admin + Trainer)', 'ok');
        } else if (p === 'duty') {
          setDevOverride({ type: 'preset', position: 'Duty Tech', admin: false, trainer: false, label: 'Duty Tech' });
          m.close();
          RMTP.ui.toast('Switched preview to Duty Tech (Staff Tech)', 'ok');
        } else if (p === 'freelancer') {
          setDevOverride({ type: 'preset', position: 'Freelancer', admin: false, trainer: false, label: 'Freelancer' });
          m.close();
          RMTP.ui.toast('Switched preview to Freelancer (Restricted Access)', 'ok');
        }
      });
    });

    const uApplyBtn = root.querySelector('#dev-user-apply-btn');
    if (uApplyBtn) {
      uApplyBtn.addEventListener('click', () => {
        const selId = root.querySelector('#dev-user-select').value;
        if (!selId) {
          RMTP.ui.toast('Please select a crew member from the list.', 'info');
          return;
        }
        const target = RMTP.store.find('users', selId);
        if (target) {
          setDevOverride({
            type: 'user',
            userId: selId,
            position: target.position || 'Duty Tech',
            admin: !!target.admin,
            trainer: !!target.trainer,
            label: displayName(target) + ' (' + (target.position || 'Tech') + ')'
          });
          m.close();
          RMTP.ui.toast('Now previewing portal as ' + displayName(target), 'ok');
        }
      });
    }

    const cApplyBtn = root.querySelector('#dev-custom-apply-btn');
    if (cApplyBtn) {
      cApplyBtn.addEventListener('click', () => {
        const pos = root.querySelector('#dev-custom-pos').value;
        const adm = root.querySelector('#dev-custom-admin').checked;
        const trn = root.querySelector('#dev-custom-trainer').checked;
        setDevOverride({
          type: 'custom',
          position: pos,
          admin: adm,
          trainer: trn,
          label: pos + (adm ? ' \u00b7 Admin' : '') + (trn ? ' \u00b7 Trainer' : '')
        });
        m.close();
        RMTP.ui.toast('Custom permissions applied (' + pos + ')', 'ok');
      });
    }

    const rBtn = root.querySelector('#dev-reset-btn');
    if (rBtn) {
      rBtn.addEventListener('click', () => {
        clearDevOverride();
        m.close();
        RMTP.ui.toast('Reset to Technical Manager', 'ok');
      });
    }

    const cBtn = root.querySelector('[data-cancel]');
    if (cBtn) cBtn.addEventListener('click', m.close);
  }

  function refreshShell() {
    if (RMTP.shell && typeof RMTP.shell.refreshIdentity === 'function') RMTP.shell.refreshIdentity();
  }

  return {
    POSITIONS,
    displayName, initials, badges, hashPassword,
    rolesForPosition, isAutoAdminPosition,
    current, currentId, setCurrent, can,
    realCurrent, realCurrentId, isRealTechManager,
    getDevOverride, setDevOverride, clearDevOverride, openDevModal,
    login, signUp, signOut, signInEmail, showLogin, ensureSession,
    pendingUsers, approveUser, rejectUser, refreshShell,
    isTechManager, isAdmin, isTechManagerOrAdmin,
    isFreelancer, canViewDcp,
  };
})();
