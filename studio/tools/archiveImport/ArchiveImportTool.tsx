import {useCallback, useMemo, useRef, useState} from 'react'
import {useClient} from 'sanity'
import {Badge, Box, Button, Card, Container, Flex, Heading, Radio, Stack, Text} from '@sanity/ui'
import {
  type Candidate,
  type ExistingDay,
  type Mode,
  groupByDay,
  isImageFile,
  makeItem,
  planDayWrites,
  readCaptureDate,
} from './core'

type Phase = 'idle' | 'reading' | 'review' | 'importing' | 'done'
type Result = {date: string; added: number; created: boolean}
type Failure = {name: string; error: string}

const CONCURRENCY = 4

/** Recursively collect files from a drag-and-drop that may include folders. */
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items || [])
    .map((i) => i.webkitGetAsEntry?.())
    .filter(Boolean) as FileSystemEntry[]
  if (!entries.length) return Array.from(dt.files || [])
  const out: File[] = []
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      out.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)))
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader()
      // readEntries returns batches; keep reading until empty
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) break
        for (const child of batch) await walk(child)
      }
    }
  }
  for (const e of entries) await walk(e)
  return out
}

async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({length: Math.min(n, items.length)}, async () => {
      while (next < items.length) {
        const i = next++
        await fn(items[i], i)
      }
    }),
  )
}

const fmtDay = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'})

