export { toBeijingDateString } from './time';

export const normalizeAuthorName = (value: string): string => {
  return value.trim().replace(/^UID:/i, '').toLowerCase();
};

export const sameAuthor = (left: string, right: string): boolean => {
  return normalizeAuthorName(left) === normalizeAuthorName(right);
};
