const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const pad = (value: number, size = 2): string => String(value).padStart(size, '0');

export interface BeijingDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  dayOfWeek: number;
}

export const toBeijingDateParts = (date: Date = new Date()): BeijingDateParts => {
  const shifted = new Date(date.getTime() + BEIJING_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
    dayOfWeek: shifted.getUTCDay(),
  };
};

export const toBeijingISOString = (date: Date = new Date()): string => {
  const parts = toBeijingDateParts(date);
  return [
    `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`,
    `T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}.${pad(parts.millisecond, 3)}+08:00`,
  ].join('');
};

export const toBeijingDateString = (date: Date = new Date()): string => {
  const parts = toBeijingDateParts(date);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
};

export const toBeijingMinuteString = (date: Date = new Date()): string => {
  const parts = toBeijingDateParts(date);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
};

export const addBeijingDays = (date: Date, offsetDays: number): string => {
  return toBeijingDateString(new Date(date.getTime() + offsetDays * 24 * 60 * 60 * 1000));
};
