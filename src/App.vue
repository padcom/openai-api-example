<template>
  <!-- <pre>{{ JSON.stringify(messages, null, 2) }}</pre> -->
  <div class="messages-container">
    <div v-for="message in messages" :key="message.id" class="markdown-body message" :class="{ [message.role]: true }"
      v-html="marked(message.content, { renderer })"
    />
  </div>
  <div class="prompt">
    <input type="text" v-focus v-model="question" :readonly="processing"
      placeholder="Press Enter to send, Escape to abort response, Ctrl+Delete to clear chat"
      @keydown.enter="ask()"
      @keydown.esc="abort()"
      @keydown.ctrl.delete="!processing ? newChat() : {}"
    >
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, shallowRef, computed } from 'vue'
import { OpenAI } from 'openai'
import type { ChatCompletionMessage, ChatCompletionMessageParam } from 'openai/resources/index.mjs'
import { marked } from 'marked'
import type { Stream } from 'openai/core/streaming.mjs'
import type { ResponseIncompleteEvent, ResponseInputItem } from 'openai/resources/responses/responses.mjs'

const renderer = new marked.Renderer()
renderer.link = function({ href, title, text }) {
  return `<a target="_blank" href="${href}" title="${title}">${text}</a>`;
}

interface Message {
  id?: string
  name?: string
  role: string
  content: string
  reasoning?: boolean
}

const messages = ref<Message[]>([])
const question = ref('what is the highest mountain?')
const streamResponses = shallowRef<Stream<OpenAI.Responses.ResponseStreamEvent>>()
const streamChat = shallowRef<Stream<OpenAI.Chat.Completions.ChatCompletionChunk>>()
const processing = computed(() => Boolean(streamResponses.value) || Boolean(streamChat.value))
const type = ref<'responses' | 'chat'>('chat')

const api = new OpenAI({
  baseURL: import.meta.env.VITE_APP_OPENAI_BASE_URL,
  apiKey: import.meta.env.VITE_APP_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
})

const previousResponseId = ref('')

async function askResponses() {
  console.log('asking responses!')

  if (!question.value) return

  messages.value.unshift({ role: 'user', content: question.value })
  question.value = ''

  streamResponses.value = await api.responses.create({
    model: import.meta.env.VITE_APP_MODEL,
    input: messages.value[0].content,
    tools: [{ type: 'web_search_preview' }],
    previous_response_id: previousResponseId.value,
    store: true,
    stream: true,
    reasoning: { effort: 'high' },
  })

  messages.value.unshift({ role: 'assistant', content: '' })

  try {
    for await (const event of streamResponses.value) {
      if (event.type === 'response.reasoning.delta') {
        messages.value[0].reasoning = true
        messages.value[0].content += event.delta
      } else if (event.type === 'response.reasoning.done') {
        messages.value.unshift({ role: 'assistant', content: '' })
      } else if (event.type === 'response.output_text.delta') {
        messages.value[0].content += event.delta
      } else if (event.type === 'response.created') {
        previousResponseId.value = event.response.id
      } else {
        console.log(event.type, event)
      }
    }
  } finally {
    streamResponses.value = undefined
  }
}

async function askChat() {
  console.log('asking chat!')

  if (!question.value) return

  messages.value.unshift({ role: 'user', content: question.value })
  question.value = ''

  streamChat.value = await api.chat.completions.create({
    model: import.meta.env.VITE_APP_MODEL,
    messages: [...messages.value as ChatCompletionMessageParam[]].reverse(),
    stream: true,
  })

  messages.value.unshift({ role: 'assistant', content: '' })

  try {
    for await (const event of streamChat.value) {
      messages.value[0].content += event.choices[0].delta.content
    }
  } finally {
    streamChat.value = undefined
  }
}

function ask() {
  switch (type.value) {
    case 'responses': return askResponses()
    case 'chat': return askChat()
  }
}

function abort() {
  streamResponses.value?.controller.abort()
  streamChat.value?.controller.abort()
}

function newChat() {
  abort()
  messages.value = [
    { role: 'system', content: 'You are a helpful assistant. You come from [LM Studio](https://lmstudio.ai)' },
  ]

  previousResponseId.value = ''
}

onMounted(newChat)
</script>

<style lang="postcss">
html, body {
  width: 100dvw;
  height: 100dvh;
  margin: 0;
  padding: 0;
}
#app {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  height: 100%;
}
</style>

<style lang="postcss" scoped>
.messages-container {
  display: flex;
  flex-direction: column-reverse;
  gap: 0.5rem;
  width: 50%;
  margin-inline: auto;
  margin-top: 1rem;
  overflow: auto;
  flex-grow: 1;
}

.prompt {
  display: flex;
  width: 50%;
  margin-inline: auto;
  margin-bottom: 1rem;

  & input {
    flex-grow: 1;
    padding: 0.5rem;
    border-radius: 8px;
  }
}

.message {
  max-width: 80%;
  border-radius: 0.5rem;
  padding: 8px 16px;
}

.message.system {
  background-color: rgb(250, 237, 241);
  align-self: center;
  text-align: center;
}
.message.user {
  background-color: aliceblue;
  align-self: self-end;
  text-align: right;
  border-bottom-left-radius: 0;
}
.message.assistant {
  background-color: beige;
  align-self: self-start;
  border-bottom-right-radius: 0;
}
</style>
