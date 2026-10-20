/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  checkVersionNow,
  extractBuildId,
  extractEntryUrls,
  probeForNewVersion,
  startVersionChecker,
  stopVersionChecker,
} from '../version-checker'

const LOADED_HTML = `
<!doctype html>
<html>
  <head>
    <script src="/static/js/index.aaaa1111.js"></script>
    <script src="/static/js/vendor-react.bbbb2222.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`

const DEPLOYED_SAME_HTML = `
<!doctype html>
<html>
  <head>
    <script src="/static/js/index.aaaa1111.js"></script>
    <script src="/static/js/vendor-react.bbbb2222.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`

const DEPLOYED_NEW_HTML = `
<!doctype html>
<html>
  <head>
    <script src="/static/js/index.cccc3333.js"></script>
    <script src="/static/js/vendor-react.bbbb2222.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`

function mockFetchHtml(html: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(html),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('version-checker', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML =
      '<script src="/static/js/index.aaaa1111.js"></script>' +
      '<script src="/static/js/vendor-react.bbbb2222.js"></script>'
  })

  afterEach(() => {
    stopVersionChecker()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('extractEntryUrls', () => {
    it('按排序返回所有入口脚本路径', () => {
      expect(extractEntryUrls(LOADED_HTML)).toEqual([
        '/static/js/index.aaaa1111.js',
        '/static/js/vendor-react.bbbb2222.js',
      ])
    })

    it('忽略非脚本标签与内联脚本', () => {
      const html =
        '<link rel="stylesheet" href="/a.css"><script>inline()</script>' +
        '<script src="/app.1234.js"></script>'
      expect(extractEntryUrls(html)).toEqual(['/app.1234.js'])
    })

    it('没有入口脚本时返回空数组', () => {
      expect(extractEntryUrls('<html><body></body></html>')).toEqual([])
    })
  })

  describe('extractBuildId', () => {
    it('读取 meta 标签中的构建标识', () => {
      expect(
        extractBuildId('<meta name="build-id" content="rv.1.abc">')
      ).toBe('rv.1.abc')
    })

    it('回退到 data-build-rev 属性', () => {
      expect(extractBuildId('<html data-build-rev="rv.2.def">')).toBe(
        'rv.2.def'
      )
    })

    it('缺少标识时返回 null', () => {
      expect(extractBuildId('<html></html>')).toBeNull()
    })
  })

  describe('probeForNewVersion', () => {
    it('入口资源一致时判定为最新', async () => {
      mockFetchHtml(DEPLOYED_SAME_HTML)
      await expect(probeForNewVersion()).resolves.toEqual({
        hasNewVersion: false,
        reason: 'none',
      })
    })

    it('入口脚本哈希变化时判定有新版本', async () => {
      mockFetchHtml(DEPLOYED_NEW_HTML)
      await expect(probeForNewVersion()).resolves.toEqual({
        hasNewVersion: true,
        reason: 'assets',
      })
    })

    it('部署的构建标识变化时判定有新版本', async () => {
      document.head.innerHTML = '<meta name="build-id" content="rv.old">'
      mockFetchHtml(`${DEPLOYED_SAME_HTML}<meta name="build-id" content="rv.new">`)
      await expect(probeForNewVersion()).resolves.toEqual({
        hasNewVersion: true,
        reason: 'build-id',
      })
    })

    it('请求绕过 HTTP 缓存并使用时间戳', async () => {
      const fetchMock = mockFetchHtml(DEPLOYED_SAME_HTML)
      await probeForNewVersion()
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toMatch(/^\/index\.html\?t=\d+$/)
      expect(init.cache).toBe('no-store')
    })

    it('网络失败时不误判为新版本', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      await expect(probeForNewVersion()).resolves.toEqual({
        hasNewVersion: false,
        reason: 'unavailable',
      })
    })

    it('服务端返回错误状态时不误判为新版本', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 502 })
      )
      await expect(probeForNewVersion()).resolves.toEqual({
        hasNewVersion: false,
        reason: 'unavailable',
      })
    })

    it('服务器未内联入口脚本时无法判定', async () => {
      mockFetchHtml('<html><body><div id="root"></div></body></html>')
      await expect(probeForNewVersion()).resolves.toEqual({
        hasNewVersion: false,
        reason: 'unavailable',
      })
    })
  })

  describe('checkVersionNow', () => {
    it('检测到新部署后调用注入的刷新函数', async () => {
      vi.useFakeTimers()
      mockFetchHtml(DEPLOYED_NEW_HTML)
      const reload = vi.fn()

      const checking = checkVersionNow({ reload })
      await vi.advanceTimersByTimeAsync(1000)
      await checking

      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('版本一致时不刷新页面', async () => {
      vi.useFakeTimers()
      mockFetchHtml(DEPLOYED_SAME_HTML)
      const reload = vi.fn()

      const checking = checkVersionNow({ reload })
      await vi.advanceTimersByTimeAsync(2000)
      await checking

      expect(reload).not.toHaveBeenCalled()
    })

    it('刷新失败时回退到强制刷新', async () => {
      vi.useFakeTimers()
      mockFetchHtml(DEPLOYED_NEW_HTML)
      const forceReload = vi.fn()
      const reload = vi.fn().mockRejectedValue(new Error('blocked'))

      const checking = checkVersionNow({ reload, forceReload })
      await vi.advanceTimersByTimeAsync(1000)
      await checking
      await vi.advanceTimersByTimeAsync(0)

      expect(forceReload).toHaveBeenCalled()
    })
  })

  describe('startVersionChecker', () => {
    it('首次检查延迟执行，随后按间隔轮询', async () => {
      vi.useFakeTimers()
      const fetchMock = mockFetchHtml(DEPLOYED_SAME_HTML)

      startVersionChecker({ checkInterval: 5000, initialDelay: 1000 })

      expect(fetchMock).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1000)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(5000)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('停止后不再轮询', async () => {
      vi.useFakeTimers()
      const fetchMock = mockFetchHtml(DEPLOYED_SAME_HTML)

      const stop = startVersionChecker({
        checkInterval: 5000,
        initialDelay: 1000,
      })
      await vi.advanceTimersByTimeAsync(1000)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      stop()
      await vi.advanceTimersByTimeAsync(20000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('重复启动会替换上一次的定时器而不是叠加', async () => {
      vi.useFakeTimers()
      const fetchMock = mockFetchHtml(DEPLOYED_SAME_HTML)

      startVersionChecker({ checkInterval: 5000, initialDelay: 1000 })
      startVersionChecker({ checkInterval: 5000, initialDelay: 1000 })

      await vi.advanceTimersByTimeAsync(1000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('标签页重新可见时立即检查', async () => {
      vi.useFakeTimers()
      const fetchMock = mockFetchHtml(DEPLOYED_SAME_HTML)

      startVersionChecker({ checkInterval: 60000, initialDelay: 60000 })
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })
})
