import { AlignmentType, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } from 'docx'

export interface Inline { text: string; bold?: boolean; italic?: boolean; link?: string }
export type HeadingLevel6 = 1 | 2 | 3 | 4 | 5 | 6
export type Block =
  | { type: 'heading'; level: HeadingLevel6; inlines: Inline[] }
  | { type: 'paragraph' | 'bullet' | 'numbered'; inlines: Inline[] }

// `_x_` only counts at word edges, so snake_case identifiers stay plain.
const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g

export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of s.matchAll(INLINE)) {
    if (m.index! > last) out.push({ text: s.slice(last, m.index) })
    if (m[1]) out.push({ text: m[1], link: m[2] })
    else if (m[3]) out.push({ text: m[3], bold: true })
    else out.push({ text: m[4] ?? m[5], italic: true })
    last = m.index! + m[0].length
  }
  if (last < s.length) out.push({ text: s.slice(last) })
  return out
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', inlines: parseInline(para.join(' ')) })
    para = []
  }
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    let m: RegExpMatchArray | null
    if (!line) { flush(); continue }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flush(); blocks.push({ type: 'heading', level: m[1].length as HeadingLevel6, inlines: parseInline(m[2]) }); continue }
    if ((m = line.match(/^[-*]\s+(.*)$/))) { flush(); blocks.push({ type: 'bullet', inlines: parseInline(m[1]) }); continue }
    if ((m = line.match(/^\d+[.)]\s+(.*)$/))) { flush(); blocks.push({ type: 'numbered', inlines: parseInline(m[1]) }); continue }
    para.push(line)
  }
  flush()
  return blocks
}

/** Only web and mail links are kept; anything else (javascript:, data:) is rendered as plain text. */
export function safeHref(url: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(url.trim()) ? url.trim() : null
}

/** A numbering instance per separate numbered list, so each list restarts at 1. null for other blocks. */
export function listInstances(blocks: Block[]): Array<number | null> {
  let instance = 0
  let inList = false
  return blocks.map((b) => {
    if (b.type !== 'numbered') { inList = false; return null }
    if (!inList) { instance++; inList = true }
    return instance
  })
}

const runs = (inlines: Inline[]) => inlines.map((i) => {
  const href = i.link ? safeHref(i.link) : null
  return href
    ? new ExternalHyperlink({ link: href, children: [new TextRun({ text: i.text, style: 'Hyperlink' })] })
    : new TextRun({ text: i.text, bold: i.bold, italics: i.italic })
})

const HEADING = {
  1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4, 5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6,
} as const

export async function markdownToDocx(md: string, title: string): Promise<Blob> {
  const blocks = parseMarkdown(md)
  const instances = listInstances(blocks)
  const children = blocks.map((b, i) => {
    if (b.type === 'heading') return new Paragraph({ heading: HEADING[b.level], children: runs(b.inlines) })
    if (b.type === 'bullet') return new Paragraph({ bullet: { level: 0 }, children: runs(b.inlines) })
    if (b.type === 'numbered') return new Paragraph({ numbering: { reference: 'numbered', level: 0, instance: instances[i] ?? 1 }, children: runs(b.inlines) })
    return new Paragraph({ children: runs(b.inlines), spacing: { after: 160 } })
  })
  const doc = new Document({
    creator: 'jobfinder.inogen.ai',
    title,
    numbering: { config: [{ reference: 'numbered', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START }] }] },
    sections: [{ children }],
  })
  return Packer.toBlob(doc)
}

export const docxFilename = (title: string) =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document'}.docx`

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
