import { describe, it, expect } from 'vitest'
import { parseMarkdown, parseInline, markdownToDocx, docxFilename, listInstances, safeHref } from './markdownDocx'

describe('parseMarkdown', () => {
  it('reads headings, paragraphs, bullet and numbered lists', () => {
    const blocks = parseMarkdown('# Michael Snow\n\nAI engineer\nbased in NL.\n\n## Skills\n- Python\n* GCP\n\n1. First\n2. Second')
    expect(blocks.map((b) => b.type === 'heading' ? `h${b.level}` : b.type)).toEqual(['h1', 'paragraph', 'h2', 'bullet', 'bullet', 'numbered', 'numbered'])
    expect(blocks[1].inlines.map((i) => i.text).join('')).toBe('AI engineer based in NL.')
  })
  it('treats a Subject line as a paragraph', () => {
    expect(parseMarkdown('Subject: AI Engineer')[0].type).toBe('paragraph')
  })
})

describe('edge cases', () => {
  it('leaves snake_case words alone', () => {
    expect(parseInline('big_data_eng and _real_ italics')).toEqual([{ text: 'big_data_eng and ' }, { text: 'real', italic: true }, { text: ' italics' }])
  })
  it('supports headings down to level 6', () => {
    expect(parseMarkdown('#### Four\n###### Six').map((b) => b.type === 'heading' && b.level)).toEqual([4, 6])
  })
  it('restarts numbering for each separate numbered list', () => {
    const blocks = parseMarkdown('1. a\n2. b\n\nText\n\n1. c')
    expect(listInstances(blocks).filter((n) => n !== null)).toEqual([1, 1, 2])
  })
  it('only allows web and mail links', () => {
    expect(safeHref('https://x.ai')).toBe('https://x.ai')
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,x')).toBeNull()
  })
})

describe('parseInline', () => {
  it('handles bold, italic and links', () => {
    expect(parseInline('I built **RAG** at *scale*, see [site](https://x.ai).')).toEqual([
      { text: 'I built ' }, { text: 'RAG', bold: true }, { text: ' at ' }, { text: 'scale', italic: true },
      { text: ', see ' }, { text: 'site', link: 'https://x.ai' }, { text: '.' },
    ])
  })
})

describe('docx', () => {
  it('produces a non-empty Word file', async () => {
    const blob = await markdownToDocx('# Title\n\nHello **world**\n\n- one', 'Cover letter')
    expect(blob.size).toBeGreaterThan(1000)
  })
  it('makes a safe filename', () => {
    expect(docxFilename('Cover letter · 7 Oct, 14:02')).toBe('cover-letter-7-oct-14-02.docx')
  })
})
