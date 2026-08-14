import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tasks, taskHistory, users } from '../db/schema.js';
import { publicTask, type PublicTask } from './task.service.js';
import { publicUser, type PublicUser } from '../lib/serialize.js';
import { listFor, type NotificationView } from './notification.service.js';
import { AppError } from '../lib/errors.js';

const TERMINAL = ['completed', 'cancelled'] as const;

function dayBounds(now = new Date()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const endOfDay = new Date(start.getTime() + 86_400_000);
  const soon = new Date(start.getTime() + 8 * 86_400_000); // through the next 7 days
  return { start, endOfDay, soon };
}

export type DashboardSummary = {
  counts: {
    total: number; pending: number; progress: number; hold: number;
    completed: number; overdue: number; cancelled: number;
    assignedToMe: number; dueToday: number; dueSoon: number;
  };
  dueToday: PublicTask[];
  dueSoon: PublicTask[];
  recentlyAssigned: PublicTask[];
  myTasks: PublicTask[];
  recentActivity: {
    id: string; event: string; taskId: string; taskTitle: string;
    createdAt: Date; actor: { id: string; fullName: string } | null;
  }[];
};

export async function summary(userId: string): Promise<DashboardSummary> {
  const { start, endOfDay, soon } = dayBounds();
  const all = (await db.select().from(tasks)).map(publicTask);

  const openWithDue = (t: PublicTask) =>
    !!t.dueAt && !TERMINAL.includes(t.status as any);

  /*
   * Both bounds matter. With only an upper bound this is a prefix, not a bucket: a
   * task due last month satisfies `dueAt < endOfDay` and shows up under "Due Today"
   * while also being counted as overdue, so the dashboard contradicts itself.
   * Anything already past its due time belongs in the overdue count below.
   */
  const dueToday = all
    .filter((t) => openWithDue(t)
      && t.dueAt!.getTime() >= start.getTime()
      && t.dueAt!.getTime() < endOfDay.getTime())
    .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime());

  const dueSoon = all
    .filter((t) => openWithDue(t)
      && t.dueAt!.getTime() >= endOfDay.getTime()
      && t.dueAt!.getTime() < soon.getTime())
    .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime());

  const myTasks = all
    .filter((t) => t.assignedTo === userId && !TERMINAL.includes(t.status as any))
    .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));

  const recentlyAssigned = all
    .filter((t) => t.assignedAt !== null)
    .sort((a, b) => b.assignedAt!.getTime() - a.assignedAt!.getTime())
    .slice(0, 8);

  const countOf = (s: string) => all.filter((t) => t.status === s).length;

  const activity = await db.select({
    id: taskHistory.id, event: taskHistory.event, createdAt: taskHistory.createdAt,
    taskId: tasks.id, taskTitle: tasks.title,
    actorId: users.id, actorName: users.fullName,
  }).from(taskHistory)
    .innerJoin(tasks, eq(tasks.id, taskHistory.taskId))
    .leftJoin(users, eq(users.id, taskHistory.actorId))
    .orderBy(desc(taskHistory.createdAt))
    .limit(12);

  return {
    counts: {
      total: all.length,
      pending: countOf('assigned'),
      progress: countOf('progress'),
      hold: countOf('hold'),
      completed: countOf('completed'),
      // The union of "explicitly marked" and "derived", not just `countOf('overdue')`.
      // The expiry cron sets the status on a schedule, so a task that lapsed since the
      // last run needs the derived half or it is counted nowhere; and a row already
      // carrying the status counts even if its dueAt is missing, so neither half alone
      // is sufficient.
      overdue: all.filter((t) => t.isOverdue || t.status === 'overdue').length,
      cancelled: countOf('cancelled'),
      assignedToMe: all.filter((t) => t.assignedTo === userId).length,
      dueToday: dueToday.length,
      dueSoon: dueSoon.length,
    },
    dueToday: dueToday.slice(0, 8),
    dueSoon: dueSoon.slice(0, 8),
    recentlyAssigned,
    myTasks: myTasks.slice(0, 8),
    recentActivity: activity.map((a) => ({
      id: a.id, event: a.event, taskId: a.taskId, taskTitle: a.taskTitle, createdAt: a.createdAt,
      actor: a.actorId ? { id: a.actorId, fullName: a.actorName! } : null,
    })),
  };
}

export async function bootstrap(userId: string): Promise<{
  me: PublicUser; users: PublicUser[]; tasks: PublicTask[]; notifications: NotificationView[];
}> {
  const [meRow] = await db.select().from(users).where(eq(users.id, userId));
  if (!meRow) throw new AppError('USER_NOT_FOUND', 'User not found');

  const [allUsers, allTasks, notifs] = await Promise.all([
    db.select().from(users),
    db.select().from(tasks).orderBy(desc(tasks.createdAt)),
    listFor(userId),
  ]);

  return {
    me: publicUser(meRow),
    users: allUsers.map(publicUser),
    tasks: allTasks.map(publicTask),
    notifications: notifs,
  };
}
