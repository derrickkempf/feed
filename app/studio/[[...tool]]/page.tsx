import {NextStudio} from 'next-sanity/studio'
import config from '@/sanity.config'
import {isConfigured} from '@/sanity/env'

export const dynamic = 'force-static'
export {metadata, viewport} from 'next-sanity/studio'

export default function StudioPage() {
  if (!isConfigured) {
    return (
      <main style={{fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '15vh auto', padding: 24, lineHeight: 1.6}}>
        <h1 style={{fontSize: 20}}>Sanity isn&apos;t connected yet</h1>
        <p>
          Set <code>NEXT_PUBLIC_SANITY_PROJECT_ID</code> (and optionally <code>NEXT_PUBLIC_SANITY_DATASET</code>) in{' '}
          <code>.env.local</code>, then restart the dev server. See the README for setup steps.
        </p>
      </main>
    )
  }
  return <NextStudio config={config} />
}
