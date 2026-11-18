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
import { useQuery } from '@tanstack/react-query'
import { ImageOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Skeleton } from '@/components/ui/skeleton'

import { getTicketAttachment, ticketKeys } from '../api'

/**
 * A ticket image as a thumbnail that opens full size. The bytes come through
 * the authenticated client; a missing or unreadable image shows a notice
 * instead of a broken-image glyph.
 */
export function TicketImage(props: { id: number }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: ticketKeys.attachment(props.id),
    queryFn: ({ signal }) => getTicketAttachment(props.id, signal),
    staleTime: Infinity,
    retry: false,
    meta: { errorToast: false },
  })
  const [image, setImage] = useState<{ blob: Blob; src: string } | null>(null)
  useEffect(() => {
    if (!query.data) return
    const src = URL.createObjectURL(query.data)
    setImage({ blob: query.data, src })
    return () => URL.revokeObjectURL(src)
  }, [query.data])
  const src = query.data && image?.blob === query.data ? image.src : undefined

  if (query.isPending) {
    return <Skeleton className='size-24 rounded-md' />
  }
  if (!src) {
    return (
      <div
        role='img'
        aria-label={t('Image unavailable')}
        className='text-muted-foreground flex size-24 flex-col items-center justify-center gap-1 rounded-md border text-xs'
      >
        <ImageOff className='size-5' aria-hidden='true' />
        {t('Image unavailable')}
      </div>
    )
  }
  return (
    <>
      <button
        type='button'
        className='focus-visible:ring-ring overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none'
        aria-label={t('View image')}
        onClick={() => setOpen(true)}
      >
        <img src={src} alt='' className='size-24 object-cover' />
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Image')}
        contentClassName='sm:max-w-4xl'
      >
        <img
          src={src}
          alt={t('Ticket image')}
          className='mx-auto max-h-[75vh] max-w-full object-contain'
        />
      </Dialog>
    </>
  )
}
