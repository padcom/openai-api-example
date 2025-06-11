import 'github-markdown-css'
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')

/*
import { OpenAI } from 'openai'

const api = new OpenAI({
  baseURL: 'http://localhost:1234/v1',
  apiKey: '1234',
  dangerouslyAllowBrowser: true,
})
const stream = await api.chat.completions.create({
  messages: [
    { role: 'system', content: 'You are a helpful assistant' }
  ],
  input: 'tell me a short story',
  stream: true,
})

for await (const event of stream) {
  console.log(event.choices[0].delta)
}
*/
