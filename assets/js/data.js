/* ==========================================================================
   TaskFlow — Mock data layer
   Everything here is demo data. No network, no backend.
   ========================================================================== */
window.TF = window.TF || {};

(function (TF) {
  'use strict';

  /* ---------- date helpers (all data is relative to "today") ---------- */
  function at(dayOffset, h, m) {
    var d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h === undefined ? 17 : h, m || 0, 0, 0);
    return d.getTime();
  }
  function mins(n) { return Date.now() - n * 60000; }
  TF.at = at;

  /* ---------- people ---------- */
  TF.CURRENT_USER = 'u-rizwan';

  TF.users = [
    { id: 'u-rizwan', name: 'Rizwan Hanif',  initials: 'RH', role: 'Operations Director', dept: 'Executive',        email: 'rizwan@utopiafulfillment.com', c1: '#10b981', c2: '#047857' },
    { id: 'u-john',   name: 'John Smith',    initials: 'JS', role: 'Inbound Supervisor',  dept: 'Operations',       email: 'john@utopiafulfillment.com',   c1: '#60a5fa', c2: '#2563eb' },
    { id: 'u-sarah',  name: 'Sarah Khan',    initials: 'SK', role: 'Logistics Manager',   dept: 'Logistics',        email: 'sarah@utopiafulfillment.com',  c1: '#a78bfa', c2: '#7c3aed' },
    { id: 'u-mike',   name: 'Mike Wilson',   initials: 'MW', role: 'Warehouse Lead',      dept: 'Warehouse',        email: 'mike@utopiafulfillment.com',   c1: '#fbbf24', c2: '#d97706' },
    { id: 'u-aisha',  name: 'Aisha Rahman',  initials: 'AR', role: 'Finance Analyst',     dept: 'Finance',          email: 'aisha@utopiafulfillment.com',  c1: '#34d399', c2: '#059669' },
    { id: 'u-david',  name: 'David Chen',    initials: 'DC', role: 'Compliance Officer',  dept: 'Compliance',       email: 'david@utopiafulfillment.com',  c1: '#f87171', c2: '#dc2626' },
    { id: 'u-emma',   name: 'Emma Torres',   initials: 'ET', role: 'Client Success Lead', dept: 'Customer Success', email: 'emma@utopiafulfillment.com',   c1: '#22d3ee', c2: '#0891b2' },
    { id: 'u-omar',   name: 'Omar Farooq',   initials: 'OF', role: 'Procurement Manager', dept: 'Procurement',      email: 'omar@utopiafulfillment.com',   c1: '#818cf8', c2: '#4f46e5' }
  ];

  TF.userMap = {};
  TF.users.forEach(function (u) { TF.userMap[u.id] = u; });
  TF.user = function (id) { return TF.userMap[id] || TF.userMap[TF.CURRENT_USER]; };
  TF.userName = function (id) { return (TF.userMap[id] || {}).name || 'Someone'; };

  /* ---------- status / priority dictionaries ---------- */
  TF.STATUS = {
    assigned:  { key: 'assigned',  label: 'Assigned',    color: '#64748b', tone: 'slate',  icon: 'i-inbox' },
    progress:  { key: 'progress',  label: 'In Progress', color: '#3b82f6', tone: 'blue',   icon: 'i-dot-circle' },
    hold:      { key: 'hold',      label: 'On Hold',     color: '#f59e0b', tone: 'amber',  icon: 'i-pause' },
    completed: { key: 'completed', label: 'Completed',   color: '#10b981', tone: 'green',  icon: 'i-check' },
    overdue:   { key: 'overdue',   label: 'Overdue',     color: '#ef4444', tone: 'red',    icon: 'i-alert' }
  };
  TF.STATUS_ORDER = ['assigned', 'progress', 'hold', 'completed', 'overdue'];

  TF.PRIORITY = {
    low:      { key: 'low',      label: 'Low',      color: '#64748b', tone: 'slate',  rank: 0 },
    medium:   { key: 'medium',   label: 'Medium',   color: '#3b82f6', tone: 'blue',   rank: 1 },
    high:     { key: 'high',     label: 'High',     color: '#f59e0b', tone: 'amber',  rank: 2 },
    critical: { key: 'critical', label: 'Critical', color: '#ef4444', tone: 'red',    rank: 3 }
  };
  TF.PRIORITY_ORDER = ['low', 'medium', 'high', 'critical'];

  /* ---------- KPI targets -----------------------------------------------
     The visible board is a slice of a 128-task workspace. Offsets between
     the seeded slice and these targets are computed once at boot so the
     headline numbers stay truthful while live edits still move them.     */
  TF.KPI_TARGET = {
    assigned: 6, progress: 42, hold: 4, completed: 67, overdue: 9,
    dueToday: 14, onTime: 55
  };

  /* ---------- tasks ---------- */
  TF.tasks = [
    /* ---- in progress ---- */
    { id: 'TF-1042', title: 'Verify Amazon Container CTNR-88213',
      desc: 'Cross-check the 40ft inbound container manifest against the ASN and flag any short-ships before the dock closes.',
      status: 'progress', priority: 'high', progress: 72, assignee: 'u-john', reporter: 'u-sarah',
      project: 'Inbound Operations', start: at(-3, 9), due: at(0, 16, 30), created: at(-3, 9, 12),
      tags: ['Amazon', 'Inbound', 'Container'],
      attachments: [{ name: 'CTNR-88213-manifest.pdf', size: '2.4 MB' }, { name: 'asn-export.xlsx', size: '318 KB' }] },

    { id: 'TF-1055', title: 'Freight claim — damaged pallets on PO-9921',
      desc: 'Four pallets arrived crushed. Compile photo evidence, BOL and packing list, then file the claim with the carrier.',
      status: 'progress', priority: 'high', progress: 15, assignee: 'u-aisha', reporter: 'u-rizwan',
      project: 'Claims', start: at(-1, 11), due: at(0, 18), created: at(-1, 11),
      tags: ['Claim', 'Carrier'], attachments: [{ name: 'damage-photos.zip', size: '14.1 MB' }] },

    { id: 'TF-1045', title: 'Inbound ASN mismatch investigation',
      desc: 'Three consecutive shipments from Northgate posted quantity variances. Trace the root cause in the WMS receipts.',
      status: 'progress', priority: 'high', progress: 30, assignee: 'u-john', reporter: 'u-rizwan',
      project: 'Inbound Operations', start: at(-2, 10), due: at(0, 17), created: at(-2, 10),
      tags: ['WMS', 'Data'], attachments: [] },

    { id: 'TF-1049', title: 'Customs documentation — container MSCU-4471',
      desc: 'Entry summary and commercial invoice need review before the broker files. Cargo clears Thursday.',
      status: 'progress', priority: 'critical', progress: 60, assignee: 'u-david', reporter: 'u-sarah',
      project: 'Compliance', start: at(-4, 9), due: at(1, 12), created: at(-4, 9),
      tags: ['Customs', 'Import'], attachments: [{ name: 'entry-summary-7501.pdf', size: '860 KB' }] },

    { id: 'TF-1044', title: 'Reconcile detention & demurrage charges',
      desc: 'August invoices show $18.4k in accessorials. Match each charge to a gate-in / gate-out timestamp.',
      status: 'progress', priority: 'medium', progress: 45, assignee: 'u-sarah', reporter: 'u-aisha',
      project: 'Carrier Management', start: at(-5, 9), due: at(2, 17), created: at(-5, 9),
      tags: ['Finance', 'Carrier'], attachments: [] },

    { id: 'TF-1052', title: 'Amazon partnered carrier program setup',
      desc: 'Register the new trailer fleet under the partnered carrier programme and validate rate cards in Seller Central.',
      status: 'progress', priority: 'high', progress: 40, assignee: 'u-sarah', reporter: 'u-rizwan',
      project: 'Amazon Channel', start: at(-6, 9), due: at(3, 17), created: at(-6, 9),
      tags: ['Amazon', 'Carrier'], attachments: [] },

    { id: 'TF-1046', title: 'Board pack — Q3 operations KPIs',
      desc: 'Pull throughput, dock-to-stock and on-time metrics into the quarterly board deck. Narrative on peak readiness.',
      status: 'progress', priority: 'high', progress: 65, assignee: 'u-rizwan', reporter: 'u-rizwan',
      project: 'Leadership', start: at(-7, 9), due: at(2, 12), created: at(-7, 9),
      tags: ['Reporting', 'Leadership'], attachments: [{ name: 'q3-ops-metrics.xlsx', size: '1.1 MB' }] },

    { id: 'TF-1047', title: 'Slotting optimisation — fast-mover zone',
      desc: 'Re-slot the top 200 SKUs into the golden zone to cut pick travel. Coordinate with night shift on the move plan.',
      status: 'progress', priority: 'medium', progress: 58, assignee: 'u-omar', reporter: 'u-mike',
      project: 'Warehouse Efficiency', start: at(-9, 9), due: at(4, 17), created: at(-9, 9),
      tags: ['Slotting', 'Productivity'], attachments: [] },

    { id: 'TF-1048', title: 'Weekly carrier scorecard distribution',
      desc: 'Publish on-time pickup and tender acceptance scores to the five core carriers with commentary.',
      status: 'progress', priority: 'low', progress: 85, assignee: 'u-emma', reporter: 'u-sarah',
      project: 'Carrier Management', start: at(-2, 9), due: at(1, 15), created: at(-2, 9),
      tags: ['Reporting'], attachments: [] },

    { id: 'TF-1054', title: 'Pick-path retraining — night shift',
      desc: 'Run two toolbox sessions on the revised pick path and capture sign-off from all 14 associates.',
      status: 'progress', priority: 'medium', progress: 25, assignee: 'u-mike', reporter: 'u-rizwan',
      project: 'Warehouse Efficiency', start: at(-3, 22), due: at(5, 6), created: at(-3, 20),
      tags: ['Training'], attachments: [] },

    /* ---- overdue ---- */
    { id: 'TF-1035', title: 'Amazon appointment confirmation — FBA delivery',
      desc: 'Appointment window for the FBA shipment was never confirmed in Carrier Central. Rebook before the ISA expires.',
      status: 'overdue', priority: 'critical', progress: 55, assignee: 'u-mike', reporter: 'u-sarah',
      project: 'Amazon Channel', start: at(-6, 9), due: at(-1, 14), created: at(-6, 9),
      tags: ['Amazon', 'Appointment'], attachments: [] },

    { id: 'TF-1040', title: 'Vendor compliance chargeback dispute',
      desc: 'Dispute $4,280 in ASN-accuracy chargebacks. Evidence pack must be uploaded to the vendor portal.',
      status: 'overdue', priority: 'high', progress: 35, assignee: 'u-omar', reporter: 'u-aisha',
      project: 'Vendor Compliance', start: at(-10, 9), due: at(-2, 17), created: at(-10, 9),
      tags: ['Chargeback', 'Finance'], attachments: [{ name: 'chargeback-evidence.pdf', size: '4.7 MB' }] },

    { id: 'TF-1037', title: 'Trailer maintenance log submission',
      desc: 'DOT inspection logs for units 118–124 are outstanding. Collect driver sign-offs and file with fleet.',
      status: 'overdue', priority: 'medium', progress: 20, assignee: 'u-john', reporter: 'u-rizwan',
      project: 'Fleet', start: at(-12, 9), due: at(-3, 17), created: at(-12, 9),
      tags: ['Fleet', 'DOT'], attachments: [] },

    /* ---- assigned ---- */
    { id: 'TF-1063', title: 'Onboard 4 new warehouse associates',
      desc: 'Badges, WMS accounts, safety induction and buddy assignment for the peak-season intake.',
      status: 'assigned', priority: 'medium', progress: 0, assignee: 'u-emma', reporter: 'u-rizwan',
      project: 'People', start: at(0, 8), due: at(0, 17), created: at(-1, 16),
      tags: ['Onboarding'], attachments: [] },

    { id: 'TF-1056', title: 'Approve 2026 carrier rate increases',
      desc: 'Three carriers submitted 4–6% general rate increases. Review against budget and counter where justified.',
      status: 'assigned', priority: 'high', progress: 0, assignee: 'u-rizwan', reporter: 'u-omar',
      project: 'Carrier Management', start: at(0, 9), due: at(0, 18), created: at(-2, 14),
      tags: ['Approval', 'Finance'], attachments: [{ name: 'gri-comparison.xlsx', size: '540 KB' }] },

    { id: 'TF-1057', title: 'Q4 volume forecast model',
      desc: 'Refresh the forecast with October actuals and model three peak scenarios for labour planning.',
      status: 'assigned', priority: 'high', progress: 0, assignee: 'u-sarah', reporter: 'u-rizwan',
      project: 'Planning', start: at(1, 9), due: at(5, 17), created: at(-1, 10),
      tags: ['Forecast', 'Planning'], attachments: [] },

    { id: 'TF-1059', title: 'Safety audit — loading dock zone C',
      desc: 'Quarterly walkthrough covering dock locks, fall protection and forklift pedestrian separation.',
      status: 'assigned', priority: 'medium', progress: 0, assignee: 'u-david', reporter: 'u-rizwan',
      project: 'Compliance', start: at(2, 9), due: at(7, 17), created: at(0, 9, 20),
      tags: ['Safety', 'Audit'], attachments: [] },

    { id: 'TF-1061', title: 'Amazon SPD rate card review',
      desc: 'Benchmark small parcel delivery rates against two alternate providers ahead of renewal.',
      status: 'assigned', priority: 'low', progress: 0, assignee: 'u-omar', reporter: 'u-sarah',
      project: 'Amazon Channel', start: at(3, 9), due: at(9, 17), created: at(0, 11),
      tags: ['Amazon', 'Procurement'], attachments: [] },

    /* ---- on hold ---- */
    { id: 'TF-1050', title: 'WMS integration — phase 2 (order sync)',
      desc: 'Blocked pending vendor API credentials. Resume once the sandbox environment is provisioned.',
      status: 'hold', priority: 'high', progress: 40, assignee: 'u-rizwan', reporter: 'u-rizwan',
      project: 'Systems', start: at(-18, 9), due: at(14, 17), created: at(-18, 9),
      tags: ['Integration', 'Blocked'], attachments: [] },

    { id: 'TF-1053', title: 'Cold storage expansion proposal',
      desc: 'On hold until the Q4 capital budget is confirmed. Draft is complete pending finance review.',
      status: 'hold', priority: 'low', progress: 20, assignee: 'u-rizwan', reporter: 'u-aisha',
      project: 'Facilities', start: at(-20, 9), due: at(21, 17), created: at(-20, 9),
      tags: ['Capex'], attachments: [] },

    /* ---- completed ---- */
    { id: 'TF-1031', title: 'Returns backlog clearance — 1,240 units',
      desc: 'Cleared the aged returns queue and restocked sellable inventory ahead of the cycle count.',
      status: 'completed', priority: 'high', progress: 100, assignee: 'u-emma', reporter: 'u-rizwan',
      project: 'Reverse Logistics', start: at(-9, 9), due: at(-2, 17), completedAt: at(-2, 15), onTime: true,
      created: at(-9, 9), tags: ['Returns'], attachments: [] },

    { id: 'TF-1029', title: 'Peak season staffing plan',
      desc: 'Agency headcount, shift patterns and overtime envelope approved for November through January.',
      status: 'completed', priority: 'high', progress: 100, assignee: 'u-sarah', reporter: 'u-rizwan',
      project: 'Planning', start: at(-14, 9), due: at(-4, 17), completedAt: at(-4, 12), onTime: true,
      created: at(-14, 9), tags: ['Planning', 'People'], attachments: [] },

    { id: 'TF-1026', title: 'Carrier insurance certificate renewal',
      desc: 'Collected current COIs from all active carriers and updated the compliance register.',
      status: 'completed', priority: 'medium', progress: 100, assignee: 'u-david', reporter: 'u-omar',
      project: 'Compliance', start: at(-16, 9), due: at(-7, 17), completedAt: at(-5, 16), onTime: false,
      created: at(-16, 9), tags: ['Compliance'], attachments: [] },

    { id: 'TF-1024', title: 'Warehouse cycle count — zone B',
      desc: 'Full count completed with 99.2% location accuracy. Three variances escalated to finance.',
      status: 'completed', priority: 'medium', progress: 100, assignee: 'u-mike', reporter: 'u-rizwan',
      project: 'Inventory', start: at(-8, 6), due: at(-6, 17), completedAt: at(-6, 14), onTime: true,
      created: at(-8, 6), tags: ['Inventory'], attachments: [] },

    { id: 'TF-1021', title: 'Client QBR deck — Meridian Retail',
      desc: 'Quarterly business review delivered. Client renewed for a further 12 months.',
      status: 'completed', priority: 'high', progress: 100, assignee: 'u-emma', reporter: 'u-rizwan',
      project: 'Client Success', start: at(-13, 9), due: at(-6, 12), completedAt: at(-6, 11), onTime: true,
      created: at(-13, 9), tags: ['Client', 'Reporting'], attachments: [{ name: 'meridian-qbr.pptx', size: '8.9 MB' }] },

    { id: 'TF-1019', title: 'Update SOP — hazmat receiving',
      desc: 'Revised the hazmat intake procedure after the regulation update and retrained the receiving team.',
      status: 'completed', priority: 'critical', progress: 100, assignee: 'u-david', reporter: 'u-rizwan',
      project: 'Compliance', start: at(-15, 9), due: at(-8, 17), completedAt: at(-8, 15), onTime: true,
      created: at(-15, 9), tags: ['SOP', 'Safety'], attachments: [] },

    { id: 'TF-1017', title: 'Onboard 3PL partner — Northgate Logistics',
      desc: 'Contract executed, EDI connection tested and first pilot shipment delivered successfully.',
      status: 'completed', priority: 'high', progress: 100, assignee: 'u-omar', reporter: 'u-rizwan',
      project: 'Partnerships', start: at(-24, 9), due: at(-12, 17), completedAt: at(-9, 17), onTime: false,
      created: at(-24, 9), tags: ['Partner', 'EDI'], attachments: [] },

    { id: 'TF-1014', title: 'Dock schedule template rollout',
      desc: 'New appointment template live across all four docks. Average trailer dwell down 22 minutes.',
      status: 'completed', priority: 'medium', progress: 100, assignee: 'u-mike', reporter: 'u-john',
      project: 'Inbound Operations', start: at(-20, 9), due: at(-11, 17), completedAt: at(-11, 13), onTime: true,
      created: at(-20, 9), tags: ['Docks'], attachments: [] },

    { id: 'TF-1011', title: 'Q2 freight rate reconciliation',
      desc: 'Audited 1,842 invoices against contracted rates and recovered $11.3k in overcharges.',
      status: 'completed', priority: 'high', progress: 100, assignee: 'u-aisha', reporter: 'u-rizwan',
      project: 'Finance', start: at(-26, 9), due: at(-13, 17), completedAt: at(-13, 16), onTime: true,
      created: at(-26, 9), tags: ['Finance', 'Audit'], attachments: [] },

    { id: 'TF-1008', title: 'Invoice verification — carrier batch #4471',
      desc: 'All 96 invoices in the batch verified and released for payment.',
      status: 'completed', priority: 'medium', progress: 100, assignee: 'u-aisha', reporter: 'u-john',
      project: 'Finance', start: at(-18, 9), due: at(-14, 17), completedAt: at(-14, 15), onTime: true,
      created: at(-18, 9), tags: ['Finance'], attachments: [] }
  ];

  /* ---------- seeded activity per task ---------- */
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

  TF.tasks.forEach(function (t) {
    var log = [];
    log.push({ type: 'created', user: t.reporter, text: '{user} created the task', ts: t.created });
    log.push({ type: 'assigned', user: t.reporter, text: 'Assigned to <b>' + TF.userName(t.assignee) + '</b>', ts: t.created + 4 * 60000 });
    if (t.status !== 'assigned') {
      log.push({ type: 'status', user: t.assignee, text: 'Assigned &rarr; <b>In Progress</b>', ts: t.start + 90 * 60000 });
    }
    if (t.progress > 0 && t.progress < 100) {
      log.push({ type: 'progress', user: t.assignee, text: '<b>' + Math.max(0, t.progress - 22) + '%</b> &rarr; <b>' + t.progress + '%</b>', ts: Date.now() - 3 * 3600000 });
    }
    if (t.status === 'completed') {
      log.push({ type: 'done', user: t.assignee, text: 'Marked the task <b>Completed</b>', ts: t.completedAt });
    }
    if (t.status === 'overdue') {
      log.push({ type: 'priority', user: t.reporter, text: 'Flagged as <b>overdue</b> — past the due date', ts: t.due + 3600000 });
    }
    t.activity = log;
    t.comments = [];
  });

  /* seeded conversation on the headline task */
  (function () {
    var t = TF.tasks[0];
    t.comments = [
      { user: 'u-sarah', text: 'Container is on the yard — dock 3 is clear from 15:00.', ts: mins(126) },
      { user: 'u-john',  text: 'Counted 18 of 24 pallets so far. Two cartons look short against the ASN, checking now.', ts: mins(38) }
    ];
    t.activity.push({ type: 'comment', user: 'u-john', text: 'Left a comment on the task', ts: mins(38) });
  }());

  /* ---------- notifications ---------- */
  TF.notifications = [
    { id: 'n1', type: 'assigned', title: 'New task assigned', body: 'Sarah assigned you <q>Verify Amazon Container CTNR-88213</q>', task: 'TF-1042', ts: mins(2),   read: false },
    { id: 'n2', type: 'done',     title: 'Task completed',    body: 'John completed <q>Invoice verification — carrier batch #4471</q>', task: 'TF-1008', ts: mins(15),  read: false },
    { id: 'n3', type: 'overdue',  title: 'Task overdue',      body: '<q>Amazon appointment confirmation — FBA delivery</q> is overdue', task: 'TF-1035', ts: mins(64),  read: false },
    { id: 'n4', type: 'comment',  title: 'New comment',       body: 'Sarah Khan commented on <q>Verify Amazon Container CTNR-88213</q>', task: 'TF-1042', ts: mins(126), read: true },
    { id: 'n5', type: 'progress', title: 'Progress updated',  body: 'Aisha moved <q>Reconcile detention &amp; demurrage charges</q> to 45%', task: 'TF-1044', ts: mins(210), read: true },
    { id: 'n6', type: 'mention',  title: 'You were mentioned', body: 'David mentioned you in <q>Customs documentation — MSCU-4471</q>', task: 'TF-1049', ts: mins(340), read: true }
  ];

  TF.NOTIF_STYLE = {
    assigned: { icon: 'i-inbox',    color: '#3b82f6' },
    done:     { icon: 'i-check',    color: '#10b981' },
    overdue:  { icon: 'i-alert',    color: '#ef4444' },
    comment:  { icon: 'i-comment',  color: '#8b5cf6' },
    progress: { icon: 'i-trend-up', color: '#f59e0b' },
    mention:  { icon: 'i-user',     color: '#06b6d4' },
    created:  { icon: 'i-sparkle',  color: '#10b981' }
  };

  /* ---------- team performance (whole 128-task workspace) ---------- */
  TF.teamStats = {
    'u-john':   { tasks: 18, completed: 14, score: 82, active: 3, workload: 4 },
    'u-sarah':  { tasks: 21, completed: 18, score: 91, active: 4, workload: 4 },
    'u-mike':   { tasks: 14, completed: 9,  score: 68, active: 3, workload: 3 },
    'u-aisha':  { tasks: 16, completed: 13, score: 86, active: 2, workload: 2 },
    'u-david':  { tasks: 12, completed: 8,  score: 74, active: 2, workload: 2 },
    'u-emma':   { tasks: 19, completed: 16, score: 88, active: 3, workload: 3 },
    'u-omar':   { tasks: 15, completed: 11, score: 79, active: 3, workload: 3 },
    'u-rizwan': { tasks: 13, completed: 10, score: 84, active: 4, workload: 4 }
  };

  /* ---------- analytics series ---------- */
  TF.weekly = [
    { label: 'Mon', completed: 11, created: 14 },
    { label: 'Tue', completed: 15, created: 12 },
    { label: 'Wed', completed:  9, created: 17 },
    { label: 'Thu', completed: 18, created: 13 },
    { label: 'Fri', completed: 21, created: 10 },
    { label: 'Sat', completed:  7, created:  4 },
    { label: 'Sun', completed:  4, created:  3 }
  ];

  TF.completionTrend = [
    { label: 'W1', value: 64 }, { label: 'W2', value: 68 }, { label: 'W3', value: 66 },
    { label: 'W4', value: 71 }, { label: 'W5', value: 74 }, { label: 'W6', value: 72 },
    { label: 'W7', value: 77 }, { label: 'W8', value: 79 }, { label: 'W9', value: 76 },
    { label: 'W10', value: 80 }, { label: 'W11', value: 78 }, { label: 'W12', value: 82 }
  ];

  TF.cycleTrend = [
    { label: 'W1', value: 4.2 }, { label: 'W2', value: 4.0 }, { label: 'W3', value: 3.8 },
    { label: 'W4', value: 3.9 }, { label: 'W5', value: 3.4 }, { label: 'W6', value: 3.3 },
    { label: 'W7', value: 3.1 }, { label: 'W8', value: 3.2 }, { label: 'W9', value: 3.0 },
    { label: 'W10', value: 2.9 }, { label: 'W11', value: 2.9 }, { label: 'W12', value: 2.8 }
  ];

  /* ---------- lookups ---------- */
  TF.PROJECTS = (function () {
    var seen = {}, out = [];
    TF.tasks.forEach(function (t) { if (!seen[t.project]) { seen[t.project] = 1; out.push(t.project); } });
    return out.sort();
  }());

  /* seed counts, frozen — used to derive the hidden remainder of the workspace */
  TF.SEED_COUNTS = (function () {
    var c = { assigned: 0, progress: 0, hold: 0, completed: 0, overdue: 0, dueToday: 0, onTime: 0 };
    var t0 = new Date(); t0.setHours(0, 0, 0, 0);
    var t1 = t0.getTime() + 86400000;
    TF.tasks.forEach(function (t) {
      c[t.status]++;
      if (t.due >= t0.getTime() && t.due < t1 && t.status !== 'completed') c.dueToday++;
      if (t.status === 'completed' && t.onTime) c.onTime++;
    });
    return c;
  }());
}(window.TF));
