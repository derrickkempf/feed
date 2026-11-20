import {getFeed, getSettings} from '@/lib/sanity'
import {Feed} from '@/components/Feed'

export default async function Home() {
  const [days, settings] = await Promise.all([getFeed(), getSettings()])
  return <Feed days={days} settings={settings} />
}
