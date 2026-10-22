export const localTime = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

export const minuteBound = (value: string, offset: number) => {
  // Calendar limits compare local wall-clock values, not timezone offsets.
  const time = new Date(value ? `${value}Z` : '').getTime()
  return Number.isFinite(time) ? new Date(time + offset * 60000).toISOString().slice(0, 16) : undefined
}
