import { describe, expect, it } from 'vitest'
import { parseBookmarksHtml } from '@shared/bookmarks-import'

const CHROME_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://example.com/" ADD_DATE="1" ICON="data:image/png;base64,AAAA">Example &amp; Co</A>
        <DT><H3>News</H3>
        <DL><p>
            <DT><A HREF="https://news.example.org/a?x=1&amp;y=2">Top <b>story</b></A>
        </DL><p>
        <DT><A HREF="javascript:alert(1)">Bad</A>
        <DT><A HREF="ftp://files.example.com/">FTP</A>
    </DL><p>
    <DT><A HREF="http://plain.example.net/">Plain</A>
</DL><p>`

describe('parseBookmarksHtml', () => {
  it('parses Chrome/Firefox style exports with folders and entities', () => {
    const items = parseBookmarksHtml(CHROME_EXPORT)
    expect(items).toEqual([
      { title: 'Example & Co', url: 'https://example.com/', folder: 'Bookmarks bar' },
      { title: 'Top story', url: 'https://news.example.org/a?x=1&y=2', folder: 'Bookmarks bar / News' },
      { title: 'Plain', url: 'http://plain.example.net/', folder: '' }
    ])
  })

  it('drops non-http(s) links and invalid URLs', () => {
    const items = parseBookmarksHtml('<DL><A HREF="javascript:1">x</A><A HREF="file:///c:/a">y</A><A HREF="https://">z</A><A HREF="https://ok.example/">ok</A></DL>')
    expect(items.map((i) => i.url)).toEqual(['https://ok.example/'])
  })

  it('is tolerant of garbage and respects the limit', () => {
    expect(parseBookmarksHtml('')).toEqual([])
    expect(parseBookmarksHtml('<<<>>> not html')).toEqual([])
    const many = Array.from({ length: 50 }, (_, i) => `<A HREF="https://e.example/${i}">${i}</A>`).join('')
    expect(parseBookmarksHtml(many, 10)).toHaveLength(10)
  })

  it('uses the URL as the title when the title is empty', () => {
    expect(parseBookmarksHtml('<A HREF="https://t.example/"></A>')[0]?.title).toBe('https://t.example/')
  })
})
