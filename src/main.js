import 'github-markdown-css'
import "@padcom/chat-ui/dist/index.css"
import "@padcom/chat-ui-formatter-marked"
import { createApp } from 'vue'
import App from './App.vue'
import focus from './directives/focus'

createApp(App)
  .directive('focus', focus)
  .mount('#app')
