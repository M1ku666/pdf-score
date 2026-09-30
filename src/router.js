import { createRouter, createWebHistory } from 'vue-router'
import PlayerView from './views/PlayerView.vue'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: PlayerView },
    { path: '/:id', name: 'score', component: PlayerView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
