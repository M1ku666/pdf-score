import { createRouter, createWebHistory } from 'vue-router'
import PlayerView from './views/PlayerView.vue'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    // 只有一个页面：打开具体乐谱用 /:id（**地址栏里不带 `/score` 前缀**），没打开文件就是 /
    { path: '/', name: 'home', component: PlayerView },
    // 打开具体乐谱：**单段路径全捕获** —— 先把这一段当成乐谱 id 试一次，打不到由
    // `views/PlayerView.vue` 的 `load()` 把地址退回 `/`（并弹一条「找不到这份乐谱」）。
    // 参数默认匹配 `[^/]+?`，所以**带点的单段（`/favicon.svg`）也算 id**；能这么走到的只有
    // 应用内导航，真正请求那些静态文件的是服务器（`public/` 原样照发），够不到客户端路由。
    { path: '/:id', name: 'score', component: PlayerView },
    // 兜底：多段路径（`/score/xxx`、`/foo/bar`）一律回首页
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
