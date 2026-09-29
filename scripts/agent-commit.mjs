/**
 * 受控提交：按**显式文件清单**提交，先预览、再凭指纹提交。约定与流程见 `docs/git.md`。
 *
 * 为什么不用 `git add -A` + `git commit`：
 *   - `git commit`（不带路径）提交的是**共享的 index**，谁先跑谁就把别人已暂存的改动一起收走；
 *   - 多个 agent 并行时，`git status` 里的改动不都属于当前会话。
 * 所以固定走 `git add -- <路径>` + `git commit --only -- <路径>`：只动列出的路径，
 * 别人已暂存的内容原样留在 index 里（已实测）。
 *
 * 两个模式，必须显式二选一：
 *   --preview  打印清单 / 改动量 / message / 不在范围内的改动 / 指纹，**不写任何东西**
 *   --write    必须带 `--expect <预览打印的指纹>`，指纹对不上就拒绝（预览到确认之间文件被动过）
 *
 * 已知限制（实测）：
 *   - `git commit --only -- <未跟踪文件>` 会报 `pathspec ... did not match`，所以未跟踪文件
 *     必须先 `git add`；这是本脚本唯一需要碰真实 index 的一步。
 *   - 本沙箱下 node 无法用管道捕获子进程输出（EPERM），因此 git 的输出经 `artifacts/` 下的
 *     临时文件转一道，再用 fs 读回来。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** 允许的 type；改了这里要同步改 `docs/git.md` 的表 */
const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'chore', 'revert']

/** 只有这些词做描述等于没写（精确匹配，`fix: 修复导出按钮` 不受影响） */
const VAGUE = [
  '更新', '修改', '调整', '改动', '优化', '完善', '杂项', '其他', '一些改动',
  'update', 'updates', 'fix', 'fixes', 'changes', 'misc', 'wip', 'stuff',
]

const SUBJECT_MAX = 72
const HR = '─'.repeat(60)

/* ---------- 参数 ---------- */

const argv = process.argv.slice(2)
let mode = null
let message = null
let expect = null
let diffLines = 0
let showExcluded = false
const rawPaths = []

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--') {
    rawPaths.push(...argv.slice(i + 1))
    break
  }
  if (a === '--preview') mode = 'preview'
  else if (a === '--write') mode = 'write'
  else if (a === '-m' || a === '--message') message = argv[++i]
  else if (a.startsWith('--message=')) message = a.slice('--message='.length)
  else if (a === '--expect') expect = argv[++i]
  else if (a === '--diff-lines') diffLines = Number(argv[++i])
  else if (a === '--show-excluded') showExcluded = true
  else if (a === '-h' || a === '--help') { usage(); process.exit(0) }
  else if (a.startsWith('-')) die(`未知参数：${a}`)
  else rawPaths.push(a)
}

function usage() {
  console.log(`用法：
  用户直接给了 message（不用再确认，直接提交）：
    node scripts/agent-commit.mjs --write --message "<type>: <中文简述>" -- <文件…>
  用户只说了 commit（先 --preview 给他看，确认后再提交）：
    node scripts/agent-commit.mjs --preview --message "<type>: <中文简述>" -- <文件…>
    node scripts/agent-commit.mjs --write   --message "<type>: <中文简述>" --expect <预览打印的指纹> -- <文件…>

可选：
  --expect <指纹>        只在「用户确认过预览」时给：指纹对不上就拒绝提交
  --show-excluded        把「不属于本次会话的改动」逐条列出来（默认只报个数）
  --diff-lines <n>       预览里 diff 的行数上限（默认 0 = 不打印）

message 只写一行（不写正文）。`)
}

if (!mode) die('必须显式指定 --preview 或 --write（不提供默认值，避免误提交 / 空跑）')
if (typeof message !== 'string' || !message.trim()) die('缺少 --message')
if (!rawPaths.length) die('没有指定文件：路径写在 `--` 之后（只接受具体文件，不接受目录）')

