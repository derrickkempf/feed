/** Image CDN URL sized for the feed. */
export const imgSrc = (url: string, w = 1600) => `${url}?w=${w}&fit=max&auto=format&q=82`

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** "Today", "Yesterday", "Monday, March 3rd", or "March 3rd, 2025" — same as the original site. */
export function dayLabel(date: string, now = new Date()) {
  if (date === ymd(now)) return 'Today'
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  if (date === ymd(y)) return 'Yesterday'
  const [yr, mo, da] = date.split('-').map(Number)
  const d = new Date(yr, mo - 1, da)
  const month = d.toLocaleDateString('en-US', {month: 'long'})
  return yr === now.getFullYear()
    ? `${d.toLocaleDateString('en-US', {weekday: 'long'})}, ${month} ${ordinal(da)}`
    : `${month} ${ordinal(da)}, ${yr}`
}

export function videoEmbed(url: string) {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`
  const vm = url.match(/vimeo\.com\/(\d+)/)
  return vm ? `https://player.vimeo.com/video/${vm[1]}` : null
}
