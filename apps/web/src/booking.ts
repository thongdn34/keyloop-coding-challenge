export type TimedVisit = { startAt: string; endAt: string };

export function visitState(item: TimedVisit, now: number) {
  const start = new Date(item.startAt).getTime();
  const end = new Date(item.endAt).getTime();
  if (end <= now) return "Completed";
  if (start <= now) return "In progress";
  return "Upcoming";
}

export function sortSchedule<T extends TimedVisit>(
  items: T[],
  now: number,
): T[] {
  return items.slice().sort((a, b) => {
    const aOpen = new Date(a.endAt).getTime() > now;
    const bOpen = new Date(b.endAt).getTime() > now;
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
  });
}

export function openCount(items: TimedVisit[], now: number) {
  return items.filter((item) => new Date(item.endAt).getTime() > now).length;
}
