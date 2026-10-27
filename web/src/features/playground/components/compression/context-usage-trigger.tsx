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
import { Minimize2Icon, Settings2Icon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ContextUsageIcon } from '@/components/ai-elements/context'
import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverTitle,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type Props = {
  usageText: string
  used?: number
  /** The budget the ring is drawn against; absent when it is only assumed. */
  shownBudget?: number
  busy: boolean
  estimating: boolean
  estimateFailed: boolean
  onRetryEstimate: () => void
  disabled: boolean
  canCompress: boolean
  pendingAttempt: boolean
  onCompress: () => void
  onOpenSettings: () => void
  hasSummary: boolean
  onViewSummary: () => void
  onUndoCompression: () => void
  compressionWarning: boolean
}

/**
 * The context usage ring in the input toolbar. A click or a touch long press
 * opens the actions; a plain touch shows the tooltip like a hover does.
 */
export function ContextUsageTrigger(props: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const longPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const longPressOrigin = useRef({ x: 0, y: 0 })
  const suppressClick = useRef(false)
  const cancelLongPress = () => clearTimeout(longPress.current)
  useEffect(() => () => clearTimeout(longPress.current), [])
  const closeAnd = (action: () => void) => () => {
    setOpen(false)
    action()
  }
  return (
    <Popover
      open={open}
      onOpenChange={(value, details) => {
        if (suppressClick.current && details.reason === 'trigger-press') {
          suppressClick.current = false
          return
        }
        setOpen(value)
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <PromptInputButton
                  aria-label={t('Model context usage')}
                  aria-description={props.usageText}
                  className={
                    props.used !== undefined &&
                    props.shownBudget !== undefined &&
                    props.used >= props.shownBudget * 0.8
                      ? 'text-destructive'
                      : 'text-muted-foreground hover:text-foreground'
                  }
                  onPointerDown={(event) => {
                    suppressClick.current = false
                    if (event.pointerType === 'mouse') return
                    cancelLongPress()
                    longPressOrigin.current = {
                      x: event.clientX,
                      y: event.clientY,
                    }
                    longPress.current = setTimeout(() => {
                      suppressClick.current = true
                      setOpen(true)
                    }, 450)
                  }}
                  onPointerUp={cancelLongPress}
                  onPointerMove={(event) => {
                    // A resting finger still drifts a little, so only a real
                    // drag hands the gesture back to the message scroller.
                    if (
                      Math.abs(event.clientX - longPressOrigin.current.x) >
                        10 ||
                      Math.abs(event.clientY - longPressOrigin.current.y) > 10
                    ) {
                      cancelLongPress()
                    }
                  }}
                  onPointerCancel={cancelLongPress}
                  onContextMenu={(event) => event.preventDefault()}
                  onClick={(event) => {
                    if (suppressClick.current) {
                      event.preventDefault()
                    }
                  }}
                >
                  <ContextUsageIcon
                    usedTokens={props.used}
                    maxTokens={props.shownBudget}
                    aria-hidden='true'
                    className={
                      props.busy || props.estimating
                        ? 'animate-pulse'
                        : undefined
                    }
                  />
                </PromptInputButton>
              }
            />
          }
        />
        {!open && (
          <TooltipContent className='space-y-1'>
            <p>{t('Model context usage')}</p>
            <p>{props.usageText}</p>
          </TooltipContent>
        )}
      </Tooltip>
      <PopoverContent
        side='top'
        align='start'
        className='w-72 max-w-[calc(100vw-2rem)]'
      >
        <PopoverTitle>{t('Model context usage')}</PopoverTitle>
        <p className='text-muted-foreground text-xs tabular-nums' role='status'>
          {props.usageText}
        </p>
        {props.estimateFailed && (
          <Button size='sm' variant='outline' onClick={props.onRetryEstimate}>
            {t('Retry')}
          </Button>
        )}
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            size='sm'
            variant='outline'
            className='touch-manipulation pointer-coarse:min-h-11'
            disabled={props.disabled || !props.canCompress}
            onClick={closeAnd(props.onCompress)}
          >
            <Minimize2Icon aria-hidden='true' />
            {props.pendingAttempt
              ? t('Retry compression')
              : t('Compress context')}
          </Button>
          <Button
            size='icon'
            variant='ghost'
            className='touch-manipulation pointer-coarse:size-10'
            aria-label={t('Compression settings')}
            disabled={props.disabled}
            onClick={closeAnd(props.onOpenSettings)}
          >
            <Settings2Icon aria-hidden='true' />
          </Button>
          {props.hasSummary && (
            <>
              <Button
                size='sm'
                variant='ghost'
                className='touch-manipulation pointer-coarse:min-h-11'
                onClick={closeAnd(props.onViewSummary)}
              >
                {t('View summary')}
              </Button>
              <Button
                size='sm'
                variant='ghost'
                className='touch-manipulation pointer-coarse:min-h-11'
                disabled={props.disabled}
                onClick={props.onUndoCompression}
              >
                {t('Undo compression')}
              </Button>
            </>
          )}
          {props.compressionWarning && (
            <span className='text-destructive'>
              {t('DeepSeek V3 models have poor compression quality')}
            </span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
