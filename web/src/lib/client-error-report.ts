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
import { getBuildRevision } from '@/lib/build-metadata'
import { api } from '@/lib/http-client'

type FailedRequest = {
  config?: { method?: string; url?: string }
  response?: { status?: number; headers?: Record<string, unknown> }
}

/**
 * Send the error behind the error page to the server log, as the browser
 * console would print it. Never rejects: a report that cannot be delivered
 * must not get in the way of recovering the page.
 */
export async function reportClientError(error: unknown): Promise<void> {
  const failed: FailedRequest =
    typeof error === 'object' && error !== null ? error : {}
  const method = failed.config?.method?.toUpperCase() ?? ''
  const requestId = failed.response?.headers?.['x-oneapi-request-id']
  try {
    await api.post(
      '/api/client-error',
      {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? (error.stack ?? '') : '',
        status: failed.response?.status ?? 0,
        // The path only: a query string may carry codes or tokens.
        page: window.location.pathname,
        build: getBuildRevision(),
        request: failed.config?.url ? `${method} ${failed.config.url}` : '',
        request_id: typeof requestId === 'string' ? requestId : '',
      },
      { skipErrorHandler: true, skipBusinessError: true, timeout: 3000 }
    )
  } catch {
    // The server may be the thing that is failing.
  }
}
