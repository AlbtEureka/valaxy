<script setup lang="ts">
import { onMounted } from 'vue'
import { isStaticMode } from './utils'

onMounted(() => {
  if (isStaticMode)
    document.title = 'Vite Inspect (Production)'
})
</script>

<template>
  <main grid="~ rows-[min-content_1fr]" size="h-screen w-screen" text="gray-700 dark:gray-200">
    <Suspense>
      <RouterView />
      <template #fallback>
        Loading...
      </template>
    </Suspense>
  </main>
</template>
