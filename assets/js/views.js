/* ==========================================================================
   TaskFlow — screens. Each view returns HTML; `after` wires up behaviour.
   ========================================================================== */
(function (TF) {
  'use strict';

  var V = {};
  TF.Views = V;

  /* ==================================================================
     Shared task atoms
     ================================================================== */
  TF.taskCardHTML = function (t, i) {
    var st = TF.STATUS[t.status], pr = TF.PRIORITY[t.priority];
    var done = t.status === 'completed';
    return '' +
      '<article class="tcard' + (done ? ' is-done' : '') + '" data-task="' + t.id + '" style="--tc:' + st.color + ';--d:' + (i * 45) + 'ms">' +
        '<button class="tcheck' + (done ? ' is-on' : '') + '" data-toggle="' + t.id + '" aria-label="Toggle complete">' + TF.icon('i-check') + '</button>' +
        '<div class="tcard__main">' +
          '<div class="tcard__row1">' +
            '<span class="tcard__id">' + t.id + '</span>' +
            '<span class="tcard__title">' + TF.esc(t.title) + '</span>' +
            TF.prioChip(t.priority) +
          '</div>' +
          '<p class="tcard__desc">' + TF.esc(t.desc) + '</p>' +
          '<div class="tcard__meta">' +
            TF.statusChip(t.status) +
            '<span class="tcard__due ' + TF.dueTone(t) + '">' + TF.icon('i-clock') + TF.fmtDue(t.due, done) + '</span>' +
            '<span class="tcard__prog">' + TF.progressBar(t.progress, TF.progressTone(t)) + '<b>' + t.progress + '%</b></span>' +
          '</div>' +
        '</div>' +
        '<div class="tcard__right">' +
          '<div class="tcard__actions">' +
            '<button class="mini-btn tip" data-tip="Open details" data-open="' + t.id + '">' + TF.icon('i-edit') + '</button>' +
          '</div>' +
          TF.avatarHTML(t.assignee, 'sm') +
          '<span class="tcard__go">' + TF.icon('i-arrow-right') + '</span>' +
        '</div>' +
      '</article>';
  };

  TF.boardCardHTML = function (t, i) {
    var st = TF.STATUS[t.status];
    return '' +
      '<article class="bcard" data-task="' + t.id + '" style="--d:' + (i * 40) + 'ms">' +
        '<div class="bcard__top"><span class="tcard__id">' + t.id + '</span>' + TF.prioChip(t.priority) + '</div>' +
        '<h4 class="bcard__title">' + TF.esc(t.title) + '</h4>' +
        '<p class="bcard__desc">' + TF.esc(t.desc) + '</p>' +
        TF.progressBar(t.progress, TF.progressTone(t)) +
        '<div class="bcard__foot">' +
          '<span class="tcard__due ' + TF.dueTone(t) + '">' + TF.icon('i-clock') + TF.fmtDue(t.due, t.status === 'completed') + '</span>' +
          TF.avatarHTML(t.assignee, 'xs') +
        '</div>' +
      '</article>';
  };

  function toolbar(opts) {
    var f = TF.state.filters;
    var people = TF.users.map(function (u) {
      return '<option value="' + u.id + '"' + (f.assignee === u.id ? ' selected' : '') + '>' + TF.esc(u.name) + '</option>';
    }).join('');
    var statuses = TF.STATUS_ORDER.map(function (k) {
      return '<option value="' + k + '"' + (f.status === k ? ' selected' : '') + '>' + TF.STATUS[k].label + '</option>';
    }).join('');
    var prios = TF.PRIORITY_ORDER.slice().reverse().map(function (k) {
      return '<option value="' + k + '"' + (f.priority === k ? ' selected' : '') + '>' + TF.PRIORITY[k].label + '</option>';
    }).join('');

    return '<div class="toolbar">' +
      (opts.scope ? '<div class="seg" data-seg="scope">' +
        ['mine:Assigned to me', 'created:Created by me', 'all:Everything'].map(function (s) {
          var p = s.split(':');
          return '<button class="seg__btn' + (TF.state.scope === p[0] ? ' is-on' : '') + '" data-scope="' + p[0] + '">' + p[1] + '</button>';
        }).join('') + '</div>' : '') +
      '<label class="toolbar__search">' + TF.icon('i-search') +
        '<input type="text" id="taskSearch" placeholder="Filter tasks…" value="' + TF.esc(f.q) + '" />' +
      '</label>' +
      '<select class="filter-select" data-filter="status"><option value="all">All statuses</option>' + statuses + '</select>' +
      '<select class="filter-select" data-filter="priority"><option value="all">All priorities</option>' + prios + '</select>' +
      (opts.people !== false ? '<select class="filter-select" data-filter="assignee"><option value="all">Everyone</option>' + people + '</select>' : '') +
      '<div class="seg" data-seg="layout">' +
        '<button class="seg__btn' + (TF.state.layout === 'list' ? ' is-on' : '') + '" data-layout="list">' + TF.icon('i-alltasks') + 'List</button>' +
        '<button class="seg__btn' + (TF.state.layout === 'board' ? ' is-on' : '') + '" data-layout="board">' + TF.icon('i-grid') + 'Board</button>' +
      '</div>' +
      '</div>';
  }

  function collection(tasks, emptyOpts) {
    if (!tasks.length) return TF.emptyState(emptyOpts);
    if (TF.state.layout === 'board') {
      return '<div class="board">' + TF.STATUS_ORDER.map(function (k) {
        var st = TF.STATUS[k];
        var group = tasks.filter(function (t) { return t.status === k; });
        return '<section class="col">' +
          '<header class="col__head"><i class="col__dot" style="--cc:' + st.color + '"></i><b>' + st.label + '</b>' +
          '<span class="col__count">' + group.length + '</span></header>' +
          '<div class="col__list">' +
            (group.length ? group.map(TF.boardCardHTML).join('')
              : '<p style="font-size:12px;color:var(--text-3);padding:10px 4px">Nothing here.</p>') +
          '</div></section>';
      }).join('') + '</div>';
    }
    return '<div class="task-list">' + tasks.map(TF.taskCardHTML).join('') + '</div>';
  }

  /* ==================================================================
     DASHBOARD
     ================================================================== */
  function statTile(o, i) {
    return '<article class="kpi kpi--flat" style="--kc:' + o.color + ';--d:' + (i * 60) + 'ms"' +
      (o.view ? ' data-view="' + o.view + '"' : '') +
      (o.status ? ' data-status-tile="' + o.status + '"' : '') + '>' +
      '<div class="kpi__top">' +
        '<span class="kpi__ico">' + TF.icon(o.icon) + '</span>' +
      '</div>' +
      '<div class="kpi__value" data-countup="' + o.value + '">0</div>' +
      '<div class="kpi__label">' + o.label + '</div>' +
    '</article>';
  }

  function taskRow(t, i) {
    return '' +
    '<article class="tcard" data-task="' + t.id + '" style="--tc:' + TF.STATUS[t.status].color + ';--d:' + (i * 50) + 'ms">' +
      '<button class="tcheck" data-toggle="' + t.id + '" aria-label="Complete task">' + TF.icon('i-check') + '</button>' +
      '<div class="tcard__main">' +
        '<div class="tcard__row1"><span class="tcard__title">' + TF.esc(t.title) + '</span></div>' +
        '<div class="tcard__meta" style="margin-top:7px">' +
          '<span class="tcard__due" style="display:inline-flex;align-items:center;gap:6px">' +
            TF.avatarHTML(t.assignee, 'xs') + TF.esc(TF.userName(t.assignee)) + '</span>' +
          TF.prioChip(t.priority) +
        '</div>' +
        '<div class="tcard__meta" style="margin-top:8px">' +
          '<span class="tcard__due ' + TF.dueTone(t) + '">' + TF.icon('i-clock') + TF.fmtDue(t.due) + '</span>' +
          '<span class="tcard__prog">' + TF.progressBar(t.progress, TF.progressTone(t)) + '<b>' + t.progress + '%</b></span>' +
        '</div>' +
      '</div>' +
      '<div class="tcard__right"><span class="tcard__go">' + TF.icon('i-arrow-right') + '</span></div>' +
    '</article>';
  }

  function listCard(opts) {
    return '' +
    '<section class="card">' +
      '<div class="card__head"><div><h3>' + opts.title + '</h3><p>' + opts.sub + '</p></div>' +
        (opts.link ? '<button class="btn btn--ghost btn--tiny" data-view="' + opts.link +
          '">All' + TF.icon('i-chev-right') + '</button>' : '') +
      '</div>' +
      '<div class="card__body">' +
        (opts.tasks.length
          ? '<div class="task-list">' + opts.tasks.map(taskRow).join('') + '</div>'
          : TF.emptyState({ icon: opts.emptyIcon || 'i-check', title: opts.emptyTitle, text: opts.emptyText })) +
      '</div>' +
    '</section>';
  }

  V.dashboard = function () {
    var c = TF.counts();
    var hour = new Date().getHours();
    var greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    var me = TF.session.me ? TF.session.me.fullName.split(' ')[0] : 'there';

    var open = function (t) { return t.status !== 'completed' && t.status !== 'cancelled'; };
    var t0 = TF.startOfDay(Date.now()), t1 = t0 + 86400000, t7 = t0 + 8 * 86400000;

    var dueToday = TF.tasks.filter(function (t) { return open(t) && t.due && t.due < t1; })
      .sort(function (a, b) { return a.due - b.due; }).slice(0, 6);

    var dueSoon = TF.tasks.filter(function (t) { return open(t) && t.due >= t1 && t.due < t7; })
      .sort(function (a, b) { return a.due - b.due; }).slice(0, 6);

    var recentlyAssigned = TF.tasks.filter(function (t) { return t.assignedAt; })
      .sort(function (a, b) { return b.assignedAt - a.assignedAt; }).slice(0, 6);

    var mine = TF.tasks.filter(function (t) { return t.assignee === TF.CURRENT_USER && open(t); })
      .sort(TF.sortByUrgency).slice(0, 6);

    var tiles = [
      { label: 'Total Tasks',    value: c.total,        icon: 'i-layers',     color: '#8b5cf6', view: 'alltasks' },
      { label: 'Pending',        value: c.pending,      icon: 'i-inbox',      color: '#64748b', status: 'assigned' },
      { label: 'In Progress',    value: c.progress,     icon: 'i-dot-circle', color: '#3b82f6', status: 'progress' },
      { label: 'Completed',      value: c.completed,    icon: 'i-check',      color: '#10b981', status: 'completed' },
      { label: 'Overdue',        value: c.overdue,      icon: 'i-alert',      color: '#ef4444', status: 'overdue' },
      { label: 'Assigned to Me', value: c.assignedToMe, icon: 'i-user',       color: '#06b6d4', view: 'mytasks' },
      { label: 'Due Today',      value: c.dueToday,     icon: 'i-clock',      color: '#f59e0b' },
      { label: 'Due Soon',       value: c.dueSoon,      icon: 'i-calendar',   color: '#a78bfa' }
    ];

    return '' +
    '<div class="view">' +
      '<div class="page-head">' +
        '<div>' +
          '<h1 class="page-head__title">' + greet + ', ' + TF.esc(me) + ' <span class="wave">👋</span></h1>' +
          '<p class="page-head__sub">Here\'s what\'s happening with your team\'s work today.</p>' +
        '</div>' +
        '<div class="page-head__actions">' +
          '<span class="chip"><i class="chip__dot" style="color:var(--c-green)"></i>' +
            TF.DOW[new Date().getDay()] + ', ' + TF.fmtDate(Date.now(), true) + '</span>' +
          '<button class="btn btn--primary btn--sm" data-action="create">' + TF.icon('i-plus') + 'Create Task</button>' +
        '</div>' +
      '</div>' +

      '<div class="kpis kpis--8">' + tiles.map(statTile).join('') + '</div>' +

      '<div class="dash-grid section">' +
        '<div class="dash-col">' +
          listCard({ title: 'Due Today', sub: c.dueToday + ' open · earliest first', tasks: dueToday,
            emptyTitle: 'Nothing due today', emptyText: 'No open task reaches its due time today.' }) +
          listCard({ title: 'Due Soon', sub: 'Open tasks due in the next 7 days', tasks: dueSoon,
            emptyIcon: 'i-calendar', emptyTitle: 'Nothing due this week',
            emptyText: 'No open task falls due over the next seven days.' }) +
          listCard({ title: 'Recently Assigned', sub: 'Newest assignments across the team',
            tasks: recentlyAssigned, link: 'alltasks',
            emptyIcon: 'i-inbox', emptyTitle: 'No assignments yet',
            emptyText: 'Assigned tasks appear here as soon as someone hands work over.' }) +
        '</div>' +

        '<div class="dash-col">' +
          listCard({ title: 'My Tasks', sub: mine.length + ' open · sorted by urgency', tasks: mine, link: 'mytasks',
            icon: 'i-target', emptyTitle: "🎯 You're all caught up!",
            emptyText: 'No pending tasks at the moment. New work assigned to you lands right here.' }) +

          '<section class="card">' +
            '<div class="card__head"><div><h3>Recent Activity</h3><p>Across the workspace</p></div>' +
              '<button class="btn btn--ghost btn--tiny" data-view="activity">All' + TF.icon('i-chev-right') + '</button></div>' +
            '<div class="card__body">' +
              '<div class="timeline">' + TF.recentActivity(6).map(TF.timelineItem).join('') + '</div>' +
            '</div>' +
          '</section>' +
        '</div>' +
      '</div>' +
    '</div>';
  };

  V.dashboard.after = function (root) {
    // Status tiles jump to the filtered task list.
    TF.qsa('[data-status-tile]', root).forEach(function (tile) {
      tile.style.cursor = 'pointer';
      tile.addEventListener('click', function () {
        TF.state.filters.status = tile.getAttribute('data-status-tile');
        TF.go('alltasks');
      });
    });

    /* No data fetching here. This hook runs on every render, so fetching and then
       calling TF.render() re-entered itself forever — the dashboard visibly flickered.
       TF.dashboardData is loaded once by TF.hydrate() before the first paint. */
  };

  /* ==================================================================
     MY TASKS
     ================================================================== */
  V.mytasks = function () {
    var scope = TF.state.scope;
    var base = TF.tasks.filter(function (t) {
      if (scope === 'mine') return t.assignee === TF.CURRENT_USER;
      if (scope === 'created') return t.reporter === TF.CURRENT_USER;
      return t.assignee === TF.CURRENT_USER || t.reporter === TF.CURRENT_USER;
    });
    var list = TF.applyFilters(base).sort(TF.sortByUrgency);
    var open = base.filter(function (t) { return t.status !== 'completed'; }).length;

    return '<div class="view">' +
      '<div class="page-head">' +
        '<div><h1 class="page-head__title">My Tasks</h1>' +
        '<p class="page-head__sub">' + open + ' open · ' + (base.length - open) + ' completed · you are watching ' + base.length + ' items</p></div>' +
        '<div class="page-head__actions">' +
          '<button class="btn btn--primary btn--sm" data-action="create">' + TF.icon('i-plus') + 'Create Task</button>' +
        '</div>' +
      '</div>' +
      toolbar({ scope: true, people: false }) +
      collection(list, {
        icon: 'i-target', title: "🎯 You're all caught up!",
        text: 'No tasks match this view right now. Adjust the filters or create something new.',
        action: { label: 'Create a task', attrs: 'data-action="create"' }
      }) +
    '</div>';
  };

  /* ==================================================================
     ALL TASKS
     ================================================================== */
  V.alltasks = function () {
    var list = TF.applyFilters(TF.tasks).sort(TF.sortByUrgency);
    var c = TF.counts();
    return '<div class="view">' +
      '<div class="page-head">' +
        '<div><h1 class="page-head__title">All Tasks</h1>' +
        '<p class="page-head__sub">Showing ' + list.length + ' of ' + TF.tasks.length + ' active board items · ' + c.total + ' in the workspace</p></div>' +
        '<div class="page-head__actions">' +
          '<button class="btn btn--outline btn--sm" data-action="clear-filters">' + TF.icon('i-refresh') + 'Reset filters</button>' +
          '<button class="btn btn--primary btn--sm" data-action="create">' + TF.icon('i-plus') + 'Create Task</button>' +
        '</div>' +
      '</div>' +
      toolbar({ scope: false }) +
      collection(list, {
        icon: 'i-search', title: 'No tasks match those filters',
        text: 'Try widening the status or priority filter, or clear the search to see the full board.',
        action: { label: 'Reset filters', icon: 'i-refresh', attrs: 'data-action="clear-filters"' }
      }) +
    '</div>';
  };

  /* ==================================================================
     TEAM
     ================================================================== */
  V.team = function () {
    /* Live per-person stats — TF.teamStats was seeded demo data and no longer exists. */
    var team = TF.users.map(function (u) {
      var all = TF.tasks.filter(function (t) { return t.assignee === u.id; });
      var completed = all.filter(function (t) { return t.status === 'completed'; }).length;
      return {
        u: u,
        s: {
          tasks: all.length,
          completed: completed,
          active: all.filter(function (t) {
            return t.status !== 'completed' && t.status !== 'cancelled';
          }).length,
          score: all.length ? Math.round((completed / all.length) * 100) : 0
        }
      };
    }).sort(function (a, b) { return b.s.tasks - a.s.tasks; });

    var cards = team.map(function (r, i) {
      var u = r.u, s = r.s;
      var wl = Math.min(4, s.active);
      var wlColor = wl >= 4 ? '#ef4444' : wl === 3 ? '#f59e0b' : '#10b981';
      var wlLabel = wl >= 4 ? 'High load' : wl === 3 ? 'Balanced' : 'Light load';
      /* A deactivated member cannot sign in, so their card is dimmed and labelled —
         otherwise they look identical to everyone else and a Manager cannot tell at a
         glance who still has access. */
      return '<article class="emp' + (u.active ? '' : ' emp--inactive') + '" data-employee="' + u.id +
        '" style="--ac:' + u.c1 + ';--d:' + (i * 60) + 'ms">' +
        '<header class="emp__head">' + TF.avatarHTML(u.id, 'xl') +
          '<div><div class="emp__name">' + TF.esc(u.name) +
            (u.active ? '' : ' <span class="chip chip--slate">Inactive</span>') + '</div>' +
          '<div class="emp__role">' + TF.esc(u.role) + ' · ' + TF.esc(u.dept) + '</div></div></header>' +
        '<div class="emp__stats">' +
          '<div class="emp__stat"><b class="tnum" data-countup="' + s.active + '">0</b><span>Active</span></div>' +
          '<div class="emp__stat"><b class="tnum" data-countup="' + s.completed + '">0</b><span>Completed</span></div>' +
          '<div class="emp__stat"><b class="tnum" data-countup="' + s.tasks + '">0</b><span>Total</span></div>' +
        '</div>' +
        '<div class="emp__prog-head"><span>Completion rate</span><b>' + s.score + '%</b></div>' +
        TF.progressBar(s.score, s.score >= 85 ? '' : s.score >= 75 ? 'blue' : 'amber') +
        '<div class="emp__foot">' +
          '<span class="workload" style="--wc:' + wlColor + ';color:' + wlColor + '"><span class="workload__bars">' +
            [1, 2, 3, 4].map(function (n) { return '<i class="' + (n <= wl ? 'is-on' : '') + '"></i>'; }).join('') +
          '</span>' + wlLabel + '</span>' +
          '<span class="chip">' + TF.icon('i-layers') + s.active + ' on the board</span>' +
        '</div>' +
      '</article>';
    }).join('');

    var totalActive = team.reduce(function (a, r) { return a + r.s.active; }, 0);
    var avgScore = team.length ? Math.round(team.reduce(function (a, r) { return a + r.s.score; }, 0) / team.length) : 0;

    return '<div class="view">' +
      '<div class="page-head">' +
        '<div><h1 class="page-head__title">Team</h1>' +
        '<p class="page-head__sub">' + TF.users.length + ' people · ' + totalActive + ' tasks in flight · average completion ' + avgScore + '%</p></div>' +
        '<div class="page-head__actions">' +
          '<button class="btn btn--outline btn--sm" data-view="reports">' + TF.icon('i-reports') + 'Performance report</button>' +
          '<button class="btn btn--primary btn--sm" data-action="create">' + TF.icon('i-plus') + 'Assign work</button>' +
          (TF.isManager()
            ? '<button class="btn btn--primary btn--sm" id="addMemberBtn">' +
                TF.icon('i-plus') + 'Add team member</button>'
            : '<span class="chip chip--slate">' + TF.icon('i-shield') +
                'Only a Manager can add team members</span>') +
        '</div>' +
      '</div>' +
      '<div class="team-grid">' + cards + '</div>' +

      '<section class="card section">' +
        '<div class="card__head"><div><h3>Team roster</h3>' +
          '<p>' + TF.users.length + ' member' + (TF.users.length === 1 ? '' : 's') +
          ' · Utopia Brands Trucking Team</p></div></div>' +
        '<div class="card__body">' +
          '<div class="table-wrap"><table class="table">' +
            '<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Job title</th>' +
              '<th>Status</th>' + (TF.isManager() ? '<th style="width:150px"></th>' : '') + '</tr></thead>' +
            '<tbody>' + TF.users.map(function (u) {
              return '<tr>' +
                '<td><div class="cell-user">' + TF.avatarHTML(u.id, 'sm') +
                  '<span><b>' + TF.esc(u.name) + '</b><i>' + TF.esc(u.dept) + '</i></span></div></td>' +
                '<td>' + TF.esc(u.email) + '</td>' +
                '<td><span class="chip chip--blue">' + TF.esc(u.roleLabel) + '</span></td>' +
                '<td>' + TF.esc(u.role) + '</td>' +
                '<td><span class="chip ' + (u.active ? 'chip--green' : 'chip--slate') + '">' +
                  '<i class="chip__dot"></i>' + (u.active ? 'Active' : 'Inactive') + '</span></td>' +
                (TF.isManager()
                  ? '<td style="text-align:right">' +
                      '<button class="btn btn--ghost btn--tiny" data-edit-user="' + u.id + '">Edit</button>' +
                      (u.id === TF.CURRENT_USER ? ''
                        : '<button class="btn btn--ghost btn--tiny" data-toggle-user="' + u.id +
                          '" data-activate="' + (!u.active) + '">' +
                          (u.active ? 'Deactivate' : 'Activate') + '</button>') +
                    '</td>'
                  : '') +
              '</tr>';
            }).join('') + '</tbody>' +
          '</table></div>' +
        '</div>' +
      '</section>' +
    '</div>';
  };

  V.team.after = function (root) {
    var add = TF.qs('#addMemberBtn', root);
    if (add) add.addEventListener('click', function () { TF.openUserModal(null); });

    TF.qsa('[data-edit-user]', root).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        TF.openUserModal(btn.getAttribute('data-edit-user'));
      });
    });

    TF.qsa('[data-toggle-user]', root).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-toggle-user');
        var activate = btn.getAttribute('data-activate') === 'true';
        btn.disabled = true;
        TF.api.setUserActive(id, activate).then(function () {
          TF.toast({ type: 'success', title: activate ? 'User activated' : 'User deactivated',
            body: activate ? 'They can sign in again.' : 'Their session was ended immediately.' });
          return TF.refresh();
        }).catch(function (err) {
          btn.disabled = false;
          TF.apiError(err, 'Could not update the user');
        });
      });
    });
  };

  /* ==================================================================
     CALENDAR
     ================================================================== */
  V.calendar = function () {
    var cur = new Date(TF.state.calYear, TF.state.calMonth, 1);
    var first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    var startDow = first.getDay();
    var gridStart = new Date(first); gridStart.setDate(1 - startDow);

    var byDay = {};
    TF.tasks.forEach(function (t) {
      var k = TF.startOfDay(t.due);
      (byDay[k] = byDay[k] || []).push(t);
    });

    var cells = '', today = TF.startOfDay(Date.now()), evIndex = 0;
    for (var i = 0; i < 42; i++) {
      var d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
      var key = TF.startOfDay(d.getTime());
      var out = d.getMonth() !== cur.getMonth();
      var items = (byDay[key] || []).sort(function (a, b) { return a.due - b.due; });
      var shown = items.slice(0, 3);
      cells += '<div class="cal__cell' + (out ? ' is-out' : '') + (key === today ? ' is-today' : '') + '">' +
        '<div class="cal__date">' + d.getDate() + '</div>' +
        '<div class="cal__events">' + shown.map(function (t) {
          var color = t.status === 'completed' ? '#10b981' : t.status === 'overdue' || TF.dayDiff(t.due) < 0 ? '#ef4444' : TF.PRIORITY[t.priority].color;
          evIndex++;
          return '<div class="cal-ev' + (t.status === 'completed' ? ' is-done' : '') + '" data-task="' + t.id + '" ' +
            'style="--ec:' + color + ';--d:' + (evIndex * 18) + 'ms" title="' + TF.esc(t.title) + '">' +
            '<i class="cal-ev__dot"></i><span>' + TF.esc(t.title) + '</span></div>';
        }).join('') +
        (items.length > 3 ? '<div class="cal__more" data-day="' + key + '">+' + (items.length - 3) + ' more</div>' : '') +
        '</div></div>';
    }

    var monthTasks = TF.tasks.filter(function (t) {
      var d = new Date(t.due);
      return d.getMonth() === cur.getMonth() && d.getFullYear() === cur.getFullYear();
    });

    return '<div class="view">' +
      '<div class="page-head">' +
        '<div><h1 class="page-head__title">Calendar</h1>' +
        '<p class="page-head__sub">' + monthTasks.length + ' deadlines in ' + TF.MONTHS[cur.getMonth()] + ' · click any task to open it</p></div>' +
        '<div class="page-head__actions">' +
          '<button class="btn btn--primary btn--sm" data-action="create">' + TF.icon('i-plus') + 'Create Task</button>' +
        '</div>' +
      '</div>' +
      '<div class="cal">' +
        '<div class="cal__head">' +
          '<div class="cal__month">' + TF.MONTHS[cur.getMonth()] + ' ' + cur.getFullYear() + '</div>' +
          '<div class="cal__nav">' +
            '<button class="btn btn--outline btn--sm" data-cal="today">Today</button>' +
            '<button class="icon-btn" data-cal="prev" aria-label="Previous month">' + TF.icon('i-chev-left') + '</button>' +
            '<button class="icon-btn" data-cal="next" aria-label="Next month">' + TF.icon('i-chev-right') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="cal__dow">' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>' +
        '<div class="cal__grid ' + (TF.state.calDir || '') + '">' + cells + '</div>' +
        '<div class="cal-legend">' +
          '<span style="--lc:#ef4444"><i></i>Overdue / Critical</span>' +
          '<span style="--lc:#f59e0b"><i></i>High priority</span>' +
          '<span style="--lc:#3b82f6"><i></i>Medium priority</span>' +
          '<span style="--lc:#64748b"><i></i>Low priority</span>' +
          '<span style="--lc:#10b981"><i></i>Completed</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  };

  /* ==================================================================
     NOTIFICATIONS
     ================================================================== */
  V.notifications = function () {
    var unread = TF.notifications.filter(function (n) { return !n.read; }).length;
    var list = TF.state.notifFilter === 'unread'
      ? TF.notifications.filter(function (n) { return !n.read; })
      : TF.notifications;

    return '<div class="view">' +
      '<div class="page-head">' +
        '<div><h1 class="page-head__title">Notifications</h1>' +
        '<p class="page-head__sub">' + unread + ' unread · ' + TF.notifications.length + ' in the last 7 days</p></div>' +
        '<div class="page-head__actions">' +
          '<div class="seg" data-seg="notif">' +
            '<button class="seg__btn' + (TF.state.notifFilter !== 'unread' ? ' is-on' : '') + '" data-notif-filter="all">All</button>' +
            '<button class="seg__btn' + (TF.state.notifFilter === 'unread' ? ' is-on' : '') + '" data-notif-filter="unread">Unread</button>' +
          '</div>' +
          '<button class="btn btn--outline btn--sm" data-action="mark-all">' + TF.icon('i-check') + 'Mark all read</button>' +
        '</div>' +
      '</div>' +
      '<section class="card"><div class="card__body" style="padding:8px">' +
        (list.length ? list.map(TF.notifHTML).join('')
          : TF.emptyState({ icon: 'i-bell', title: 'Inbox zero', text: 'No unread notifications. We will ping you the moment something needs attention.' })) +
      '</div></section>' +
    '</div>';
  };

  /* ==================================================================
     REPORTS
     ================================================================== */
  function breakdownTable(opts) {
    var total = opts.rows.reduce(function (s, r) { return s + r.value; }, 0) || 1;
    return '' +
    '<section class="card">' +
      '<div class="card__head"><div><h3>' + opts.title + '</h3><p>' + opts.sub + '</p></div></div>' +
      '<div class="card__body">' +
        '<div class="table-wrap"><table class="table">' +
          '<thead><tr><th>' + opts.head + '</th><th class="num">Tasks</th>' +
            '<th class="num">Share</th><th style="width:32%">Distribution</th></tr></thead>' +
          '<tbody>' + opts.rows.map(function (r) {
            var pct = Math.round((r.value / total) * 100);
            return '<tr' + (r.attrs || '') + '>' +
              '<td><span class="cell-user"><i class="legend__dot" style="--lc:' + r.color +
                ';background:' + r.color + '"></i><b>' + TF.esc(r.label) + '</b></span></td>' +
              '<td class="num tnum">' + r.value + '</td>' +
              '<td class="num tnum">' + pct + '%</td>' +
              '<td><div class="cell-prog">' + TF.progressBar(pct, r.tone || '') + '</div></td>' +
            '</tr>';
          }).join('') + '</tbody>' +
          '<tfoot><tr><th>Total</th><th class="num tnum">' + (total === 1 && !opts.rows.length ? 0 : total) +
            '</th><th class="num">100%</th><th></th></tr></tfoot>' +
        '</table></div>' +
      '</div>' +
    '</section>';
  }

  V.reports = function () {
    var c = TF.counts();
    var open = function (t) { return t.status !== 'completed' && t.status !== 'cancelled'; };

    var byStatus = TF.STATUS_ORDER.map(function (k) {
      return { label: TF.STATUS[k].label, value: c[k] || 0, color: TF.STATUS[k].color,
               attrs: ' data-report-status="' + k + '"' };
    }).filter(function (r) { return r.value > 0; });

    var byPriority = TF.PRIORITY_ORDER.slice().reverse().map(function (k) {
      return {
        label: TF.PRIORITY[k].label, color: TF.PRIORITY[k].color,
        value: TF.tasks.filter(function (t) { return t.priority === k; }).length
      };
    }).filter(function (r) { return r.value > 0; });

    var byProject = TF.PROJECTS.map(function (p) {
      return { label: p, color: '#8b5cf6',
               value: TF.tasks.filter(function (t) { return t.project === p; }).length };
    }).sort(function (a, b) { return b.value - a.value; });

    var byAssignee = TF.users.map(function (u) {
      var all = TF.tasks.filter(function (t) { return t.assignee === u.id; });
      return {
        u: u,
        total: all.length,
        openCount: all.filter(open).length,
        completed: all.filter(function (t) { return t.status === 'completed'; }).length,
        overdue: all.filter(function (t) { return t.status === 'overdue' || (open(t) && t.isOverdue); }).length
      };
    }).filter(function (r) { return r.total > 0; })
      .sort(function (a, b) { return b.total - a.total; });

    var headline = [
      { label: 'Total Tasks',   value: c.total,     icon: 'i-layers',     color: '#8b5cf6' },
      { label: 'Completed',     value: c.completed, icon: 'i-check',      color: '#10b981' },
      { label: 'Open',          value: c.total - c.completed - c.cancelled, icon: 'i-dot-circle', color: '#3b82f6' },
      { label: 'Overdue',       value: c.overdue,   icon: 'i-alert',      color: '#ef4444' }
    ];

    return '' +
    '<div class="view">' +
      '<div class="page-head">' +
        '<div>' +
          '<h1 class="page-head__title">Reports</h1>' +
          '<p class="page-head__sub">Task breakdowns across the Utopia Brands Trucking Team.</p>' +
        '</div>' +
        '<div class="page-head__actions">' +
          '<button class="btn btn--outline btn--sm" id="reportPrint">' + TF.icon('i-download') + 'Print / save PDF</button>' +
        '</div>' +
      '</div>' +

      '<div class="kpis">' + headline.map(statTile).join('') + '</div>' +

      '<div class="section" style="display:grid;gap:20px">' +
        breakdownTable({ title: 'Tasks by Status', sub: 'Live distribution across the workspace',
          head: 'Status', rows: byStatus }) +
        breakdownTable({ title: 'Tasks by Priority', sub: 'Where the weight of the work sits',
          head: 'Priority', rows: byPriority }) +
        breakdownTable({ title: 'Tasks by Project', sub: 'Grouped by the project field',
          head: 'Project', rows: byProject }) +

        '<section class="card">' +
          '<div class="card__head"><div><h3>Tasks by Assignee</h3>' +
            '<p>Workload and delivery per team member</p></div>' +
            '<button class="btn btn--ghost btn--tiny" data-view="team">View team' + TF.icon('i-chev-right') + '</button></div>' +
          '<div class="card__body">' +
            (byAssignee.length
              ? '<div class="table-wrap"><table class="table">' +
                  '<thead><tr><th>Team member</th><th>Role</th><th class="num">Total</th>' +
                    '<th class="num">Open</th><th class="num">Completed</th><th class="num">Overdue</th></tr></thead>' +
                  '<tbody>' + byAssignee.map(function (r) {
                    return '<tr data-employee="' + r.u.id + '">' +
                      '<td><div class="cell-user">' + TF.avatarHTML(r.u.id, 'sm') +
                        '<span><b>' + TF.esc(r.u.name) + '</b><i>' + TF.esc(r.u.dept) + '</i></span></div></td>' +
                      '<td><span class="chip chip--slate">' + TF.esc(r.u.roleLabel) + '</span></td>' +
                      '<td class="num tnum">' + r.total + '</td>' +
                      '<td class="num tnum">' + r.openCount + '</td>' +
                      '<td class="num tnum">' + r.completed + '</td>' +
                      '<td class="num tnum' + (r.overdue ? ' is-danger' : '') + '">' + r.overdue + '</td>' +
                    '</tr>';
                  }).join('') + '</tbody>' +
                '</table></div>'
              : TF.emptyState({ icon: 'i-user', title: 'No assigned tasks yet',
                  text: 'Assign work to team members and their workload appears here.' })) +
          '</div>' +
        '</section>' +
      '</div>' +
    '</div>';
  };

  V.reports.after = function (root) {
    var print = TF.qs('#reportPrint', root);
    if (print) print.addEventListener('click', function () { window.print(); });

    TF.qsa('[data-report-status]', root).forEach(function (tr) {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', function () {
        TF.state.filters.status = tr.getAttribute('data-report-status');
        TF.go('alltasks');
      });
    });
  };

  /* ==================================================================
     ACTIVITY
     ================================================================== */
  V.activity = function () {
    var feed = TF.recentActivity(40);
    var groups = [];
    var map = {};
    feed.forEach(function (a) {
      var k = TF.startOfDay(a.ts);
      if (!map[k]) { map[k] = []; groups.push({ day: k, items: map[k] }); }
      map[k].push(a);
    });

    var body = groups.length ? groups.map(function (g) {
      var diff = TF.dayDiff(g.day);
      var label = diff === 0 ? 'Today' : diff === -1 ? 'Yesterday' : TF.DOW[new Date(g.day).getDay()] + ' · ' + TF.fmtDate(g.day);
      return '<div class="act-day">' +
        '<div class="act-day__label">' + TF.icon('i-clock') + label + '</div>' +
        '<div class="timeline">' + g.items.map(TF.timelineItem).join('') + '</div>' +
      '</div>';
    }).join('') : TF.emptyState({ icon: 'i-activity', title: 'Nothing has happened yet', text: 'Activity from across the workspace will stream in here as your team works.' });

    return '<div class="view">' +
      '<div class="page-head">' +
        '<div><h1 class="page-head__title">Activity</h1>' +
        '<p class="page-head__sub">Everything that happened across ' + TF.tasks.length + ' active tasks</p></div>' +
      '</div>' +
      '<section class="card"><div class="card__body">' + body + '</div></section>' +
    '</div>';
  };

  /* ==================================================================
     SETTINGS
     ================================================================== */
  V.settings = function () {
    var s = TF.state;
    var me = TF.user(TF.CURRENT_USER);
    var accents = [
      { key: 'emerald', color: '#10b981' }, { key: 'teal', color: '#14b8a6' },
      { key: 'blue', color: '#3b82f6' }, { key: 'violet', color: '#8b5cf6' }, { key: 'amber', color: '#f59e0b' }
    ];

    function row(title, desc, control) {
      return '<div class="set-row"><div class="set-row__meta"><b>' + title + '</b><p>' + desc + '</p></div>' + control + '</div>';
    }
    function toggle(key, on) {
      return '<label class="switch"><input type="checkbox" data-pref="' + key + '"' + (on ? ' checked' : '') + ' /><span class="switch__track"><span class="switch__thumb"></span></span></label>';
    }

    return '<div class="view">' +
      '<div class="page-head">' +
        '<div><h1 class="page-head__title">Settings</h1>' +
        '<p class="page-head__sub">Personalise your workspace. Preferences are stored locally in this browser.</p></div>' +
      '</div>' +

      '<div class="two-col">' +
        '<section class="card">' +
          '<div class="card__head"><div><h3>Appearance</h3><p>Theme and accent colour</p></div></div>' +
          '<div class="card__body">' +
            row('Colour theme', 'Switch between the light and dark workspace.',
              '<div class="theme-cards">' +
                '<div class="theme-card' + (s.theme === 'light' ? ' is-on' : '') + '" data-theme-set="light">' +
                  '<div class="theme-card__prev"><i style="flex:0 0 26%;background:#0f1513"></i><i style="flex:1;background:#f1f5f3"></i></div>' +
                  '<div class="theme-card__name">' + TF.icon('i-sun') + 'Light</div></div>' +
                '<div class="theme-card' + (s.theme === 'dark' ? ' is-on' : '') + '" data-theme-set="dark">' +
                  '<div class="theme-card__prev"><i style="flex:0 0 26%;background:#0b100e"></i><i style="flex:1;background:#101715"></i></div>' +
                  '<div class="theme-card__name">' + TF.icon('i-moon') + 'Dark</div></div>' +
              '</div>') +
            row('Accent colour', 'Used for highlights, charts and primary actions.',
              '<div class="accent-dots">' + accents.map(function (a) {
                return '<button class="accent-dot' + (s.accent === a.key ? ' is-on' : '') + '" data-accent="' + a.key + '" style="--dc:' + a.color + '" aria-label="' + a.key + '"></button>';
              }).join('') + '</div>') +
            row('Collapse sidebar by default', 'Start each session with the icon-only navigation rail.', toggle('collapsed', s.collapsed)) +
          '</div>' +
        '</section>' +

        '<section class="card">' +
          '<div class="card__head"><div><h3>Notifications</h3><p>What you get pinged about</p></div></div>' +
          '<div class="card__body">' +
            row('Task assignments', 'Notify me when a task is assigned to me.', toggle('nAssign', s.prefs.nAssign)) +
            row('Due date reminders', 'Remind me two hours before a deadline.', toggle('nDue', s.prefs.nDue)) +
            row('Comments &amp; mentions', 'Notify me when someone replies or mentions me.', toggle('nComment', s.prefs.nComment)) +
            row('Weekly digest', 'A Monday summary of team performance.', toggle('nDigest', s.prefs.nDigest)) +
          '</div>' +
        '</section>' +
      '</div>' +

      '<div class="two-col section">' +
        '<section class="card">' +
          '<div class="card__head"><div><h3>Profile</h3><p>How you appear to the team</p></div></div>' +
          '<div class="card__body">' +
            '<div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">' +
              TF.avatarHTML(TF.CURRENT_USER, 'xl') +
              '<div><div style="font-size:16px;font-weight:700;letter-spacing:-.02em">' + TF.esc(TF.user(TF.CURRENT_USER).name) + '</div>' +
              '<div style="font-size:12.5px;color:var(--text-3)">' + TF.esc(TF.user(TF.CURRENT_USER).email) + '</div></div>' +
              '<span class="chip chip--slate" style="margin-left:auto" title="Avatars are generated from your initials">' +
                TF.icon('i-user') + 'Avatar from initials</span>' +
            '</div>' +
            '<div class="auth__error" id="profileError" hidden></div>' +
            '<div class="form-grid">' +
              '<label class="field"><span class="field__label">Full name</span>' +
                '<span class="field__control"><input id="pfName" maxlength="120" value="' +
                  TF.esc(me.name) + '" /></span></label>' +
              '<label class="field"><span class="field__label">Job title</span>' +
                '<span class="field__control"><input id="pfTitle" maxlength="120" value="' +
                  TF.esc(me.jobTitle || '') + '" placeholder="' + TF.esc(me.roleLabel) + '" /></span></label>' +
              '<label class="field"><span class="field__label">Department</span>' +
                '<span class="field__control"><input id="pfDept" maxlength="120" value="' +
                  TF.esc(me.dept && me.dept !== '—' ? me.dept : '') + '" /></span></label>' +
              '<label class="field"><span class="field__label">Organizational role</span>' +
                '<span class="field__control"><input value="' + TF.esc(me.roleLabel) +
                  '" disabled /></span></label>' +
              '<label class="field span-2"><span class="field__label">Email <i>(sign-in address)</i></span>' +
                '<span class="field__control"><input value="' + TF.esc(me.email) +
                  '" disabled /></span></label>' +
            '</div>' +
            '<p class="field__hint">Your role and email are set by a Manager. ' +
              'To change your password, use Change password above.</p>' +
          '</div>' +
          '<div class="card__foot" style="display:flex;justify-content:flex-end;gap:9px">' +
            '<button class="btn btn--ghost btn--sm" id="pfReset">Discard</button>' +
            '<button class="btn btn--primary btn--sm" id="pfSave">Save changes</button>' +
          '</div>' +
        '</section>' +

        '<section class="card">' +
          '<div class="card__head"><div><h3>Preferences</h3><p>Personalize how the workspace looks and feels</p></div></div>' +
          '<div class="card__body">' +
            row('Motion &amp; animation', 'Turn off if you prefer a calmer, static interface.', toggle('motion', s.prefs.motion)) +
            row('Compact task rows', 'Show more tasks per screen in list views.', toggle('compact', s.prefs.compact)) +
          '</div>' +
        '</section>' +
      '</div>' +
    '</div>';
  };

  V.settings.after = function (root) {
    var save = TF.qs('#pfSave', root);
    var reset = TF.qs('#pfReset', root);
    if (!save) return;

    if (reset) reset.addEventListener('click', function () { TF.render(); });

    save.addEventListener('click', function () {
      if (save.classList.contains('is-loading')) return;
      var errBox = TF.qs('#profileError', root);
      var payload = {
        fullName: TF.qs('#pfName', root).value.trim(),
        jobTitle: TF.qs('#pfTitle', root).value.trim() || null,
        department: TF.qs('#pfDept', root).value.trim() || null
      };

      if (!payload.fullName) {
        errBox.textContent = 'Your name cannot be empty.';
        errBox.hidden = false;
        return;
      }

      errBox.hidden = true;
      save.classList.add('is-loading');
      save.innerHTML = '<span class="spinner"></span><span class="btn__text">Saving…</span>';

      TF.api.updateMyProfile(payload).then(function () {
        return TF.refresh();
      }).then(function () {
        TF.toast({ type: 'success', title: 'Profile updated',
          body: 'Your details are now visible to the team.' });
      }).catch(function (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
        save.classList.remove('is-loading');
        save.innerHTML = 'Save changes';
      });
    });
  };

  /* ==================================================================
     CHANGE PASSWORD
     ================================================================== */
  V.password = function () {
    var forced = TF.session.me && TF.session.me.mustChangePassword;
    return '' +
    '<div class="view">' +
      '<div class="page-head">' +
        '<div>' +
          '<h1 class="page-head__title">Change password</h1>' +
          '<p class="page-head__sub">' +
            (forced
              ? 'Set a new password before you continue. Your account was created with a temporary one.'
              : 'Choose a new password for your account.') +
          '</p>' +
        '</div>' +
      '</div>' +
      '<section class="card" style="max-width:520px">' +
        '<div class="card__body">' +
          '<form id="pwdForm" autocomplete="off">' +
            '<div class="auth__error" id="pwdError" hidden></div>' +
            '<label class="field"><span class="field__label">Current password</span>' +
              '<span class="field__control">' + TF.icon('i-shield', 'field__ico') +
              '<input type="password" id="pwdCurrent" required autocomplete="current-password" /></span></label>' +
            '<label class="field"><span class="field__label">New password</span>' +
              '<span class="field__control">' + TF.icon('i-shield', 'field__ico') +
              '<input type="password" id="pwdNew" required autocomplete="new-password" /></span></label>' +
            '<label class="field"><span class="field__label">Confirm new password</span>' +
              '<span class="field__control">' + TF.icon('i-shield', 'field__ico') +
              '<input type="password" id="pwdConfirm" required autocomplete="new-password" /></span></label>' +
            '<p class="field__hint">At least 8 characters, including one letter and one digit.</p>' +
            '<button class="btn btn--primary btn--block" type="submit" id="pwdBtn">' +
              '<span class="btn__text">Update password</span></button>' +
          '</form>' +
        '</div>' +
      '</section>' +
    '</div>';
  };

  V.password.after = function (root) {
    var form = TF.qs('#pwdForm', root);
    var errBox = TF.qs('#pwdError', root);
    var btn = TF.qs('#pwdBtn', root);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (btn.classList.contains('is-loading')) return;

      var cur = TF.qs('#pwdCurrent', root).value;
      var next = TF.qs('#pwdNew', root).value;
      var confirm = TF.qs('#pwdConfirm', root).value;

      errBox.hidden = true;
      btn.classList.add('is-loading');
      btn.innerHTML = '<span class="spinner"></span><span class="btn__text">Updating…</span>';

      TF.api.changePassword(cur, next, confirm).then(function () {
        // The server revoked every session. Send the user back to sign in.
        TF.showAuth('Password updated. Please sign in with your new password.');
      }).catch(function (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
        btn.classList.remove('is-loading');
        btn.innerHTML = '<span class="btn__text">Update password</span>';
      });
    });
  };

}(window.TF));
