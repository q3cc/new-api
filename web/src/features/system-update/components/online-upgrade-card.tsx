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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  SecureVerificationDialog,
  useSecureVerification,
} from '@/features/auth/secure-verification'
import { formatTimestamp } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { AuthOperationError } from '@/lib/secure-verification'

import {
  applyOnlineUpgrade,
  checkOnlineUpgrade,
  isUpgradeInProgress,
  onlineUpgradeQueryKey,
  rollbackOnlineUpgrade,
  useOnlineUpgradeStatus,
  type OnlineUpgradeStatus,
} from '../online-upgrade'

type UpgradeStep = {
  text: string
  tone: 'info' | 'success' | 'error'
  percent?: number
}

/** Describes where an upgrade stands, from download to the old version exiting. */
function describeUpgrade(
  status: OnlineUpgradeStatus,
  t: TFunction
): UpgradeStep | null {
  const progress = status.progress
  const supervisor = status.supervisor
  if (progress.phase === 'failed') {
    return {
      text: t('Upgrade failed: {{error}}', { error: progress.error }),
      tone: 'error',
    }
  }
  if (progress.phase === 'downloading') {
    const percent =
      progress.total > 0
        ? Math.floor((progress.downloaded / progress.total) * 100)
        : 0
    return {
      text: t('Downloading {{version}}: {{percent}}%', {
        version: progress.version,
        percent,
      }),
      tone: 'info',
      percent,
    }
  }
  if (progress.phase === 'handing_over' || supervisor?.phase === 'starting') {
    return {
      text: t('Verified. Starting the new version...'),
      tone: 'info',
    }
  }
  if (supervisor?.phase === 'failed') {
    return {
      text: t('Upgrade failed: {{error}}', { error: supervisor.error }),
      tone: 'error',
    }
  }
  const draining = supervisor?.draining ?? []
  if (draining.length > 0) {
    const connections = draining.reduce(
      (sum, worker) => sum + worker.connections,
      0
    )
    return {
      text: t(
        'Now running {{version}}. The previous version is finishing {{count}} open connections and exits when they are done.',
        { version: status.current_version, count: connections }
      ),
      tone: 'info',
    }
  }
  if (
    supervisor?.phase === 'succeeded' &&
    supervisor.target_version === status.current_version
  ) {
    return {
      text: t('Upgraded to {{version}}.', { version: status.current_version }),
      tone: 'success',
    }
  }
  return null
}

