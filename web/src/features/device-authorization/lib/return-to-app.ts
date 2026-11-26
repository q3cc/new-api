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

/**
 * The native client's link back into the app. Fixed here rather than taken
 * from the page's query, so the page cannot be made to redirect anywhere else.
 */
export const NATIVE_APP_CALLBACK = 'lyrabox://device-auth'

export type DeviceDecision = 'approved' | 'denied'

export function appCallbackUrl(decision: DeviceDecision): string {
  return `${NATIVE_APP_CALLBACK}?status=${decision}`
}

/**
 * Hands the decision back to the app. In the app's sign-in sheet (iOS
 * ASWebAuthenticationSession) this link closes the sheet; the app then signs
 * in by its own request, so nothing secret travels in the link.
 */
export function returnToApp(decision: DeviceDecision): void {
  window.location.assign(appCallbackUrl(decision))
}
