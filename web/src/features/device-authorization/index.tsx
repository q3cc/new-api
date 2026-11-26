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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout/components/section-page-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { SecureVerificationDialog } from '@/features/auth/secure-verification'
import {
  approveClientDeviceAuthorization,
  denyClientDeviceAuthorization,
  getClientDeviceAuthorization,
} from '@/features/security/api'
import { useAccountSecurity } from '@/features/security/hooks/use-account-security'
import { clientDevicesQueryKey } from '@/features/security/lib/client-device'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { AuthorizationRequest } from './components/authorization-request'
import { type DeviceDecision, returnToApp } from './lib/return-to-app'
import { formatUserCode, normalizeUserCode } from './lib/user-code'

type Decision = DeviceDecision

/**
 * Lets the signed-in user approve a native client (Lyra Box) that started a
 * browser authorization. The client opens /device?code=XXXX-XXXX; the code
 * can also be typed in. Opened with return=app (the app's sign-in sheet), the
 * page goes back to the app once the user decides.
 */
export function DeviceAuthorization() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const search = useSearch({ from: '/_authenticated/device/' })
  const code = normalizeUserCode(search.code ?? '')
  const [draft, setDraft] = useState(formatUserCode(code))
  const [decision, setDecision] = useState<Decision | null>(null)
  const security = useAccountSecurity()

  const requestQuery = useQuery({
    queryKey: ['device-authorization', code],
    enabled: code.length === 8 && decision === null,
    retry: false,
    queryFn: async () => {
      const response = await getClientDeviceAuthorization(code)
      if (!response.success || !response.data) {
        throw createServerError(
          response,
          t('This code is invalid or has expired.')
        )
      }
      return response.data
    },
    meta: { errorToast: false },
  })

  const decide = (next: Decision) => {
    setDecision(next)
    if (search.return === 'app') returnToApp(next)
  }

  const denyMutation = useMutation({
    mutationFn: async () => {
      const response = await denyClientDeviceAuthorization(code)
      if (!response.success) {
        throw createServerError(response, t('Failed to deny the request'))
      }
    },
    onSuccess: () => decide('denied'),
    onError: (error: Error) => handleServerError(error),
  })

  const approve = async () => {
    const result = await security.run(async (signal) => {
      const proof = await security.verify(
        { scope: 'client_device.authorize', context: { user_code: code } },
        signal
      )
      return approveClientDeviceAuthorization(code, proof, signal)
    })
    if (!result) return
    decide('approved')
    await queryClient.invalidateQueries({ queryKey: clientDevicesQueryKey })
  }

  const submitCode = (event: FormEvent) => {
    event.preventDefault()
    setDecision(null)
    void navigate({
      to: '/device',
      search: {
        code: formatUserCode(normalizeUserCode(draft)),
        return: search.return,
      },
      replace: true,
    })
  }

  let content: ReactNode
  if (decision === 'approved') {
    content = (
      <Empty role='status'>
        <EmptyHeader>
          <EmptyTitle>{t('Device authorized')}</EmptyTitle>
          <EmptyDescription>
            {t('{{name}} is now signed in. You can return to the app.', {
              name: requestQuery.data?.client_name ?? 'Lyra Box',
            })}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else if (decision === 'denied') {
    content = (
      <Empty role='status'>
        <EmptyHeader>
          <EmptyTitle>{t('Request denied')}</EmptyTitle>
          <EmptyDescription>
            {t('The device was not signed in.')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else if (code.length !== 8) {
    content = null
  } else if (requestQuery.isLoading) {
    content = <Skeleton className='h-64 w-full' />
  } else if (requestQuery.isError || !requestQuery.data) {
    content = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('This code is invalid or has expired.')}</EmptyTitle>
          <EmptyDescription>
            {t('Start signing in again in the app to get a new code.')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else {
    content = (
      <AuthorizationRequest
        request={requestQuery.data}
        approving={security.pending}
        denying={denyMutation.isPending}
        onApprove={() => void approve()}
        onDeny={() => denyMutation.mutate()}
      />
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Authorize a device')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto flex w-full max-w-xl flex-col gap-4'>
          <Card data-card-hover='false'>
            <CardContent>
              <form
                className='flex flex-col gap-3 sm:flex-row sm:items-end'
                onSubmit={submitCode}
              >
                <div className='flex flex-1 flex-col gap-2'>
                  <Label htmlFor='device-user-code'>
                    {t('Code shown in the app')}
                  </Label>
                  <Input
                    id='device-user-code'
                    value={draft}
                    autoComplete='off'
                    autoCapitalize='characters'
                    spellCheck={false}
                    placeholder='XXXX-XXXX'
                    className='font-mono tracking-widest uppercase'
                    onChange={(event) => setDraft(event.target.value)}
                  />
                </div>
                <Button
                  type='submit'
                  variant='outline'
                  disabled={normalizeUserCode(draft).length !== 8}
                >
                  {t('Continue')}
                </Button>
              </form>
            </CardContent>
          </Card>
          {content}
        </div>
        <SecureVerificationDialog {...security.verificationDialogProps} />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
