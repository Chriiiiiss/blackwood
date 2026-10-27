export function durationLabel(seconds: number) {
  return [
    [Math.floor(seconds / 3600), "h"],
    [Math.floor((seconds % 3600) / 60), "min"],
    [seconds % 60, "s"],
  ]
    .filter(([value]) => Number(value) > 0)
    .map(([value, unit]) => `${value} ${unit}`)
    .join(" ");
}

export function parseDuration(value: string): number | null {
  const text = value.trim().toLowerCase();
  const hoursAndMinutes = /^(\d+)\s*h\s*(\d+)$/.exec(text);
  const units =
    /^(?:(\d+)\s*h\s*)?(?:(\d+)\s*(?:min|m)\s*)?(?:(\d+)\s*s\s*)?$/.exec(text);
  const seconds = /^\d+$/.test(text)
    ? Number(text) * 60
    : hoursAndMinutes
      ? Number(hoursAndMinutes[1]) * 3600 + Number(hoursAndMinutes[2]) * 60
      : text && units
        ? Number(units[1] ?? 0) * 3600 +
          Number(units[2] ?? 0) * 60 +
          Number(units[3] ?? 0)
        : 0;
  return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 604800
    ? seconds
    : null;
}
