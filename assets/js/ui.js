/* ==========================================================================
   TaskFlow — UI kit: DOM helpers, formatters, atoms, toasts, animations
   ========================================================================== */
(function (TF) {
  'use strict';

  /* ------------------------------ DOM ------------------------------ */
  TF.qs = function (sel, root) { return (root || document).querySelector(sel); };
  TF.qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  TF.el = function (html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = String(html).trim();
    return tpl.content.firstElementChild;
  };

  TF.esc = function (s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  TF.icon = function (name, cls) {
    return '<svg class="ico ' + (cls || '') + '"><use href="#i-' + name + '"></use></svg>';
  };

  TF.reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------ dates ------------------------------ */
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  TF.MONTHS = MONTHS; TF.MON = MON; TF.DOW = DOW;

  function startOfDay(ts) { var d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  TF.startOfDay = startOfDay;
  TF.sameDay = function (a, b) { return startOfDay(a) === startOfDay(b); };
  TF.dayDiff = function (ts) { return Math.round((startOfDay(ts) - startOfDay(Date.now())) / 86400000); };

  TF.fmtTime = function (ts) {
    var d = new Date(ts), h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return h + ':' + (m < 10 ? '0' + m : m) + ' ' + ap;
  };

  TF.fmtDate = function (ts, withYear) {
    var d = new Date(ts);
    return MON[d.getMonth()] + ' ' + d.getDate() + (withYear ? ', ' + d.getFullYear() : '');
  };

  /* "Today, 4:30 PM" / "Tomorrow" / "3 days overdue" */
  TF.fmtDue = function (ts, done) {
    var diff = TF.dayDiff(ts);
    if (done) return 'Delivered ' + TF.fmtDate(ts);
    if (diff === 0) return 'Today, ' + TF.fmtTime(ts);
    if (diff === 1) return 'Tomorrow, ' + TF.fmtTime(ts);
    if (diff === -1) return 'Yesterday · overdue';
    if (diff < 0) return Math.abs(diff) + ' days overdue';
    if (diff <= 6) return DOW[new Date(ts).getDay()] + ', ' + TF.fmtTime(ts);
    return TF.fmtDate(ts);
  };

  TF.dueTone = function (t) {
    if (t.status === 'completed') return '';
    var diff = TF.dayDiff(t.due);
    if (diff < 0) return 'is-late';
    if (diff === 0) return 'is-today';
    return '';
  };

  TF.relTime = function (ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + ' min ago';
    if (s < 86400) { var h = Math.floor(s / 3600); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
    var d = Math.floor(s / 86400);
    if (d === 1) return 'Yesterday';
    if (d < 7) return d + ' days ago';
    if (s < 0) return 'in ' + TF.fmtDate(ts);
    return TF.fmtDate(ts);
  };

  TF.toInputDate = function (ts) {
    var d = new Date(ts);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  };

  /* ------------------------------ atoms ------------------------------ */
  TF.avatarHTML = function (userId, size, extra) {
    var u = TF.user(userId);
    return '<span class="avatar ' + (size ? 'avatar--' + size : '') + ' ' + (extra || '') + '" ' +
      'style="--av-1:' + u.c1 + ';--av-2:' + u.c2 + '" title="' + TF.esc(u.name) + '">' + u.initials + '</span>';
  };

  TF.statusChip = function (key) {
    var s = TF.STATUS[key] || TF.STATUS.assigned;
    return '<span class="chip chip--' + s.tone + '"><i class="chip__dot"></i>' + s.label + '</span>';
  };

  TF.prioChip = function (key) {
    var p = TF.PRIORITY[key] || TF.PRIORITY.medium;
    var ic = key === 'critical' ? 'i-flame' : key === 'high' ? 'i-alert' : key === 'low' ? 'i-chev-down' : 'i-dot-circle';
    return '<span class="chip chip--' + p.tone + '">' + TF.icon(ic) + p.label + '</span>';
  };

  TF.progressBar = function (pct, tone, big) {
    return '<span class="progress ' + (tone ? 'progress--' + tone : '') + (big ? ' progress--lg' : '') + '">' +
      '<span class="progress__fill" data-fill="' + pct + '"></span></span>';
  };

  TF.progressTone = function (t) {
    if (t.status === 'completed') return '';
    if (t.status === 'overdue') return 'red';
    if (t.status === 'hold') return 'amber';
    if (t.status === 'assigned') return 'slate';
    return 'blue';
  };

  /* animate every [data-fill] inside a root from 0 to its value */
  TF.playBars = function (root, delayStep) {
    var bars = TF.qsa('[data-fill]', root || document);
    bars.forEach(function (b, i) {
      var v = b.getAttribute('data-fill');
      b.style.width = '0%';
      setTimeout(function () { b.style.width = v + '%'; }, TF.reduceMotion ? 0 : 90 + i * (delayStep === undefined ? 45 : delayStep));
    });
  };

  /* ------------------------------ count-up ------------------------------ */
  TF.countUp = function (node, to, opts) {
    opts = opts || {};
    var dur = TF.reduceMotion ? 0 : (opts.duration || 1400);
    var suffix = opts.suffix || '';
    var prefix = opts.prefix || '';
    var dec = opts.decimals || 0;
    var from = opts.from || 0;
    var start = null;

    function settle() {
      node.textContent = prefix + (dec ? to.toFixed(dec) : Math.round(to).toLocaleString()) + suffix;
    }
    if (!dur) { settle(); return; }

    /* safety net: if rAF is paused (background tab) land on the final value anyway */
    var guard = setTimeout(settle, dur + 400);

    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3.2);
      var v = from + (to - from) * eased;
      node.textContent = prefix + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString()) + suffix;
      if (p < 1) requestAnimationFrame(frame);
      else { clearTimeout(guard); settle(); }
    }
    requestAnimationFrame(frame);
  };

  TF.playCounters = function (root) {
    TF.qsa('[data-countup]', root || document).forEach(function (n, i) {
      var to = parseFloat(n.getAttribute('data-countup'));
      var dec = n.getAttribute('data-decimals');
      setTimeout(function () {
        TF.countUp(n, to, {
          suffix: n.getAttribute('data-suffix') || '',
          prefix: n.getAttribute('data-prefix') || '',
          decimals: dec ? parseInt(dec, 10) : 0,
          duration: 1200 + i * 60
        });
      }, TF.reduceMotion ? 0 : i * 70);
    });
  };

  /* ------------------------------ toasts ------------------------------ */
  var TOAST_STYLE = {
    success: { icon: 'i-check',    color: '#10b981' },
    info:    { icon: 'i-bell',     color: '#3b82f6' },
    warn:    { icon: 'i-alert',    color: '#f59e0b' },
    danger:  { icon: 'i-alert',    color: '#ef4444' },
    task:    { icon: 'i-target',   color: '#8b5cf6' },
    magic:   { icon: 'i-sparkle',  color: '#10b981' }
  };

  TF.toast = function (opts) {
    var host = TF.qs('#toasts');
    if (!host) return;
    var st = TOAST_STYLE[opts.type] || TOAST_STYLE.info;
    var dur = opts.duration || 4600;

    var node = TF.el(
      '<div class="toast" style="--tc:' + st.color + ';--tc-bg:' + st.color + '1f;--dur:' + dur + 'ms">' +
        '<span class="toast__ico">' + TF.icon(opts.icon || st.icon) + '</span>' +
        '<div class="toast__body"><b>' + (opts.title || '') + '</b>' +
          (opts.body ? '<p>' + opts.body + '</p>' : '') + '</div>' +
        '<button class="toast__close" aria-label="Dismiss">' + TF.icon('i-x') + '</button>' +
        '<span class="toast__bar"></span>' +
      '</div>'
    );

    var timer = setTimeout(close, dur);
    function close() {
      clearTimeout(timer);
      node.classList.add('is-out');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 340);
    }
    node.querySelector('.toast__close').addEventListener('click', close);
    node.addEventListener('click', function (e) {
      if (e.target.closest('.toast__close')) return;
      if (opts.onClick) { opts.onClick(); close(); }
    });
    node.addEventListener('mouseenter', function () {
      clearTimeout(timer);
      var bar = node.querySelector('.toast__bar');
      if (bar) bar.style.animationPlayState = 'paused';
    });
    node.addEventListener('mouseleave', function () {
      var bar = node.querySelector('.toast__bar');
      if (bar) bar.style.animationPlayState = 'running';
      timer = setTimeout(close, 1800);
    });

    host.appendChild(node);
    while (host.children.length > 4) host.removeChild(host.firstElementChild);
    return node;
  };

  /* ------------------------------ celebration ------------------------------ */
  TF.burst = function (anchor, count) {
    if (TF.reduceMotion || !anchor) return;
    var rect = anchor.getBoundingClientRect();
    var colors = ['#10b981', '#34d399', '#3b82f6', '#f59e0b', '#8b5cf6'];
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:' + (rect.left + rect.width / 2) + 'px;top:' + (rect.top + rect.height / 2) + 'px;z-index:135;pointer-events:none';
    document.body.appendChild(host);
    for (var i = 0; i < (count || 16); i++) {
      var s = document.createElement('i');
      var a = (Math.PI * 2 * i) / (count || 16) + Math.random() * 0.5;
      var dist = 60 + Math.random() * 70;
      s.className = 'spark';
      s.style.cssText = '--sc:' + colors[i % colors.length] +
        ';--tx:' + (Math.cos(a) * dist).toFixed(1) + 'px;--ty:' + (Math.sin(a) * dist).toFixed(1) +
        'px;animation-delay:' + (Math.random() * 90).toFixed(0) + 'ms';
      host.appendChild(s);
    }
    setTimeout(function () { if (host.parentNode) host.parentNode.removeChild(host); }, 1200);
  };

  /* ------------------------------ empty state ------------------------------ */
  TF.emptyState = function (o) {
    return '<div class="empty">' +
      '<div class="empty__art"><span class="empty__ring"></span><span class="empty__ring empty__ring--2"></span>' +
      '<span class="empty__ico">' + TF.icon(o.icon || 'i-target') + '</span></div>' +
      '<h4>' + o.title + '</h4><p>' + o.text + '</p>' +
      (o.action ? '<button class="btn btn--soft btn--sm" ' + (o.action.attrs || '') + '>' + TF.icon(o.action.icon || 'i-plus') + o.action.label + '</button>' : '') +
      '</div>';
  };

  /* ------------------------------ chart tooltip ------------------------------ */
  var tipNode = null;
  TF.tip = {
    show: function (x, y, html) {
      if (!tipNode) {
        tipNode = TF.el('<div class="chart-tip"></div>');
        document.body.appendChild(tipNode);
      }
      tipNode.innerHTML = html;
      tipNode.style.left = x + 'px';
      tipNode.style.top = y + 'px';
      requestAnimationFrame(function () { tipNode.classList.add('is-on'); });
    },
    move: function (x, y) { if (tipNode) { tipNode.style.left = x + 'px'; tipNode.style.top = y + 'px'; } },
    hide: function () { if (tipNode) tipNode.classList.remove('is-on'); }
  };

  /* ------------------------------ misc ------------------------------ */
  TF.pluralize = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };

  TF.debounce = function (fn, ms) {
    var t;
    return function () {
      var a = arguments, c = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(c, a); }, ms || 160);
    };
  };

  TF.highlight = function (text, q) {
    if (!q) return TF.esc(text);
    var i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return TF.esc(text);
    return TF.esc(text.slice(0, i)) + '<mark>' + TF.esc(text.slice(i, i + q.length)) + '</mark>' + TF.esc(text.slice(i + q.length));
  };

}(window.TF));
