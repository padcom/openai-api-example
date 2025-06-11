<template>
  <div class="messages-container">
    <div v-for="message in messages" :key="message.id" class="markdown-body message" :class="{ [message.role]: true }"
      v-html="marked(message.content, { renderer })"
    />
  </div>
  <div class="prompt">
    <input type="text" v-model="question"
      @keydown.enter="ask()"
      @keydown.esc="abort()"
      @keydown.ctrl.delete="newChat()"
    >
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted } from 'vue'
import { OpenAI } from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/index.mjs'
import { marked } from 'marked'

const renderer = new marked.Renderer()
renderer.link = function({ href, title, text }) {
  return `<a target="_blank" href="${href}" title="${title}">${text}</a>`;
}

interface Message {
  id?: string
  name?: string
  role: string
  content: string
}

const messages = ref<Message[]>([])
const question = ref('what is the highest mountain?')

const api = new OpenAI({
  baseURL: import.meta.env.VITE_APP_OPENAI_BASE_URL,
  apiKey: import.meta.env.VITE_APP_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
})

let abortController = new AbortController()

async function ask() {
  messages.value.unshift({ role: 'user', content: question.value })
  question.value = ''

  const stream = await api.chat.completions.create({
    model: '',
    messages: messages.value as Array<ChatCompletionMessageParam>,
    stream: true,
  })

  abortController = stream.controller

  messages.value.unshift({ role: 'assistant', content: '' })

  for await (const event of stream) {
    // @ts-ignore xxx
    if (!messages.value[0].role) messages.value[0].role = event.choices[0].delta.role
    if (event.choices[0].delta.content) messages.value[0].content += event.choices[0].delta.content
  }
}

function abort() {
  abortController?.abort()
}

function newChat() {
  messages.value = [
    { role: 'system', content: 'You are a helpful assistant. I come from [LM Studio](https://lmstudio.ai)' },
  ]
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