/* ---------- 校验并规范化 message ---------- */

message = message.replace(/\r\n/g, '\n').replace(/\n+$/, '')
if (message.includes('\n')) die('message 只写一行（不写正文）：细节压进那一行简述里')
const subject = message

if (/^[a-z]+\([^)]*\)\s*:/.test(subject)) die('本仓库的 message 不写 scope：写成 `type: 中文简述`，不要 `type(scope): …`')

const m = /^([a-z]+): (.+)$/.exec(subject)
if (!m) die(`message 首行必须是 \`type: 中文简述\`，现在拿到的是：${subject}`)
if (!TYPES.includes(m[1])) die(`未知 type \`${m[1]}\`；可用：${TYPES.join(' / ')}`)
if (/[.。]\s*$/.test(m[2])) die('简述结尾不要加句号')
if (VAGUE.includes(m[2].trim().toLowerCase())) die(`简述「${m[2].trim()}」没有信息量：说清改了什么、影响哪一块`)
if ([...subject].length > SUBJECT_MAX) die(`简述 ${[...subject].length} 字，超过 ${SUBJECT_MAX} 字上限：只有一行，写不下的就删掉`)

/* ---------- git 调用 ---------- */

let TOP = process.cwd()
const CAP_DIR = join(TOP, 'artifacts')
mkdirSync(CAP_DIR, { recursive: true })
const CAP_OUT = join(CAP_DIR, `.commit-${process.pid}-${Date.now()}.out`)
const CAP_ERR = `${CAP_OUT}.err`

function gitRaw(args) {
  const outFd = openSync(CAP_OUT, 'w')
  const errFd = openSync(CAP_ERR, 'w')
  const r = spawnSync('git', args, { cwd: TOP, stdio: ['ignore', outFd, errFd] })
  closeSync(outFd)
  closeSync(errFd)
  return { code: r.status, out: readFileSync(CAP_OUT, 'utf8'), err: readFileSync(CAP_ERR, 'utf8') }
}

function git(args, { allowFail = false } = {}) {
  const r = gitRaw(args)
  if (r.code !== 0 && !allowFail) die(`git ${args.join(' ')} 失败：\n${(r.err || r.out).trim()}`)
  return r
}

TOP = git(['rev-parse', '--show-toplevel']).out.trim() || TOP
if (!statSync(TOP, { throwIfNoEntry: false })) die('不在 git 仓库里')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** `.git/index.lock` 这类竞争由别的 agent 引起：等一下重试；重试完仍失败就报错，别并发硬闯 */
async function gitRace(args) {
  const LOCKED = /index\.lock|Unable to create|Another git process|cannot lock ref|unable to lock/i
  for (let i = 0; ; i++) {
    const r = gitRaw(args)
    if (r.code === 0) return r
    if (i < 5 && LOCKED.test(r.err + r.out)) { await sleep(200 * (i + 1)); continue }
    die(`git ${args.join(' ')} 失败：\n${(r.err || r.out).trim()}`)
  }
}

/* ---------- 路径归一化 ---------- */

const paths = []
for (const raw of rawPaths) {
  const abs = resolve(process.cwd(), raw)
  const rel = relative(TOP, abs)
  if (!rel || rel.startsWith('..') || resolve(TOP, rel) !== abs) die(`路径不在仓库里：${raw}`)
  const st = statSync(abs, { throwIfNoEntry: false })
  if (st && st.isDirectory()) die(`只接受具体文件，不接受目录：${raw}（目录会把别人改过的文件一起卷进来）`)
  const p = rel.split(sep).join('/')
  if (!paths.includes(p)) paths.push(p)
}
paths.sort()

/* ---------- 计划（状态 + 指纹） ---------- */