export function ArchiveImportTool() {
  const client = useClient({apiVersion: '2026-11-01'}).withConfig({perspective: 'raw'})
  const [phase, setPhase] = useState<Phase>('idle')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [ignored, setIgnored] = useState(0)
  const [mode, setMode] = useState<Mode>('draft')
  const [progress, setProgress] = useState({done: 0, total: 0, label: ''})
  const [results, setResults] = useState<Result[]>([])
  const [skipped, setSkipped] = useState<string[]>([])
  const [failures, setFailures] = useState<Failure[]>([])
  const [dragOver, setDragOver] = useState(false)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  const groups = useMemo(() => groupByDay(candidates), [candidates])
  const fromFileDate = candidates.filter((c) => c.source === 'file').length

  const reset = () => {
    setPhase('idle')
    setCandidates([])
    setIgnored(0)
    setResults([])
    setSkipped([])
    setFailures([])
  }

  const read = useCallback(async (files: File[]) => {
    const images = files.filter(isImageFile)
    setIgnored(files.length - images.length)
    if (!images.length) return
    setPhase('reading')
    setProgress({done: 0, total: images.length, label: 'Reading dates'})
    const out: Candidate[] = new Array(images.length)
    let done = 0
    await pool(images, 8, async (f, i) => {
      out[i] = await readCaptureDate(f)
      setProgress((p) => ({...p, done: ++done}))
    })
    setCandidates(out)
    setPhase('review')
  }, [])

  const run = useCallback(async () => {
    setPhase('importing')
    const fails: Failure[] = []
    const dupes: string[] = []

    // Assets already used anywhere in the feed (published or draft) — skip those.
    const used = new Set<string>(
      await client.fetch<string[]>(`array::unique(*[_type == "day"].items[_type == "feedImage"].image.asset._ref)`),
    )

    // 1. upload
    setProgress({done: 0, total: candidates.length, label: 'Uploading'})
    const uploaded: {c: Candidate; assetId: string}[] = []
    const seenThisRun = new Set<string>()
    let done = 0
    await pool(candidates, CONCURRENCY, async (c) => {
      try {
        const asset = await client.assets.upload('image', c.file, {
          filename: c.file.name,
          extract: ['exif', 'location', 'lqip', 'palette', 'blurhash'],
        })
        // Sanity de-duplicates identical files to the same asset id
        if (used.has(asset._id) || seenThisRun.has(asset._id)) dupes.push(c.file.name)
        else {
          seenThisRun.add(asset._id)
          uploaded.push({c, assetId: asset._id})
        }
      } catch (e) {
        fails.push({name: c.file.name, error: e instanceof Error ? e.message : String(e)})
      }
      setProgress((p) => ({...p, done: ++done}))
    })

    // 2. file into days
    const byDay = groupByDay(uploaded.map((u) => ({...u, takenAt: u.c.takenAt})))
    setProgress({done: 0, total: byDay.size, label: 'Sorting into days'})
    const res: Result[] = []
    let d = 0
    for (const [date, list] of byDay) {
      try {
        const existing = await client.fetch<ExistingDay[]>(`*[_type == "day" && date == $date]`, {date})
        const items = list.map((u) => makeItem(u.assetId, u.takenAt))
        const muts = planDayWrites(date, items, existing, mode)
        await client.mutate(muts as never, {visibility: 'async'})
        res.push({date, added: items.length, created: existing.length === 0})
      } catch (e) {
        for (const u of list) fails.push({name: u.c.file.name, error: `Saving ${date}: ${e instanceof Error ? e.message : e}`})
      }
      setProgress((p) => ({...p, done: ++d}))
    }

    setResults(res)
    setSkipped(dupes)
    setFailures(fails)
    setPhase('done')
  }, [candidates, client, mode])

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (phase !== 'idle') return
    read(await filesFromDrop(e.dataTransfer))
  }

  return (
    <Container width={2} padding={4}>
      <Stack gap={5}>
        <Stack gap={3}>
          <Heading size={2}>Archive import</Heading>
          <Text muted size={1}>
            Drop in photos or whole folders. Each image is filed into the Day it was taken, using the capture date in its
            EXIF metadata (or the file’s date if it has none). Days that don’t exist yet are created. Images already in the
            feed are skipped.
          </Text>
        </Stack>

        {phase === 'idle' && (
          <Card
            padding={5}
            radius={3}
            border
            tone={dragOver ? 'primary' : 'default'}
            style={{borderStyle: 'dashed', textAlign: 'center'}}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <Stack gap={4}>
              <Text size={2} weight="semibold">
                Drop images or folders here
              </Text>
              <Flex gap={2} justify="center">
                <Button text="Choose images…" mode="ghost" onClick={() => filesInput.current?.click()} />
                <Button text="Choose a folder…" mode="ghost" onClick={() => folderInput.current?.click()} />
              </Flex>
              {ignored > 0 && (
                <Text size={1} muted>
                  {ignored} non-image file{ignored === 1 ? '' : 's'} ignored.
                </Text>
              )}
            </Stack>
            <input
              ref={filesInput}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              hidden
              onChange={(e) => read(Array.from(e.target.files || []))}
            />
            <input
              ref={folderInput}
              type="file"
              multiple
              hidden
              {...({webkitdirectory: '', directory: ''} as Record<string, string>)}
              onChange={(e) => read(Array.from(e.target.files || []))}
            />
          </Card>
        )}

        {(phase === 'reading' || phase === 'importing') && (
          <Card padding={4} radius={3} border>
            <Stack gap={3}>
              <Text weight="semibold">
                {progress.label}… {progress.done} / {progress.total}
              </Text>
              <Box style={{height: 6, background: 'var(--card-border-color)', borderRadius: 3, overflow: 'hidden'}}>
                <Box
                  style={{
                    height: '100%',
                    width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                    background: 'var(--card-focus-ring-color)',
                    transition: 'width .2s',
                  }}
                />
              </Box>
              {phase === 'importing' && (
                <Text size={1} muted>
                  Keep this tab open until it finishes.
                </Text>
              )}
            </Stack>
          </Card>
        )}

        {phase === 'review' && (
          <Stack gap={4}>
            <Card padding={4} radius={3} border>
              <Stack gap={4}>
                <Text weight="semibold">
                  {candidates.length} image{candidates.length === 1 ? '' : 's'} across {groups.size} day
                  {groups.size === 1 ? '' : 's'}
                </Text>
                {fromFileDate > 0 && (
                  <Text size={1} muted>
                    {fromFileDate} had no EXIF capture date and will use the file’s modified date (marked “file date” below).
                  </Text>
                )}
                <Stack gap={3}>
                  <Flex as="label" gap={3} align="center">
                    <Radio checked={mode === 'draft'} onChange={() => setMode('draft')} />
                    <Text size={1}>
                      <strong>Add as drafts</strong> — review each day, then Publish. Nothing goes live yet.
                    </Text>
                  </Flex>
                  <Flex as="label" gap={3} align="center">
                    <Radio checked={mode === 'publish'} onChange={() => setMode('publish')} />
                    <Text size={1}>
                      <strong>Publish immediately</strong> — images appear on the site right away.
                    </Text>
                  </Flex>
                </Stack>
                <Flex gap={2}>
                  <Button tone="primary" text={`Import ${candidates.length} images`} onClick={run} />
                  <Button mode="bleed" text="Cancel" onClick={reset} />
                </Flex>
              </Stack>
            </Card>
            <Card radius={3} border style={{maxHeight: 420, overflow: 'auto'}}>
              <Stack>
                {[...groups.entries()].map(([date, list]) => (
                  <Card key={date} padding={3} borderBottom>
                    <Flex justify="space-between" align="center" gap={3}>
                      <Text size={1} weight="semibold">
                        {fmtDay(date)}
                      </Text>
                      <Flex gap={2} align="center">
                        {list.some((c) => c.source === 'file') && <Badge tone="caution">file date</Badge>}
                        <Text size={1} muted>
                          {list.length} image{list.length === 1 ? '' : 's'}
                        </Text>
                      </Flex>
                    </Flex>
                  </Card>
                ))}
              </Stack>
            </Card>
          </Stack>
        )}

        {phase === 'done' && (
          <Stack gap={4}>
            <Card padding={4} radius={3} border tone={failures.length ? 'caution' : 'positive'}>
              <Stack gap={3}>
                <Text weight="semibold">
                  Added {results.reduce((n, r) => n + r.added, 0)} images to {results.length} day
                  {results.length === 1 ? '' : 's'} ({results.filter((r) => r.created).length} new)
                  {mode === 'draft' ? ' as drafts' : ''}.
                </Text>
                {skipped.length > 0 && (
                  <Text size={1}>
                    Skipped {skipped.length} already in the feed: {skipped.slice(0, 8).join(', ')}
                    {skipped.length > 8 ? '…' : ''}
                  </Text>
                )}
                {mode === 'draft' && results.length > 0 && (
                  <Text size={1}>Open Feed (days) to review and publish them.</Text>
                )}
              </Stack>
            </Card>
            {failures.length > 0 && (
              <Card padding={4} radius={3} border tone="critical">
                <Stack gap={2}>
                  <Text weight="semibold">{failures.length} failed</Text>
                  {failures.slice(0, 20).map((f, i) => (
                    <Text key={i} size={1}>
                      {f.name}: {f.error}
                    </Text>
                  ))}
                </Stack>
              </Card>
            )}
            <Box>
              <Button text="Import more" mode="ghost" onClick={reset} />
            </Box>
          </Stack>
        )}
      </Stack>
    </Container>
  )
}
