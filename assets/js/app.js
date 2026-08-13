/* ==========================================================================
   TaskFlow — application controller
   State, routing, drawer, modal, search, notifications, demo interactions.
   ========================================================================== */
(function (TF) {
  'use strict';

  var KEY = 'taskflow.v1';
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
    filters: { q: '', status: 'all', priority: 'all', assignee: 'all' },
    calYear: now.getFullYear(),
    calMonth: now.getMonth(),
    calDir: '',
    seq: 1064,
    session: false,
    prefs: { nAssign: true, nDue: true, nComment: true, nDigest: false, motion: true, compact: false }
  };

  /* difference between the seeded slice and the full 128-task workspace */
  var OFFSET = {};
  ['assigned', 'progress', 'hold', 'completed', 'overdue', 'dueToday', 'onTime'].forEach(function (k) {
    OFFSET[k] = Math.max(0, TF.KPI_TARGET[k] - TF.SEED_COUNTS[k]);
  });

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        theme: TF.state.theme, accent: TF.state.accent, collapsed: TF.state.collapsed,
        prefs: TF.state.prefs, seq: TF.state.seq, session: TF.state.session,
        tasks: TF.tasks, notifications: TF.notifications
      }));
    } catch (e) { /* storage unavailable — demo still works in memory */ }
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
      if (d.seq) TF.state.seq = d.seq;
      if (d.session) TF.state.session = d.session;
      if (d.tasks && d.tasks.length) TF.tasks = d.tasks;
      if (d.notifications && d.notifications.length) TF.notifications = d.notifications;
    } catch (e) { /* corrupt payload — fall back to seed data */ }
  }

  /* ==================================================================
     2. DERIVED DATA
     ================================================================== */
  TF.counts = function () {
    var c = { assigned: 0, progress: 0, hold: 0, completed: 0, overdue: 0, dueToday: 0, onTime: 0 };
    var t0 = TF.startOfDay(Date.now()), t1 = t0 + 86400000;
    TF.tasks.forEach(function (t) {
      if (c[t.status] === undefined) c[t.status] = 0;
      c[t.status]++;
      if (t.due >= t0 && t.due < t1 && t.status !== 'completed') c.dueToday++;
      if (t.status === 'completed' && t.onTime) c.onTime++;
    });
    Object.keys(OFFSET).forEach(function (k) { c[k] += OFFSET[k]; });
    c.total = c.assigned + c.progress + c.hold + c.completed + c.overdue;
    c.rate = c.completed ? Math.round((c.onTime / c.completed) * 100) : 0;

    var num = 0, den = 0;
    TF.users.forEach(function (u) {
      var s = TF.teamStats[u.id];
      num += s.tasks * s.score; den += s.tasks;
    });
    c.teamScore = Math.round(num / (den || 1));
    c.productivity = Math.round((c.teamScore + c.rate) / 2);
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
      if (!q) return true;
      var hay = (t.id + ' ' + t.title + ' ' + t.desc + ' ' + (t.tags || []).join(' ') + ' ' +
        t.project + ' ' + TF.userName(t.assignee)).toLowerCase();
      return hay.indexOf(q) > -1;
    });
  };

  TF.recentActivity = function (n) {
    var out = [];
    TF.tasks.forEach(function (t) {
      (t.activity || []).forEach(function (a) {
        out.push({ type: a.type, user: a.user, text: a.text, ts: a.ts, taskId: t.id, taskTitle: t.title });
      });
    });
    out.sort(function (a, b) { return b.ts - a.ts; });
    return out.slice(0, n || 20);
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
    calendar: 'Calendar', notifications: 'Notifications', reports: 'Reports', activity: 'Activity', settings: 'Settings' };

  function render() {
    var name = TF.state.view;
    var view = TF.Views[name] || TF.Views.dashboard;
    var host = qs('#viewport');
    host.innerHTML = view();
    document.title = VIEW_TITLES[name] + ' · TaskFlow';

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
    if (drawerTask === id) openTask(id, true);
    render();
    if (source && value === 100) TF.burst(source, 18);
  }
  TF.setProgress = setProgress;

  function toggleComplete(id, source) {
    var t = TF.taskById(id);
    if (!t) return;
    if (t.status === 'completed') {
      setProgress(id, 0);
      TF.toast({ type: 'info', title: 'Task reopened', body: '<q>' + TF.esc(t.title) + '</q> is back on the board.', duration: 3000 });
    } else {
      if (source) {
        source.classList.add('is-on');
        TF.burst(source, 14);
      }
      setTimeout(function () { setProgress(id, 100); }, 260);
    }
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

  function openTask(id, keepScroll) {
    var t = TF.taskById(id);
    if (!t) return;
    var drawer = qs('#drawer'), scrim = qs('#scrim');
    var prevScroll = keepScroll ? (qs('#drawerBody') || {}).scrollTop || 0 : 0;

    drawerTask = id;
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
  TF.openTask = openTask;

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
            '<select class="select" id="fProject">' + TF.PROJECTS.map(function (p) {
              return '<option' + (p === 'Inbound Operations' ? ' selected' : '') + '>' + TF.esc(p) + '</option>';
            }).join('') + '</select>' +
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
    draft = { assignee: 'u-john', priority: 'high', tags: [], files: [], progress: 0 };
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

    var t = {
      id: 'TF-' + (++TF.state.seq),
      title: title,
      desc: qs('#fDesc').value.trim() || 'No description provided.',
      status: draft.progress >= 100 ? 'completed' : draft.progress > 0 ? 'progress' : 'assigned',
      priority: draft.priority,
      progress: draft.progress,
      assignee: draft.assignee,
      reporter: TF.CURRENT_USER,
      project: qs('#fProject').value,
      start: start,
      due: due,
      created: Date.now(),
      tags: draft.tags.slice(),
      attachments: draft.files.slice(),
      comments: [],
      activity: []
    };
    if (t.status === 'completed') { t.completedAt = Date.now(); t.onTime = Date.now() <= t.due; }

    t.activity.push({ type: 'created', user: TF.CURRENT_USER, text: '{user} created the task', ts: Date.now() });
    t.activity.push({ type: 'assigned', user: TF.CURRENT_USER, text: 'Assigned to <b>' + TF.esc(TF.userName(t.assignee)) + '</b>', ts: Date.now() + 1 });

    setTimeout(function () {
      /* success animation inside the modal */
      var modal = qs('.modal');
      if (modal) {
        var burst = el('<div class="success-burst">' +
          '<div class="success-burst__ring">' + TF.icon('i-check') + '</div>' +
          '<b>Task created</b><p>' + TF.esc(title) + ' → ' + TF.esc(TF.userName(t.assignee)) + '</p></div>');
        modal.appendChild(burst);
        TF.burst(burst.querySelector('.success-burst__ring'), 22);
      }

      TF.tasks.unshift(t);
      save();

      setTimeout(function () {
        closeModal();
        if (TF.state.view === 'dashboard' || TF.state.view === 'mytasks' || TF.state.view === 'alltasks' || TF.state.view === 'calendar') render();
        else TF.go('alltasks');

        TF.notify({ type: 'assigned', title: 'New task assigned',
          body: TF.esc(TF.userName(TF.CURRENT_USER)) + ' assigned <q>' + TF.esc(t.title) + '</q> to ' + TF.esc(TF.userName(t.assignee)),
          task: t.id });

        TF.toast({ type: 'task', icon: 'i-target', title: '🎯 Task assigned',
          body: '<q>' + TF.esc(t.title) + '</q> assigned to ' + TF.esc(TF.userName(t.assignee)) + '.',
          onClick: function () { openTask(t.id); } });
      }, 1150);
    }, 850);
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
            '<span class="chip">' + TF.teamStats[u.id].tasks + ' tasks</span></div>';
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
      renderNotifPanel(); refreshBadges(); save();
      if (TF.state.view === 'notifications') render();
      TF.toast({ type: 'success', title: 'All caught up', body: 'Every notification is marked as read.', duration: 2600 });
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
          TF.state.filters = { q: '', status: 'all', priority: 'all', assignee: 'all' };
          render();
          TF.toast({ type: 'info', title: 'Filters cleared', duration: 2000 });
          return;
        }
        if (a === 'mark-all') {
          TF.notifications.forEach(function (n) { n.read = true; });
          save(); render(); renderNotifPanel(); refreshBadges();
          return;
        }
        if (a === 'complete') { completeFromDrawer(act); return; }
        if (a === 'reopen') { setProgress(act.getAttribute('data-id'), 0); return; }
        if (a === 'add-comment') { addComment(); return; }
        if (a === 'reset-demo') { resetDemo(); return; }
        if (a === 'export') {
          TF.toast({ type: 'info', title: 'Export queued', body: 'PDF export is stubbed in this UI-only demo.', duration: 3000 });
          return;
        }
        if (a === 'save-profile') {
          TF.toast({ type: 'success', title: 'Profile saved', body: 'Your details were updated locally.', duration: 2600 });
          return;
        }
        if (a === 'soon') {
          TF.toast({ type: 'info', title: 'Not in this demo', body: 'This control is visual only for now.', duration: 2400 });
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
        if (n && !n.read) { n.read = true; save(); renderNotifPanel(); refreshBadges(); if (TF.state.view === 'notifications') render(); }
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
        TF.state.filters = { q: '', status: 'all', priority: 'all', assignee: emp.getAttribute('data-employee') };
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
    var t = TF.taskById(drawerTask);
    t.comments = t.comments || [];
    t.comments.push({ user: TF.CURRENT_USER, text: v, ts: Date.now() });
    t.activity.push({ type: 'comment', user: TF.CURRENT_USER, text: 'Left a comment on the task', ts: Date.now() });
    save();
    openTask(drawerTask, true);
    TF.toast({ type: 'success', title: 'Comment posted', body: 'Your note is visible to the assignee.', duration: 2600 });
    setTimeout(function () { var i = qs('#commentInput'); if (i) i.focus(); }, 60);
  }

  function resetDemo() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    TF.toast({ type: 'warn', title: 'Resetting workspace', body: 'Reloading the seeded demo data…', duration: 1600 });
    setTimeout(function () { location.reload(); }, 900);
  }

  /* ==================================================================
     11. BOOT
     ================================================================== */
  var BOOT_STEPS = [
    { p: 18, t: 'Preparing your workspace…' },
    { p: 42, t: 'Loading 128 tasks…' },
    { p: 66, t: 'Syncing team activity…' },
    { p: 88, t: 'Rendering analytics…' },
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
    if (TF.state.session) enterApp(true);
    else showAuth();
  }

  function showAuth() {
    var auth = qs('#authScreen');
    auth.hidden = false;
    TF.playCounters(auth);
  }

  function enterApp(skipAnim) {
    var app = qs('#appShell');
    app.hidden = false;
    TF.state.session = true;
    save();
    applyChrome();
    render();
    renderNotifPanel();
    refreshBadges();

    if (!skipAnim) {
      setTimeout(function () {
        TF.toast({ type: 'magic', title: 'Welcome back, Rizwan',
          body: 'You have ' + TF.notifications.filter(function (n) { return !n.read; }).length +
            ' unread notifications and ' + TF.counts().dueToday + ' tasks due today.' });
      }, 700);
      setTimeout(function () {
        var overdue = TF.tasks.filter(function (t) { return t.status === 'overdue'; })[0];
        if (overdue) {
          TF.toast({ type: 'danger', title: 'Overdue task needs attention',
            body: '<q>' + TF.esc(overdue.title) + '</q> is past its due date.',
            onClick: function () { openTask(overdue.id); } });
        }
      }, 3400);
    }
  }

  function bindAuth() {
    qs('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = qs('#loginBtn');
      if (btn.classList.contains('is-loading')) return;
      btn.classList.add('is-loading');
      btn.innerHTML = '<span class="spinner"></span><span class="btn__text">Opening workspace…</span>';
      setTimeout(function () {
        qs('#authScreen').classList.add('is-out');
        setTimeout(function () { qs('#authScreen').hidden = true; }, 660);
        enterApp(false);
      }, 900);
    });

    qs('#logoutBtn').addEventListener('click', function () {
      closePops();
      TF.state.session = false;
      save();
      qs('#appShell').hidden = true;
      var auth = qs('#authScreen');
      auth.hidden = false;
      auth.classList.remove('is-out');
      var btn = qs('#loginBtn');
      btn.classList.remove('is-loading');
      btn.innerHTML = '<span class="btn__text">Continue to Dashboard</span>' + TF.icon('i-arrow-right', 'btn__arrow');
      TF.playCounters(auth);
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
