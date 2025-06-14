<template>
  <pre style="display: none">{{ JSON.stringify(messages, null, 2) }}</pre>
  <div class="messages-container">
    <div v-for="message in messages" :key="message.id"
      class="markdown-body message"
      :class="{
        [message.role]: true,
        reasoning: message.reasoning,
        tool: message.tool_calls || message.role === 'tool'
      }"
      v-html="marked(message.content || '', { renderer })"
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
import type { ChatCompletionMessage, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/index.mjs'
import { marked } from 'marked'
import type { Stream } from 'openai/core/streaming.mjs'
import type { ResponseIncompleteEvent, ResponseInputItem } from 'openai/resources/responses/responses.mjs'

const renderer = new marked.Renderer()
renderer.link = function({ href, title, text }) {
  return `<a target="_blank" href="${href}" title="${title}">${text}</a>`;
}

interface ToolCall {
  id?: string
  type: 'function'
  function: { name: string, arguments: string }
}

interface Message {
  id?: string
  name?: string
  role: string
  content?: string
  reasoning?: boolean
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

const messages = ref<Message[]>([])
// const question = ref('what is the highest mountain?')
const question = ref('what is the price of an apple?')
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
    input: messages.value[0].content!,
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
        messages.value[0].content! += event.delta
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

    return streamResponses.value
  } finally {
    streamResponses.value = undefined
  }
}

const getFruitPrice: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'getFruitPrice',
    description: 'Retrieves price of a fruit specified by name',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
      // additionalProperties: false,
    },
  },
}

async function processChatMessages() {
  messages.value.unshift({ role: 'assistant', content: '' })

  function processTextMessage(choice: OpenAI.Chat.Completions.ChatCompletionChunk.Choice) {
    if (choice.delta.content === '<think>') {
      messages.value[0].content += choice.delta.content
      messages.value[0].reasoning = true
    } else if (choice.delta.content === '</think>' && messages.value[0].reasoning) {
      messages.value[0].content += choice.delta.content
      // messages.value.unshift({ role: 'assistant', content: '' })
    } else if (choice.delta.content) {
      messages.value[0].content += choice.delta.content
    }
  }

  function processToolCallMessage(delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall) {
    if (!messages.value[0].tool_calls) messages.value[0].tool_calls = []

    if (messages.value[0].tool_calls.length < delta.index + 1) {
      messages.value[0].tool_calls.push({
        id: delta.id,
        type: 'function',
        function: { name: '', arguments: '' },
      })
    }

    const toolCall = messages.value[0].tool_calls[delta.index]

    try {
      if (delta.function?.name) toolCall.function.name += delta.function.name
      if (delta.function?.arguments) toolCall.function.arguments += delta.function.arguments
    } catch (e) {
      console.error(e)
      debugger
    }
  }

  function processToolCallsMessage(choice: OpenAI.Chat.Completions.ChatCompletionChunk.Choice) {
    for (const tool_call of choice.delta.tool_calls || []) {
      processToolCallMessage(tool_call)
    }

    if (choice.finish_reason === 'tool_calls' && messages.value[0].tool_calls) {
      // delete messages.value[0].content
      messages.value[0].tool_calls = messages.value[0].tool_calls.map(toolCall => ({
        ...toolCall,
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments
        },
      }))
    }
  }

  try {
    for await (const event of streamChat.value!) {
      for (const choice of event.choices) {
        processTextMessage(choice)
        processToolCallsMessage(choice)
      }
    }
  } finally {
    streamChat.value = undefined
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
    tools: [getFruitPrice],
  })

  await processChatMessages()

  if (messages.value[0].tool_calls) {
    for (const toolCall of messages.value[0].tool_calls) {
      console.log('Requested a call to', toolCall.type, JSON.stringify(toolCall[toolCall.type]))
      messages.value.unshift({ role: 'tool', content: '$5', tool_call_id: toolCall.id })
    }

    streamChat.value = await api.chat.completions.create({
      model: import.meta.env.VITE_APP_MODEL,
      messages: [...messages.value as ChatCompletionMessageParam[]].reverse(),
      stream: true,
    })

    await processChatMessages()
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

  &.reasoning {
    background-color: lightgrey;
  }
}
.message.tool {
  display: none;
}
</style>
