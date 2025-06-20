<template>
  <pre style="display: none">{{ JSON.stringify(messages, null, 2) }}</pre>
  <Chat>
    <Messages v-slot="{ message }" :messages>
      <Message :message
        class="markdown-body"
        :class="{
          reasoning: message.reasoning,
          tool: message.tool_calls || message.role === 'tool'
        }"
      />
    </Messages>
    <Prompt
      :disabled="processing"
      placeholder="Press Enter to send, Escape to abort response, Ctrl+Delete to clear chat"
      @query="ask($event)"
      @keydown.esc="abort()"
      @keydown.ctrl.delete="!processing ? newChat() : {}"
    />
  </Chat>
</template>

<script lang="ts" setup>
import { ref, onMounted, shallowRef } from 'vue'
import { OpenAI } from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/index.mjs'
import type { Stream } from 'openai/core/streaming.mjs'

import { uuid, Chat, Messages, Message, Prompt, addMessage, type ChatMessage } from '@padcom/chat-ui'

interface ToolCall {
  id?: string
  type: 'function'
  function: { name: string, arguments: string }
}

interface Message extends ChatMessage {
  name?: string
  reasoning?: boolean
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

const messages = ref<Message[]>([])
const streamResponses = shallowRef<Stream<OpenAI.Responses.ResponseStreamEvent>>()
const streamChat = shallowRef<Stream<OpenAI.Chat.Completions.ChatCompletionChunk>>()
const processing = ref(false)
const type = ref<'responses' | 'chat'>('chat')

const api = new OpenAI({
  baseURL: import.meta.env.VITE_APP_OPENAI_BASE_URL,
  apiKey: import.meta.env.VITE_APP_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
})

const previousResponseId = ref('')

async function askResponses(question: string) {
  console.log('asking responses!')

  processing.value = true
  messages.value.push({ id: uuid(), role: 'user', content: question })

  try {
    streamResponses.value = await api.responses.create({
      model: import.meta.env.VITE_APP_MODEL,
      input: messages.value.at(-1)!.content!,
      tools: [{ type: 'web_search_preview' }],
      previous_response_id: previousResponseId.value,
      store: true,
      stream: true,
      reasoning: { effort: 'high' },
    })

    addMessage(messages, { id: uuid(), role: 'assistant', content: '' })
  } catch (e) {
    processing.value = false
    addMessage(messages, { id: uuid(), role: 'error', content: `${e}` })
    throw e
  }

  console.log(3)

  try {
    for await (const event of streamResponses.value!) {
      if (event.type === 'response.reasoning.delta') {
        messages.value.at(-1)!.reasoning = true
        messages.value.at(-1)!.content! += event.delta
      } else if (event.type === 'response.reasoning.done') {
        messages.value.push({ id: event.item_id, role: 'assistant', content: '' })
      } else if (event.type === 'response.output_text.delta') {
        messages.value.at(-1)!.content += event.delta
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
  messages.value.push({ id: uuid(), role: 'assistant', content: '' })

  function processTextMessage(choice: OpenAI.Chat.Completions.ChatCompletionChunk.Choice) {
    if (choice.delta.content === '<think>') {
      messages.value.at(-1)!.content += choice.delta.content
      messages.value.at(-1)!.reasoning = true
    } else if (choice.delta.content === '</think>' && messages.value.at(-1)!.reasoning) {
      messages.value.at(-1)!.content += choice.delta.content
      // messages.value.push({ role: 'assistant', content: '' })
    } else if (choice.delta.content) {
      messages.value.at(-1)!.content += choice.delta.content
    }
  }

  function processToolCallMessage(delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall) {
    if (!messages.value.at(-1)!.tool_calls) messages.value.at(-1)!.tool_calls = []

    if (messages.value.at(-1)!.tool_calls!.length < delta.index + 1) {
      messages.value.at(-1)!.tool_calls!.push({
        id: delta.id,
        type: 'function',
        function: { name: '', arguments: '' },
      })
    }

    const toolCall = messages.value.at(-1)!.tool_calls![delta.index]

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

    if (choice.finish_reason === 'tool_calls' && messages.value.at(-1)!.tool_calls) {
      // delete messages.value.at(-1)!.content
      messages.value.at(-1)!.tool_calls = messages.value.at(-1)!.tool_calls!.map(toolCall => ({
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

async function askChat(question: string) {
  console.log('asking chat!')

  messages.value.push({ id: uuid(), role: 'user', content: question })

  try {
    streamChat.value = await api.chat.completions.create({
      model: import.meta.env.VITE_APP_MODEL,
      messages: [...messages.value as ChatCompletionMessageParam[]].reverse(),
      stream: true,
      tools: [getFruitPrice],
    })
  } catch (e) {
    addMessage(messages, { id: uuid(), role: 'error', content: `${e}` })
    return
  }

  await processChatMessages()

  if (messages.value.at(-1)!.tool_calls) {
    for (const toolCall of messages.value.at(-1)!.tool_calls!) {
      console.log('Requested a call to', toolCall.type, JSON.stringify(toolCall[toolCall.type]))
      messages.value.push({ id: uuid(), role: 'tool', content: '$5', tool_call_id: toolCall.id })
    }

    streamChat.value = await api.chat.completions.create({
      model: import.meta.env.VITE_APP_MODEL,
      messages: [...messages.value as ChatCompletionMessageParam[]].reverse(),
      stream: true,
    })

    await processChatMessages()
  }
}

function ask(q: string) {
  switch (type.value) {
    case 'responses': return askResponses(q)
    case 'chat': return askChat(q)
  }
}

function abort() {
  streamResponses.value?.controller.abort()
  streamChat.value?.controller.abort()
}

function newChat() {
  abort()
  messages.value = [
    { id: uuid(), role: 'system', content: 'You are a helpful assistant. You come from [LM Studio](https://lmstudio.ai)' },
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
.chat {
  max-width: clamp(400px, 50%, 50%);
  margin-inline: auto;
  height: calc(100dvh - 2rem);
  padding-block: 1rem;
}

.message.tool {
  display: none;
}
</style>
