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
import { t } from 'i18next'

export async function fetchChatboxModels(apiKey: string): Promise<string[]> {
  // The management client replaces Authorization with session credentials.
  // Query the local relay with the selected API key to honor its group and limits.
  try {
    const key = apiKey.startsWith('sk-') ? apiKey : `sk-${apiKey}`
    const response = await fetch('/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    })
    if (!response.ok) {
      throw new Error()
    }
    const result = await response.json()
    if (!Array.isArray(result.data)) {
      throw new Error()
    }
    return result.data.flatMap((model: { id?: unknown }) =>
      typeof model?.id === 'string' ? [model.id] : []
    )
  } catch {
    // Never propagate request objects or gateway response bodies containing secrets.
    throw new Error(t('Failed to load models'))
  }
}
