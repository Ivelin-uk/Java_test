export function formatDuration(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0
  return `${Math.floor(total / 60)} мин ${total % 60} сек`
}
