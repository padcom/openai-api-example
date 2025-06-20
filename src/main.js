import { createApp } from 'vue'
import App from './App.vue'
import focus from './directives/focus'

createApp(App)
  .directive('focus', focus)
  .mount('#app')
