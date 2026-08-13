/* ==========================================================================
   TaskFlow — hand-built SVG charts (no dependencies)
   ========================================================================== */
(function (TF) {
  'use strict';

  var uid = 0;
  function nextId(p) { return p + '-' + (++uid); }

  var Charts = {};
  TF.charts = Charts;

  /* ------------------------------------------------------------------
     Circular progress ring
     ------------------------------------------------------------------ */
  Charts.ring = function (host, pct, opts) {
    opts = opts || {};
    var size = opts.size || 168, sw = opts.width || 13;
    var r = (size - sw) / 2 - 2;
    var c = 2 * Math.PI * r;
    var gid = nextId('ringGrad');

    host.innerHTML =
      '<svg viewBox="0 0 ' + size + ' ' + size + '">' +
        '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0%" stop-color="' + (opts.from || '#34d399') + '"/>' +
          '<stop offset="100%" stop-color="' + (opts.to || '#059669') + '"/>' +
        '</linearGradient></defs>' +
        '<circle class="ring__track" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="' + sw + '"/>' +
        '<circle class="ring__bar" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="' + sw + '" ' +
          'stroke="url(#' + gid + ')" stroke-dasharray="' + c + '" stroke-dashoffset="' + c + '"/>' +
      '</svg>' +
      '<div class="ring__center">' +
        '<div class="ring__value" data-ring-val>0%</div>' +
        '<div class="ring__label">' + (opts.label || 'Productivity') + '</div>' +
      '</div>';

    var bar = host.querySelector('.ring__bar');
    var val = host.querySelector('[data-ring-val]');
    setTimeout(function () {
      bar.style.strokeDashoffset = c - (c * pct) / 100;
      TF.countUp(val, pct, { suffix: '%', duration: 1600 });
    }, TF.reduceMotion ? 0 : 220);

    return {
      set: function (p) {
        bar.style.strokeDashoffset = c - (c * p) / 100;
        TF.countUp(val, p, { suffix: '%', duration: 700, from: parseFloat(val.textContent) || 0 });
      }
    };
  };

  /* ------------------------------------------------------------------
     Donut with hover tooltip + legend linkage
     segs: [{ key, label, value, color }]
     ------------------------------------------------------------------ */
  Charts.donut = function (host, segs, opts) {
    opts = opts || {};
    var size = 200, sw = 22, r = (size - sw) / 2 - 6;
    var c = 2 * Math.PI * r;
    var total = segs.reduce(function (a, s) { return a + s.value; }, 0) || 1;

    var body = '', acc = 0;
    segs.forEach(function (s, i) {
      var len = (s.value / total) * c;
      body += '<circle class="donut__seg" data-key="' + s.key + '" data-i="' + i + '" ' +
        'cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" ' +
        'stroke="' + s.color + '" stroke-linecap="butt" ' +
        'stroke-dasharray="0 ' + c + '" stroke-dashoffset="' + (-acc) + '"></circle>';
      acc += len;
    });

    host.innerHTML =
      '<svg viewBox="0 0 ' + size + ' ' + size + '">' + body + '</svg>' +
      '<div class="donut__center"><b data-donut-total>0</b><span>' + (opts.centerLabel || 'total tasks') + '</span></div>';

    /* animate segment growth */
    var circles = TF.qsa('.donut__seg', host);
    var acc2 = 0;
    segs.forEach(function (s, i) {
      var len = (s.value / total) * c;
      var el = circles[i];
      setTimeout(function () {
        el.setAttribute('stroke-dasharray', len + ' ' + (c - len));
      }, TF.reduceMotion ? 0 : 180 + i * 110);
      acc2 += len;
    });
    TF.countUp(host.querySelector('[data-donut-total]'), total, { duration: 1400 });

    /* hover */
    circles.forEach(function (el, i) {
      var s = segs[i];
      el.addEventListener('mouseenter', function (e) {
        host.classList.add('is-hovering');
        TF.tip.show(e.clientX, e.clientY,
          '<b>' + s.label + '</b> · ' + s.value +
          '<i>' + Math.round((s.value / total) * 100) + '% of all tasks</i>');
        if (opts.onHover) opts.onHover(s.key);
      });
      el.addEventListener('mousemove', function (e) { TF.tip.move(e.clientX, e.clientY); });
      el.addEventListener('mouseleave', function () {
        host.classList.remove('is-hovering');
        TF.tip.hide();
        if (opts.onHover) opts.onHover(null);
      });
      el.addEventListener('click', function () { if (opts.onClick) opts.onClick(s.key); });
    });

    return {
      focus: function (key) {
        host.classList.toggle('is-hovering', !!key);
        circles.forEach(function (el, i) {
          el.style.opacity = !key || segs[i].key === key ? '1' : '';
        });
      }
    };
  };

  /* ------------------------------------------------------------------
     Grouped vertical bars
     data: [{ label, values:[{value,color,name}] }]
     ------------------------------------------------------------------ */
  Charts.bars = function (host, data, opts) {
    opts = opts || {};
    var max = opts.max || Math.max.apply(null, data.map(function (d) {
      return d.values.reduce(function (a, v) { return a + v.value; }, 0);
    })) || 1;

    host.setAttribute('class', 'bars');
    host.innerHTML = data.map(function (d, i) {
      var stack = d.values.map(function (v, j) {
        var h = (v.value / max) * 100;
        return '<i class="bar" style="--bc:' + v.color + ';--bd:' + (i * 60 + j * 40) + 'ms" data-h="' + h + '" ' +
          'data-name="' + TF.esc(v.name) + '" data-val="' + v.value + '"></i>';
      }).join('');
      return '<div class="bar-col"><div class="bar-col__stack">' + stack + '</div>' +
        '<span class="bar-col__label">' + TF.esc(d.label) + '</span></div>';
    }).join('');

    TF.qsa('.bar', host).forEach(function (b) {
      setTimeout(function () { b.style.height = b.getAttribute('data-h') + '%'; }, TF.reduceMotion ? 0 : 60);
      b.addEventListener('mouseenter', function (e) {
        TF.tip.show(e.clientX, e.clientY, '<b>' + b.getAttribute('data-val') + '</b> ' + b.getAttribute('data-name'));
      });
      b.addEventListener('mousemove', function (e) { TF.tip.move(e.clientX, e.clientY); });
      b.addEventListener('mouseleave', TF.tip.hide);
    });
  };

  /* ------------------------------------------------------------------
     Smooth area/line chart
     series: [{value,label}]
     ------------------------------------------------------------------ */
  Charts.line = function (host, series, opts) {
    opts = opts || {};
    var W = 640, H = 220, padL = 34, padR = 12, padT = 16, padB = 26;
    var color = opts.color || '#10b981';
    var gid = nextId('lineGrad');

    var vals = series.map(function (d) { return d.value; });
    var min = opts.min !== undefined ? opts.min : Math.min.apply(null, vals);
    var max = opts.max !== undefined ? opts.max : Math.max.apply(null, vals);
    var pad = (max - min) * 0.25 || 1;
    min = Math.max(0, min - pad); max = max + pad;

    var iw = W - padL - padR, ih = H - padT - padB;
    function px(i) { return padL + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw); }
    function py(v) { return padT + ih - ((v - min) / (max - min)) * ih; }

    /* catmull-rom -> bezier for a smooth line */
    var pts = series.map(function (d, i) { return [px(i), py(d.value)]; });
    var path = 'M' + pts[0][0] + ',' + pts[0][1];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      path += ' C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
    }
    var area = path + ' L' + pts[pts.length - 1][0] + ',' + (padT + ih) + ' L' + pts[0][0] + ',' + (padT + ih) + ' Z';

    /* grid + y labels */
    var grid = '', steps = 4;
    for (var g = 0; g <= steps; g++) {
      var y = padT + (ih / steps) * g;
      var v = max - ((max - min) / steps) * g;
      grid += '<line class="grid-line" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '"/>' +
        '<text class="axis-text" x="' + (padL - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' +
        (opts.decimals ? v.toFixed(1) : Math.round(v)) + (opts.unit || '') + '</text>';
    }

    var xlab = series.map(function (d, i) {
      if (series.length > 8 && i % 2 !== 0 && i !== series.length - 1) return '';
      return '<text class="axis-text" x="' + px(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + TF.esc(d.label) + '</text>';
    }).join('');

    var dots = series.map(function (d, i) {
      return '<circle class="pt" cx="' + px(i).toFixed(1) + '" cy="' + py(d.value).toFixed(1) + '" r="4" fill="' + color + '" stroke="var(--surface)" stroke-width="2"/>' +
        '<rect class="hit" x="' + (px(i) - iw / (series.length * 2)).toFixed(1) + '" y="' + padT + '" width="' + (iw / series.length).toFixed(1) + '" height="' + ih + '" ' +
        'data-label="' + TF.esc(d.label) + '" data-val="' + d.value + '"/>';
    }).join('');

    host.setAttribute('class', 'line-chart');
    host.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    host.setAttribute('preserveAspectRatio', 'none');
    host.innerHTML =
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + color + '" stop-opacity=".28"/>' +
        '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      grid + xlab +
      '<path class="area" d="' + area + '" fill="url(#' + gid + ')"/>' +
      '<path class="line" d="' + path + '" stroke="' + color + '"/>' +
      dots;

    var lineEl = host.querySelector('.line');
    var len = lineEl.getTotalLength ? lineEl.getTotalLength() : 1200;
    lineEl.style.setProperty('--len', len);
    setTimeout(function () { host.classList.add('is-in'); }, TF.reduceMotion ? 0 : 90);

    TF.qsa('.hit', host).forEach(function (h) {
      h.addEventListener('mouseenter', function (e) {
        TF.tip.show(e.clientX, e.clientY,
          '<b>' + h.getAttribute('data-val') + (opts.unit || '') + '</b><i>' + h.getAttribute('data-label') + '</i>');
      });
      h.addEventListener('mousemove', function (e) { TF.tip.move(e.clientX, e.clientY); });
      h.addEventListener('mouseleave', TF.tip.hide);
    });
  };

  /* ------------------------------------------------------------------
     Tiny sparkline (string output — used inside KPI cards)
     ------------------------------------------------------------------ */
  Charts.sparkline = function (values, color) {
    var W = 120, H = 34, min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var span = (max - min) || 1;
    var gid = nextId('spark');
    var pts = values.map(function (v, i) {
      return [(i / (values.length - 1)) * W, H - 3 - ((v - min) / span) * (H - 8)];
    });
    var d = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' L');
    var area = d + ' L' + W + ',' + H + ' L0,' + H + ' Z';
    return '<svg class="kpi__spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity=".3"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/></svg>';
  };

  /* ------------------------------------------------------------------
     Horizontal comparison bars
     rows: [{ label, value, max, color, meta }]
     ------------------------------------------------------------------ */
  Charts.hbars = function (host, rows) {
    host.setAttribute('class', 'hbars');
    host.innerHTML = rows.map(function (r) {
      var pct = Math.round((r.value / (r.max || 100)) * 100);
      return '<div class="hbar">' +
        '<div class="hbar__top">' +
          '<span class="hbar__name">' + (r.icon || '') + TF.esc(r.label) + '</span>' +
          '<span class="hbar__val">' + (r.display || pct + '%') + '</span>' +
        '</div>' +
        '<span class="progress"><span class="progress__fill" data-fill="' + pct + '" ' +
        'style="background:linear-gradient(90deg,' + r.color + ',' + (r.color2 || r.color) + ')"></span></span>' +
        '</div>';
    }).join('');
    TF.playBars(host, 70);
  };

}(window.TF));
