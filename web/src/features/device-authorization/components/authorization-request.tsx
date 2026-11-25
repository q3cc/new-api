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

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampRelative } from '@/lib/format'
import type { ClientDeviceAuthorization } from '@/features/security/api'
import { clientPlatformName } from '@/features/security/lib/client-device'

interface AuthorizationRequestProps {
  request: ClientDeviceAuthorization
  approving: boolean
  denying: boolean
  onApprove: () => void
  onDeny: () => void
}

/** What is asking for access, with the code to compare against the app. */
export function AuthorizationRequest(props: AuthorizationRequestProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const busy = props.approving || props.denying

  return (
    <Card data-card-hover='false'>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center gap-2'>
          {props.request.client_name}
          {props.request.verified ? (
            <Badge variant='secondary'>{t('Verified client')}</Badge>
          ) : (
            <Badge variant='outline'>{t('Unverified build')}</Badge>
          )}
        </CardTitle>
        <CardDescription>
          {t('wants to sign in to your account')}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm'>
          <dt className='text-muted-foreground'>{t('Platform')}</dt>
          <dd>{clientPlatformName(props.request.platform)}</dd>
          <dt className='text-muted-foreground'>{t('Version')}</dt>
          <dd>{props.request.app_version}</dd>
          <dt className='text-muted-foreground'>{t('Requested from')}</dt>
          <dd>{props.request.request_ip || t('Unknown')}</dd>
          <dt className='text-muted-foreground'>{t('Requested')}</dt>
          <dd>
            {formatTimestampRelative(props.request.created_at, 'seconds', locale)}
          </dd>
        </dl>
        <Alert>
          <AlertTitle>{t('Check the code')}</AlertTitle>
          <AlertDescription className='flex flex-col gap-2'>
            <span>
              {t(
                'Only authorize if you started signing in yourself and the app shows this code. Someone else could be asking you to approve their device.'
              )}
            </span>
            <span
              className='font-mono text-2xl font-semibold tracking-widest'
              aria-label={t('Code')}
            >
              {props.request.user_code}
            </span>
          </AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter className='flex justify-end gap-2'>
        <Button
          type='button'
          variant='outline'
          disabled={busy}
          onClick={props.onDeny}
        >
          {t('Deny')}
        </Button>
        <Button type='button' disabled={busy} onClick={props.onApprove}>
          {props.approving ? t('Authorizing...') : t('Authorize')}
        </Button>
      </CardFooter>
    </Card>
  )
}
