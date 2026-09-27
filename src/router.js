import { createRouter, createWebHistory } from 'vue-router'
import PlayerView from './views/PlayerView.vue'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    // 只有一个页面：打开具体乐谱用 /score/:id，没打开文件就是 /
    { path: '/', name: 'home', component: PlayerView },
    { path: '/score/:id', name: 'score', component: PlayerView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
