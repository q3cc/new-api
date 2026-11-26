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
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

// Bounds mirror setting/operation_setting/client_device_setting.go.
const schema = z.object({
  enabled: z.boolean(),
  maxDevicesPerUser: z.coerce.number().int().min(1).max(100),
  verifiedRpmEnabled: z.boolean(),
  verifiedRpmMultiplier: z.coerce.number().min(1).max(100),
  chatSyncEnabled: z.boolean(),
  chatSyncMaxSessions: z.coerce.number().int().min(1).max(100000),
  chatSyncMaxMegabytes: z.coerce.number().int().min(1).max(100000),
  buildSecret: z.string(),
})

type Values = z.infer<typeof schema>

export type ClientDeviceDefaults = Omit<Values, 'buildSecret'>

const OPTION_KEYS: Record<keyof ClientDeviceDefaults, string> = {
  enabled: 'client_device_setting.enabled',
  maxDevicesPerUser: 'client_device_setting.max_devices_per_user',
  verifiedRpmEnabled: 'client_device_setting.verified_rpm_enabled',
  verifiedRpmMultiplier: 'client_device_setting.verified_rpm_multiplier',
  chatSyncEnabled: 'chat_sync_setting.enabled',
  chatSyncMaxSessions: 'chat_sync_setting.max_sessions_per_user',
  chatSyncMaxMegabytes: 'chat_sync_setting.max_megabytes_per_user',
}

/**
 * Native clients (Lyra Box): browser authorization, the higher model request
 * rate limit for requests signed by a verified device, and cloud chat sync.
 */
export function ClientDeviceSection(props: {
  defaultValues: ClientDeviceDefaults
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const form = useForm<Values>({
    resolver: zodResolver(schema) as unknown as Resolver<Values>,
    defaultValues: { ...props.defaultValues, buildSecret: '' },
  })
  const { isDirty, isSubmitting } = form.formState
  const busy = updateOption.isPending || isSubmitting
  const verifiedRpmEnabled = form.watch('verifiedRpmEnabled')
  const chatSyncEnabled = form.watch('chatSyncEnabled')

  async function onSubmit(values: Values) {
    const updates: Array<{ key: string; value: string }> = []
    for (const field of Object.keys(OPTION_KEYS) as Array<
      keyof ClientDeviceDefaults
    >) {
      if (values[field] !== props.defaultValues[field]) {
        updates.push({ key: OPTION_KEYS[field], value: String(values[field]) })
      }
    }
    // The build keys are write-only: an empty field keeps the saved keys.
    if (values.buildSecret.trim() !== '') {
      updates.push({
        key: 'client_device_secret_setting.build_secret',
        value: values.buildSecret.trim(),
      })
    }
    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }
    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }
    form.reset({ ...values, buildSecret: '' })
  }

  return (
    <SettingsSection title={t('Native Clients')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={busy}
            isSaveDisabled={!isDirty}
            saveLabel='Save native client settings'
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>
                    {t('Allow sign-in by browser authorization')}
                  </FormLabel>
                  <FormDescription>
                    {t(
                      'Native clients such as Lyra Box show a code; the user approves it on the /device page.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={busy}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <FormField
            control={form.control}
            name='maxDevicesPerUser'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Authorized devices per user')}</FormLabel>
                <FormControl>
                  <Input type='number' min={1} max={100} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='verifiedRpmEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>
                    {t('Higher rate limit for verified clients')}
                  </FormLabel>
                  <FormDescription>
                    {t(
                      "Requests signed by a verified device of the token's owner get a multiple of the model request rate limits."
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={busy}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          {verifiedRpmEnabled && (
            <FormField
              control={form.control}
              name='verifiedRpmMultiplier'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Rate limit multiplier')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1}
                      max={100}
                      step={0.5}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name='chatSyncEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Cloud chat sync')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Signed-in clients can pull all of their chats from the cloud; they upload only when the user chooses to.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={busy}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          {chatSyncEnabled && (
            <div className='grid gap-6 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='chatSyncMaxSessions'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Synced chats per user')}</FormLabel>
                    <FormControl>
                      <Input type='number' min={1} max={100000} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='chatSyncMaxMegabytes'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Chat storage per user (MB)')}</FormLabel>
                    <FormControl>
                      <Input type='number' min={1} max={100000} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}
          <FormField
            control={form.control}
            name='buildSecret'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Official build keys')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    spellCheck={false}
                    className='font-mono'
                    placeholder={t('Leave blank to keep the saved keys')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'One key per line. A device that signs its authorization with one of them is marked verified. Saved keys are never shown again; entering keys replaces them all.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
