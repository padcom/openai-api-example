import type { Directive } from "vue";

export default {
  mounted(el) {
    if (el && el.focus) el.focus()
  },
  updated(el) {
    if (el && el.focus) el.focus()
  },
} as Directive
