export const discordRelativeTimestamp = (ms: number): string => `<t:${Math.floor(ms / 1000)}:R>`;
