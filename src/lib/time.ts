const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

export function timeAgo(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`;
  if (seconds < DAY * 30) return `${Math.floor(seconds / DAY)}d ago`;

  return new Date(isoDate).toLocaleDateString();
}
