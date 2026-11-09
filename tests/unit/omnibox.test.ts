import { describe, expect, it } from 'vitest'
import { displayUrl, resolveOmnibox } from '@shared/omnibox'

const url = (input: string, engine = 'duckduckgo'): string => resolveOmnibox(input, engine).url
const kind = (input: string): string => resolveOmnibox(input, 'duckduckgo').kind

describe('resolveOmnibox', () => {
  it('upgrades bare hostnames to https', () => {
    expect(url('example.com')).toBe('https://example.com')
    expect(url('www.example.co.uk/path?q=1')).toBe('https://www.example.co.uk/path?q=1')
    expect(url('  example.com  ')).toBe('https://example.com')
  })

  it('keeps explicit schemes', () => {
    expect(url('http://example.com/a')).toBe('http://example.com/a')
    expect(url('https://example.com')).toBe('https://example.com')
    expect(url('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080/')
    expect(kind('http://127.0.0.1:8080/')).toBe('url')
  })

  it('uses http for localhost, IPs and .local hosts', () => {
    expect(url('localhost:3000')).toBe('http://localhost:3000')
    expect(url('127.0.0.1')).toBe('http://127.0.0.1')
    expect(url('192.168.1.1:8080/admin')).toBe('http://192.168.1.1:8080/admin')
    expect(url('[::1]:8080')).toBe('http://[::1]:8080')
    expect(url('printer.local')).toBe('http://printer.local')
  })

  it('treats plain words and sentences as searches', () => {
    expect(kind('cats')).toBe('search')
    expect(url('hello world')).toBe('https://duckduckgo.com/?q=hello%20world')
    expect(url('what is example.com')).toBe('https://duckduckgo.com/?q=what%20is%20example.com')
    expect(url('c++ tutorial & more')).toBe('https://duckduckgo.com/?q=c%2B%2B%20tutorial%20%26%20more')
  })

  it('uses the selected search engine', () => {
    expect(url('cats', 'brave')).toBe('https://search.brave.com/search?q=cats')
    expect(url('cats', 'google')).toBe('https://www.google.com/search?q=cats')
    expect(url('cats', 'startpage')).toContain('startpage.com')
    expect(url('cats', 'bing')).toContain('bing.com')
    expect(url('cats', 'nonexistent')).toContain('duckduckgo.com')
  })

  it('never navigates to script-like schemes typed into the bar', () => {
    for (const evil of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'blob:https://a/b']) {
      expect(kind(evil), evil).toBe('search')
    }
  })

  it('allows only known internal pages', () => {
    expect(url('bmax://settings')).toBe('bmax://settings/')
    expect(url('bmax://newtab/')).toBe('bmax://newtab/')
    expect(kind('bmax://chrome')).toBe('search')
    expect(kind('bmax://overlay')).toBe('search')
    expect(url('about:blank')).toBe('about:blank')
    expect(kind('about:config')).toBe('search')
  })

  it('supports view-source and file URLs', () => {
    expect(url('view-source:https://example.com')).toBe('view-source:https://example.com')
    expect(url('file:///C:/a.html')).toBe('file:///C:/a.html')
  })

  it('empty input opens the new tab page', () => {
    expect(url('')).toBe('bmax://newtab/')
    expect(url('   ')).toBe('bmax://newtab/')
  })
})

describe('displayUrl', () => {
  it('hides https:// and trailing slash, keeps http://', () => {
    expect(displayUrl('https://example.com/')).toBe('example.com')
    expect(displayUrl('https://example.com/a?b=1')).toBe('example.com/a?b=1')
    expect(displayUrl('http://example.com/')).toBe('http://example.com')
    expect(displayUrl('bmax://newtab/')).toBe('')
  })
})
