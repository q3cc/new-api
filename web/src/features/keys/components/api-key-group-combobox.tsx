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
import { Check, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { GroupTagIcon } from '@/components/group-tag-icon'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useMediaQuery } from '@/hooks'
import {
  getGroupTagLabel,
  MIXED_GROUP_TAG,
  OTHER_GROUP_TAG,
} from '@/lib/group-tag'
import { cn } from '@/lib/utils'

import {
  AUTO_GROUP_FRAME_CLASS_NAME,
  AutoGroupFlowBorder,
  GroupRatioBadge,
} from './auto-group-visuals'

export type ApiKeyGroupOption = {
  value: string
  label: string
  desc?: string
  ratio?: number | string
  /** Provider tag id from @/lib/group-tag; untagged options read as "other". */
  tag?: string
}

type ApiKeyGroupComboboxProps = {
  options: ApiKeyGroupOption[]
  value?: string
  onValueChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

type TagSection = { tag: string; options: ApiKeyGroupOption[] }

// Sections follow the order the groups arrive in, so an administrator's group
// order decides which provider comes first; mixed and other close the list.
function groupByTag(options: ApiKeyGroupOption[]): TagSection[] {
  const sections = new Map<string, ApiKeyGroupOption[]>()
  for (const option of options) {
    const tag = option.tag ?? OTHER_GROUP_TAG
    const section = sections.get(tag)
    if (section) section.push(option)
    else sections.set(tag, [option])
  }
  const last = [MIXED_GROUP_TAG, OTHER_GROUP_TAG]
  return [
    ...[...sections.keys()].filter((tag) => !last.includes(tag)),
    ...last.filter((tag) => sections.has(tag)),
  ].map((tag) => ({ tag, options: sections.get(tag) ?? [] }))
}

export function ApiKeyGroupCombobox({
  options,
  value,
  onValueChange,
  placeholder,
  disabled,
}: ApiKeyGroupComboboxProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [activeTag, setActiveTag] = useState('')
  const shouldReduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const selectedOption = options.find((option) => option.value === value)
  const isAutoSelected = selectedOption?.value === 'auto'

  // Tags are only worth showing when the groups span more than one of them.
  const tagSections = useMemo(() => groupByTag(options), [options])
  const showTags = tagSections.length > 1
  const tagFilter =
    showTags && tagSections.some((section) => section.tag === activeTag)
      ? activeTag
      : ''

  const filteredSections = useMemo(() => {
    const search = searchValue.trim().toLowerCase()
    const matches = options.filter((option) => {
      if (tagFilter && (option.tag ?? OTHER_GROUP_TAG) !== tagFilter) {
        return false
      }
      if (!search) return true
      const ratioText = String(option.ratio ?? '').toLowerCase()
      return (
        option.value.toLowerCase().includes(search) ||
        option.label.toLowerCase().includes(search) ||
        option.desc?.toLowerCase().includes(search) ||
        ratioText.includes(search)
      )
    })
    return showTags
      ? groupByTag(matches)
      : [{ tag: OTHER_GROUP_TAG, options: matches }]
  }, [options, searchValue, showTags, tagFilter])

  const handleSelect = (selectedValue: string) => {
    onValueChange(selectedValue)
    setOpen(false)
    setSearchValue('')
  }

  const tagChips = [
    { tag: '', label: t('All'), count: options.length },
    ...tagSections.map((section) => ({
      tag: section.tag,
      label: getGroupTagLabel(section.tag, t),
      count: section.options.length,
    })),
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            role='combobox'
            aria-expanded={open}
            data-auto-group-effect={isAutoSelected ? 'trigger' : undefined}
            disabled={disabled}
            className={cn(
              'border-input bg-muted/40 hover:bg-muted/55 hover:text-foreground active:bg-background data-popup-open:border-ring data-popup-open:bg-background data-popup-open:ring-ring/20 relative h-auto min-h-14 w-full justify-between gap-2 rounded-lg px-3 py-2 text-start shadow-none transition-[background-color,border-color,box-shadow] duration-150 data-popup-open:ring-[3px] sm:min-h-20 sm:gap-3 sm:px-4 sm:py-3',
              isAutoSelected &&
                cn(
                  AUTO_GROUP_FRAME_CLASS_NAME,
                  'hover:border-primary/55 data-popup-open:border-primary/55 data-popup-open:ring-primary/20'
                )
            )}
          />
        }
      >
        {isAutoSelected && (
          <AutoGroupFlowBorder shouldReduceMotion={shouldReduceMotion} />
        )}
        <span className='flex min-w-0 flex-1 items-center justify-between gap-2 sm:gap-3'>
          <span className='flex min-w-0 items-center gap-3'>
            {showTags && selectedOption && (
              <GroupTagIcon
                tag={selectedOption.tag ?? OTHER_GROUP_TAG}
                size={20}
              />
            )}
            <span className='min-w-0'>
              <span className='block truncate font-medium'>
                {selectedOption?.label || placeholder || t('Select a group')}
              </span>
              {selectedOption?.desc && (
                <span className='text-muted-foreground block truncate text-[11px] sm:text-xs'>
                  {selectedOption.desc}
                </span>
              )}
            </span>
          </span>
          <span className='hidden sm:block'>
            <GroupRatioBadge
              ratio={selectedOption?.ratio}
              isAuto={isAutoSelected}
              shouldReduceMotion={shouldReduceMotion}
            />
          </span>
        </span>
        <ChevronsUpDown
          aria-hidden='true'
          className='size-4 shrink-0 opacity-50'
        />
      </PopoverTrigger>
      <PopoverContent
        className='data-closed:zoom-out-100 data-open:zoom-in-100 data-[side=bottom]:slide-in-from-top-0 data-[side=left]:slide-in-from-right-0 data-[side=right]:slide-in-from-left-0 data-[side=top]:slide-in-from-bottom-0 w-[var(--anchor-width)] overflow-hidden rounded-xl p-0 shadow-lg data-closed:duration-75 data-open:duration-100'
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t('Search...')}
            value={searchValue}
            onValueChange={setSearchValue}
          />
          {showTags && (
            <div
              role='group'
              aria-label={t('Filter groups by tag')}
              className='flex flex-wrap gap-1.5 border-b px-2 py-2'
            >
              {tagChips.map((chip) => {
                const active = chip.tag === tagFilter
                return (
                  <Button
                    key={chip.tag || 'all'}
                    type='button'
                    size='sm'
                    variant='outline'
                    aria-pressed={active}
                    // Keep typing focus in the search box when a chip is clicked.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setActiveTag(chip.tag)}
                    className={cn(
                      'h-7 gap-1.5 rounded-full px-2.5 text-xs',
                      active &&
                        'border-primary/60 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
                    )}
                  >
                    {chip.tag && <GroupTagIcon tag={chip.tag} size={14} />}
                    <span>{chip.label}</span>
                    <span
                      className={cn(
                        'tabular-nums',
                        active ? 'text-primary/80' : 'text-muted-foreground'
                      )}
                    >
                      {chip.count}
                    </span>
                  </Button>
                )
              })}
            </div>
          )}
          <CommandList className='max-h-[360px]'>
            <CommandEmpty>{t('No group found.')}</CommandEmpty>
            {filteredSections.map((section) => {
              if (section.options.length === 0) return null
              return (
                <CommandGroup
                  key={section.tag}
                  heading={
                    showTags ? (
                      <span className='flex items-center gap-1.5'>
                        <GroupTagIcon tag={section.tag} size={14} />
                        <span>{getGroupTagLabel(section.tag, t)}</span>
                        <span className='tabular-nums'>
                          {section.options.length}
                        </span>
                      </span>
                    ) : undefined
                  }
                >
                  {section.options.map((option) => {
                    const isAutoOption = option.value === 'auto'
                    const isChosen = value === option.value

                    return (
                      <CommandItem
                        key={option.value}
                        value={option.value}
                        data-auto-group-effect={
                          isAutoOption ? 'option' : undefined
                        }
                        onSelect={() => handleSelect(option.value)}
                        className={cn(
                          'data-[selected=true]:bg-muted items-center gap-3 rounded-lg px-3 py-3 transition-colors',
                          isAutoOption &&
                            cn(
                              AUTO_GROUP_FRAME_CLASS_NAME,
                              'border-primary/35 data-[selected=true]:border-primary/55'
                            )
                        )}
                      >
                        {isAutoOption && (
                          <AutoGroupFlowBorder
                            shouldReduceMotion={shouldReduceMotion}
                          />
                        )}
                        {showTags && (
                          <GroupTagIcon
                            tag={option.tag ?? OTHER_GROUP_TAG}
                            size={20}
                          />
                        )}
                        <span className='min-w-0 flex-1'>
                          <span className='block truncate font-medium'>
                            {option.label}
                          </span>
                          {option.desc && (
                            <span className='text-muted-foreground block truncate text-xs'>
                              {option.desc}
                            </span>
                          )}
                        </span>
                        <Check
                          aria-hidden='true'
                          className={cn(
                            'size-4',
                            isChosen ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <GroupRatioBadge
                          ratio={option.ratio}
                          isAuto={isAutoOption}
                          shouldReduceMotion={shouldReduceMotion}
                        />
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
