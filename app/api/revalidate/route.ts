import {revalidateTag} from 'next/cache'
import {type NextRequest, NextResponse} from 'next/server'
import {parseBody} from 'next-sanity/webhook'

/**
 * Sanity GROQ webhook → POST /api/revalidate
 * Filter: _type in ["day", "work", "snippet", "about", "settings"]
 * Secret: SANITY_REVALIDATE_SECRET
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SANITY_REVALIDATE_SECRET
  if (!secret) return new NextResponse('Missing SANITY_REVALIDATE_SECRET', {status: 500})
  const {isValidSignature, body} = await parseBody<{_type?: string}>(req, secret)
  if (!isValidSignature) return new NextResponse('Invalid signature', {status: 401})
  revalidateTag('sanity', {expire: 0})
  return NextResponse.json({revalidated: true, type: body?._type ?? null})
}