function parsePorcelainZ(text) {
  const parts = text.split('\0').filter((s) => s.length > 0)
  const out = []
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2)
    const path = parts[i].slice(3)
    // 重命名 / 复制：旧路径是紧跟着的另一个 token（`R  new\0old\0`）
    const orig = code[0] === 'R' || code[0] === 'C' ? parts[++i] ?? null : null
    out.push({ code, path, orig })
  }
  return out
}

/** 显示用单字母：新增 A / 删除 D / 修改 M / 重命名 R */
function letter(code) {
  if (code[0] === 'R' || code[0] === 'C') return 'R'
  if (code === '??' || code.includes('A')) return 'A'
  if (code.includes('D')) return 'D'
  return 'M'
}

function countLines(bytes) {
  const t = bytes.toString('utf8')
  return t.length ? t.replace(/\n$/, '').split('\n').length : 0
}

/** 全仓库状态查一次（带重命名配对），再按路径查表 —— 逐路径查看不见重命名的另一半 */
const all = parsePorcelainZ(git(['status', '--porcelain=v1', '-z']).out)
const byPath = new Map()
for (const r of all) {
  byPath.set(r.path, r)
  if (r.orig) byPath.set(r.orig, r) // 重命名的旧路径也指向同一条记录
}

const fingerprint = createHash('sha256')
const files = []
for (const p of paths) {
  const rec = byPath.get(p)
  if (!rec) {
    if (git(['check-ignore', '-q', '--', p], { allowFail: true }).code === 0) die(`路径被 .gitignore 忽略，不要提交：${p}`)
    die(`路径没有未提交的改动（可能已经被提交、被回退，或本来就干净）：${p}`)
  }
  if (rec.orig) {
    // 重命名必须两个路径一起提交：只列一侧会留下半个重命名（旧路径的删除悬在工作区）
    const partner = p === rec.path ? rec.orig : rec.path
    if (!paths.includes(partner)) {
      die(`路径是重命名的一半：${p}\n它和 ${partner} 属于同一次重命名，两个路径都要列上，否则只提交出去一半`)
    }
  }
  const abs = join(TOP, p)
  const bytes = existsSync(abs) ? readFileSync(abs) : null
  fingerprint.update(rec.code).update('\0').update(p).update('\0')
  fingerprint.update(bytes ? createHash('sha256').update(bytes).digest('hex') : 'DELETED').update('\n')

  let added = 0
  let removed = 0
  if (bytes && rec.code === '??') {
    added = countLines(bytes)
  } else {
    const [a, d] = (git(['diff', '--numstat', 'HEAD', '--', p]).out.trim().split('\n')[0] ?? '').split('\t')
    added = Number(a) || 0
    removed = Number(d) || 0
  }
  files.push({ path: p, code: rec.code, letter: letter(rec.code), added, removed })
}
const print = fingerprint.digest('hex')

/** 工作区里仍有改动、但**不在**本次提交范围的（多 agent 并行时通常是别人的） */
const others = all.filter((r) => !paths.includes(r.path))

/** 疑似「重命名只列了一半」：提交里有新文件，范围外又躺着删除（git status 不会把未暂存的重命名配成对） */
const halfRename = files.filter((f) => f.code === '??').length > 0 && others.filter((o) => o.code[1] === 'D').length > 0

/* ---------- 输出 ---------- */

