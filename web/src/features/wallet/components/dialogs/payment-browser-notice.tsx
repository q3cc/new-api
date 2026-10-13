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
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'

import type { RechargeBrowser } from '../../lib/payment'

export function PaymentBrowserNotice(props: {
  browser: RechargeBrowser | null
}) {
  const { t } = useTranslation()
  if (!props.browser) return null
  const browserNames = { WeChat: t('WeChat'), Alipay: t('Alipay'), QQ: 'QQ' }

  return (
    <Alert
      variant='destructive'
      className='col-span-2 min-w-0 border-0 bg-transparent p-0 sm:basis-full'
    >
      <AlertDescription className='text-pretty break-words'>
        {t(
          'Top-ups are unavailable in the {{browser}} in-app browser. Open this page in your system browser to continue.',
          {
            browser: browserNames[props.browser],
          }
        )}
      </AlertDescription>
    </Alert>
  )
}