/** Super administrators check GitHub for a new version and install it in place. */
export function OnlineUpgradeCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const query = useOnlineUpgradeStatus()
  const verification = useSecureVerification()
  const status = query.data

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: onlineUpgradeQueryKey })
  const check = useMutation({
    mutationFn: checkOnlineUpgrade,
    onSuccess: () => void refresh(),
  })
  const upgrade = useMutation({
    mutationFn: async (version: string) => {
      const proof = await verification.requestVerification({
        scope: 'system.upgrade',
        context: { action: 'apply', version },
        title: t('Verify to upgrade'),
        description: t(
          'Confirm your identity to replace the running version with {{version}}.',
          { version }
        ),
      })
      if (!proof) return false
      await applyOnlineUpgrade(version, proof.proof_token)
      return true
    },
    onSuccess: (started) => {
      if (!started) return
      toast.success(t('Upgrade started'))
      void refresh()
    },
    onError: (error) => handleServerError(AuthOperationError.from(error)),
  })
  const rollback = useMutation({
    mutationFn: async (version: string) => {
      const proof = await verification.requestVerification({
        scope: 'system.upgrade',
        context: { action: 'rollback' },
        title: t('Verify to roll back'),
        description: t('Confirm your identity to switch back to {{version}}.', {
          version,
        }),
      })
      if (!proof) return false
      await rollbackOnlineUpgrade(proof.proof_token)
      return true
    },
    onSuccess: (started) => {
      if (!started) return
      toast.success(t('Rollback started'))
      void refresh()
    },
    onError: (error) => handleServerError(AuthOperationError.from(error)),
  })

  if (!status) {
    return (
      <p className='text-muted-foreground text-sm'>
        {query.isError
          ? t('Failed to load the online upgrade status.')
          : t('Loading...')}
      </p>
    )
  }

  const latest = status.check.latest
  const busy =
    isUpgradeInProgress(status) || upgrade.isPending || rollback.isPending
  const step = describeUpgrade(status, t)
  const previous = status.supervisor?.previous
  const drainHours = Math.round((status.drain_timeout / 3600) * 10) / 10
  let checkText = t('Updates have not been checked yet.')
  if (status.check.checked_at > 0) {
    checkText = status.check.has_update
      ? t('New version available: {{version}}', { version: latest?.version })
      : t('You are running the latest version.')
  }

  return (
    <section
      aria-labelledby='online-upgrade-title'
      className='space-y-4 rounded-lg border p-4'
    >
      <div className='space-y-1'>
        <h3 id='online-upgrade-title' className='font-semibold'>
          {t('Online upgrade')}
        </h3>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Open connections stay on the current version for up to {{hours}} hours; new connections go to the new version right away.',
            { hours: drainHours }
          )}
        </p>
      </div>

      {!status.supervised && (
        <Alert>
          <AlertTitle>{t('Online upgrade is not enabled')}</AlertTitle>
          <AlertDescription>
            {t(
              'Set HOT_UPGRADE_ENABLED=true and SESSION_SECRET for the container and recreate it once. After that, upgrades run here without recreating it.'
            )}
          </AlertDescription>
        </Alert>
      )}

      <dl className='grid min-w-0 gap-3 text-sm sm:grid-cols-2'>
        <div className='min-w-0'>
          <dt className='text-muted-foreground'>{t('Current version')}</dt>
          <dd className='font-mono font-medium break-all'>
            {status.current_version}
          </dd>
        </div>
        <div className='min-w-0'>
          <dt className='text-muted-foreground'>{t('Latest version')}</dt>
          <dd className='font-mono font-medium break-all'>
            {latest?.version ?? t('Unknown')}
          </dd>
        </div>
        {latest && (
          <div>
            <dt className='text-muted-foreground'>{t('Published at')}</dt>
            <dd>{formatTimestamp(latest.published_at)}</dd>
          </div>
        )}
        {status.check.checked_at > 0 && (
          <div>
            <dt className='text-muted-foreground'>{t('Last checked')}</dt>
            <dd>{formatTimestamp(status.check.checked_at)}</dd>
          </div>
        )}
      </dl>

      <p role='status' aria-live='polite' className='text-sm'>
        {checkText}
      </p>
      {status.check.error && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('Failed to check for updates')}: {status.check.error}
          </AlertDescription>
        </Alert>
      )}

      {step && (
        <div
          role='status'
          aria-live='polite'
          className='space-y-2'
          data-tone={step.tone}
        >
          {step.tone === 'error' ? (
            <Alert variant='destructive'>
              <AlertDescription>{step.text}</AlertDescription>
            </Alert>
          ) : (
            <p className='text-sm font-medium'>{step.text}</p>
          )}
          {step.percent !== undefined && (
            <Progress value={step.percent} aria-label={step.text} />
          )}
        </div>
      )}

      {status.check.has_update && latest?.notes && (
        <div className='space-y-1'>
          <div className='text-muted-foreground text-sm'>
            {t('Changes in this version')}
          </div>
          <pre className='bg-muted max-h-48 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap'>
            {latest.notes}
          </pre>
        </div>
      )}

      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          variant='outline'
          disabled={check.isPending}
          onClick={() => check.mutate()}
        >
          {check.isPending ? t('Checking updates...') : t('Check for updates')}
        </Button>
        {status.supervised && status.check.has_update && latest && (
          <Button
            type='button'
            disabled={busy}
            onClick={() => upgrade.mutate(latest.version)}
          >
            {t('Upgrade to {{version}}', { version: latest.version })}
          </Button>
        )}
        {status.supervised && previous && (
          <Button
            type='button'
            variant='ghost'
            disabled={busy}
            onClick={() => rollback.mutate(previous.version)}
          >
            {t('Roll back to {{version}}', { version: previous.version })}
          </Button>
        )}
      </div>
      <SecureVerificationDialog {...verification.dialogProps} />
    </section>
  )
}