function printPreview(note) {
  console.log(`${HR}\n提交预览${note ? `（${note}）` : ''}\n${HR}`)
  console.log(`\n本次提交 ${files.length} 个文件：`)
  for (const f of files) {
    const stat = f.code === '??' ? `+${f.added}（新文件）` : `+${f.added} −${f.removed}`
    console.log(`  ${f.letter}  ${f.path}   ${stat}`)
  }
  console.log('\ncommit message：')
  console.log(`  ${message}`)
  if (others.length) {
    if (showExcluded) {
      console.log(`\n不在本次提交范围（工作区里仍有改动，**不会**提交）：`)
      for (const o of others) console.log(`  ${o.code}  ${o.orig ? `${o.orig} → ${o.path}` : o.path}`)
    } else {
      console.log(`\n不在本次提交范围：另有 ${others.length} 处改动不属于本次会话，未包含（要看加 --show-excluded）`)
    }
  } else {
    console.log('\n不在本次提交范围：无（工作区其余部分是干净的）')
  }
  if (halfRename) {
    console.log('\n⚠ 本次有新增文件，范围外又有删除的文件 —— 确认一下这是不是「重命名只列了一半」：')
    console.log('  重命名要把旧路径和新路径一起列上。')
  }
  if (diffLines > 0) {
    const diff = git(['diff', 'HEAD', '--', ...paths]).out.replace(/\n+$/, '')
    if (diff) {
      const dl = diff.split('\n')
      console.log(`\ndiff（共 ${dl.length} 行${dl.length > diffLines ? `，只显示前 ${diffLines} 行` : ''}）：`)
      console.log(dl.slice(0, diffLines).join('\n'))
      if (dl.length > diffLines) console.log(`  …（还有 ${dl.length - diffLines} 行，需要就单独跑 git diff）`)
    }
    if (files.some((f) => f.code === '??')) console.log('\n（新文件的内容不在 diff 里；要看就单独读文件）')
  }
  console.log(`\n指纹：${print}`)
  console.log(`${HR}\n`)
}

if (mode === 'preview') {
  printPreview('未写入任何东西')
  console.log('把上面整段给用户看，等他确认 message 之后，再用 --write + 同一个指纹提交。')
  cleanup()
  process.exit(0)
}

/* ---------- write ---------- */

// `--expect` 只在「用户确认过一份预览」的路径上需要；用户直接给 message 时脚本本来就在这一次调用里
// 现算清单，没有要保护的确认对象，所以不传就跳过这道校验。
if (expect && print !== expect) {
  printPreview('文件在预览之后被动过，指纹对不上，未提交')
  console.log(`你给的 --expect：${expect}\n现在的指纹：${print}`)
  console.log('上面是重新算的一份：重新给用户看一遍再提交，不要绕过指纹检查。')
  cleanup()
  process.exit(1)
}

// 只有还在工作区里的路径需要进 index（新文件必须，否则 `--only` 的 pathspec 匹配不到）；
// 删除 / 重命名的旧路径不在工作区，`--only` 会从 HEAD 里认出来，对它跑 `git add` 反而会致命报错。
const onDisk = paths.filter((p) => existsSync(join(TOP, p)))
if (onDisk.length) await gitRace(['add', '--', ...onDisk])
await gitRace(['commit', '--only', '-m', message, '--', ...paths])

const head = git(['log', '-1', '--format=%H%n%s']).out.trim().split('\n')
const names = git(['show', '--name-only', '--format=', 'HEAD']).out.trim().split('\n').filter(Boolean)
const leaked = names.filter((n) => !paths.includes(n))
const leftover = parsePorcelainZ(git(['status', '--porcelain=v1', '-z', '--', ...paths]).out)

console.log(`${HR}\n已提交\n${HR}`)
console.log(`  commit  ${head[0]}`)
console.log(`  首行    ${head[1]}`)
console.log(`  文件    ${names.length} 个：${names.join('、')}`)
if (leaked.length) console.log(`\n⚠ 提交里混进了不在清单里的文件：${leaked.join('、')}（立即告诉用户）`)
if (leftover.length) console.log(`\n⚠ 这些路径提交后仍有改动（提交期间工作区被改过？）：${leftover.map((r) => r.path).join('、')}`)
console.log('\n按约定不 push；要 push 另外问用户。')
console.log(`${HR}\n`)

cleanup()

function cleanup() {
  rmSync(CAP_OUT, { force: true })
  rmSync(CAP_ERR, { force: true })
}

function die(msg) {
  console.error(`[commit] ${msg}`)
  try { cleanup() } catch { /* 清理失败不影响报错 */ }
  process.exit(1)
}
