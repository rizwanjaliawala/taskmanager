/* ==========================================================================
   TaskFlow — data dictionaries
   Live data (users, tasks, notifications) comes from the API via
   TF.hydrate() in app.js. This file only holds static lookups.
   ========================================================================== */
window.TF = window.TF || {};

(function (TF) {
  'use strict';

  /* Populated by TF.hydrate() from GET /api/bootstrap. */
  TF.CURRENT_USER = null;
  TF.users = [];
  TF.userMap = {};
  TF.tasks = [];
  TF.notifications = [];
  TF.PROJECTS = [];

  TF.user = function (id) { return TF.userMap[id] || { name: 'Unknown', initials: '?', c1: '#94a3b8', c2: '#64748b' }; };
  TF.userName = function (id) { return (TF.userMap[id] || {}).name || 'Someone'; };

  /* ---------- status / priority dictionaries (unchanged) ---------- */
  TF.STATUS = {
    assigned:  { key: 'assigned',  label: 'Pending',     color: '#64748b', tone: 'slate',  icon: 'i-inbox' },
    progress:  { key: 'progress',  label: 'In Progress', color: '#3b82f6', tone: 'blue',   icon: 'i-dot-circle' },
    hold:      { key: 'hold',      label: 'On Hold',     color: '#f59e0b', tone: 'amber',  icon: 'i-pause' },
    completed: { key: 'completed', label: 'Completed',   color: '#10b981', tone: 'green',  icon: 'i-check' },
    overdue:   { key: 'overdue',   label: 'Overdue',     color: '#ef4444', tone: 'red',    icon: 'i-alert' },
    cancelled: { key: 'cancelled', label: 'Cancelled',   color: '#94a3b8', tone: 'slate',  icon: 'i-x' }
  };
  TF.STATUS_ORDER = ['assigned', 'progress', 'hold', 'completed', 'overdue', 'cancelled'];

  TF.PRIORITY = {
    low:      { key: 'low',      label: 'Low',      color: '#64748b', tone: 'slate',  rank: 0 },
    medium:   { key: 'medium',   label: 'Medium',   color: '#3b82f6', tone: 'blue',   rank: 1 },
    high:     { key: 'high',     label: 'High',     color: '#f59e0b', tone: 'amber',  rank: 2 },
    critical: { key: 'critical', label: 'Critical', color: '#ef4444', tone: 'red',    rank: 3 }
  };
  TF.PRIORITY_ORDER = ['low', 'medium', 'high', 'critical'];

  TF.ROLE_LABELS = {
    director: 'Director', sr_manager: 'Sr. Manager', manager: 'Manager', dm: 'DM',
    sr_am: 'Sr. AM', am: 'AM', sr_executive: 'Sr Executive', executive: 'Executive'
  };
  TF.ROLE_ORDER = ['director','sr_manager','manager','dm','sr_am','am','sr_executive','executive'];

  /* ---------- seeded activity per task (kept for TF.timelineItem's icon/tone lookup) ---------- */
  var ACT = {
    created:  { icon: 'i-sparkle',    tone: 'green',  label: 'Task created' },
    assigned: { icon: 'i-user',       tone: 'blue',   label: 'Task assigned' },
    status:   { icon: 'i-layers',     tone: 'purple', label: 'Status changed' },
    progress: { icon: 'i-trend-up',   tone: 'amber',  label: 'Progress updated' },
    comment:  { icon: 'i-comment',    tone: 'slate',  label: 'Comment added' },
    done:     { icon: 'i-check',      tone: 'green',  label: 'Task completed' },
    file:     { icon: 'i-clip',       tone: 'slate',  label: 'Attachment added' },
    priority: { icon: 'i-flame',      tone: 'red',    label: 'Priority changed' }
  };
  TF.ACT = ACT;

  TF.NOTIF_STYLE = {
    assigned: { icon: 'i-inbox',    color: '#3b82f6' },
    done:     { icon: 'i-check',    color: '#10b981' },
    overdue:  { icon: 'i-alert',    color: '#ef4444' },
    comment:  { icon: 'i-comment',  color: '#8b5cf6' },
    progress: { icon: 'i-trend-up', color: '#f59e0b' },
    mention:  { icon: 'i-user',     color: '#06b6d4' },
    created:  { icon: 'i-sparkle',  color: '#10b981' }
  };
}(window.TF));
