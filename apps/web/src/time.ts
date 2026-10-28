export const REQUEST_TIMEOUT_MS = 10_000;

function pad(part: number) {
  return String(part).padStart(2, "0");
}

/** `datetime-local` value in the browser's timezone. */
export function localValue(date: Date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function defaultSlot() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return localValue(date);
}

/** ISO 8601 with an explicit numeric offset. This is what the API accepts. */
export function withOffset(value: string) {
  const date = new Date(value);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

export function addMinutes(value: string, minutes: number) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + minutes);
  return localValue(date);
}

export function startOfLocalDay(date = new Date()) {
  const local = new Date(date);
  local.setHours(0, 0, 0, 0);
  return withOffset(localValue(local));
}

export function addLocalDays(localDateTime: string, days: number) {
  const date = new Date(localDateTime);
  date.setDate(date.getDate() + days);
  return withOffset(localValue(date));
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours && remainder) return `${hours} hr ${remainder} min`;
  if (hours) return hours === 1 ? "1 hour" : `${hours} hours`;
  return `${remainder} min`;
}

export function timeIssue(value: string): string | null {
  if (!value) return "Choose an appointment date and time.";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Enter a valid date and time.";
  if (date.getTime() <= Date.now()) return "Choose a time in the future.";
  return null;
}
