# 构建与部署 · PDF Score

---

## 1. 构建：必须走 npm 脚本

- `predev` / `prebuild` 会先把 pdf.js 的 cmap、标准字体与 wasm 资源从 `node_modules` 复制到 `public/pdfjs/`。**请用 `npm run dev` / `npm run build`，不要直接调 `vite build`**，否则这些资源不会被复制，PDF 兼容性下降。
- `public/pdfjs/` 在 `.gitignore` 里，按需加载、不影响首屏体积。
- `npm run preview` 预览 `dist/`，默认 `:4173`；生产冒烟（`npm run test:dist`）要求它正在运行。
- 构建目标 `es2022`，pdf.js 在 dev 下预打包（`optimizeDeps.include`）。
- `vite.config.js` 里还有一个 `watchLocales` 插件：开发时改 `src/i18n/*.yaml` 会自动重新编译语言包并整页刷新。

## 2. 手机 / 局域网访问

`npm run dev`（以及 `preview`）监听局域网，启动后终端会打印两行地址：

```
➜  Local:   http://localhost:5173/
➜  Network: http://192.168.x.x:5173/     ← 手机用这个
```

- 手机在同一 Wi-Fi 下打开 Network 那一行即可；`npm run lan-url` 可以随时重新打印这个地址。
- 首次启动 Windows 可能弹防火墙询问，需要允许「专用 / 公用网络」入站。
- 地址是 DHCP 分配的内网 IP，换网络或重启路由器后可能变化。
- 少数公共 Wi-Fi 开了「AP 隔离」，设备之间不能互访；改用手机热点、USB 共享网络，或 `npx localtunnel --port 5173` 之类的方式。
- 手机通过 `http://内网IP` 访问属于**非安全上下文**：IndexedDB、Web Audio、pdf.js 都正常工作；只有「申请持久化存储」不可用（代码里已容错，不影响使用）。

### 2.1 端口已占用时：先用已有的，别另起一个

`npm run dev` / `npm run preview` 发现 `:5173` / `:4173` 被占用（`Port 5173 is in use, trying another one...`），**默认行为是自动换到 5174 / 4174 再起一个新进程**。这个默认行为要**主动避开**：

- **先判断占用者是不是本项目的同一个服务器**（很可能就是你自己或上一次会话留下的 dev / preview）。是的话 —— **直接用那个端口，不要再起一个**。
- 只有确认占用者是**别的东西**（或那个进程已经卡死、必须重启）时，才新起一个进程。

为什么这条要写下来：

- **同时跑两个 dev server 有两个真相**：手机 / 浏览器可能连在旧的 5173 上，你在新的 5174 上改代码、刷新却看不到变化，误判成「HMR 坏了」「改动没生效」。
- `test:dist` 与 `lan-url` 及文档里的地址全是**固定端口**（`:4173`、`:5173`）；换了端口之后它们会打到旧的、没跑着你刚构建产物的那个服务上，冒烟测试因此**假通过或假失败**。
- 端口一变，手机之前存的书签 / 打印出来的 Network 地址也会失效。

实操：先看端口归属，再决定复用还是重启。

```powershell
# 谁占着 5173 / 4173（最后一列是 PID）
netstat -ano | findstr ":5173 :4173"

# 看看那个 PID 是不是 node（vite）
Get-Process -Id <PID> | Select-Object Id, ProcessName, Path
```

- 是本项目 node/vite → **什么都不用做**，直接访问 `http://localhost:5173/`（或 `npm run lan-url` 重新打印局域网地址）。
- 想换成自己新起的进程 → **先停掉旧的**，再 `npm run dev`，别让两个同时活着：

```powershell
Stop-Process -Id <PID>          # 单个进程
# 或者按端口一把清掉（谨慎：会影响所有占用该端口的进程）
Get-NetTCPConnection -LocalPort 4173 -State Listen |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ }
```

- 确实需要在**另一个端口**上并存（例如一边 dev 跑 5173、一边想 preview 到别的端口）：必须**显式指定端口**并让下游一起改，别依赖 Vite 的自动 +1：
  `npm run preview -- --port 4174`，随后 `test:dist` 也要指过去（默认写死 `http://127.0.0.1:4173/`，见 `project.md` §3）。
- **AI agent 尤其注意**：起长驻服务前先检查端口，**不要因为「命令没报错」就以为起成功了** —— 自动换端口不会失败，只会让文档和测试里的地址对不上。若端口已有一个健康的同项目服务，**复用即可**，不要新起。

## 3. 部署到 Netlify（从 GitHub 导入）

仓库里已带 `netlify.toml` 与 `public/_redirects`，**构建配置什么都不用改**：build command `npm run build`（会先跑 prebuild 复制 pdf.js 资源）、publish `dist`，SPA 回退把 `/*` 指到 `/index.html`（`/score/xxx` 直接刷新也能打开），另外给 `/assets/*` 加了长缓存头。步骤：

1. 把项目推到 GitHub（`node_modules/`、`dist/`、`public/pdfjs/` 已在 `.gitignore` 中，不会进仓库）。
2. Netlify → **Add new site → Import an existing project → GitHub** → 选择该仓库。
3. 构建配置保持默认（Netlify 会读 `netlify.toml`；手动填就是 Build command `npm run build`、Publish directory `dist`）。
4. Deploy。之后每次 push 到发布分支都会自动重新部署，PR 会生成预览链接。

### 3.1 发布分支就是 `main`

Netlify 只把**发布分支**上的推送发到正式网址。本仓库的发布分支是 `main`。改发布分支在 Netlify 后台（**Project configuration → Developer settings → Continuous deployment → Branches and deploy contexts**），不在仓库里。

### 3.2 默认自动发布，可用「锁定部署」改成手动

只有 `main` 的推送会自动上线。要让推送**照常构建但不自动上线**，用 Netlify 的**锁定部署（Locked Deploys）**——在 **Deploys** 页点 **Lock to stop auto publishing**。

锁定后的行为：

- 推送到发布分支**仍会构建**，构建好的版本留在 Deploys 列表里，不上线。
- 上线要手动：在某次部署的详情页点 **Publish deploy**。
- 恢复自动发布：Deploys 页点 **Unlock to start auto publishing**。
- **解锁不会补发**：解锁前已构建好的版本不会自动上线，仍要手动挑一次 **Publish deploy**。

锁定前先确认线上已是你满意的版本 —— 锁的是「当前已发布的那个版本」。

### 3.3 跳过某一次构建

commit 信息里含 `[skip ci]` 或 `[skip netlify]`，该次推送**完全不触发构建**（一次推送里多个 commit 时，写在最新的那个上即可）。适合纯改文档这类不需要构建的提交。

> 数据只存在浏览器本地（IndexedDB）。换设备或清理浏览器数据前，请先在乐谱库里**导出 pmz / zip 备份**。首次使用时浏览器会申请持久化存储权限，尽量避免被自动清理。
