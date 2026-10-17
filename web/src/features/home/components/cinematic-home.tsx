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
import { Link } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Braces,
  Layers,
  Route,
  Sparkles,
} from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { CopyButton } from '@/components/copy-button'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber, formatNumber } from '@/lib/format'

import '@/styles/home.css'
import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'

import { useCountUp, useOrbitSphere, usePointerShine } from '../hooks'
import { useWebglGlass } from '../hooks/use-webgl-glass'
import { ConnectionExample } from './connection-example'

export function CinematicHome(props: { isAuthenticated: boolean }) {
  const { t, i18n } = useTranslation()
  const { systemName } = useSystemConfig()
  const { status } = useStatus()
  const access = parseHeaderNavModulesFromStatus(status).pricing
  const canReadCatalog =
    !!status && access.enabled && (!access.requireAuth || props.isAuthenticated)
  const catalog = usePricingData(canReadCatalog)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const origin =
    (typeof status?.server_address === 'string' &&
      status.server_address.trim()) ||
    window.location.origin
  const baseUrl = `${origin.replace(/\/+$/, '')}/v1`
  const docsUrl =
    (typeof status?.docs_link === 'string' && status.docs_link) ||
    'https://docs.newapi.pro'
  const catalogReady = canReadCatalog && !catalog.isLoading && !catalog.error
  const modelCount = useCountUp(catalogReady ? catalog.models.length : null)
  const groupCount = useCountUp(
    catalogReady ? Object.keys(catalog.usableGroup).length : null
  )
  const glassRef = usePointerShine<HTMLDivElement>(
    'header nav, .home-glass, .home-metrics, .home-hero-actions [data-slot=button]'
  )
  useWebglGlass(glassRef)
  const orbitRef = useRef<HTMLCanvasElement>(null)
  useOrbitSphere(orbitRef)
  const count = (value: number | null) =>
    value === null ? '—' : formatNumber(value, locale)
  const features = [
    {
      icon: Layers,
      title: t('Multi-protocol Compatible'),
      text: t('One integration. More possibilities.'),
    },
    {
      icon: Braces,
      title: t('Transparent Billing'),
      text: t('Track usage, costs and performance with real-time analytics'),
    },
    {
      icon: Route,
      title: t('Load Balancing'),
      text: t('Support for high concurrency with automatic load balancing'),
    },
    {
      icon: Sparkles,
      title: t('Playground'),
      text: t('Write, experiment, and keep the conversation going.'),
    },
  ]

  return (
    <div ref={glassRef} className='cinematic-home'>
      <div className='home-backdrop' aria-hidden='true' />
      <PublicLayout showMainContainer={false}>
        <main>
          <section className='home-hero' aria-labelledby='home-title'>
            <canvas ref={orbitRef} className='home-orbit' aria-hidden='true' />
            <div className='home-hero-content'>
              <p className='home-eyebrow'>
                <span className='home-signal' />
                {t('OpenAI compatible')}
                <span aria-hidden='true'>/</span>
                {t('Unified API Gateway')}
              </p>
              <div className='home-title-stage'>
                <h1 id='home-title' className='home-title'>
                  {systemName || 'New API'}
                </h1>
              </div>
              <div className='home-hero-lede'>
                <p className='home-tagline'>
                  {t('One endpoint. Endless possibilities.')}
                </p>
                <p className='home-description'>
                  {t('One API key connects your ideas to leading AI models.')}
                </p>
                <div className='home-hero-actions'>
                  <Button
                    role='link'
                    size='lg'
                    className='home-primary'
                    render={
                      <Link
                        to={props.isAuthenticated ? '/dashboard' : '/sign-up'}
                      />
                    }
                  >
                    {props.isAuthenticated
                      ? t('Go to Dashboard')
                      : t('Get Started')}
                    <ArrowRight aria-hidden='true' />
                  </Button>
                  <Button
                    role='link'
                    size='lg'
                    variant='outline'
                    className='home-secondary'
                    render={<Link to='/pricing' />}
                  >
                    {t('Explore models')}
                    <Layers aria-hidden='true' />
                  </Button>
                </div>
              </div>
            </div>
            <a className='home-scroll' href='#connect'>
              <ArrowDown aria-hidden='true' className='size-4' />
              {t('Start building')}
            </a>
            <dl className='home-metrics'>
              <div>
                <dt>{t('Available models')}</dt>
                <dd>{count(modelCount)}</dd>
              </div>
              <div>
                <dt>{t('Available groups')}</dt>
                <dd>{count(groupCount)}</dd>
              </div>
              <div>
                <dt>{t('API protocol')}</dt>
                <dd>OpenAI</dd>
              </div>
              <div>
                <dt>{t('Streaming responses')}</dt>
                <dd>SSE</dd>
              </div>
            </dl>
          </section>

          <div className='home-body'>
            <section
              id='connect'
              className='home-section home-connect'
              aria-labelledby='connect-title'
            >
              <AnimateInView className='home-section-intro'>
                <span className='home-section-number'>01 / {t('Connect')}</span>
                <h2 id='connect-title'>
                  {t('A familiar API.')}
                  <br />
                  <span>{t('A wider world.')}</span>
                </h2>
                <p>
                  {t('Keep your SDK. Change the endpoint. Choose your model.')}
                </p>
                <div className='home-endpoint home-glass'>
                  <code>{baseUrl}</code>
                  <CopyButton
                    value={baseUrl}
                    aria-label={t('Copy API address')}
                  />
                </div>
                <Button
                  role='link'
                  variant='link'
                  className='px-0'
                  render={
                    docsUrl.startsWith('http') ? (
                      <a
                        href={docsUrl}
                        target='_blank'
                        rel='noopener noreferrer'
                      />
                    ) : (
                      <Link to={docsUrl} />
                    )
                  }
                >
                  <BookOpen aria-hidden='true' />
                  {t('Docs')}
                  <ArrowRight aria-hidden='true' />
                </Button>
              </AnimateInView>
              <AnimateInView delay={140} className='min-w-0'>
                <ConnectionExample baseUrl={baseUrl} />
              </AnimateInView>
            </section>

            {access.enabled && (
              <section
                className='home-section home-catalog'
                aria-labelledby='models-title'
              >
                <AnimateInView className='home-section-heading'>
                  <div>
                    <span className='home-section-number'>
                      02 / {t('Models')}
                    </span>
                    <h2 id='models-title'>{t('Find your next model.')}</h2>
                  </div>
                  <Button
                    role='link'
                    variant='outline'
                    render={<Link to='/pricing' />}
                  >
                    {t('View all models')}
                    <ArrowRight aria-hidden='true' />
                  </Button>
                </AnimateInView>
                {status && !canReadCatalog ? (
                  <EmptyState
                    title={t('Sign in required')}
                    action={
                      <Button
                        role='link'
                        render={
                          <Link
                            to='/sign-in'
                            search={{ redirect: '/pricing' }}
                          />
                        }
                      >
                        {t('Sign in')}
                      </Button>
                    }
                  />
                ) : null}
                {!status || catalog.isLoading ? (
                  <LoadingState message={t('Loading...')} />
                ) : null}
                {canReadCatalog && catalog.error ? (
                  <ErrorState
                    title={t('Failed to load models')}
                    onRetry={() => void catalog.refetch()}
                  />
                ) : null}
                {canReadCatalog &&
                !catalog.isLoading &&
                !catalog.error &&
                catalog.models.length === 0 ? (
                  <EmptyState title={t('No models available')} />
                ) : null}
                {canReadCatalog &&
                !catalog.isLoading &&
                !catalog.error &&
                catalog.models.length > 0 ? (
                  <div className='home-model-grid'>
                    {catalog.models.slice(0, 8).map((model, index) => (
                      <AnimateInView
                        key={model.model_name}
                        delay={index * 55}
                        className='min-w-0'
                      >
                        <Link
                          to='/pricing'
                          className='home-model home-glass h-full'
                        >
                          <div className='home-model-mark' aria-hidden='true'>
                            <Layers className='size-5' />
                          </div>
                          <div className='min-w-0 flex-1'>
                            <h3>{model.model_name}</h3>
                            <p>
                              {model.vendor_name || t('AI model')}
                              {model.context_length
                                ? ` · ${formatCompactNumber(model.context_length, locale)} ${t('Context')}`
                                : ''}
                            </p>
                          </div>
                          <ArrowRight
                            className='size-4 shrink-0 opacity-50'
                            aria-hidden='true'
                          />
                        </Link>
                      </AnimateInView>
                    ))}
                  </div>
                ) : null}
                <p className='home-catalog-note'>
                  {t(
                    'Model availability and pricing follow your selected group.'
                  )}
                </p>
              </section>
            )}

            <section
              className='home-section home-benefits'
              aria-labelledby='benefits-title'
            >
              <AnimateInView className='home-section-intro'>
                <span className='home-section-number'>
                  03 / {t('Core Features')}
                </span>
                <h2 id='benefits-title'>
                  {t('Less integration.')}
                  <br />
                  <span>{t('More creation.')}</span>
                </h2>
                <p>{t('The essentials, connected in one place.')}</p>
              </AnimateInView>
              <div className='home-feature-list'>
                {features.map((feature, index) => (
                  <AnimateInView
                    as='article'
                    key={feature.title}
                    delay={index * 80}
                  >
                    <span className='home-feature-index'>0{index + 1}</span>
                    <div>
                      <h3>
                        <feature.icon className='size-4' aria-hidden='true' />
                        {feature.title}
                      </h3>
                      <p>{feature.text}</p>
                    </div>
                  </AnimateInView>
                ))}
              </div>
            </section>

            <section
              className='home-section home-closing'
              aria-labelledby='start-title'
            >
              <AnimateInView>
                <span className='home-section-number'>
                  {t('Your next idea starts here.')}
                </span>
                <h2 id='start-title'>{t('Make something extraordinary.')}</h2>
                <div className='home-hero-actions'>
                  <Button
                    role='link'
                    size='lg'
                    className='home-primary'
                    render={
                      <Link
                        to={props.isAuthenticated ? '/playground' : '/sign-up'}
                      />
                    }
                  >
                    {props.isAuthenticated
                      ? t('Open Playground')
                      : t('Get Started')}
                    <ArrowRight aria-hidden='true' />
                  </Button>
                  <Button
                    role='link'
                    size='lg'
                    variant='outline'
                    className='home-secondary'
                    render={<Link to='/pricing' />}
                  >
                    {t('View Pricing')}
                  </Button>
                </div>
                <div className='home-apps'>
                  <a
                    href='https://cherry-ai.com'
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    Cherry Studio ↗
                  </a>
                  <a
                    href='https://ccswitch.io'
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    CC Switch ↗
                  </a>
                </div>
                <p className='home-apps-caption'>
                  {t(
                    'Supports one-click configuration and perfectly adapts to NewAPI multi-protocol configuration.'
                  )}
                </p>
              </AnimateInView>
            </section>
            <Footer />
          </div>
        </main>
      </PublicLayout>
    </div>
  )
}
