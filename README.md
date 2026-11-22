# HTTP More

一个本地运行的 HTTP 重复请求工具。可以配置请求地址、方法、Query、Headers、请求体、执行次数和完成后间隔，并实时查看每次响应及汇总数据。

## 启动

需要 Node.js 22+ 和 pnpm。

```bash
pnpm install
pnpm dev
```

开发页面位于 `http://127.0.0.1:5173`，Vite 会将 `/api` 代理到本地 Node 服务。

## 生产运行

```bash
pnpm build
pnpm start
```

打开 `http://127.0.0.1:3000`。生产环境由同一个 Node 进程提供前端页面和请求接口。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm build
```

## 使用说明

- 第一条请求立即发送；每次响应完全读取后，再等待设置的间隔。
- POST、PUT、PATCH 请求体支持 JSON、纯文本和文本键值 `multipart/form-data`；Form Data 字段可重复或禁用，`Content-Type` 与 boundary 自动生成。
- HTTP 非 2xx、网络错误会记为失败，但不会终止剩余请求。
- 点击停止会取消正在进行的请求、等待计时和后续请求。
- 每次运行会创建独立 Cookie Jar：自动保存响应中的 `Set-Cookie`（包括 `HttpOnly`），并按照域名、路径、Secure 和过期规则用于本次任务的后续请求及重定向；手动填写的 `Cookie` Header 优先覆盖同名自动 Cookie。
- 默认开启浏览器请求头补全：从当前浏览器读取 User-Agent 和语言，补充 Accept，并根据“来源页面 URL”生成 Origin、Referer；手动 Header 优先。普通网页不能读取其他标签页地址，跨域接口应手动填写真实来源页。
- JSON 响应会格式化，文本直接显示，二进制只显示类型和字节数。
- 配置保存在浏览器本地，响应历史仅存在于当前页面。
- 支持深色与浅色主题切换，主题选择会保存在浏览器本地。
- 工具不限制次数、间隔、响应大小或请求时长，请避免误填极大值。
- 这是允许访问 localhost 和局域网地址的个人工具，请勿未经认证直接部署到公网。
