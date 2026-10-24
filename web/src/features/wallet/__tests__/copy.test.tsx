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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { Toaster, toast } from 'sonner'
import { beforeEach, expect, it, vi } from 'vitest'

import { Button } from '@/components/ui/button'
import { BillingHistoryDialog } from '@/features/wallet/components/dialogs/billing-history-dialog'
import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import viLocale from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { RechargeFormCard } from '../components/recharge-form-card'
import { SubscriptionPlansCard } from '../components/subscription-plans-card'
import { useRedemption } from '../hooks/use-redemption'

const i18n = createInstance()

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: false,
    nsSeparator: false,
    resources: { en, zh, 'zh-TW': zhTW, fr, ru, ja, vi: viLocale },
    interpolation: { escapeValue: false },
  })
})

it('translates billing history statuses and updates them when the language changes', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 3,
        items: ['success', 'pending', 'expired'].map((status, id) => ({
          id,
          status,
          amount: 10,
          money: 10,
          trade_no: `order-${id}`,
          payment_method: 'stripe',
          create_time: 1,
        })),
      },
    },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <BillingHistoryDialog open onOpenChange={vi.fn()} />
    </I18nextProvider>
  )
  await screen.findByText('order-0')
  for (const label of ['成功', '待确认', '已过期']) {
    expect(screen.getByText(label)).toBeVisible()
  }
  await act(() => i18n.changeLanguage('en'))
  for (const label of ['Success', 'Pending', 'Expired']) {
    expect(screen.getByText(label)).toBeVisible()
  }
})

it.each([
  { priceRatio: 7.3, paid: '584', saved: '146', full: '146' },
  { priceRatio: 0.000123, paid: '0.0098', saved: '0.0025', full: '0.0025' },
])(
  'translates recharge presets and minimum amount without changing precision at price ratio $priceRatio',
  async ({ priceRatio, paid, saved, full }) => {
    render(
      <I18nextProvider i18n={i18n}>
        <RechargeFormCard
          topupInfo={{
            enable_online_topup: true,
            enable_stripe_topup: false,
            pay_methods: [],
            min_topup: 1,
            stripe_min_topup: 1,
            amount_options: [100, 20],
            discount: {},
          }}
          presetAmounts={[{ value: 100, discount: 0.8 }, { value: 20 }]}
          selectedPreset={null}
          topupAmount={1}
          paymentAmount={priceRatio}
          priceRatio={priceRatio}
          calculating={false}
          paymentLoading={null}
          redemptionCode=''
          redeeming={false}
          onSelectPreset={vi.fn()}
          onTopupAmountChange={vi.fn()}
          onPaymentMethodSelect={vi.fn()}
          onRedemptionCodeChange={vi.fn()}
          onRedeem={vi.fn()}
        />
      </I18nextProvider>
    )
    expect(screen.getByRole('button', { name: /^100 / })).toHaveTextContent(
      `优惠 20%支付 ${paid} • 节省 ${saved}`
    )
    expect(screen.getByRole('button', { name: /^20 / })).toHaveTextContent(
      `支付 ${full}`
    )
    expect(screen.getByPlaceholderText('最低 1')).toBeVisible()
    await act(() => i18n.changeLanguage('en'))
    expect(screen.getByRole('button', { name: /^100 / })).toHaveTextContent(
      `20% OFFPay ${paid} • Save ${saved}`
    )
    expect(screen.getByRole('button', { name: /^20 / })).toHaveTextContent(
      `Pay ${full}`
    )
    expect(screen.getByPlaceholderText('Minimum 1')).toBeVisible()
  }
)

function SubscriptionCodeFlow() {
  const { redeemCode } = useRedemption()
  const [revision, setRevision] = useState(0)
  return (
    <>
      <Button
        onClick={async () => {
          if (await redeemCode(' subscription-code ')) {
            setRevision((value) => value + 1)
          }
        }}
      >
        Redeem
      </Button>
      <SubscriptionPlansCard topupInfo={null} refreshKey={revision} />
      <Toaster />
    </>
  )
}

