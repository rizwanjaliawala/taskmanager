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
  function kpiCard(o, i) {
    return '<article class="kpi" style="--kc:' + o.color + ';--d:' + (i * 70) + 'ms">' +
      TF.charts.sparkline(o.spark, o.color) +
      '<div class="kpi__top">' +
        '<span class="kpi__ico">' + TF.icon(o.icon) + '</span>' +
        '<span class="kpi__delta kpi__delta--' + (o.dir || 'up') + '">' +
          TF.icon(o.dir === 'down' ? 'i-trend-down' : 'i-trend-up') + o.delta + '</span>' +
      '</div>' +
      '<div class="kpi__value" data-countup="' + o.value + '"' + (o.suffix ? ' data-suffix="' + o.suffix + '"' : '') + '>0</div>' +
      '<div class="kpi__label">' + o.label + '</div>' +
    '</article>';
  }

  V.dashboard = function () {
    var c = TF.counts();
    var hour = new Date().getHours();
    var greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    var me = TF.user(TF.CURRENT_USER).name.split(' ')[0];

    var kpis = [
      { label: 'Total Tasks',     value: c.total,     icon: 'i-layers',     color: '#8b5cf6', delta: '+12', spark: [88, 94, 99, 105, 112, 119, 128] },
      { label: 'In Progress',     value: c.progress,  icon: 'i-dot-circle', color: '#3b82f6', delta: '+6',  spark: [30, 34, 33, 38, 36, 40, 42] },
      { label: 'Completed',       value: c.completed, icon: 'i-check',      color: '#10b981', delta: '+18', spark: [41, 46, 50, 55, 58, 63, 67] },
      { label: 'Overdue',         value: c.overdue,   icon: 'i-alert',      color: '#ef4444', delta: '-3', dir: 'down', spark: [15, 14, 13, 12, 11, 10, 9] },
      { label: 'Due Today',       value: c.dueToday,  icon: 'i-clock',      color: '#f59e0b', delta: '+4',  spark: [8, 11, 9, 13, 10, 12, 14] },
      { label: 'Completion Rate', value: c.rate,      icon: 'i-target',     color: '#06b6d4', delta: '+8.4%', suffix: '%', spark: [71, 74, 72, 77, 79, 80, 82] }
    ];

    var mine = TF.tasks.filter(function (t) {
      return (t.assignee === TF.CURRENT_USER || t.reporter === TF.CURRENT_USER) && t.status !== 'completed';
    }).sort(TF.sortByUrgency).slice(0, 5);

    var team = TF.users.filter(function (u) { return u.id !== TF.CURRENT_USER; })
      .map(function (u) { return { u: u, s: TF.teamStats[u.id] }; })
      .sort(function (a, b) { return b.s.score - a.s.score; });

    var recent = TF.recentActivity(5);

    return '' +
    '<div class="view">' +
      '<div class="page-head">' +
        '<div>' +
          '<h1 class="page-head__title">' + greet + ', ' + TF.esc(me) + ' <span class="wave">👋</span></h1>' +
          '<p class="page-head__sub">Here\'s what\'s happening with your team\'s work today.</p>' +
        '</div>' +
        '<div class="page-head__actions">' +
          '<span class="chip"><i class="chip__dot" style="color:var(--c-green)"></i>' + TF.DOW[new Date().getDay()] + ', ' + TF.fmtDate(Date.now(), true) + '</span>' +
          '<button class="btn btn--outline btn--sm" data-view="reports">' + TF.icon('i-download') + 'Export report</button>' +
          '<button class="btn btn--primary btn--sm" data-action="create">' + TF.icon('i-plus') + 'Create Task</button>' +
        '</div>' +
      '</div>' +

      '<div class="kpis">' + kpis.map(kpiCard).join('') + '</div>' +

      '<div class="dash-grid section">' +
        '<div class="dash-col">' +

          '<section class="card">' +
            '<div class="card__body ring-card">' +
              '<div class="ring" id="prodRing"></div>' +
              '<div class="ring-meta">' +
                '<h3>Team Productivity</h3>' +
                '<p>Weighted across ' + TF.users.length + ' people and ' + c.total + ' tasks in the current cycle. Momentum is up on last week.</p>' +
                '<span class="trend-pill">' + TF.icon('i-trend-up') + '+8.4% compared with last week</span>' +
                '<div class="ring-stats">' +
                  '<div><b class="tnum" data-countup="' + c.completed + '">0</b><span>Delivered</span></div>' +
                  '<div><b class="tnum" data-countup="2.8" data-decimals="1" data-suffix="d">0</b><span>Avg cycle</span></div>' +
                  '<div><b class="tnum" data-countup="94" data-suffix="%">0</b><span>SLA met</span></div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</section>' +

          '<div class="two-col">' +
            '<section class="card">' +
              '<div class="card__head"><div><h3>Tasks by Status</h3><p>Live distribution across the workspace</p></div></div>' +
              '<div class="card__body donut-wrap">' +
                '<div class="donut" id="statusDonut"></div>' +
                '<div class="legend" id="statusLegend"></div>' +
              '</div>' +
            '</section>' +

            '<section class="card">' +
              '<div class="card__head"><div><h3>Weekly Throughput</h3><p>Created vs completed</p></div>' +
                '<span class="chip chip--green"><i class="chip__dot"></i>85 closed</span></div>' +
              '<div class="card__body"><div id="weekBars"></div>' +
                '<div style="display:flex;gap:16px;margin-top:14px;justify-content:center">' +
                  '<span class="chip chip--green"><i class="chip__dot"></i>Completed</span>' +
                  '<span class="chip chip--slate"><i class="chip__dot"></i>Created</span>' +
                '</div>' +
              '</div>' +
            '</section>' +
          '</div>' +

          '<section class="card">' +
            '<div class="card__head"><div><h3>Team Performance</h3><p>Delivery score for the current cycle</p></div>' +
              '<button class="btn btn--ghost btn--tiny" data-view="team">View team' + TF.icon('i-chev-right') + '</button></div>' +
            '<div class="card__body">' +
              '<div class="table-wrap"><table class="table">' +
                '<thead><tr><th>Employee</th><th class="num">Tasks</th><th class="num">Completed</th><th style="width:34%">Progress</th></tr></thead>' +
                '<tbody>' + team.map(function (r, i) {
                  return '<tr data-employee="' + r.u.id + '">' +
                    '<td><div class="cell-user"><span class="rank rank--' + (i + 1) + '">' + (i + 1) + '</span>' +
                      TF.avatarHTML(r.u.id, 'sm') + '<span><b>' + TF.esc(r.u.name) + '</b><i>' + TF.esc(r.u.dept) + '</i></span></div></td>' +
                    '<td class="num tnum">' + r.s.tasks + '</td>' +
                    '<td class="num tnum">' + r.s.completed + '</td>' +
                    '<td><div class="cell-prog">' + TF.progressBar(r.s.score, r.s.score >= 85 ? '' : r.s.score >= 75 ? 'blue' : 'amber') +
                      '<b>' + r.s.score + '%</b></div></td>' +
                  '</tr>';
                }).join('') + '</tbody>' +
              '</table></div>' +
            '</div>' +
          '</section>' +
        '</div>' +

        '<div class="dash-col">' +
          '<section class="card">' +
            '<div class="card__head"><div><h3>My Tasks</h3><p>' + mine.length + ' open · sorted by urgency</p></div>' +
              '<button class="btn btn--ghost btn--tiny" data-view="mytasks">All' + TF.icon('i-chev-right') + '</button></div>' +
            '<div class="card__body">' +
              (mine.length ? '<div class="task-list">' + mine.map(function (t, i) {
                return '' +
                '<article class="tcard" data-task="' + t.id + '" style="--tc:' + TF.STATUS[t.status].color + ';--d:' + (i * 60) + 'ms">' +
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
                '</article>'; }).join('') + '</div>'
              : TF.emptyState({ icon: 'i-target', title: "🎯 You're all caught up!", text: 'No pending tasks at the moment. New work assigned to you will land right here.', action: { label: 'Create a task', attrs: 'data-action="create"' } })) +
            '</div>' +
          '</section>' +

          '<section class="card">' +
            '<div class="card__head"><div><h3>Recent Activity</h3><p>Across the workspace</p></div>' +
              '<button class="btn btn--ghost btn--tiny" data-view="activity">All' + TF.icon('i-chev-right') + '</button></div>' +
            '<div class="card__body">' +
              '<div class="timeline">' + recent.map(TF.timelineItem).join('') + '</div>' +
            '</div>' +
          '</section>' +
        '</div>' +
      '</div>' +
    '</div>';
  };

  V.dashboard.after = function (root) {
    var c = TF.counts();
    TF.charts.ring(TF.qs('#prodRing', root), c.productivity, { label: 'Productivity' });

    var segs = TF.STATUS_ORDER.map(function (k) {
      return { key: k, label: TF.STATUS[k].label, value: c[k], color: TF.STATUS[k].color };
    });
    var legend = TF.qs('#statusLegend', root);
    var donut = TF.charts.donut(TF.qs('#statusDonut', root), segs, {
      centerLabel: 'total tasks',
      onHover: function (key) {
        TF.qsa('.legend__item', legend).forEach(function (li) {
          li.classList.toggle('is-dim', !!key && li.getAttribute('data-key') !== key);
        });
      },
      onClick: function (key) { TF.state.filters.status = key; TF.go('alltasks'); }
    });

    legend.innerHTML = segs.map(function (s) {
      return '<div class="legend__item" data-key="' + s.key + '" style="--lc:' + s.color + '">' +
        '<i class="legend__dot"></i><span class="legend__name">' + s.label + '</span>' +
        '<span class="legend__val tnum">' + s.value + '</span>' +
        '<span class="legend__pct">' + Math.round((s.value / c.total) * 100) + '%</span></div>';
    }).join('');
    TF.qsa('.legend__item', legend).forEach(function (li) {
      li.addEventListener('mouseenter', function () { donut.focus(li.getAttribute('data-key')); });
      li.addEventListener('mouseleave', function () { donut.focus(null); });
      li.addEventListener('click', function () {
        TF.state.filters.status = li.getAttribute('data-key');
        TF.go('alltasks');
      });
    });

    TF.charts.bars(TF.qs('#weekBars', root), TF.weekly.map(function (d) {
      return { label: d.label, values: [
        { value: d.completed, color: '#10b981', name: 'completed' },
        { value: d.created, color: '#94a3b8', name: 'created' }
      ] };
    }));
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
    var cards = TF.users.map(function (u, i) {
      var s = TF.teamStats[u.id];
      var live = TF.tasks.filter(function (t) { return t.assignee === u.id && t.status !== 'completed'; }).length;
      var wl = s.workload;
      var wlColor = wl >= 4 ? '#ef4444' : wl === 3 ? '#f59e0b' : '#10b981';
      var wlLabel = wl >= 4 ? 'High load' : wl === 3 ? 'Balanced' : 'Light load';
      return '<article class="emp" data-employee="' + u.id + '" style="--ac:' + u.c1 + ';--d:' + (i * 60) + 'ms">' +
        '<header class="emp__head">' + TF.avatarHTML(u.id, 'xl') +
          '<div><div class="emp__name">' + TF.esc(u.name) + '</div>' +
          '<div class="emp__role">' + TF.esc(u.role) + ' · ' + TF.esc(u.dept) + '</div></div></header>' +
        '<div class="emp__stats">' +
          '<div class="emp__stat"><b class="tnum" data-countup="' + (s.tasks - s.completed) + '">0</b><span>Active</span></div>' +
          '<div class="emp__stat"><b class="tnum" data-countup="' + s.completed + '">0</b><span>Completed</span></div>' +
          '<div class="emp__stat"><b class="tnum" data-countup="' + s.tasks + '">0</b><span>Total</span></div>' +
        '</div>' +
        '<div class="emp__prog-head"><span>Completion rate</span><b>' + s.score + '%</b></div>' +
        TF.progressBar(s.score, s.score >= 85 ? '' : s.score >= 75 ? 'blue' : 'amber') +
        '<div class="emp__foot">' +
          '<span class="workload" style="--wc:' + wlColor + ';color:' + wlColor + '"><span class="workload__bars">' +
            [1, 2, 3, 4].map(function (n) { return '<i class="' + (n <= wl ? 'is-on' : '') + '"></i>'; }).join('') +
          '</span>' + wlLabel + '</span>' +
          '<span class="chip">' + TF.icon('i-layers') + live + ' on the board</span>' +
        '</div>' +
      '</article>';
    }).join('');

    var totalActive = TF.users.reduce(function (a, u) { return a + (TF.teamStats[u.id].tasks - TF.teamStats[u.id].completed); }, 0);

    return '<div class="view">' +
      '<div class="page-head">' +
        '<div><h1 class="page-head__title">Team</h1>' +
        '<p class="page-head__sub">' + TF.users.length + ' people · ' + totalActive + ' tasks in flight · average score ' + TF.counts().productivity + '%</p></div>' +
        '<div class="page-head__actions">' +
          '<button class="btn btn--outline btn--sm" data-view="reports">' + TF.icon('i-reports') + 'Performance report</button>' +
          '<button class="btn btn--primary btn--sm" data-action="create">' + TF.icon('i-plus') + 'Assign work</button>' +
        '</div>' +
      '</div>' +
      '<div class="team-grid">' + cards + '</div>' +
    '</div>';
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
  V.reports = function () {
    var c = TF.counts();
    var tiles = [
      { label: 'Completion Rate',        value: c.rate, suffix: '%', icon: 'i-target',   color: '#10b981', foot: '+8.4% vs last week', dir: 'up' },
      { label: 'Average Completion Time', value: 2.8, dec: 1, suffix: ' days', icon: 'i-clock', color: '#3b82f6', foot: '−0.4 days vs last week', dir: 'up' },
      { label: 'Overdue Rate',           value: 7, suffix: '%', icon: 'i-alert',    color: '#ef4444', foot: '−2 pts vs last week', dir: 'up' },
      { label: 'Team Productivity',      value: 12, prefix: '+', suffix: '%', icon: 'i-trend-up', color: '#8b5cf6', foot: 'Sustained 4 weeks', dir: 'up' }
    ];

    var deptMap = {};
    TF.users.forEach(function (u) {
      var s = TF.teamStats[u.id];
      var d = deptMap[u.dept] || (deptMap[u.dept] = { tasks: 0, completed: 0, score: 0, n: 0 });
      d.tasks += s.tasks; d.completed += s.completed; d.score += s.score; d.n++;
    });

    return '<div class="view">' +
      '<div class="page-head">' +
        '<div><h1 class="page-head__title">Reports</h1>' +
        '<p class="page-head__sub">Operations performance · rolling 12 weeks · demo dataset</p></div>' +
        '<div class="page-head__actions">' +
          '<select class="filter-select"><option>Last 12 weeks</option><option>This quarter</option><option>Year to date</option></select>' +
          '<button class="btn btn--outline btn--sm" data-action="export">' + TF.icon('i-download') + 'Export PDF</button>' +
        '</div>' +
      '</div>' +

      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(212px,1fr))">' +
        tiles.map(function (t, i) {
          return '<article class="stat-tile" style="--sc:' + t.color + ';--d:' + (i * 80) + 'ms">' +
            '<span class="stat-tile__glow"></span>' +
            '<div class="stat-tile__label">' + TF.icon(t.icon) + t.label + '</div>' +
            '<div class="stat-tile__value" data-countup="' + t.value + '"' +
              (t.suffix ? ' data-suffix="' + t.suffix + '"' : '') +
              (t.prefix ? ' data-prefix="' + t.prefix + '"' : '') +
              (t.dec ? ' data-decimals="' + t.dec + '"' : '') + '>0</div>' +
            '<div class="stat-tile__foot">' + TF.icon('i-trend-up') + t.foot + '</div>' +
          '</article>';
        }).join('') +
      '</div>' +

      '<div class="two-col section">' +
        '<section class="card">' +
          '<div class="card__head"><div><h3>Completion Rate Trend</h3><p>Percentage of tasks closed on time</p></div>' +
            '<span class="chip chip--green">' + TF.icon('i-trend-up') + '+18 pts</span></div>' +
          '<div class="card__body"><svg id="trendChart"></svg></div>' +
        '</section>' +
        '<section class="card">' +
          '<div class="card__head"><div><h3>Average Cycle Time</h3><p>Days from assignment to completion</p></div>' +
            '<span class="chip chip--blue">' + TF.icon('i-trend-down') + '−1.4 days</span></div>' +
          '<div class="card__body"><svg id="cycleChart"></svg></div>' +
        '</section>' +
      '</div>' +

      '<div class="two-col section">' +
        '<section class="card">' +
          '<div class="card__head"><div><h3>Priority Mix</h3><p>Where the workload sits today</p></div></div>' +
          '<div class="card__body donut-wrap">' +
            '<div class="donut" id="prioDonut"></div>' +
            '<div class="legend" id="prioLegend"></div>' +
          '</div>' +
        '</section>' +
        '<section class="card">' +
          '<div class="card__head"><div><h3>Department Performance</h3><p>Completion score by function</p></div></div>' +
          '<div class="card__body"><div id="deptBars"></div></div>' +
        '</section>' +
      '</div>' +

      '<section class="card section">' +
        '<div class="card__head"><div><h3>Weekly Throughput</h3><p>Tasks created against tasks completed</p></div></div>' +
        '<div class="card__body"><div id="repWeek"></div></div>' +
      '</section>' +
    '</div>';
  };

  V.reports.after = function (root) {
    TF.charts.line(TF.qs('#trendChart', root), TF.completionTrend, { color: '#10b981', unit: '%' });
    TF.charts.line(TF.qs('#cycleChart', root), TF.cycleTrend, { color: '#3b82f6', decimals: 1, unit: 'd' });

    var mix = TF.PRIORITY_ORDER.slice().reverse().map(function (k) {
      return {
        key: k, label: TF.PRIORITY[k].label, color: TF.PRIORITY[k].color,
        value: TF.tasks.filter(function (t) { return t.priority === k; }).length
      };
    });
    var total = mix.reduce(function (a, s) { return a + s.value; }, 0) || 1;
    var legend = TF.qs('#prioLegend', root);
    var donut = TF.charts.donut(TF.qs('#prioDonut', root), mix, { centerLabel: 'board items' });
    legend.innerHTML = mix.map(function (s) {
      return '<div class="legend__item" data-key="' + s.key + '" style="--lc:' + s.color + '">' +
        '<i class="legend__dot"></i><span class="legend__name">' + s.label + '</span>' +
        '<span class="legend__val tnum">' + s.value + '</span>' +
        '<span class="legend__pct">' + Math.round((s.value / total) * 100) + '%</span></div>';
    }).join('');
    TF.qsa('.legend__item', legend).forEach(function (li) {
      li.addEventListener('mouseenter', function () { donut.focus(li.getAttribute('data-key')); });
      li.addEventListener('mouseleave', function () { donut.focus(null); });
    });

    var deptMap = {};
    TF.users.forEach(function (u) {
      var s = TF.teamStats[u.id];
      var d = deptMap[u.dept] || (deptMap[u.dept] = { score: 0, n: 0, tasks: 0 });
      d.score += s.score; d.n++; d.tasks += s.tasks;
    });
    var palette = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4', '#ef4444', '#6366f1', '#64748b'];
    var rows = Object.keys(deptMap).map(function (k, i) {
      var d = deptMap[k];
      return { label: k, value: Math.round(d.score / d.n), max: 100, color: palette[i % palette.length],
        display: Math.round(d.score / d.n) + '% · ' + d.tasks + ' tasks' };
    }).sort(function (a, b) { return b.value - a.value; });
    TF.charts.hbars(TF.qs('#deptBars', root), rows);

    TF.charts.bars(TF.qs('#repWeek', root), TF.weekly.map(function (d) {
      return { label: d.label, values: [
        { value: d.completed, color: '#10b981', name: 'completed' },
        { value: d.created, color: '#94a3b8', name: 'created' }
      ] };
    }));
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
              '<button class="btn btn--outline btn--sm" style="margin-left:auto" data-action="soon">Change photo</button>' +
            '</div>' +
            '<div class="form-grid">' +
              '<label class="field"><span class="field__label">Full name</span><span class="field__control"><input value="Rizwan Hanif" /></span></label>' +
              '<label class="field"><span class="field__label">Role</span><span class="field__control"><input value="Operations Director" /></span></label>' +
              '<label class="field span-2"><span class="field__label">Email</span><span class="field__control"><input value="rizwan@utopiafulfillment.com" /></span></label>' +
            '</div>' +
          '</div>' +
          '<div class="card__foot" style="display:flex;justify-content:flex-end;gap:9px">' +
            '<button class="btn btn--ghost btn--sm" data-action="soon">Discard</button>' +
            '<button class="btn btn--primary btn--sm" data-action="save-profile">Save changes</button>' +
          '</div>' +
        '</section>' +

        '<section class="card">' +
          '<div class="card__head"><div><h3>Demo workspace</h3><p>This build has no backend — everything lives in your browser</p></div></div>' +
          '<div class="card__body">' +
            row('Motion &amp; animation', 'Turn off if you prefer a calmer, static interface.', toggle('motion', s.prefs.motion)) +
            row('Compact task rows', 'Show more tasks per screen in list views.', toggle('compact', s.prefs.compact)) +
            '<div class="set-row"><div class="set-row__meta"><b>Reset demo data</b>' +
              '<p>Restore the original seeded tasks, notifications and activity. This cannot be undone.</p></div>' +
              '<button class="btn btn--danger btn--sm" data-action="reset-demo">' + TF.icon('i-refresh') + 'Reset workspace</button></div>' +
          '</div>' +
        '</section>' +
      '</div>' +
    '</div>';
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
