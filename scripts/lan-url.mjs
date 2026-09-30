import { networkInterfaces } from 'node:os'

const PORT = process.argv[2] || process.env.PORT || 5173
const nets = networkInterfaces()
const rows = []
for (const [name, list] of Object.entries(nets)) {
  for (const info of list || []) {
    if (info.family !== 'IPv4' || info.internal) continue
    rows.push({ name, address: info.address })
  }
}

console.log('\n手机访问地址（同一 Wi-Fi 下）：')
if (!rows.length) {
  console.log('  没有找到局域网 IPv4 地址，检查一下网络连接')
} else {
  for (const r of rows) console.log(`  http://${r.address}:${PORT}/     (${r.name})`)
}
console.log('\n开发服务器：npm run dev（监听所有网卡，端口 5173）')
console.log('若打不开：确认手机与电脑同一 Wi-Fi，且 Windows 防火墙允许 node.exe 入站。\n')
