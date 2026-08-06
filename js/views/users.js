/* ============================================================
   views/users.js — people, permissions & training sign-off
   ------------------------------------------------------------
   Competencies come from RMTP.TRAINING (space-specific
   categories). The per-user sheet updates in place (no modal
   rebuild) so ticking a box doesn't jump you to the top, and each
   category has a "Sign off all". Admins manage users; trainers
   (and admins) sign people off. Gating is UX-only (see auth.js).
   ============================================================ */
RMTP.views.users = function (el) {
  const ui = RMTP.ui, store = RMTP.store, auth = RMTP.auth;

  const canManage = auth.can('users.manage');
  const canSign   = auth.can('training.signoff');
  const sbMode = () => !!(RMTP.supabase && RMTP.supabase.isConfigured());

  function competencies() {
    const out = [];
    RMTP.TRAINING.forEach((cat) => cat.items.forEach((it) =>
      out.push({ id: RMTP.slug(cat.category) + '::' + RMTP.slug(it), group: cat.category, label: it })));
    return out;
  }
  function signoffId(userId, compId) { return 'so-' + userId + '-' + compId; }
  function signedFor(userId) { return store.all('signoffs').filter((s) => s.userId === userId); }
  function adminCount() { return store.all('users').filter((u) => u.admin).length; }

  render();
  // Supabase mode: on every visit to this page, refresh the users list from
  // the database (the source of truth), then re-render once — so approvals and
  // new self-registrations made elsewhere show up without a manual reload.
  if (sbMode()) {
    RMTP.syncSb.pullCollection('users')
      .then(() => { render(); auth.refreshShell(); })
      .catch(() => { /* keep showing cached users */ });
  }

  function render() {
    const allUsers = store.all('users');
    const roleRank = (u) => {
      const p = (u.position || '').toLowerCase();
      if (/technical manager|tech manager/.test(p)) return 0;
      if (/senior/.test(p)) return 1;
      if (/duty/.test(p)) return 2;
      return 3;
    };
    const users = allUsers.filter((u) => u.status !== 'pending')
      .sort((a, b) => (roleRank(a) - roleRank(b)) || auth.displayName(a).localeCompare(auth.displayName(b)));
    const pending = allUsers.filter((u) => u.status === 'pending');
    const total = competencies().length;

    el.innerHTML =
      '<div class="view-enter">' +
        ui.pageHeader('Users', 'Team',
          canManage && !sbMode() ? '<button id="add-user" class="btn btn-primary">' + ui.icon('plus', 'w-4 h-4') + 'Add user</button>' : '') +
        '<p class="text-muted -mt-2 mb-6 max-w-2xl text-sm">' + users.length + ' users \u00b7 ' + total + ' competencies. ' +
          (canManage ? (sbMode() ? 'New people sign up via \u201cRequest access\u201d on the sign-in screen; approve them below and set their role.' : 'You can add, edit and approve users.') : canSign ? 'You can sign off training.' : 'View only \u2014 ask an admin to make changes.') + '</p>' +
        (canManage && pending.length ? pendingPanel(pending) : '') +
        (users.length
          ? '<div class="panel divide-y divide-line overflow-hidden">' + users.map((u) => row(u, total)).join('') + '</div>'
          : ui.empty('users', 'No users yet', 'Add someone to get started.')) +
      '</div>';

    const add = el.querySelector('#add-user');
    if (add) add.addEventListener('click', () => editUser());
    users.forEach((u) => el.querySelector('[data-open="' + u.id + '"]').addEventListener('click', () => openUser(u)));
    pending.forEach((u) => {
      const ap = el.querySelector('[data-approve="' + u.id + '"]'); if (ap) ap.addEventListener('click', () => { auth.approveUser(u.id); ui.toast(auth.displayName(u) + ' approved', 'ok'); render(); });
      const rj = el.querySelector('[data-reject="' + u.id + '"]'); if (rj) rj.addEventListener('click', async () => {
        const ok = await ui.confirm('Reject and delete ' + auth.displayName(u) + '\u2019s access request?', { title: 'Reject request', confirmLabel: 'Reject', danger: true });
        if (ok) { auth.rejectUser(u.id); ui.toast('Request rejected', 'ok'); render(); }
      });
    });
  }

  function pendingPanel(pending) {
    return '<div class="panel p-4 mb-6" style="border-color:color-mix(in srgb,var(--accent) 40%,var(--line))">' +
      '<div class="flex items-center gap-2 mb-3">' + ui.icon('alert', 'w-4 h-4 text-accent') +
        '<p class="eyebrow">Access requests \u00b7 ' + pending.length + '</p></div>' +
      '<div class="grid gap-2">' + pending.map((u) =>
        '<div class="flex items-center justify-between gap-3 flex-wrap">' +
          '<div class="min-w-0"><p class="font-medium truncate">' + ui.esc(auth.displayName(u)) + '</p>' +
            '<p class="text-xs text-muted">' + ui.esc(u.email) + ' \u00b7 ' + ui.esc(u.position) + ' \u00b7 ' + ui.esc(u.discipline) + '</p></div>' +
          '<div class="flex gap-2 shrink-0">' +
            '<button data-approve="' + u.id + '" class="btn btn-primary !py-1.5 text-xs">' + ui.icon('check', 'w-4 h-4') + 'Approve</button>' +
            '<button data-reject="' + u.id + '" class="btn btn-ghost !py-1.5 text-xs">Reject</button>' +
          '</div>' +
        '</div>').join('') +
      '</div></div>';
  }

  function row(u, total) {
    const done = signedFor(u.id).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return '<button data-open="' + u.id + '" class="w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-panel2/50 transition-colors">' +
      '<div class="w-10 h-10 rounded-full bg-panel2 border border-line flex items-center justify-center text-sm font-display font-semibold shrink-0">' +
        ui.esc(auth.initials(u)) + '</div>' +
      '<div class="min-w-0 flex-1">' +
        '<p class="font-medium truncate">' + ui.esc(auth.displayName(u)) + '</p>' +
        '<p class="text-xs text-muted mt-0.5">' + ui.esc(u.position) + ' \u00b7 ' + ui.esc(u.discipline) + '</p>' +
      '</div>' +
      '<div class="hidden sm:flex">' + auth.badges(u) + '</div>' +
      '<div class="w-28 shrink-0 hidden md:block">' +
        '<div class="flex items-center gap-2">' +
          '<div class="flex-1 h-1.5 rounded-full bg-panel2 overflow-hidden"><div class="h-full rounded-full" style="width:' + pct + '%;background:var(--accent)"></div></div>' +
          '<span class="tabular text-xs text-muted">' + done + '/' + total + '</span>' +
        '</div>' +
      '</div>' +
      '<span class="text-muted shrink-0">' + ui.icon('chevR', 'w-4 h-4') + '</span>' +
    '</button>';
  }

  /* User detail — training sheet updates in place (no scroll jump). */
  function openUser(u) {
    const comps = competencies();
    const cats = RMTP.TRAINING.map((c) => ({
      name: c.category, key: RMTP.slug(c.category),
      comps: comps.filter((x) => x.group === c.category),
    }));

    function isSigned(compId) { return !!store.find('signoffs', signoffId(u.id, compId)); }
    function stamp(iso) { const d = new Date(iso); return ui.formatDate(iso) + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    function catStats(cat) {
      const signed = cat.comps.filter((c) => isSigned(c.id)).length;
      return { signed: signed, total: cat.comps.length };
    }

    const sheet = cats.map((cat) => {
      const st = catStats(cat);
      const pct = st.total ? Math.round((st.signed / st.total) * 100) : 0;
      return '<div class="mb-5">' +
        '<div class="flex items-center justify-between gap-3 mb-2">' +
          '<p class="eyebrow">' + ui.esc(cat.name) + '</p>' +
          '<div class="flex items-center gap-2">' +
            '<span id="cnt-' + cat.key + '" class="tabular text-xs text-muted">' + st.signed + '/' + st.total + '</span>' +
            (canSign ? '<button data-signall="' + cat.key + '" id="all-' + cat.key + '" class="btn btn-ghost !px-2.5 !py-1 text-xs">' + (st.signed === st.total ? 'All signed' : 'Sign off all') + '</button>' : '') +
          '</div>' +
        '</div>' +
        '<div class="h-1 rounded-full bg-panel2 overflow-hidden mb-2"><div id="bar-' + cat.key + '" class="h-full rounded-full" style="width:' + pct + '%;background:var(--accent)"></div></div>' +
        '<div class="panel divide-y divide-line overflow-hidden">' +
          cat.comps.map((c) => {
            const on = isSigned(c.id);
            const rec = on ? store.find('signoffs', signoffId(u.id, c.id)) : null;
            return '<div class="flex items-center gap-3 px-3 py-2.5">' +
              '<div class="min-w-0 flex-1">' +
                '<p class="text-sm truncate">' + ui.esc(c.label) + '</p>' +
                '<p data-meta="' + c.id + '" class="text-[11px] text-muted mt-0.5">' + (rec ? 'Signed ' + stamp(rec.date) + ' by ' + ui.esc(rec.signedBy) : '') + '</p>' +
              '</div>' +
              (canSign
                ? '<button data-toggle="' + c.id + '" class="btn btn-ghost !px-2.5 !py-1.5 text-xs shrink-0"' + (on ? ' style="color:var(--ok)" disabled' : '') + '>' + (on ? ui.icon('check', 'w-4 h-4') + 'Signed' : 'Sign off') + '</button>'
                : (on ? ui.pill('Signed', 'var(--ok)') : '<span class="text-xs text-muted">\u2014</span>')) +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
    }).join('') || ui.empty('book', 'No competencies', 'Add training categories in config.');

    const isSelf = auth.currentId() === u.id;
    const m = ui.modal({
      title: auth.displayName(u),
      size: 'md:max-w-lg',
      body:
        '<div class="flex items-center justify-between gap-3 mb-4">' +
          '<div class="flex items-center gap-2 flex-wrap">' +
            '<span class="text-sm text-muted">' + ui.esc(u.position) + ' \u00b7 ' + ui.esc(u.discipline) + '</span>' + auth.badges(u) +
          '</div>' +
          (canManage ? '<button data-edit class="btn btn-ghost !px-2.5 !py-1.5 text-xs shrink-0">' + ui.icon('pen', 'w-4 h-4') + 'Edit</button>' : '') +
        '</div>' +
        '<p class="eyebrow mb-3">Training</p>' + sheet,
      footer:
        (canManage ? '<button data-remove class="btn btn-danger mr-auto"' + (isSelf ? ' disabled title="You can\u2019t remove yourself"' : '') + '>' + ui.icon('trash', 'w-4 h-4') + 'Remove</button>' : '') +
        '<button class="btn btn-primary" data-done data-primary>Done</button>',
    });

    // --- in-place updates ---
    function paintToggle(btn, on) {
      btn.innerHTML = on ? ui.icon('check', 'w-4 h-4') + 'Signed' : 'Sign off';
      btn.style.color = on ? 'var(--ok)' : '';
      btn.disabled = on;
    }
    function paintMeta(compId) {
      const meta = m.root.querySelector('[data-meta="' + compId + '"]');
      const rec = store.find('signoffs', signoffId(u.id, compId));
      if (meta) meta.textContent = rec ? 'Signed ' + stamp(rec.date) + ' by ' + rec.signedBy : '';
    }
    function refreshCat(cat) {
      const st = catStats(cat);
      const cnt = m.root.querySelector('#cnt-' + cat.key); if (cnt) cnt.textContent = st.signed + '/' + st.total;
      const bar = m.root.querySelector('#bar-' + cat.key); if (bar) bar.style.width = (st.total ? Math.round(st.signed / st.total * 100) : 0) + '%';
      const all = m.root.querySelector('#all-' + cat.key); if (all) all.textContent = (st.signed === st.total ? 'All signed' : 'Sign off all');
    }
    function sign(compId) {
      const comp = comps.find((c) => c.id === compId);
      store.upsert('signoffs', { id: signoffId(u.id, compId), userId: u.id, compId: compId, compLabel: comp ? comp.group + ' \u2014 ' + comp.label : compId, signedBy: auth.displayName(auth.current()) || 'Unknown', date: new Date().toISOString() });
    }

    cats.forEach((cat) => {
      cat.comps.forEach((c) => {
        const btn = m.root.querySelector('[data-toggle="' + c.id + '"]');
        if (btn) btn.addEventListener('click', () => {
          if (isSigned(c.id)) return;            // sign-off is one-way; never cleared
          sign(c.id);
          paintToggle(btn, true); paintMeta(c.id); refreshCat(cat);
        });
      });
      const allBtn = m.root.querySelector('[data-signall="' + cat.key + '"]');
      if (allBtn) allBtn.addEventListener('click', () => {
        cat.comps.forEach((c) => {
          if (!isSigned(c.id)) sign(c.id);
          const btn = m.root.querySelector('[data-toggle="' + c.id + '"]');
          if (btn) paintToggle(btn, true);
          paintMeta(c.id);
        });
        refreshCat(cat);
      });
    });

    m.root.querySelector('[data-done]').addEventListener('click', () => { m.close(); render(); });
    const editBtn = m.root.querySelector('[data-edit]');
    if (editBtn) editBtn.addEventListener('click', () => { m.close(); editUser(u); });
    const rm = m.root.querySelector('[data-remove]');
    if (rm && !isSelf) rm.addEventListener('click', async () => {
      if (u.admin && adminCount() <= 1) { ui.toast('Can\u2019t remove the last admin', 'danger'); return; }
      m.close();
      const ok = await ui.confirm('Remove ' + auth.displayName(u) + ' and their training record?', { title: 'Remove user', confirmLabel: 'Remove', danger: true });
      if (!ok) { render(); return; }
      signedFor(u.id).forEach((s) => store.remove('signoffs', s.id));
      store.remove('users', u.id);
      ui.toast('User removed', 'ok'); render();
    });
  }

  // compIds contain "::" — attribute selectors handle them; no id-escaping needed.

  function editUser(existing) {
    if (!canManage) { ui.toast('Only admins can manage users', 'danger'); return; }
    if (!existing && sbMode()) { ui.toast('In this deployment, new people sign up via \u201cRequest access\u201d and you approve them \u2014 that\u2019s how they get a password.', 'info'); return; }
    const u = existing || {};
    const opt = (arr, val) => arr.map((v) => '<option ' + (v === val ? 'selected' : '') + '>' + v + '</option>').join('');
    const chk = (id, label, on) =>
      '<label class="flex items-center gap-3 panel p-3 cursor-pointer">' +
        '<input type="checkbox" id="' + id + '" class="w-4 h-4 accent-[var(--accent)]" ' + (on ? 'checked' : '') + ' />' +
        '<span class="text-sm">' + ui.esc(label) + '</span></label>';
    const m = ui.modal({
      title: existing ? 'Edit user' : 'Add user',
      size: 'md:max-w-lg',
      body:
        '<div class="grid gap-4">' +
          '<div class="grid grid-cols-2 gap-4">' +
            fld('First name', '<input id="u-first" class="field" value="' + ui.esc(u.firstName || '') + '" placeholder="First" />') +
            fld('Last name',  '<input id="u-last" class="field" value="' + ui.esc(u.lastName || '') + '" placeholder="Last" />') +
          '</div>' +
          '<div class="grid grid-cols-2 gap-4">' +
            fld('Email', '<input id="u-email" type="email" class="field" value="' + ui.esc(u.email || '') + '" placeholder="you@richmix.local" />') +
            fld(existing ? 'Reset password' : 'Password', '<input id="u-pass" type="password" class="field" placeholder="' + (existing ? 'Leave blank to keep' : 'At least 6 characters') + '" />') +
          '</div>' +
          '<div class="grid grid-cols-2 gap-4">' +
            fld('Position', '<select id="u-position" class="field">' + opt(auth.POSITIONS, u.position || 'Duty Tech') + '</select>') +
            fld('Preferred discipline', '<select id="u-discipline" class="field">' + opt(auth.DISCIPLINES, u.discipline || 'Sound') + '</select>') +
          '</div>' +
          '<div class="grid gap-2">' +
            '<label class="flex items-center gap-3 panel p-3 cursor-pointer">' +
              '<input type="checkbox" id="u-trainer" class="w-4 h-4 accent-[var(--accent)]" ' + (u.trainer ? 'checked' : '') + ' />' +
              '<span class="text-sm">Trainer <span class="text-muted">\u2014 can sign off training</span></span></label>' +
            '<p id="u-role-note" class="text-xs text-muted"></p>' +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>' + (existing ? 'Save' : 'Add user') + '</button>',
    });
    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);

    // Roles follow position: TM/Senior are auto admin+trainer (trainer locked on).
    const posSel = m.root.querySelector('#u-position');
    const trainerBox = m.root.querySelector('#u-trainer');
    const roleNote = m.root.querySelector('#u-role-note');
    function syncRoles() {
      if (auth.isAutoAdminPosition(posSel.value)) {
        trainerBox.checked = true; trainerBox.disabled = true;
        roleNote.textContent = posSel.value + 's are automatically admins and trainers.';
      } else {
        trainerBox.disabled = false;
        roleNote.textContent = 'Base permissions. Tick Trainer to let them sign off training.';
      }
    }
    posSel.addEventListener('change', syncRoles); syncRoles();

    m.root.querySelector('[data-save]').addEventListener('click', () => {
      const firstName = m.root.querySelector('#u-first').value.trim();
      const lastName = m.root.querySelector('#u-last').value.trim();
      if (!firstName && !lastName) { ui.toast('Enter a name', 'danger'); return; }
      const email = m.root.querySelector('#u-email').value.trim();
      const pass = m.root.querySelector('#u-pass').value;
      if (!existing) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { ui.toast('Enter a valid email', 'danger'); return; }
        if (pass.length < 6) { ui.toast('Password needs 6+ characters', 'danger'); return; }
      }
      const position = posSel.value;
      const roles = auth.rolesForPosition(position, trainerBox.checked);
      if (u.admin && !roles.admin && adminCount() <= 1) { ui.toast('There must be at least one admin', 'danger'); return; }
      const record = Object.assign({}, u, {
        id: u.id || store.uid('user'),
        firstName: firstName, lastName: lastName, email: email,
        status: u.status && u.status !== 'pending' ? u.status : 'active',
        position: position,
        discipline: m.root.querySelector('#u-discipline').value,
        admin: roles.admin, trainer: roles.trainer,
      });
      if (pass) record.password = auth.hashPassword(pass);
      store.upsert('users', record);
      m.close(); ui.toast(existing ? 'User saved' : 'User added', 'ok'); auth.refreshShell(); render();
    });
  }

  function inner(label, control) { return '<label class="block text-sm font-medium mb-2">' + ui.esc(label) + '</label>' + control; }
  function fld(label, control) { return '<div>' + inner(label, control) + '</div>'; }
};
