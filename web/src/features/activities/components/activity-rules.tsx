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
import { ScrollText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/ui/markdown'

type ActivityRulesProps = {
  title: string
  rules: string
}

/** Opens an activity's Markdown rules; renders nothing without rules. */
export function ActivityRules(props: ActivityRulesProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!props.rules.trim()) return null
  return (
    <>
      <Button size='sm' variant='outline' onClick={() => setOpen(true)}>
        <ScrollText aria-hidden='true' />
        {t('Activity rules')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Activity rules')}
        description={props.title}
        contentClassName='sm:max-w-2xl'
      >
        <Markdown breaks className='text-sm leading-relaxed'>
          {props.rules}
        </Markdown>
      </Dialog>
    </>
  )
}
