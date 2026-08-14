/* ==========================================================================
   Utopia Trucking Task Manager — application controller
   State, routing, drawer, modal, search, notifications, demo interactions.
   ========================================================================== */
(function (TF) {
  'use strict';

  var KEY = 'utm.prefs.v1';
  var qs = TF.qs, qsa = TF.qsa, el = TF.el;

  /* ==================================================================
     1. STATE
     ================================================================== */
  var now = new Date();

  TF.state = {
    theme: 'light',
    accent: 'emerald',
    collapsed: false,
    view: 'dashboard',
    scope: 'mine',
    layout: 'list',
    notifFilter: 'all',
    filters: { q: '', status: 'all', priority: 'all', assignee: 'all', project: 'all' },
    calYear: now.getFullYear(),
    calMonth: now.getMonth(),
    calDir: '',
    prefs: { nAssign: true, nDue: true, nComment: true, nDigest: false, motion: true, compact: false }
  };

  /* ==================================================================
     1b. HYDRATION — server is the source of truth for users/tasks/notifs
     ================================================================== */
  var AVATAR_COLORS = [
    ['#10b981', '#047857'], ['#60a5fa', '#2563eb'], ['#a78bfa', '#7c3aed'],
    ['#fbbf24', '#d97706'], ['#34d399', '#059669'], ['#f87171', '#dc2626'],
    ['#22d3ee', '#0891b2'], ['#818cf8', '#4f46e5']
  ];

  function colorFor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  var ms = function (iso) { return iso ? new Date(iso).getTime() : 0; };

  /** Server user → the shape views.js renders. */
  TF.fromApiUser = function (u) {
    var c = colorFor(u.id);
    return {
      id: u.id, name: u.fullName, initials: u.initials, email: u.email,
      orgRole: u.role, roleLabel: TF.ROLE_LABELS[u.role] || u.role,
      role: u.jobTitle || TF.ROLE_LABELS[u.role] || u.role,
      dept: u.department || '—', teamId: u.teamId, managerId: u.managerId,
      active: u.isActive, lastLogin: ms(u.lastLoginAt),
      c1: c[0], c2: c[1]
    };
  };

  /** Server task → the shape views.js renders (epoch ms, `assignee`, `due`, `desc`). */
  TF.fromApiTask = function (t) {
    return {
      id: t.id, ref: t.ref, title: t.title, desc: t.description || '',
      status: t.status, priority: t.priority, progress: t.progress,
      assignee: t.assignedTo, reporter: t.createdBy,
      project: t.project || 'General',
      created: ms(t.createdAt), assignedAt: ms(t.assignedAt),
      start: ms(t.startAt), due: ms(t.dueAt),
      completedAt: ms(t.completedAt),
      isOverdue: !!t.isOverdue,
      onTime: t.completedAt && t.dueAt ? ms(t.completedAt) <= ms(t.dueAt) : false,
      notes: t.notes || '', tags: t.tags || [], attachments: [],
      activity: [], comments: []
    };
  };

  TF.fromApiNotification = function (n) {
    return {
      id: n.id, type: n.type, title: n.title, body: n.body,
      task: n.taskId, ts: ms(n.createdAt), read: !!n.read
    };
  };

  /**
   * Paints the signed-in user into the app chrome — sidebar, topbar button and the
   * profile popover. These were static demo markup showing one hardcoded person, so
   * every real user saw someone else's name and email after signing in.
   */
  TF.paintIdentity = function () {
    var me = TF.session.me;
    if (!me) return;

    var jobTitle = me.jobTitle || TF.ROLE_LABELS[me.role] || me.role;

    qsa('[data-me-name]').forEach(function (n) { n.textContent = me.fullName; });
    qsa('[data-me-role]').forEach(function (n) { n.textContent = jobTitle; });
    qsa('[data-me-email]').forEach(function (n) { n.textContent = me.email; });
    /* The avatar is generated from the user's initials and a colour derived from their
       id — there is no photo upload anywhere in the product, so nothing to load. */
    var u = TF.user(me.id);
    qsa('[data-me-avatar]').forEach(function (n) {
      n.textContent = u.initials || me.initials || '?';
      n.style.setProperty('--av-1', u.c1);
      n.style.setProperty('--av-2', u.c2);
      n.setAttribute('title', me.fullName);
    });
  };

  TF.hydrate = function () {
    return Promise.all([TF.api.bootstrap(), TF.api.dashboard()]).then(function (r) {
      var d = r[0];
      TF.session.me = d.me;
      TF.CURRENT_USER = d.me.id;

      TF.users = d.users.map(TF.fromApiUser);
      TF.userMap = {};
      TF.users.forEach(function (u) { TF.userMap[u.id] = u; });

      TF.tasks = d.tasks.map(TF.fromApiTask);
      TF.notifications = d.notifications.map(TF.fromApiNotification);
      TF.dashboardData = r[1];

      var seen = {};
      TF.PROJECTS = [];
      TF.tasks.forEach(function (t) {
        if (t.project && !seen[t.project]) { seen[t.project] = 1; TF.PROJECTS.push(t.project); }
      });
      TF.PROJECTS.sort();

      TF.paintIdentity();
    });
  };

  /** Refetches tasks and notifications, then re-renders. */
  TF.refresh = function () {
    return TF.hydrate().then(function () {
      render();
      renderNotifPanel();
      refreshBadges();
    });
  };

  /**
   * Optimistic mutation: apply locally, render, then persist. On failure,
   * re-hydrate from the server so local state can never drift out of truth.
   */
  TF.mutate = function (applyLocally, apiCall, errorTitle) {
    applyLocally();
    render();
    refreshBadges();
    return apiCall().then(function (updated) {
      return updated;
    }).catch(function (err) {
      TF.apiError(err, errorTitle);
      return TF.refresh();
    });
  };

  /* Preferences only — tasks and notifications live on the server (see hydrate above). */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        theme: TF.state.theme, accent: TF.state.accent,
        collapsed: TF.state.collapsed, prefs: TF.state.prefs
      }));
    } catch (e) { /* storage unavailable — preferences reset next load */ }
  }
  TF.save = save;

  function load() {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return; }
    if (!raw) return;
    try {
      var d = JSON.parse(raw);
      if (d.theme) TF.state.theme = d.theme;
      if (d.accent) TF.state.accent = d.accent;
      if (typeof d.collapsed === 'boolean') TF.state.collapsed = d.collapsed;
      if (d.prefs) Object.keys(d.prefs).forEach(function (k) { TF.state.prefs[k] = d.prefs[k]; });
    } catch (e) { /* corrupt payload — fall back to defaults */ }
  }

  /* ==================================================================
     2. DERIVED DATA
     ================================================================== */
  TF.counts = function () {
    var c = { assigned: 0, progress: 0, hold: 0, completed: 0, overdue: 0, cancelled: 0,
              dueToday: 0, dueSoon: 0, onTime: 0, assignedToMe: 0 };
    var t0 = TF.startOfDay(Date.now()), t1 = t0 + 86400000, t7 = t0 + 8 * 86400000;

    TF.tasks.forEach(function (t) {
      if (c[t.status] === undefined) c[t.status] = 0;
      c[t.status]++;
      var open = t.status !== 'completed' && t.status !== 'cancelled';
      if (open && t.due) {
        if (t.due < t1) c.dueToday++;
        else if (t.due < t7) c.dueSoon++;
      }
      if (t.status === 'completed' && t.onTime) c.onTime++;
      if (t.assignee === TF.CURRENT_USER) c.assignedToMe++;
    });

    c.total = TF.tasks.length;
    c.pending = c.assigned;
    c.rate = c.completed ? Math.round((c.onTime / c.completed) * 100) : 0;
    return c;
  };

  TF.taskById = function (id) {
    return TF.tasks.filter(function (t) { return t.id === id; })[0];
  };

  TF.sortByUrgency = function (a, b) {
    var rank = { overdue: 0, progress: 1, assigned: 2, hold: 3, completed: 4 };
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    if (a.status === 'completed') return (b.completedAt || 0) - (a.completedAt || 0);
    if (a.due !== b.due) return a.due - b.due;
    return TF.PRIORITY[b.priority].rank - TF.PRIORITY[a.priority].rank;
  };

  TF.applyFilters = function (list) {
    var f = TF.state.filters;
    var q = (f.q || '').trim().toLowerCase();
    return list.filter(function (t) {
      if (f.status !== 'all' && t.status !== f.status) return false;
      if (f.priority !== 'all' && t.priority !== f.priority) return false;
      if (f.assignee !== 'all' && t.assignee !== f.assignee) return false;
      if (f.project !== 'all' && t.project !== f.project) return false;
      if (!q) return true;
      var hay = (t.id + ' ' + t.title + ' ' + t.desc + ' ' + (t.tags || []).join(' ') + ' ' +
        t.project + ' ' + TF.userName(t.assignee)).toLowerCase();
      return hay.indexOf(q) > -1;
    });
  };

  /** Renders one task-history row into the same copy the activity timeline expects. */
  TF.historyText = function (h) {
    var name = function (id) { return '<b>' + TF.esc(TF.userName(id)) + '</b>'; };
    switch (h.event) {
      case 'created':          return '{user} created the task';
      case 'assigned':         return 'Assigned to ' + name(h.toValue);
      case 'reassigned':       return 'Reassigned from ' + name(h.fromValue) + ' to ' + name(h.toValue);
      case 'status_changed':   return '<b>' + TF.statusLabel(h.fromValue) + '</b> &rarr; <b>' + TF.statusLabel(h.toValue) + '</b>';
      case 'priority_changed': return 'Priority <b>' + TF.esc(h.fromValue) + '</b> &rarr; <b>' + TF.esc(h.toValue) + '</b>';
      case 'due_changed':      return 'Due date updated';
      case 'progress_changed': return '<b>' + TF.esc(h.fromValue) + '%</b> &rarr; <b>' + TF.esc(h.toValue) + '%</b>';
      case 'completed':        return 'Marked the task <b>Completed</b>';
      case 'reopened':         return 'Reopened the task';
      case 'cancelled':        return 'Cancelled the task';
      case 'commented':        return 'Left a comment on the task';
      default:                 return TF.esc(h.event);
    }
  };

  TF.statusLabel = function (k) { return (TF.STATUS[k] || {}).label || k; };

  /** Reads from the dashboard payload (Task 17) rather than walking every task's local activity array. */
  TF.recentActivity = function (n) {
    return (TF.dashboardData && TF.dashboardData.recentActivity ? TF.dashboardData.recentActivity : [])
      .slice(0, n || 20)
      .map(function (a) {
        return {
          type: a.event === 'created' ? 'created' : a.event === 'completed' ? 'done' : 'status',
          user: a.actor ? a.actor.id : null,
          text: TF.historyText({ event: a.event, fromValue: null, toValue: null }),
          ts: new Date(a.createdAt).getTime(),
          taskId: a.taskId, taskTitle: a.taskTitle
        };
      });
  };

  var TONE = { green: '#10b981', blue: '#3b82f6', purple: '#8b5cf6', amber: '#f59e0b', red: '#ef4444', slate: '#64748b' };

  TF.timelineItem = function (a, i) {
    var meta = TF.ACT[a.type] || TF.ACT.status;
    var color = TONE[meta.tone];
    var text = String(a.text).replace('{user}', '<b>' + TF.esc(TF.userName(a.user)) + '</b>');
    return '<div class="tl-item"' + (a.taskId ? ' data-task="' + a.taskId + '" style="cursor:pointer;' : ' style="') +
        '--tlc:' + color + ';--tlc-bg:' + color + '22;--d:' + ((i || 0) * 60) + 'ms">' +
      '<span class="tl-item__dot">' + TF.icon(meta.icon) + '</span>' +
      '<div class="tl-item__title">' + meta.label + '</div>' +
      '<div class="tl-item__desc">' + text + (a.taskTitle ? ' · <b>' + TF.esc(a.taskTitle) + '</b>' : '') + '</div>' +
      '<div class="tl-item__foot">' + TF.avatarHTML(a.user, 'xs') +
        '<span class="tl-item__time">' + TF.esc(TF.userName(a.user)) + ' · ' + TF.relTime(a.ts) + '</span></div>' +
    '</div>';
  };

  TF.notifHTML = function (n, i) {
    var st = TF.NOTIF_STYLE[n.type] || TF.NOTIF_STYLE.assigned;
    return '<div class="notif' + (n.read ? '' : ' is-unread') + '" data-notif="' + n.id + '"' +
        (n.task ? ' data-task="' + n.task + '"' : '') +
        ' style="--nc:' + st.color + ';--nc-bg:' + st.color + '1f;animation-delay:' + ((i || 0) * 55) + 'ms">' +
      '<span class="notif__ico">' + TF.icon(st.icon) + '</span>' +
      '<div class="notif__body"><b>' + n.title + '</b><p>' + n.body + '</p>' +
        '<div class="notif__time">' + TF.icon('i-clock') + TF.relTime(n.ts) +
        (n.task ? ' · ' + n.task : '') + '</div></div>' +
    '</div>';
  };

  /* ==================================================================
     3. THEME / ACCENT / CHROME
     ================================================================== */
  var ACCENTS = {
    emerald: ['#10b981', '#059669', '#047857', '#6ee7b7', '16,185,129'],
    teal:    ['#14b8a6', '#0d9488', '#0f766e', '#5eead4', '20,184,166'],
    blue:    ['#3b82f6', '#2563eb', '#1d4ed8', '#93c5fd', '59,130,246'],
    violet:  ['#8b5cf6', '#7c3aed', '#6d28d9', '#c4b5fd', '139,92,246'],
    amber:   ['#f59e0b', '#d97706', '#b45309', '#fcd34d', '245,158,11']
  };

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', TF.state.theme);
    var a = ACCENTS[TF.state.accent] || ACCENTS.emerald;
    var r = document.documentElement.style;
    r.setProperty('--accent', a[0]);
    r.setProperty('--accent-600', a[1]);
    r.setProperty('--accent-700', a[2]);
    r.setProperty('--accent-300', a[3]);
    r.setProperty('--accent-soft', 'rgba(' + a[4] + ',.12)');
    r.setProperty('--accent-glow', 'rgba(' + a[4] + ',.35)');
  }

  function toggleTheme() {
    TF.state.theme = TF.state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(); save();
    TF.toast({ type: 'info', icon: TF.state.theme === 'dark' ? 'i-moon' : 'i-sun',
      title: TF.state.theme === 'dark' ? 'Dark mode on' : 'Light mode on',
      body: 'Your preference is saved for next time.', duration: 2600 });
  }

  function applyChrome() {
    var app = qs('#appShell');
    app.classList.toggle('is-collapsed', TF.state.collapsed);
    document.body.classList.toggle('no-motion', !TF.state.prefs.motion);
    document.body.classList.toggle('compact', !!TF.state.prefs.compact);
  }

  /* ------- nav pill + badges ------- */
  function movePill() {
    ['#mainNav', '#orgNav'].forEach(function (sel) {
      var nav = qs(sel); if (!nav) return;
      var pill = qs('.nav__pill', nav);
      if (!pill) { pill = el('<span class="nav__pill" aria-hidden="true"></span>'); nav.insertBefore(pill, nav.firstChild); }
      var active = qs('.nav__item.is-active', nav);
      if (!active) { pill.style.opacity = '0'; return; }
      pill.style.opacity = '1';
      pill.style.transform = 'translateY(' + active.offsetTop + 'px)';
      pill.style.height = active.offsetHeight + 'px';
    });
  }

  function refreshBadges() {
    var openMine = TF.tasks.filter(function (t) {
      return t.assignee === TF.CURRENT_USER && t.status !== 'completed';
    }).length;
    var unread = TF.notifications.filter(function (n) { return !n.read; }).length;

    var b1 = qs('[data-badge="mytasks"]');
    if (b1) { b1.textContent = openMine; b1.style.display = openMine ? '' : 'none'; }
    var b2 = qs('[data-badge="notifications"]');
    if (b2) { b2.textContent = unread; b2.style.display = unread ? '' : 'none'; }

    var bell = qs('#bellBadge');
    if (bell) { bell.textContent = unread; bell.style.display = unread ? '' : 'none'; }
    var lbl = qs('#notifUnreadLabel');
    if (lbl) lbl.textContent = unread ? unread + ' unread' : 'All caught up';

    /* weekly goal promo */
    var weekAgo = Date.now() - 7 * 86400000;
    var doneThisWeek = TF.tasks.filter(function (t) {
      return t.status === 'completed' && (t.completedAt || 0) > weekAgo;
    }).length + 22;
    var pd = qs('#promoDone'); if (pd) pd.textContent = doneThisWeek;
    var pb = qs('#promoBar'); if (pb) pb.style.width = Math.min(100, (doneThisWeek / 40) * 100) + '%';
  }
  TF.refreshBadges = refreshBadges;

  function renderNotifPanel() {
    var list = qs('#notifList');
    if (!list) return;
    list.innerHTML = TF.notifications.length
      ? TF.notifications.slice(0, 8).map(TF.notifHTML).join('')
      : '<div style="padding:26px 16px;text-align:center;color:var(--text-3);font-size:13px">No notifications yet.</div>';
  }

  TF.notify = function (n) {
    n.id = 'n' + Date.now() + Math.floor(Math.random() * 99);
    n.ts = Date.now();
    n.read = false;
    TF.notifications.unshift(n);
    if (TF.notifications.length > 30) TF.notifications.pop();
    renderNotifPanel(); refreshBadges(); save();
    if (TF.state.view === 'notifications') render();
  };

  /* ==================================================================
     4. ROUTER
     ================================================================== */
  var VIEW_TITLES = { dashboard: 'Dashboard', mytasks: 'My Tasks', alltasks: 'All Tasks', team: 'Team',
    calendar: 'Calendar', notifications: 'Notifications', reports: 'Reports', activity: 'Activity', settings: 'Settings',
    password: 'Change password' };

  function render() {
    var name = TF.state.view;
    var view = TF.Views[name] || TF.Views.dashboard;
    var host = qs('#viewport');
    host.innerHTML = view();
    document.title = VIEW_TITLES[name] + ' · Utopia Trucking Task Manager';

    TF.playCounters(host);
    TF.playBars(host);
    if (view.after) view.after(host);

    qsa('.nav__item, .mobilenav__item').forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-view') === name);
    });
    movePill();
    refreshBadges();
    TF.state.calDir = '';
  }
  TF.render = render;

  TF.go = function (name) {
    if (!TF.Views[name]) return;
    TF.state.view = name;
    qs('#appShell').classList.remove('is-nav-open');
    render();
    window.scrollTo({ top: 0, behavior: TF.reduceMotion ? 'auto' : 'smooth' });
  };

  /* ==================================================================
     5. TASK MUTATIONS
     ================================================================== */
  function logActivity(t, type, text, user) {
    t.activity.push({ type: type, user: user || TF.CURRENT_USER, text: text, ts: Date.now() });
  }

  function setProgress(id, value, source) {
    var t = TF.taskById(id);
    if (!t) return;
    var prev = t.progress;
    var prevStatus = t.status;
    value = Math.max(0, Math.min(100, Math.round(value)));
    if (value === prev && value !== 100) return;

    t.progress = value;
    if (prev !== value) logActivity(t, 'progress', '<b>' + prev + '%</b> &rarr; <b>' + value + '%</b>');

    if (value === 100) {
      if (t.status !== 'completed') {
        t.status = 'completed';
        t.completedAt = Date.now();
        t.onTime = Date.now() <= t.due;
        logActivity(t, 'done', 'Marked the task <b>Completed</b>');
        logActivity(t, 'status', TF.STATUS[prevStatus].label + ' &rarr; <b>Completed</b>');
        TF.notify({ type: 'done', title: 'Task completed',
          body: TF.esc(TF.userName(TF.CURRENT_USER)) + ' completed <q>' + TF.esc(t.title) + '</q>', task: t.id });
        TF.toast({ type: 'success', title: 'Task completed 🎉',
          body: '<q>' + TF.esc(t.title) + '</q> is done — nice work.' });
      }
    } else if (value > 0 && (t.status === 'assigned' || t.status === 'completed')) {
      var from = TF.STATUS[t.status].label;
      t.status = 'progress';
      delete t.completedAt; delete t.onTime;
      logActivity(t, 'status', from + ' &rarr; <b>In Progress</b>');
    } else if (value === 0 && t.status === 'completed') {
      t.status = 'assigned';
      delete t.completedAt; delete t.onTime;
      logActivity(t, 'status', 'Completed &rarr; <b>Assigned</b>');
    }

    save();
    TF.api.updateTask(id, { progress: value }).then(function (updated) {
      var local = TF.taskById(id);
      if (local) {
        local.status = updated.status;
        local.completedAt = updated.completedAt ? new Date(updated.completedAt).getTime() : 0;
      }
      refreshBadges();
    }).catch(function (err) {
      TF.apiError(err, 'Could not save progress');
      TF.refresh();
    });
    if (drawerTask === id) openTask(id, true);
    render();
    if (source && value === 100) TF.burst(source, 18);
  }
  TF.setProgress = setProgress;

  /**
   * A completed task can only leave `completed` through the dedicated reopen
   * endpoint (a plain progress PATCH cannot un-complete it server-side), so this
   * persists through TF.api.completeTask/reopenTask directly rather than routing
   * through setProgress's generic progress-PATCH persistence. `wasCompleted` is
   * captured before any local mutation so the right endpoint is always chosen.
   */
  function toggleComplete(id, source) {
    var t = TF.taskById(id);
    if (!t) return;
    var wasCompleted = t.status === 'completed';

    if (wasCompleted) {
      t.progress = 0;
      t.status = 'progress';
      delete t.completedAt; delete t.onTime;
      logActivity(t, 'status', 'Completed &rarr; <b>In Progress</b>');
      save();
      render();
      TF.toast({ type: 'info', title: 'Task reopened', body: '<q>' + TF.esc(t.title) + '</q> is back on the board.', duration: 3000 });
    } else {
      if (source) {
        source.classList.add('is-on');
        TF.burst(source, 14);
      }
      setTimeout(function () {
        t.progress = 100;
        t.status = 'completed';
        t.completedAt = Date.now();
        t.onTime = Date.now() <= t.due;
        logActivity(t, 'done', 'Marked the task <b>Completed</b>');
        save();
        if (drawerTask === id) openTask(id, true);
        render();
        TF.toast({ type: 'success', title: 'Task completed 🎉', body: '<q>' + TF.esc(t.title) + '</q> is done — nice work.' });
      }, 260);
    }

    var call = wasCompleted ? TF.api.reopenTask(id) : TF.api.completeTask(id);
    call.then(function (updated) {
      var local = TF.taskById(id);
      if (local) {
        local.status = updated.status;
        local.progress = updated.progress;
        local.completedAt = updated.completedAt ? new Date(updated.completedAt).getTime() : 0;
        refreshBadges();
      }
    }).catch(function (err) {
      TF.apiError(err, 'Could not update the task');
      TF.refresh();
    });
  }

  /* ==================================================================
     6. DRAWER — task details
     ================================================================== */
  var drawerTask = null;

  function drawerHTML(t) {
    var st = TF.STATUS[t.status];
    var done = t.status === 'completed';
    var acts = (t.activity || []).slice().sort(function (a, b) { return b.ts - a.ts; });

    return '' +
    '<header class="drawer__head">' +
      '<div class="drawer__crumb"><span>' + TF.esc(t.project) + ' · ' + t.id + '</span>' +
        '<button class="icon-btn" data-action="close-drawer" aria-label="Close">' + TF.icon('i-x') + '</button></div>' +
      '<h2 class="drawer__title">' + TF.esc(t.title) + '</h2>' +
      '<div class="drawer__chips">' + TF.statusChip(t.status) + TF.prioChip(t.priority) +
        '<span class="chip ' + (TF.dueTone(t) === 'is-late' ? 'chip--red' : TF.dueTone(t) === 'is-today' ? 'chip--amber' : '') + '">' +
        TF.icon('i-clock') + TF.fmtDue(t.due, done) + '</span>' +
      '</div>' +
    '</header>' +

    '<div class="drawer__body" id="drawerBody">' +
      '<section class="drawer__sec">' +
        '<div class="drawer__sec-title">' + TF.icon('i-alltasks') + 'Description</div>' +
        '<p style="font-size:13.5px;line-height:1.7;color:var(--text-2)">' + TF.esc(t.desc) + '</p>' +
        (t.tags && t.tags.length ? '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:13px">' +
          t.tags.map(function (g) { return '<span class="chip">' + TF.icon('i-tag') + TF.esc(g) + '</span>'; }).join('') + '</div>' : '') +
      '</section>' +

      '<section class="drawer__sec">' +
        '<div class="drawer__sec-title">' + TF.icon('i-layers') + 'Details</div>' +
        '<div class="meta-grid">' +
          '<div class="meta-item"><div class="meta-item__label">Assigned to</div>' +
            '<div class="meta-item__value">' + TF.avatarHTML(t.assignee, 'sm') + TF.esc(TF.userName(t.assignee)) + '</div></div>' +
          '<div class="meta-item"><div class="meta-item__label">Reported by</div>' +
            '<div class="meta-item__value">' + TF.avatarHTML(t.reporter, 'sm') + TF.esc(TF.userName(t.reporter)) + '</div></div>' +
          '<div class="meta-item"><div class="meta-item__label">Status</div>' +
            '<div class="meta-item__value"><i class="chip__dot" style="color:' + st.color + '"></i>' + st.label + '</div></div>' +
          '<div class="meta-item"><div class="meta-item__label">Priority</div>' +
            '<div class="meta-item__value"><i class="chip__dot" style="color:' + TF.PRIORITY[t.priority].color + '"></i>' + TF.PRIORITY[t.priority].label + '</div></div>' +
          '<div class="meta-item"><div class="meta-item__label">Start date</div>' +
            '<div class="meta-item__value">' + TF.icon('i-calendar') + TF.fmtDate(t.start, true) + '</div></div>' +
          '<div class="meta-item"><div class="meta-item__label">Due date</div>' +
            '<div class="meta-item__value">' + TF.icon('i-clock') + TF.fmtDate(t.due, true) + ', ' + TF.fmtTime(t.due) + '</div></div>' +
        '</div>' +
      '</section>' +

      '<section class="drawer__sec">' +
        '<div class="drawer__sec-title">' + TF.icon('i-trend-up') + 'Progress</div>' +
        '<div class="prog-panel">' +
          '<div class="prog-panel__top">' +
            '<span class="prog-panel__val" id="drawerPct">' + t.progress + '%</span>' +
            '<span class="prog-panel__hint">' + (done ? 'Completed ' + TF.relTime(t.completedAt || Date.now()) : 'Drag or pick a checkpoint') + '</span>' +
          '</div>' +
          TF.progressBar(t.progress, TF.progressTone(t), true) +
          '<input type="range" class="slider" id="drawerSlider" min="0" max="100" step="5" value="' + t.progress + '" style="--p:' + t.progress + '%" />' +
          '<div class="prog-steps">' +
            [25, 50, 75, 100].map(function (v) {
              return '<button class="prog-step' + (t.progress === v ? ' is-on' : '') + '" data-progress="' + v + '">' + v + '%</button>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</section>' +

      (t.attachments && t.attachments.length ? '<section class="drawer__sec">' +
        '<div class="drawer__sec-title">' + TF.icon('i-clip') + 'Attachments (' + t.attachments.length + ')</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px">' + t.attachments.map(function (a) {
          return '<div class="attach"><span class="attach__ico">' + TF.icon('i-clip') + '</span>' +
            '<div><b>' + TF.esc(a.name) + '</b><i>' + TF.esc(a.size) + '</i></div></div>';
        }).join('') + '</div></section>' : '') +

      '<section class="drawer__sec">' +
        '<div class="drawer__sec-title">' + TF.icon('i-comment') + 'Comments (' + (t.comments || []).length + ')</div>' +
        ((t.comments || []).length ? t.comments.slice().reverse().map(function (cm, i) {
          return '<div class="comment" style="animation-delay:' + (i * 60) + 'ms">' + TF.avatarHTML(cm.user, 'sm') +
            '<div class="comment__bubble"><div class="comment__head"><b>' + TF.esc(TF.userName(cm.user)) + '</b>' +
            '<i>' + TF.relTime(cm.ts) + '</i></div><div class="comment__body">' + TF.esc(cm.text) + '</div></div></div>';
        }).join('') : '<p style="font-size:12.5px;color:var(--text-3)">No comments yet — start the conversation.</p>') +
        '<div class="comment-box">' + TF.avatarHTML(TF.CURRENT_USER, 'sm') +
          '<input type="text" id="commentInput" placeholder="Write a comment…" />' +
          '<button class="btn btn--primary btn--icon" data-action="add-comment" aria-label="Send">' + TF.icon('i-send') + '</button>' +
        '</div>' +
      '</section>' +

      '<section class="drawer__sec">' +
        '<div class="drawer__sec-title">' + TF.icon('i-activity') + 'Activity</div>' +
        '<div class="timeline">' + acts.map(TF.timelineItem).join('') + '</div>' +
      '</section>' +
    '</div>' +

    '<footer class="drawer__foot">' +
      '<button class="btn btn--outline" data-action="close-drawer">Close</button>' +
      (done
        ? '<button class="btn btn--soft" data-action="reopen" data-id="' + t.id + '">' + TF.icon('i-refresh') + 'Reopen task</button>'
        : '<button class="btn btn--primary" data-action="complete" data-id="' + t.id + '">' +
            '<span class="btn__text">' + TF.icon('i-check') + 'Mark Completed</span></button>') +
    '</footer>';
  }

  /** Fetches history + comments before rendering the drawer, so the timeline is live. */
  function openTask(id, keepScroll) {
    var t = TF.taskById(id);
    if (!t) return;

    Promise.all([TF.api.taskHistory(id), TF.api.taskComments(id)])
      .then(function (r) {
        t.activity = r[0].map(function (h) {
          return {
            type: h.event === 'created' ? 'created'
                : h.event === 'assigned' || h.event === 'reassigned' ? 'assigned'
                : h.event === 'completed' ? 'done'
                : h.event === 'commented' ? 'comment'
                : h.event === 'priority_changed' ? 'priority'
                : h.event === 'progress_changed' ? 'progress' : 'status',
            user: h.actor ? h.actor.id : null,
            text: TF.historyText(h),
            ts: new Date(h.createdAt).getTime()
          };
        });
        t.comments = r[1].map(function (c) {
          return { user: c.author.id, text: c.body, ts: new Date(c.createdAt).getTime() };
        });
      })
      .catch(function () { /* drawer still opens with task detail only */ })
      .then(function () { renderDrawer(t, keepScroll); });
  }
  TF.openTask = openTask;

  function renderDrawer(t, keepScroll) {
    var drawer = qs('#drawer'), scrim = qs('#scrim');
    var prevScroll = keepScroll ? (qs('#drawerBody') || {}).scrollTop || 0 : 0;

    drawerTask = t.id;
    drawer.hidden = false;
    scrim.hidden = false;
    drawer.innerHTML = drawerHTML(t);

    function reveal() {
      drawer.classList.add('is-on');
      scrim.classList.add('is-on');
      TF.playBars(drawer, 0);
      var body = qs('#drawerBody');
      if (body && prevScroll) body.scrollTop = prevScroll;
    }
    requestAnimationFrame(reveal);
    setTimeout(reveal, 40);   /* fallback when rAF is throttled */
  }

  function closeDrawer() {
    var drawer = qs('#drawer'), scrim = qs('#scrim');
    drawer.classList.remove('is-on');
    scrim.classList.remove('is-on');
    drawerTask = null;
    setTimeout(function () { drawer.hidden = true; scrim.hidden = true; }, 420);
  }
  TF.closeDrawer = closeDrawer;

  /* ==================================================================
     7. CREATE TASK MODAL
     ================================================================== */
  var draft = null;

  function modalHTML() {
    var d = draft;
    return '' +
    '<div class="modal-root__scrim" data-action="close-modal"></div>' +
    '<form class="modal" id="createForm" autocomplete="off">' +
      '<header class="modal__head">' +
        '<div class="modal__title"><span class="modal__title-ico">' + TF.icon('i-sparkle') + '</span>Create a new task</div>' +
        '<p class="modal__sub">Assign work, set a deadline and the team gets notified instantly.</p>' +
        '<button type="button" class="icon-btn modal__close" data-action="close-modal" aria-label="Close">' + TF.icon('i-x') + '</button>' +
      '</header>' +

      '<div class="modal__body">' +
        '<div class="form-grid">' +
          '<label class="field form-row span-2" style="--d:40ms"><span class="field__label">Task title *</span>' +
            '<span class="field__control">' + TF.icon('i-target', 'field__ico') +
            '<input id="fTitle" placeholder="e.g. Verify inbound container CTNR-90114" /></span></label>' +

          '<label class="field form-row span-2" style="--d:80ms"><span class="field__label">Description</span>' +
            '<textarea id="fDesc" placeholder="What needs to happen, and what does done look like?"></textarea></label>' +

          '<div class="form-row span-2" style="--d:120ms">' +
            '<span class="field__label">Assign to</span>' +
            '<div class="assignee-picker" id="fAssignee">' + TF.users.map(function (u) {
              return '<button type="button" class="assignee-opt' + (d.assignee === u.id ? ' is-on' : '') + '" data-user="' + u.id + '">' +
                TF.avatarHTML(u.id, 'xs') + TF.esc(u.name.split(' ')[0]) + '</button>';
            }).join('') + '</div>' +
          '</div>' +

          '<div class="form-row span-2" style="--d:160ms">' +
            '<span class="field__label">Priority</span>' +
            '<div class="prio-picker" id="fPriority">' + TF.PRIORITY_ORDER.map(function (k) {
              var p = TF.PRIORITY[k];
              return '<button type="button" class="prio-btn' + (d.priority === k ? ' is-on' : '') + '" data-prio="' + k + '" style="--pc:' + p.color + '">' +
                '<i class="prio-btn__dot"></i>' + p.label + '</button>';
            }).join('') + '</div>' +
          '</div>' +

          '<label class="field form-row" style="--d:200ms"><span class="field__label">Start date</span>' +
            '<span class="field__control">' + TF.icon('i-calendar', 'field__ico') +
            '<input type="date" id="fStart" value="' + TF.toInputDate(Date.now()) + '" /></span></label>' +

          '<label class="field form-row" style="--d:230ms"><span class="field__label">Due date</span>' +
            '<span class="field__control">' + TF.icon('i-clock', 'field__ico') +
            '<input type="date" id="fDue" value="' + TF.toInputDate(Date.now() + 3 * 86400000) + '" /></span></label>' +

          '<div class="form-row" style="--d:260ms">' +
            '<span class="field__label">Project</span>' +
            /* Input + datalist rather than a select: a closed list can only ever offer
               projects that already exist on some task, so there was no way to start a
               new one. Type a new name or pick an existing one from the same control. */
            '<input class="select" id="fProject" list="projectList" autocomplete="off" ' +
              'placeholder="Type a new project or pick one" />' +
            '<datalist id="projectList">' + TF.PROJECTS.map(function (p) {
              return '<option value="' + TF.esc(p) + '"></option>';
            }).join('') + '</datalist>' +
          '</div>' +

          '<div class="form-row" style="--d:290ms">' +
            '<span class="field__label">Initial progress · <b id="fProgLabel">0%</b></span>' +
            '<input type="range" class="slider" id="fProgress" min="0" max="100" step="5" value="0" style="--p:0%;margin-top:12px" />' +
          '</div>' +

          '<div class="form-row span-2" style="--d:320ms">' +
            '<span class="field__label">Tags</span>' +
            '<div class="tag-input" id="fTags">' +
              '<input type="text" id="fTagInput" placeholder="Type a tag and press Enter…" />' +
            '</div>' +
          '</div>' +

          '<div class="form-row span-2" style="--d:360ms">' +
            '<span class="field__label">Attachments</span>' +
            '<div class="dropzone" data-action="add-file">' + TF.icon('i-clip') +
              '<b>Click to attach a file</b><span>PDF, XLSX, PNG — up to 25 MB (simulated)</span></div>' +
            '<div class="file-chips" id="fFiles"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<footer class="modal__foot">' +
        '<button type="button" class="btn btn--ghost" data-action="close-modal">Cancel</button>' +
        '<button type="submit" class="btn btn--primary" id="submitTask">' +
          '<span class="btn__text">' + TF.icon('i-plus') + 'Create task</span></button>' +
      '</footer>' +
    '</form>';
  }

  function openModal() {
    draft = { assignee: null, priority: 'high', tags: [], files: [], progress: 0 };
    var root = qs('#modalRoot');
    root.hidden = false;
    root.innerHTML = modalHTML();
    function reveal() {
      root.classList.add('is-on');
      var f = qs('#fTitle'); if (f && document.activeElement !== f) f.focus();
    }
    requestAnimationFrame(reveal);
    setTimeout(reveal, 40);
    wireModal();
  }

  function closeModal() {
    var root = qs('#modalRoot');
    root.classList.remove('is-on');
    setTimeout(function () { root.hidden = true; root.innerHTML = ''; }, 320);
  }

  /* ==================================================================
     TEAM MEMBER MODAL  (Manager only)
     ================================================================== */

  /**
   * Add or edit a team member. `userId` null creates, otherwise edits.
   *
   * The Manager check here is courtesy only — it keeps a non-Manager from opening a
   * form the server will refuse anyway. The real gate is `requirePermission('user:create')`
   * on the API, which rejects the request whatever the browser thinks.
   */
  /**
   * Replaces the add-member form with the generated temporary password, so the Manager
   * can copy it and hand it over. Shown whether or not the email succeeded — if it did
   * not, this is the only copy that exists anywhere; the server stores only the hash.
   */
  function showTempPassword(root, name, tempPassword, emailed) {
    root.innerHTML = '' +
    '<div class="modal__scrim" data-close-user></div>' +
    '<div class="modal">' +
      '<header class="modal__head">' +
        '<div><h2 class="modal__title">' + TF.esc(name) + ' was added</h2>' +
        '<p class="modal__sub">' + (emailed
          ? 'Their temporary password was emailed to them. Here it is as well, in case it does not arrive.'
          : 'The email could not be sent, so give them this temporary password directly.') +
        '</p></div>' +
      '</header>' +
      '<div class="modal__body">' +
        (emailed ? '' :
          '<div class="auth__error" style="background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.35);color:#92400e">' +
            'Email delivery is not configured, so nothing was sent. This password is shown only once — ' +
            'copy it now, or you will have to recreate the account.' +
          '</div>') +
        '<label class="field"><span class="field__label">Temporary password</span>' +
          '<span class="field__control">' +
            '<input id="tempPwd" readonly value="' + TF.esc(tempPassword) + '" ' +
              'style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em" />' +
          '</span></label>' +
        '<p class="field__hint">They must change it the first time they sign in.</p>' +
      '</div>' +
      '<footer class="modal__foot">' +
        '<button type="button" class="btn btn--outline" id="copyPwd">Copy password</button>' +
        '<button type="button" class="btn btn--primary" data-close-user>Done</button>' +
      '</footer>' +
    '</div>';

    qsa('[data-close-user]', root).forEach(function (b) {
      b.addEventListener('click', closeModal);
    });

    var input = qs('#tempPwd', root);
    input.focus();
    input.select();

    qs('#copyPwd', root).addEventListener('click', function () {
      input.select();
      var done = function () {
        TF.toast({ type: 'success', title: 'Password copied',
          body: 'Send it to ' + TF.esc(name) + ' through a channel you trust.' });
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(done, function () { document.execCommand('copy'); done(); });
      } else {
        document.execCommand('copy');
        done();
      }
    });
  }

  TF.openUserModal = function (userId) {
    if (!TF.isManager()) {
      TF.toast({ type: 'danger', title: 'Not permitted',
        body: 'Only a Manager can add or edit team members.' });
      return;
    }

    var editing = userId ? TF.userMap[userId] : null;
    var root = qs('#modalRoot');

    var roleOptions = TF.ROLE_ORDER.map(function (r) {
      return '<option value="' + r + '"' +
        (editing && editing.orgRole === r ? ' selected' : '') + '>' +
        TF.esc(TF.ROLE_LABELS[r]) + '</option>';
    }).join('');

    root.hidden = false;
    root.innerHTML = '' +
    '<div class="modal__scrim" data-close-user></div>' +
    '<form class="modal" id="userForm" autocomplete="off">' +
      '<header class="modal__head">' +
        '<div><h2 class="modal__title">' + (editing ? 'Edit team member' : 'Add team member') + '</h2>' +
        '<p class="modal__sub">' + (editing
          ? 'Update this person’s role and details.'
          : 'They receive a temporary password by email and must change it on first sign-in.') +
        '</p></div>' +
        '<button type="button" class="icon-btn" data-close-user aria-label="Close">' + TF.icon('i-x') + '</button>' +
      '</header>' +
      '<div class="modal__body">' +
        '<div class="auth__error" id="userError" hidden></div>' +

        '<label class="field"><span class="field__label">Full name</span>' +
          '<span class="field__control"><input type="text" id="uName" required maxlength="120" value="' +
            (editing ? TF.esc(editing.name) : '') + '" /></span></label>' +

        '<label class="field"><span class="field__label">Email address</span>' +
          '<span class="field__control"><input type="email" id="uEmail" ' +
            (editing
              ? 'disabled value="' + TF.esc(editing.email) + '"'
              : 'required placeholder="name@utopiabrands.com"') +
          ' /></span></label>' +
        (editing ? '<p class="field__hint">Email addresses cannot be changed after the account is created.</p>' : '') +

        '<label class="field"><span class="field__label">Organizational role</span>' +
          '<span class="field__control"><select id="uRole" required>' + roleOptions + '</select></span></label>' +

        '<label class="field"><span class="field__label">Job title <i>(optional)</i></span>' +
          '<span class="field__control"><input type="text" id="uTitle" maxlength="120" value="' +
            (editing && editing.jobTitle ? TF.esc(editing.jobTitle) : '') + '" /></span></label>' +

        '<label class="field"><span class="field__label">Department <i>(optional)</i></span>' +
          '<span class="field__control"><input type="text" id="uDept" maxlength="120" value="' +
            (editing && editing.dept && editing.dept !== '—' ? TF.esc(editing.dept) : '') + '" /></span></label>' +
      '</div>' +
      '<footer class="modal__foot">' +
        '<button type="button" class="btn btn--ghost" data-close-user>Cancel</button>' +
        '<button type="submit" class="btn btn--primary" id="uSubmit">' +
          '<span class="btn__text">' + (editing ? 'Save changes' : 'Create team member') + '</span></button>' +
      '</footer>' +
    '</form>';

    requestAnimationFrame(function () { root.classList.add('is-on'); });
    setTimeout(function () { root.classList.add('is-on'); }, 40);

    qsa('[data-close-user]', root).forEach(function (b) {
      b.addEventListener('click', closeModal);
    });

    qs('#userForm', root).addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = qs('#uSubmit', root);
      var errBox = qs('#userError', root);
      if (btn.classList.contains('is-loading')) return;

      var payload = {
        fullName: qs('#uName', root).value.trim(),
        role: qs('#uRole', root).value,
        jobTitle: qs('#uTitle', root).value.trim() || null,
        department: qs('#uDept', root).value.trim() || null
      };

      errBox.hidden = true;
      btn.classList.add('is-loading');
      btn.innerHTML = '<span class="spinner"></span><span class="btn__text">Saving…</span>';

      var call;
      if (editing) {
        call = TF.api.updateUser(editing.id, payload);
      } else {
        payload.email = qs('#uEmail', root).value.trim().toLowerCase();
        call = TF.api.createUser(payload);
      }

      call.then(function (result) {
        if (editing) {
          closeModal();
          TF.toast({ type: 'success', title: 'Team member updated',
            body: TF.esc(payload.fullName) + '’s details were saved.' });
          return TF.refresh();
        }

        /* Show the temporary password before closing. If the email went out this is a
           convenience; if it did not — SMTP unconfigured or down — it is the only way
           the new member can ever sign in, so it must not be buried in a toast. */
        showTempPassword(root, payload.fullName, result.tempPassword, result.emailed);
        return TF.refresh();
      }).catch(function (err) {
        /* Show the server's reason inline — LAST_MANAGER in particular has to be read,
           not swallowed, or the Manager has no idea why the change was refused. */
        errBox.textContent = err.message;
        errBox.hidden = false;
        btn.classList.remove('is-loading');
        btn.innerHTML = '<span class="btn__text">' +
          (editing ? 'Save changes' : 'Create team member') + '</span>';
      });
    });
  };

  function renderTags() {
    var host = qs('#fTags'), input = qs('#fTagInput');
    if (!host) return;
    qsa('.tag', host).forEach(function (n) { n.remove(); });
    draft.tags.forEach(function (t, i) {
      host.insertBefore(el('<span class="tag">' + TF.esc(t) +
        '<button type="button" data-rm-tag="' + i + '" aria-label="Remove tag">' + TF.icon('i-x') + '</button></span>'), input);
    });
  }

  function renderFiles() {
    var host = qs('#fFiles');
    if (!host) return;
    host.innerHTML = draft.files.map(function (f, i) {
      return '<span class="tag">' + TF.icon('i-clip') + TF.esc(f.name) +
        '<button type="button" data-rm-file="' + i + '" aria-label="Remove">' + TF.icon('i-x') + '</button></span>';
    }).join('');
  }

  var FAKE_FILES = [
    { name: 'container-manifest.pdf', size: '1.8 MB' }, { name: 'rate-sheet-2026.xlsx', size: '412 KB' },
    { name: 'dock-photo-0142.jpg', size: '3.1 MB' }, { name: 'bol-scan.pdf', size: '740 KB' },
    { name: 'inventory-variance.csv', size: '96 KB' }
  ];

  function wireModal() {
    var form = qs('#createForm');
    if (!form) return;

    form.addEventListener('click', function (e) {
      var user = e.target.closest('[data-user]');
      if (user) {
        draft.assignee = user.getAttribute('data-user');
        qsa('.assignee-opt', form).forEach(function (b) { b.classList.toggle('is-on', b === user); });
      }
      var prio = e.target.closest('[data-prio]');
      if (prio) {
        draft.priority = prio.getAttribute('data-prio');
        qsa('.prio-btn', form).forEach(function (b) { b.classList.toggle('is-on', b === prio); });
      }
      var rmTag = e.target.closest('[data-rm-tag]');
      if (rmTag) { draft.tags.splice(parseInt(rmTag.getAttribute('data-rm-tag'), 10), 1); renderTags(); }
      var rmFile = e.target.closest('[data-rm-file]');
      if (rmFile) { draft.files.splice(parseInt(rmFile.getAttribute('data-rm-file'), 10), 1); renderFiles(); }
      if (e.target.closest('[data-action="add-file"]')) {
        var pick = FAKE_FILES[draft.files.length % FAKE_FILES.length];
        if (draft.files.length < 4) { draft.files.push(pick); renderFiles(); }
        else TF.toast({ type: 'warn', title: 'Attachment limit', body: 'This demo caps uploads at four files.', duration: 2600 });
      }
    });

    var tagInput = qs('#fTagInput');
    tagInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        var v = tagInput.value.trim().replace(/,$/, '');
        if (v && draft.tags.indexOf(v) < 0 && draft.tags.length < 6) { draft.tags.push(v); renderTags(); }
        tagInput.value = '';
      } else if (e.key === 'Backspace' && !tagInput.value && draft.tags.length) {
        draft.tags.pop(); renderTags();
      }
    });

    var prog = qs('#fProgress');
    prog.addEventListener('input', function () {
      draft.progress = parseInt(prog.value, 10);
      prog.style.setProperty('--p', draft.progress + '%');
      qs('#fProgLabel').textContent = draft.progress + '%';
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitTask();
    });
  }

  function submitTask() {
    var title = qs('#fTitle').value.trim();
    if (!title) {
      qs('#fTitle').closest('.field__control').style.borderColor = 'var(--c-red)';
      qs('#fTitle').focus();
      TF.toast({ type: 'warn', title: 'Title required', body: 'Give the task a short, clear name.', duration: 2800 });
      return;
    }

    var btn = qs('#submitTask');
    btn.classList.add('is-loading');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span class="btn__text">Creating…</span>';

    function parseDay(str, h) {
      var p = String(str || '').split('-');
      if (p.length !== 3) return null;
      return new Date(+p[0], +p[1] - 1, +p[2], h, 0, 0, 0).getTime();
    }
    var due = parseDay(qs('#fDue').value, 17) || (Date.now() + 3 * 86400000);
    var start = parseDay(qs('#fStart').value, 9) || Date.now();
    var desc = qs('#fDesc').value.trim();
    var project = qs('#fProject').value;
    var assignee = draft.assignee;

    var payload = {
      title: title,
      description: desc || null,
      priority: draft.priority,
      project: project || null,
      tags: draft.tags || [],
      dueAt: due ? new Date(due).toISOString() : null,
      startAt: start ? new Date(start).toISOString() : null
    };

    function resetSubmitBtn() {
      btn.classList.remove('is-loading');
      btn.disabled = false;
      btn.innerHTML = '<span class="btn__text">' + TF.icon('i-plus') + 'Create task</span>';
    }

    TF.api.createTask(payload).then(function (created) {
      if (assignee) return TF.api.assignTask(created.id, assignee);
      return created;
    }).then(function () {
      return TF.refresh();
    }).then(function () {
      TF.burst(btn, 22);
      closeModal();
      TF.toast({
        type: 'success', title: 'Task created',
        body: assignee
          ? '<q>' + TF.esc(title) + '</q> was assigned to <b>' +
            TF.esc(TF.userName(assignee)) + '</b> and an email notification was sent.'
          : '<q>' + TF.esc(title) + '</q> was created.'
      });
    }).catch(function (err) {
      TF.apiError(err, 'Could not create the task');
      resetSubmitBtn();
    });
  }

  /* ==================================================================
     8. SEARCH OVERLAY
     ================================================================== */
  var searchCursor = 0, searchItems = [];

  function openSearch() {
    var ov = qs('#searchOverlay');
    ov.hidden = false;
    ov.classList.remove('is-out');
    var input = qs('#searchInput');
    input.value = '';
    runSearch('');
    setTimeout(function () { input.focus(); }, 60);
  }

  function closeSearch() {
    var ov = qs('#searchOverlay');
    ov.classList.add('is-out');
    setTimeout(function () { ov.hidden = true; ov.classList.remove('is-out'); }, 220);
  }

  function runSearch(q) {
    var host = qs('#searchResults');
    q = q.trim();
    searchItems = [];

    var tasks = (q ? TF.tasks.filter(function (t) {
      var hay = (t.id + ' ' + t.title + ' ' + t.desc + ' ' + (t.tags || []).join(' ') + ' ' +
        t.project + ' ' + TF.userName(t.assignee)).toLowerCase();
      return hay.indexOf(q.toLowerCase()) > -1;
    }).sort(TF.sortByUrgency) : TF.tasks.slice().sort(TF.sortByUrgency)).slice(0, 6);

    var people = q ? TF.users.filter(function (u) {
      return (u.name + ' ' + u.role + ' ' + u.dept).toLowerCase().indexOf(q.toLowerCase()) > -1;
    }).slice(0, 4) : [];

    var projects = q ? TF.PROJECTS.filter(function (p) {
      return p.toLowerCase().indexOf(q.toLowerCase()) > -1;
    }).slice(0, 4) : [];

    var html = '';

    if (tasks.length) {
      html += '<div class="sr-group"><div class="sr-group__label">' + (q ? 'Tasks' : 'Jump back in') + '</div>' +
        tasks.map(function (t, i) {
          var st = TF.STATUS[t.status];
          searchItems.push({ kind: 'task', id: t.id });
          return '<div class="sr-item" data-sr="' + (searchItems.length - 1) + '" data-task="' + t.id + '" ' +
            'style="--src:' + st.color + ';--src-bg:' + st.color + '1f;animation-delay:' + (i * 30) + 'ms">' +
            '<span class="sr-item__ico">' + TF.icon(st.icon) + '</span>' +
            '<div class="sr-item__main"><b>' + TF.highlight(t.title, q) + '</b>' +
            '<i>' + t.id + ' · ' + st.label + ' · ' + TF.esc(TF.userName(t.assignee)) + '</i></div>' +
            TF.prioChip(t.priority) + '</div>';
        }).join('') + '</div>';
    }

    if (people.length) {
      html += '<div class="sr-group"><div class="sr-group__label">People</div>' +
        people.map(function (u) {
          searchItems.push({ kind: 'user', id: u.id });
          return '<div class="sr-item" data-sr="' + (searchItems.length - 1) + '" data-search-user="' + u.id + '" ' +
            'style="--src:' + u.c1 + ';--src-bg:' + u.c1 + '1f">' +
            '<span class="sr-item__ico" style="background:transparent;padding:0">' + TF.avatarHTML(u.id, 'sm') + '</span>' +
            '<div class="sr-item__main"><b>' + TF.highlight(u.name, q) + '</b><i>' + TF.esc(u.role) + ' · ' + TF.esc(u.dept) + '</i></div>' +
            '<span class="chip">' + TF.tasks.filter(function (t) { return t.assignee === u.id; }).length + ' tasks</span></div>';
        }).join('') + '</div>';
    }

    if (projects.length) {
      html += '<div class="sr-group"><div class="sr-group__label">Projects</div>' +
        projects.map(function (p) {
          searchItems.push({ kind: 'project', id: p });
          var n = TF.tasks.filter(function (t) { return t.project === p; }).length;
          return '<div class="sr-item" data-sr="' + (searchItems.length - 1) + '" data-search-project="' + TF.esc(p) + '" ' +
            'style="--src:#8b5cf6;--src-bg:#8b5cf61f">' +
            '<span class="sr-item__ico">' + TF.icon('i-layers') + '</span>' +
            '<div class="sr-item__main"><b>' + TF.highlight(p, q) + '</b><i>' + n + ' tasks on the board</i></div></div>';
        }).join('') + '</div>';
    }

    if (!html) {
      html = TF.emptyState({ icon: 'i-search', title: 'No matches', text: 'Nothing found for “' + TF.esc(q) + '”. Try a task ID, a name or a project.' });
    }

    host.innerHTML = html;
    searchCursor = 0;
    paintCursor();
  }

  function paintCursor() {
    var items = qsa('.sr-item');
    items.forEach(function (n, i) { n.classList.toggle('is-cursor', i === searchCursor); });
    if (items[searchCursor]) items[searchCursor].scrollIntoView({ block: 'nearest' });
  }

  function activateSearchItem(i) {
    var it = searchItems[i];
    if (!it) return;
    closeSearch();
    if (it.kind === 'task') setTimeout(function () { openTask(it.id); }, 180);
    if (it.kind === 'user') {
      TF.state.filters.assignee = it.id;
      TF.state.filters.status = 'all';
      TF.go('alltasks');
    }
    if (it.kind === 'project') {
      TF.state.filters.q = it.id;
      TF.go('alltasks');
    }
  }

  /* ==================================================================
     9. POPOVERS
     ================================================================== */
  function closePops(except) {
    qsa('.pop-wrap').forEach(function (w) { if (w !== except) w.classList.remove('is-open'); });
  }

  /* ==================================================================
     10. GLOBAL EVENTS
     ================================================================== */
  function bind() {
    /* --- theme --- */
    qs('#themeBtn').addEventListener('click', toggleTheme);

    /* --- sidebar collapse --- */
    qs('#collapseBtn').addEventListener('click', function () {
      TF.state.collapsed = !TF.state.collapsed;
      applyChrome(); save();
      setTimeout(movePill, 360);
    });

    qs('#mobileMenuBtn').addEventListener('click', function () {
      qs('#appShell').classList.toggle('is-nav-open');
    });
    qs('#sidebarScrim').addEventListener('click', function () {
      qs('#appShell').classList.remove('is-nav-open');
    });

    /* --- popovers --- */
    qs('#bellBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      var w = e.target.closest('.pop-wrap');
      var open = !w.classList.contains('is-open');
      closePops(w);
      w.classList.toggle('is-open', open);
      if (open) renderNotifPanel();
    });
    qs('#profileBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      var w = e.target.closest('.pop-wrap');
      var open = !w.classList.contains('is-open');
      closePops(w);
      w.classList.toggle('is-open', open);
    });
    qs('#markAllRead').addEventListener('click', function (e) {
      e.stopPropagation();
      TF.notifications.forEach(function (n) { n.read = true; });
      renderNotifPanel(); refreshBadges();
      if (TF.state.view === 'notifications') render();
      TF.toast({ type: 'success', title: 'All caught up', body: 'Every notification is marked as read.', duration: 2600 });
      TF.api.markAllNotificationsRead().catch(function () {});
    });

    /* --- search --- */
    qs('#searchTrigger').addEventListener('click', openSearch);
    qs('#searchClose').addEventListener('click', closeSearch);
    qs('#searchOverlay').addEventListener('click', function (e) {
      if (e.target.id === 'searchOverlay') closeSearch();
    });
    qs('#searchInput').addEventListener('input', TF.debounce(function (e) { runSearch(e.target.value); }, 110));
    qs('#searchInput').addEventListener('keydown', function (e) {
      var max = searchItems.length - 1;
      if (e.key === 'ArrowDown') { e.preventDefault(); searchCursor = Math.min(max, searchCursor + 1); paintCursor(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); searchCursor = Math.max(0, searchCursor - 1); paintCursor(); }
      else if (e.key === 'Enter') { e.preventDefault(); activateSearchItem(searchCursor); }
    });

    /* --- scrim / drawer --- */
    qs('#scrim').addEventListener('click', closeDrawer);

    /* --- keyboard --- */
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (qs('#appShell').hidden) return;
        qs('#searchOverlay').hidden ? openSearch() : closeSearch();
      }
      if (e.key === 'Escape') {
        if (!qs('#searchOverlay').hidden) closeSearch();
        else if (!qs('#modalRoot').hidden) closeModal();
        else if (!qs('#drawer').hidden) closeDrawer();
        else closePops();
      }
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !/input|textarea|select/i.test((document.activeElement || {}).tagName || '')) {
        if (!qs('#appShell').hidden && qs('#modalRoot').hidden) { e.preventDefault(); openModal(); }
      }
    });

    /* --- one delegated click handler for the whole app --- */
    document.addEventListener('click', function (e) {
      var t = e.target;

      if (!t.closest('.pop-wrap')) closePops();

      /* navigation */
      var nav = t.closest('[data-view]');
      if (nav && !t.closest('.drawer')) {
        e.preventDefault();
        closePops();
        TF.go(nav.getAttribute('data-view'));
        return;
      }

      /* actions */
      var act = t.closest('[data-action]');
      if (act) {
        var a = act.getAttribute('data-action');
        if (a === 'create') { e.preventDefault(); closePops(); openModal(); return; }
        if (a === 'close-modal') { e.preventDefault(); closeModal(); return; }
        if (a === 'close-drawer') { e.preventDefault(); closeDrawer(); return; }
        if (a === 'clear-filters') {
          TF.state.filters = { q: '', status: 'all', priority: 'all', assignee: 'all', project: 'all' };
          render();
          TF.toast({ type: 'info', title: 'Filters cleared', duration: 2000 });
          return;
        }
        if (a === 'mark-all') {
          TF.notifications.forEach(function (n) { n.read = true; });
          render(); renderNotifPanel(); refreshBadges();
          TF.api.markAllNotificationsRead().catch(function () {});
          return;
        }
        if (a === 'complete') { completeFromDrawer(act); return; }
        if (a === 'reopen') { toggleComplete(act.getAttribute('data-id')); return; }
        if (a === 'add-comment') { addComment(); return; }
        if (a === 'export') {
          TF.toast({ type: 'info', title: 'Export queued', body: 'PDF export is stubbed in this UI-only demo.', duration: 3000 });
          return;
        }
        if (a === 'save-profile') {
          TF.toast({ type: 'success', title: 'Profile saved', body: 'Your details were updated locally.', duration: 2600 });
          return;
        }
      }

      /* task checkbox */
      var chk = t.closest('[data-toggle]');
      if (chk) { e.preventDefault(); e.stopPropagation(); toggleComplete(chk.getAttribute('data-toggle'), chk); return; }

      /* progress steps inside drawer */
      var step = t.closest('[data-progress]');
      if (step && drawerTask) { setProgress(drawerTask, parseInt(step.getAttribute('data-progress'), 10), step); return; }

      /* search result */
      var sr = t.closest('.sr-item');
      if (sr) { activateSearchItem(parseInt(sr.getAttribute('data-sr'), 10)); return; }

      /* notification click */
      var nt = t.closest('[data-notif]');
      if (nt) {
        var n = TF.notifications.filter(function (x) { return x.id === nt.getAttribute('data-notif'); })[0];
        if (n && !n.read) {
          n.read = true; renderNotifPanel(); refreshBadges(); if (TF.state.view === 'notifications') render();
          TF.api.markNotificationRead(n.id).catch(function () { /* local state already updated */ });
        }
        closePops();
        var tid = nt.getAttribute('data-task');
        if (tid && TF.taskById(tid)) openTask(tid);
        return;
      }

      /* open task */
      var card = t.closest('[data-task]');
      if (card) { openTask(card.getAttribute('data-task')); return; }

      /* employee card → filter their board */
      var emp = t.closest('[data-employee]');
      if (emp) {
        TF.state.filters = { q: '', status: 'all', priority: 'all', project: 'all', assignee: emp.getAttribute('data-employee') };
        TF.go('alltasks');
        TF.toast({ type: 'info', title: 'Filtered by ' + TF.userName(emp.getAttribute('data-employee')), duration: 2400 });
        return;
      }

      /* toolbar segments */
      var scope = t.closest('[data-scope]');
      if (scope) { TF.state.scope = scope.getAttribute('data-scope'); render(); return; }
      var layout = t.closest('[data-layout]');
      if (layout) { TF.state.layout = layout.getAttribute('data-layout'); render(); return; }
      var nf = t.closest('[data-notif-filter]');
      if (nf) { TF.state.notifFilter = nf.getAttribute('data-notif-filter'); render(); return; }

      /* calendar */
      var cal = t.closest('[data-cal]');
      if (cal) {
        var dir = cal.getAttribute('data-cal');
        if (dir === 'today') { TF.state.calYear = now.getFullYear(); TF.state.calMonth = new Date().getMonth(); TF.state.calDir = ''; }
        else {
          TF.state.calMonth += dir === 'next' ? 1 : -1;
          TF.state.calDir = dir === 'next' ? 'slide-left' : 'slide-right';
          if (TF.state.calMonth > 11) { TF.state.calMonth = 0; TF.state.calYear++; }
          if (TF.state.calMonth < 0) { TF.state.calMonth = 11; TF.state.calYear--; }
        }
        render();
        return;
      }

      /* settings */
      var th = t.closest('[data-theme-set]');
      if (th) { TF.state.theme = th.getAttribute('data-theme-set'); applyTheme(); save(); render(); return; }
      var ac = t.closest('[data-accent]');
      if (ac) {
        TF.state.accent = ac.getAttribute('data-accent');
        applyTheme(); save(); render();
        TF.toast({ type: 'magic', title: 'Accent updated', duration: 2000 });
        return;
      }
    });

    /* --- delegated input handler --- */
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (t.id === 'taskSearch') {
        TF.state.filters.q = t.value;
        var pos = t.selectionStart;
        render();
        var again = qs('#taskSearch');
        if (again) { again.focus(); again.setSelectionRange(pos, pos); }
        return;
      }
      if (t.id === 'drawerSlider' && drawerTask) {
        t.style.setProperty('--p', t.value + '%');
        var pct = qs('#drawerPct');
        if (pct) pct.textContent = t.value + '%';
        var fill = qs('.prog-panel .progress__fill');
        if (fill) fill.style.width = t.value + '%';
        return;
      }
      var pref = t.getAttribute && t.getAttribute('data-pref');
      if (pref) {
        if (pref === 'collapsed') { TF.state.collapsed = t.checked; applyChrome(); }
        else TF.state.prefs[pref] = t.checked;
        save();
        return;
      }
    });

    document.addEventListener('change', function (e) {
      var f = e.target.getAttribute && e.target.getAttribute('data-filter');
      if (f) { TF.state.filters[f] = e.target.value; render(); return; }
      if (e.target.id === 'drawerSlider' && drawerTask) {
        setProgress(drawerTask, parseInt(e.target.value, 10), e.target);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.target.id === 'commentInput' && e.key === 'Enter') { e.preventDefault(); addComment(); }
    });

    window.addEventListener('resize', TF.debounce(movePill, 140));
  }

  function completeFromDrawer(btn) {
    var id = btn.getAttribute('data-id');
    if (btn.classList.contains('is-loading')) return;
    btn.classList.add('is-loading');
    btn.innerHTML = '<span class="spinner"></span><span class="btn__text">Completing…</span>';
    setTimeout(function () {
      setProgress(id, 100, btn);
      var ring = qs('.drawer .prog-panel');
      if (ring) TF.burst(ring, 20);
    }, 620);
  }

  function addComment() {
    var input = qs('#commentInput');
    if (!input || !drawerTask) return;
    var v = input.value.trim();
    if (!v) return;

    TF.api.addComment(drawerTask, v).then(function () {
      return TF.api.taskComments(drawerTask);
    }).then(function (comments) {
      var t = TF.taskById(drawerTask);
      if (t) {
        t.comments = comments.map(function (c) {
          return { user: c.author.id, text: c.body, ts: new Date(c.createdAt).getTime() };
        });
      }
      openTask(drawerTask, true);
      TF.toast({ type: 'success', title: 'Comment posted', body: 'Your note is visible to the assignee.', duration: 2600 });
      setTimeout(function () { var i = qs('#commentInput'); if (i) i.focus(); }, 60);
    }).catch(function (err) {
      TF.apiError(err, 'Could not post your comment');
    });
  }

  /* ==================================================================
     11. BOOT
     ================================================================== */
  var BOOT_STEPS = [
    { p: 20, t: 'Preparing your workspace…' },
    { p: 45, t: 'Signing you in…' },
    { p: 70, t: 'Loading tasks…' },
    { p: 90, t: 'Loading team activity…' },
    { p: 100, t: 'Ready' }
  ];

  function runBoot() {
    var bar = qs('#bootBar'), txt = qs('#bootText'), i = 0;
    (function step() {
      if (i >= BOOT_STEPS.length) {
        setTimeout(finishBoot, 260);
        return;
      }
      bar.style.width = BOOT_STEPS[i].p + '%';
      txt.textContent = BOOT_STEPS[i].t;
      i++;
      setTimeout(step, TF.reduceMotion ? 60 : 330);
    }());
  }

  function finishBoot() {
    var boot = qs('#bootScreen');
    boot.classList.add('is-out');
    setTimeout(function () { boot.hidden = true; }, 700);

    // A valid cookie means the session survives a reload — no localStorage flag needed.
    TF.api.me().then(function (me) {
      TF.session.me = me;
      return enterApp(true);
    }).catch(function () {
      showAuth();
    });
  }

  TF.session = { me: null };

  TF.isManager = function () {
    return !!(TF.session.me && TF.session.me.role === 'manager');
  };

  function showAuth(message) {
    var app = qs('#appShell');
    if (app) app.hidden = true;

    TF.session.me = null;
    var auth = qs('#authScreen');
    auth.hidden = false;
    auth.classList.remove('is-out');

    var errBox = qs('#loginError');
    if (message) { errBox.textContent = message; errBox.hidden = false; }
    else { errBox.hidden = true; }

    var btn = qs('#loginBtn');
    btn.classList.remove('is-loading');
    btn.innerHTML = '<span class="btn__text">Sign in</span>' + TF.icon('i-arrow-right', 'btn__arrow');

    var pwd = qs('#loginPassword');
    if (pwd) pwd.value = '';
    TF.playCounters(auth);
  }
  TF.showAuth = showAuth;

  /** Routes a user with a temporary password to the change-password screen only. */
  function forcePasswordChange() {
    qs('#appShell').hidden = false;
    applyChrome();
    TF.state.view = 'password';
    render();
    TF.toast({
      type: 'warn', title: 'Change your password',
      body: 'Your account uses a temporary password. Set a new one to continue.', duration: 6000
    });
  }
  TF.forcePasswordChange = forcePasswordChange;

  function enterApp(skipAnim) {
    if (TF.session.me && TF.session.me.mustChangePassword) {
      forcePasswordChange();
      return Promise.resolve();
    }

    return TF.hydrate().then(function () {
      qs('#appShell').hidden = false;
      applyChrome();
      render();
      renderNotifPanel();
      refreshBadges();

      if (!skipAnim) {
        setTimeout(function () {
          var unread = TF.notifications.filter(function (n) { return !n.read; }).length;
          TF.toast({
            type: 'magic',
            title: 'Welcome back, ' + TF.esc(TF.session.me.fullName.split(' ')[0]),
            body: unread + ' unread notification' + (unread === 1 ? '' : 's') +
                  ' and ' + TF.counts().dueToday + ' task' + (TF.counts().dueToday === 1 ? '' : 's') + ' due today.'
          });
        }, 700);
      }
    }).catch(function (err) {
      TF.apiError(err, 'Could not load your workspace');
      if (err.code === 'UNAUTHORIZED') showAuth('Your session has ended. Please sign in again.');
    });
  }
  TF.enterApp = enterApp;

  function bindAuth() {
    qs('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = qs('#loginBtn');
      if (btn.classList.contains('is-loading')) return;

      var email = qs('#loginEmail').value.trim();
      var password = qs('#loginPassword').value;
      var errBox = qs('#loginError');

      errBox.hidden = true;
      btn.classList.add('is-loading');
      btn.innerHTML = '<span class="spinner"></span><span class="btn__text">Signing in…</span>';

      TF.api.login(email, password).then(function (data) {
        TF.session.me = data.user;
        qs('#authScreen').classList.add('is-out');
        setTimeout(function () { qs('#authScreen').hidden = true; }, 660);
        return enterApp(false);
      }).catch(function (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
        btn.classList.remove('is-loading');
        btn.innerHTML = '<span class="btn__text">Sign in</span>' + TF.icon('i-arrow-right', 'btn__arrow');
        qs('#loginPassword').value = '';
      });
    });

    qs('#logoutBtn').addEventListener('click', function () {
      closePops();
      TF.api.logout().catch(function () { /* clearing the session locally is enough */ })
        .then(function () { showAuth(); });
    });
  }

  /* ---------- go ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    load();
    applyTheme();
    applyChrome();
    bind();
    bindAuth();
    runBoot();
  });

}(window.TF));
