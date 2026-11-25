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
import { SmartPhone01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { clearAuthenticatedClientState } from '@/lib/api'
import { formatTimestampRelative } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import {
  listClientDevices,
  revokeClientDevice,
  type ClientDevice,
} from '../api'
import { clientDevicesQueryKey, clientPlatformName } from '../lib/client-device'


/**
 * Native clients (Lyra Box) the user signed in by browser authorization.
 * Revoking one signs that device out and stops its signed requests.
 */
export function ClientDevicesCard() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [revokeTarget, setRevokeTarget] = useState<ClientDevice | null>(null)

  const devicesQuery = useQuery({
    queryKey: clientDevicesQueryKey,
    queryFn: async () => {
      const response = await listClientDevices()
      if (!response.success) {
        throw createServerError(response, t('Failed to load authorized clients'))
      }
      return response.data ?? []
    },
  })

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await revokeClientDevice(id)
      if (!response.success || !response.data) {
        throw createServerError(response, t('Failed to revoke the client'))
      }
      return response.data
    },
    onSuccess: async (result) => {
      setRevokeTarget(null)
      if (result.current) {
        clearAuthenticatedClientState(queryClient)
        void navigate({ to: '/sign-in', replace: true })
        return
      }
      toast.success(t('Client revoked'))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: clientDevicesQueryKey }),
        queryClient.invalidateQueries({
          queryKey: ['profile', 'login-sessions'],
        }),
      ])
    },
    onError: (error: Error) => handleServerError(error),
  })

  const devices = devicesQuery.data ?? []
  let content: ReactNode
  if (devicesQuery.isLoading) {
    content = <Skeleton className='h-20 w-full' />
  } else if (devicesQuery.isError) {
    content = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('Unable to load authorized clients')}</EmptyTitle>
          <EmptyDescription>
            {t('Refresh the list and try again.')}
          </EmptyDescription>
        </EmptyHeader>
        <Button
          type='button'
          variant='outline'
          onClick={() => devicesQuery.refetch()}
        >
          {t('Retry')}
        </Button>
      </Empty>
    )
  } else if (devices.length === 0) {
    content = (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <HugeiconsIcon icon={SmartPhone01Icon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>{t('No authorized clients')}</EmptyTitle>
          <EmptyDescription>
            {t(
              'Choose "Sign in with browser" in Lyra Box to authorize a device here.'
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else {
    content = (
      <ul className='flex flex-col' aria-label={t('Authorized clients')}>
        {devices.map((device, index) => (
          <li key={device.id}>
            {index > 0 && <Separator />}
            <div className='flex flex-col gap-3 py-4 sm:flex-row sm:items-center'>
              <div className='bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg'>
                <HugeiconsIcon
                  icon={SmartPhone01Icon}
                  className='size-5'
                  strokeWidth={2}
                  aria-hidden='true'
                />
              </div>
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <p className='truncate font-medium'>{device.name}</p>
                  <Badge variant='outline'>
                    {clientPlatformName(device.platform)}
                  </Badge>
                  {device.verified && (
                    <Badge variant='secondary'>{t('Verified client')}</Badge>
                  )}
                </div>
                <p className='text-muted-foreground mt-1 text-xs'>
                  {t('Version {{version}} · Last used {{time}} · IP: {{ip}}', {
                    version: device.app_version,
                    time: formatTimestampRelative(
                      device.last_used_at,
                      'seconds',
                      locale
                    ),
                    ip: device.last_ip || t('Unknown'),
                  })}
                </p>
              </div>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => setRevokeTarget(device)}
              >
                {t('Revoke')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <Card data-card-hover='false'>
        <CardHeader>
          <CardTitle>{t('Authorized clients')}</CardTitle>
          <CardDescription>
            {t(
              'Apps signed in by browser authorization. Revoking one signs it out.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>{content}</CardContent>
      </Card>
      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
        title={t('Revoke this client?')}
        desc={t(
          '{{name}} will be signed out and must be authorized again to use your account.',
          { name: revokeTarget?.name ?? '' }
        )}
        confirmText={t('Revoke')}
        destructive
        isLoading={revokeMutation.isPending}
        handleConfirm={() => {
          if (revokeTarget) revokeMutation.mutate(revokeTarget.id)
        }}
      />
    </>
  )
}
