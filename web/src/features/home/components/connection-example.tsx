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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CodeBlock } from '@/components/ai-elements/code-block'
import { CopyButton } from '@/components/copy-button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function ConnectionExample(props: { baseUrl: string }) {
  const { t } = useTranslation()
  const [language, setLanguage] = useState('curl')
  const url = JSON.stringify(props.baseUrl)
  const examples = [
    {
      id: 'curl',
      label: 'cURL',
      language: 'bash',
      code: `curl ${JSON.stringify(`${props.baseUrl}/chat/completions`)} \\\n  -H "Authorization: Bearer $API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{
    "model": "YOUR_MODEL",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'`,
    },
    {
      id: 'python',
      label: 'Python',
      language: 'python',
      code: `import os
from openai import OpenAI

client = OpenAI(base_url=${url}, api_key=os.environ["API_KEY"])
stream = client.chat.completions.create(
    model="YOUR_MODEL",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True,
)
for chunk in stream:
    if chunk.choices:
        print(chunk.choices[0].delta.content or "", end="")`,
    },
    {
      id: 'node',
      label: 'Node.js',
      language: 'javascript',
      code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: ${url}, apiKey: process.env.API_KEY,
});
const stream = await client.chat.completions.create({
  model: "YOUR_MODEL",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}`,
    },
  ]
  const selected =
    examples.find((example) => example.id === language) ?? examples[0]

  return (
    <div className='home-glass home-example'>
      <Tabs
        value={language}
        onValueChange={(value) => setLanguage(String(value))}
      >
        <div className='border-border/60 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3'>
          <TabsList aria-label={t('Code examples')}>
            {examples.map((example) => (
              <TabsTrigger key={example.id} value={example.id}>
                {example.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <CopyButton value={selected.code} aria-label={t('Copy code')} />
        </div>
        {examples.map((example) => (
          <TabsContent
            key={example.id}
            value={example.id}
            className='min-w-0 px-2 pb-2'
          >
            <CodeBlock
              code={example.code}
              language={example.language}
              enableCollapse={false}
              className='m-0 border-0 bg-transparent shadow-none'
            />
          </TabsContent>
        ))}
      </Tabs>
      <div className='home-example-note'>
        {t('Replace YOUR_MODEL with a model from the catalog.')}
      </div>
    </div>
  )
}
