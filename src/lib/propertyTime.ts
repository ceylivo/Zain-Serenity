function dateKeyParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("INVALID_DATE_KEY");
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) throw new Error("INVALID_DATE_KEY");
  return { year, month, day };
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day), hour: Number(value.hour), minute: Number(value.minute), second: Number(value.second) };
}

export function getDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return [parts.year, String(parts.month).padStart(2, "0"), String(parts.day).padStart(2, "0")].join("-");
}

export function getDateInTimeZoneStart(dateKey: string, timeZone: string): Date {
  const { year, month, day } = dateKeyParts(dateKey);
  const targetWallTime = Date.UTC(year, month - 1, day);
  let candidate = targetWallTime;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(candidate), timeZone);
    const representedWallTime = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const adjustment = targetWallTime - representedWallTime;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(candidate);
}

export function getNextDateKey(dateKey: string): string {
  const { year, month, day } = dateKeyParts(dateKey);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [next.getUTCFullYear(), String(next.getUTCMonth() + 1).padStart(2, "0"), String(next.getUTCDate()).padStart(2, "0")].join("-");
}

export function getZonedDayBounds(dateKey: string, timeZone: string) {
  return {
    start: getDateInTimeZoneStart(dateKey, timeZone),
    end: getDateInTimeZoneStart(getNextDateKey(dateKey), timeZone),
  };
}
