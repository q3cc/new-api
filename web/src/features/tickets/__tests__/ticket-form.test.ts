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
import { describe, expect, it } from 'vitest'

import { TICKET_MAX_IMAGE_BYTES } from '../constants'
import { createTicketSchema, validateTicketImages } from '../lib/ticket-form'

function image(type: string, size = 16) {
  return new File([new Uint8Array(size)], `shot.${type.split('/')[1]}`, {
    type,
  })
}

describe('validateTicketImages', () => {
  it('accepts up to three PNG, JPEG, GIF or WebP images within the size limit', () => {
    expect(validateTicketImages([])).toBeNull()
    expect(
      validateTicketImages([
        image('image/png'),
        image('image/jpeg'),
        image('image/webp', TICKET_MAX_IMAGE_BYTES),
      ])
    ).toBeNull()
  })

  it('refuses a fourth image', () => {
    const four = ['png', 'jpeg', 'gif', 'webp'].map((kind) =>
      image(`image/${kind}`)
    )
    expect(validateTicketImages(four)).toBe(
      'At most {{count}} images per message'
    )
  })

  it('refuses SVG, which can carry scripts, and other file types', () => {
    expect(validateTicketImages([image('image/svg+xml')])).toBe(
      'Only PNG, JPEG, GIF and WebP images are supported'
    )
    expect(validateTicketImages([image('application/pdf')])).toBe(
      'Only PNG, JPEG, GIF and WebP images are supported'
    )
  })

  it('refuses an image one byte over the size limit', () => {
    expect(
      validateTicketImages([image('image/png', TICKET_MAX_IMAGE_BYTES + 1)])
    ).toBe('Each image must be at most {{size}} MB')
  })
})

describe('createTicketSchema', () => {
  const valid = {
    title: 'Top-up missing',
    category: 'billing',
    content: 'Paid but no credit',
    topup_trade_no: '',
    request_id: '20261118000000abc',
  }

  it('accepts a ticket without an order and trims its text', () => {
    const result = createTicketSchema.parse({ ...valid, title: '  Hi  ' })
    expect(result.title).toBe('Hi')
  })

  it('requires a title and a description', () => {
    const result = createTicketSchema.safeParse({
      ...valid,
      title: ' ',
      content: '',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'Title is required',
      'Message content is required',
    ])
  })

  it('refuses a request ID with characters a gateway ID never has', () => {
    const result = createTicketSchema.safeParse({
      ...valid,
      request_id: '<script>',
    })
    expect(result.error?.issues[0]?.message).toBe('Invalid request ID')
  })
})
