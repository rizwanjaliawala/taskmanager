/* ==========================================================================
   Utopia Trucking Task Manager — API client
   Thin fetch wrapper. Same-origin, cookie-based auth.

   Cross-tab refresh coordination
   -------------------------------
   Two tabs share the same refresh cookie but keep independent JS state. If
   both access tokens lapse at the same moment, both tabs would otherwise fire
   POST /auth/refresh concurrently — and the backend's refresh-token rotation
   treats the loser as a replay and signs the user out of *every* device. To
   avoid that we elect a single refresher across tabs with a short-lived
   localStorage lock (a timestamped key with a TTL so a tab that crashes
   mid-refresh cannot deadlock every other tab forever). A tab that loses the
   race does not refresh itself — it waits briefly for the lock to clear, then
   retries its own original request once the winner's refresh has landed.
   ========================================================================== */
window.TF = window.TF || {};

(function (TF) {
  'use strict';

  var BASE = '/api';

  function ApiError(code, message, status, details) {
    var e = new Error(message);
    e.name = 'ApiError';
    e.code = code;
    e.status = status;
    e.details = details;
    return e;
  }

  /* Friendly copy for every documented error code. */
  var MESSAGES = {
    INVALID_CREDENTIALS: 'Incorrect email or password.',
    UNAUTHORIZED: 'Your session has ended. Please sign in again.',
    FORBIDDEN: 'You do not have permission to do that.',
    PASSWORD_CHANGE_REQUIRED: 'Please change your password to continue.',
    ACCOUNT_INACTIVE: 'This account has been deactivated. Contact your Manager.',
    USER_EXISTS: 'A user with that email address already exists.',
    USER_NOT_FOUND: 'That user could not be found.',
    TASK_NOT_FOUND: 'That task could not be found.',
    INVALID_ASSIGNMENT: 'That task cannot be assigned to the selected person.',
    INVALID_STATUS_TRANSITION: 'That status change is not allowed.',
    SELF_ACTION_FORBIDDEN: 'You cannot do that to your own account.',
    LAST_MANAGER: 'This is the only active Manager — promote someone else first, otherwise nobody can manage the team.',
    VALIDATION_ERROR: 'Please check the highlighted fields.',
    RATE_LIMITED: 'Too many attempts. Please wait a few minutes.',
    EMAIL_FAILED: 'The task was saved but the notification email could not be sent.',
    DATABASE_ERROR: 'We could not reach the database. Please try again.',
    NOT_FOUND: 'That could not be found.',
    INTERNAL_ERROR: 'Something went wrong. Please try again.'
  };

  /* ---------- cross-tab refresh mutex (localStorage) ---------- */
  var LOCK_KEY = 'utm.refreshLock.v1';
  var LOCK_TTL = 5000;      /* a crashed tab's lock is ignored after this long */
  var WAIT_STEP = 150;      /* how often a waiting tab re-checks the lock */
  var WAIT_MAX_MS = 8000;   /* well beyond LOCK_TTL, so waiting always terminates */
  var TAB_ID = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2);

  function hasStorage() {
    try { return !!window.localStorage; } catch (e) { return false; }
  }

  function readLock() {
    if (!hasStorage()) return null;
    var raw;
    try { raw = localStorage.getItem(LOCK_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /** A lock older than LOCK_TTL belongs to a tab that died mid-refresh — treat it as free. */
  function isLocked() {
    var lock = readLock();
    return !!lock && (Date.now() - lock.ts) < LOCK_TTL;
  }

  function tryAcquireLock() {
    if (!hasStorage()) return true; /* no cross-tab coordination possible; proceed solo */
    if (isLocked()) return false;
    var mine = { id: TAB_ID, ts: Date.now() };
    try {
      localStorage.setItem(LOCK_KEY, JSON.stringify(mine));
      var check = readLock();
      return !!check && check.id === TAB_ID;
    } catch (e) { return true; }
  }

  function releaseLock() {
    if (!hasStorage()) return;
    var lock = readLock();
    if (lock && lock.id === TAB_ID) {
      try { localStorage.removeItem(LOCK_KEY); } catch (e) { /* ignore */ }
    }
  }

  function waitForLockRelease(waited) {
    waited = waited || 0;
    if (!isLocked() || waited >= WAIT_MAX_MS) return Promise.resolve();
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(waitForLockRelease(waited + WAIT_STEP)); }, WAIT_STEP);
    });
  }

  /**
   * Runs the actual POST /auth/refresh if this tab wins the cross-tab lock;
   * otherwise waits for the winning tab to finish rather than refreshing too.
   * Resolves true/false — true means "safe to retry the original request".
   */
  function coordinateRefresh() {
    if (tryAcquireLock()) {
      return send('POST', '/auth/refresh').then(function (rr) {
        releaseLock();
        return rr.res.ok;
      }).catch(function () {
        releaseLock();
        return false;
      });
    }
    /* Someone else (this tab's earlier call, or another tab) is refreshing.
       Do not race it — wait, then let the caller retry its own request. */
    return waitForLockRelease().then(function () { return true; });
  }

  function send(method, path, body) {
    var opts = {
      method: method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(BASE + path, opts).then(function (res) {
      return res.text().then(function (text) {
        var payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON */ }
        return { res: res, payload: payload };
      });
    });
  }

  var refreshing = null; /* de-dupes concurrent refreshes within this tab */

  /**
   * On 401 the access cookie has expired. Coordinate a single refresh across
   * tabs (see header comment), then retry the original request once. A failed
   * refresh surfaces as UNAUTHORIZED and the app returns to login.
   */
  function request(method, path, body) {
    return send(method, path, body).then(function (r) {
      if (r.res.status === 401 && path.indexOf('/auth/') !== 0) {
        if (!refreshing) {
          refreshing = coordinateRefresh().then(function (ok) {
            refreshing = null;
            return ok;
          });
        }
        return refreshing.then(function (okRefresh) {
          if (!okRefresh) return r;
          return send(method, path, body);
        });
      }
      return r;
    }).then(function (r) {
      var payload = r.payload;
      if (r.res.ok && payload && payload.ok) return payload.data;

      var err = (payload && payload.error) || {};
      var code = err.code || 'INTERNAL_ERROR';
      throw ApiError(code, MESSAGES[code] || err.message || 'Request failed',
        r.res.status, err.details);
    });
  }

  TF.api = {
    MESSAGES: MESSAGES,
    request: request,
    get:   function (p) { return request('GET', p); },
    post:  function (p, b) { return request('POST', p, b === undefined ? {} : b); },
    patch: function (p, b) { return request('PATCH', p, b); },
    del:   function (p) { return request('DELETE', p); },

    /* auth */
    login: function (email, password) { return request('POST', '/auth/login', { email: email, password: password }); },
    logout: function () { return request('POST', '/auth/logout', {}); },
    me: function () { return request('GET', '/auth/me'); },
    /* Self-service profile edit — name, job title, department only. Role and email
       are Manager-controlled and the server refuses them from this endpoint. */
    updateMyProfile: function (patch) { return request('PATCH', '/auth/me', patch); },

    changePassword: function (currentPassword, newPassword, confirmPassword) {
      return request('POST', '/auth/change-password', {
        currentPassword: currentPassword, newPassword: newPassword, confirmPassword: confirmPassword
      });
    },

    /* data */
    bootstrap: function () { return request('GET', '/bootstrap'); },
    dashboard: function () { return request('GET', '/dashboard'); },

    /* users */
    listUsers: function () { return request('GET', '/users'); },
    createUser: function (input) { return request('POST', '/users', input); },
    updateUser: function (id, patch) { return request('PATCH', '/users/' + id, patch); },
    setUserActive: function (id, active) {
      return request('POST', '/users/' + id + (active ? '/activate' : '/deactivate'), {});
    },

    /* tasks */
    listTasks: function () { return request('GET', '/tasks'); },
    createTask: function (input) { return request('POST', '/tasks', input); },
    updateTask: function (id, patch) { return request('PATCH', '/tasks/' + id, patch); },
    deleteTask: function (id) { return request('DELETE', '/tasks/' + id); },
    assignTask: function (id, assigneeId) {
      return request('POST', '/tasks/' + id + '/assign', { assigneeId: assigneeId });
    },
    setTaskStatus: function (id, status) {
      return request('POST', '/tasks/' + id + '/status', { status: status });
    },
    completeTask: function (id) { return request('POST', '/tasks/' + id + '/complete', {}); },
    reopenTask: function (id) { return request('POST', '/tasks/' + id + '/reopen', {}); },
    cancelTask: function (id) { return request('POST', '/tasks/' + id + '/cancel', {}); },
    taskHistory: function (id) { return request('GET', '/tasks/' + id + '/history'); },
    taskComments: function (id) { return request('GET', '/tasks/' + id + '/comments'); },
    addComment: function (id, body) {
      return request('POST', '/tasks/' + id + '/comments', { body: body });
    },

    /* notifications */
    notifications: function () { return request('GET', '/notifications'); },
    markNotificationRead: function (id) { return request('PATCH', '/notifications/' + id + '/read'); },
    markAllNotificationsRead: function () { return request('POST', '/notifications/read-all', {}); }
  };

  /** Shows the standard error toast. Use in every catch block. */
  TF.apiError = function (err, fallbackTitle) {
    TF.toast({
      type: 'danger',
      title: fallbackTitle || 'Something went wrong',
      body: (err && err.message) || MESSAGES.INTERNAL_ERROR
    });
  };
}(window.TF));