it('a subscription redemption with zero balance increase succeeds and refreshes subscriptions', async () => {
  await i18n.changeLanguage('en')
  toast.dismiss()
  let active = false
  const sub = {
    subscription: {
      id: 30,
      user_id: 1,
      plan_id: 7,
      status: 'active',
      source: 'redemption',
      start_time: 1,
      end_time: 2000000000,
      amount_total: 5000000,
      amount_used: 0,
    },
  }
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/subscription/plans') {
      return {
        data: {
          success: true,
          data: [
            {
              plan: {
                id: 7,
                title: 'Monthly API',
                enabled: true,
                duration_unit: 'month',
                duration_value: 1,
                total_amount: 5000000,
                quota_reset_period: 'monthly',
                price_amount: 10,
                max_purchase_per_user: 0,
              },
            },
          ],
        },
      }
    }
    if (url === '/api/subscription/self') {
      return {
        data: {
          success: true,
          data: {
            subscriptions: active ? [sub] : [],
            all_subscriptions: active ? [sub] : [],
          },
        },
      }
    }
    return { data: { success: true, data: { id: 1, quota: 10 } } }
  })
  const redeem = vi.spyOn(api, 'post').mockImplementation(async () => {
    active = true
    return {
      data: {
        success: true,
        data: 0,
        redemption: {
          type: 'subscription',
          plan_title: 'Monthly API',
          subscription_id: 30,
          end_time: 2000000000,
        },
      },
    }
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const flow = render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <SubscriptionCodeFlow />
      </I18nextProvider>
    </QueryClientProvider>
  )
  await screen.findByText('No Active')
  fireEvent.click(screen.getByRole('button', { name: 'Redeem' }))
  await screen.findByText(/Subscription activated: Monthly API\. Expires:/)
  await waitFor(() => expect(screen.getByText(/1 active/)).toBeVisible())
  expect(redeem).toHaveBeenCalledWith('/api/user/topup', {
    key: 'subscription-code',
  })
  expect(
    screen.queryByText(/Redemption successful! Added/)
  ).not.toBeInTheDocument()
  flow.unmount()
  client.clear()
  toast.dismiss()
})

function RedemptionOnly() {
  const { redeemCode } = useRedemption()
  return (
    <>
      <Button onClick={() => void redeemCode('subscription-code')}>
        Redeem
      </Button>
      <Toaster />
    </>
  )
}

it.each(['en', 'zh', 'zh-TW', 'fr', 'ru', 'ja', 'vi'])(
  'subscription success is translated into %s',
  async (language) => {
    toast.dismiss()
    await i18n.changeLanguage(language)
    const key = 'Subscription activated: {{plan}}. Expires: {{expires}}'
    expect(i18n.getResource(language, 'translation', key)).toBeDefined()
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: { id: 1 } },
    })
    vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        success: true,
        data: 0,
        redemption: {
          type: 'subscription',
          plan_title: 'Gift Plan',
          end_time: 2000000000,
        },
      },
    })
    const flow = render(
      <I18nextProvider i18n={i18n}>
        <RedemptionOnly />
      </I18nextProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Redeem' }))
    const message = await screen.findByText(/Gift Plan/)
    expect(message).not.toHaveTextContent('{{')
    if (language !== 'en') {
      expect(message).not.toHaveTextContent('Subscription activated:')
    }
    flow.unmount()
    toast.dismiss()
  }
)

it('shows the groups a plan and an active subscription pay for, and nothing for an unlimited plan', async () => {
  await i18n.changeLanguage('zh')
  const plan = (id: number, title: string, groups?: string[]) => ({
    plan: {
      id,
      title,
      enabled: true,
      duration_unit: 'month',
      duration_value: 1,
      total_amount: 5000000,
      quota_reset_period: 'never',
      price_amount: 10,
      max_purchase_per_user: 0,
      allowed_groups: groups,
    },
  })
  const sub = {
    subscription: {
      id: 31,
      user_id: 1,
      plan_id: 8,
      status: 'active',
      start_time: 1,
      end_time: 2000000000,
      amount_total: 5000000,
      amount_used: 0,
      allowed_groups: ['vip'],
    },
  }
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/subscription/plans') {
      return {
        data: {
          success: true,
          data: [plan(8, 'VIP Plan', ['vip', 'svip']), plan(9, 'Any Plan')],
        },
      }
    }
    if (url === '/api/subscription/self') {
      return {
        data: {
          success: true,
          data: { subscriptions: [sub], all_subscriptions: [sub] },
        },
      }
    }
    return { data: { success: true, data: { id: 1, quota: 10 } } }
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <SubscriptionPlansCard topupInfo={null} />
      </I18nextProvider>
    </QueryClientProvider>
  )

  expect(await screen.findByText('可用分组: vip, svip')).toBeVisible()
  expect(screen.getByText('可用分组: vip')).toBeVisible()
  expect(screen.getAllByText(/可用分组/)).toHaveLength(2)
  client.clear()
})
