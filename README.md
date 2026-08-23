<p align="center">
  <img src="./build/roxy-app-icon-character-v9-large.png" width="160" alt="Roxy 的书架图标">
</p>

<h1 align="center">Roxy 的书架</h1>

<p align="center">
  面向 Windows 的本地优先私人阅读器。让书留在你的电脑里，让阅读回到正文。
</p>

<p align="center">
  <strong>EPUB</strong> · <strong>TXT</strong> · <strong>PDF</strong> · 完全离线 · 无账户 · 无遥测
</p>

<p align="center">
  <a href="https://github.com/rudeus5128-art/roxy-bookshelf/actions/workflows/ci.yml"><img src="https://github.com/rudeus5128-art/roxy-bookshelf/actions/workflows/ci.yml/badge.svg" alt="Windows CI"></a>
  <img src="https://img.shields.io/badge/platform-Windows-1769FF" alt="Windows">
  <img src="https://img.shields.io/badge/version-1.0.1-1769FF" alt="Version 1.0.1">
</p>

![Roxy 的书架 v1.0.1 界面](./docs/screenshots/bookshelf-v1.0.1.png)

## 为什么选择 Roxy

Roxy 不追求成为功能最多的阅读器。它专注于稳定、安全、快速地打开本地书籍，
并用克制的界面保留阅读所需的能力。

## 特性

- EPUB、TXT、PDF 本地阅读
- 清晰的书架、搜索、自定义子书架与批量整理
- 目录、正文搜索、可靠的阅读位置恢复、书签与高亮
- TXT 自动编码识别，支持 UTF-8、UTF-16、GBK、GB18030 等编码切换
- PDF 连续滚动、单页、双页、缩放及页面适配
- EPUB / TXT 自适应单页与双页布局，兼顾全屏与窗口阅读
- 仅在真实阅读活动期间累计的本地阅读统计
- 完整明暗主题和 Windows 文件关联，资源管理器中可直接打开

## 三种格式，一套安静的阅读体验

<table>
  <tr>
    <td align="center" width="33%"><img src="./build/epub-large.png" width="150" alt="EPUB 文件图标"></td>
    <td align="center" width="33%"><img src="./build/txt-large.png" width="150" alt="TXT 文件图标"></td>
    <td align="center" width="33%"><img src="./build/pdf-large.png" width="150" alt="PDF 文件图标"></td>
  </tr>
  <tr>
    <td align="center"><strong>EPUB</strong><br>封面、目录、插图、正文搜索与自适应单双页</td>
    <td align="center"><strong>TXT</strong><br>多编码识别、章节目录、大文件分块与自适应单双页</td>
    <td align="center"><strong>PDF</strong><br>连续滚动、单页双页、目录、搜索、缩放与页面适配</td>
  </tr>
</table>

安装 Roxy 并完成文件关联后，Windows 资源管理器中的 `.epub`、`.txt` 和 `.pdf`
文件会分别使用上方展示的对应子图标，方便在文件夹中快速辨认格式。

## 阅读界面

工具栏保持紧凑，目录、搜索、书签、字号和版式设置在需要时才出现。

![Roxy TXT 阅读界面](./docs/screenshots/reader.png)

## 原则

- 核心功能完全离线可用
- 不上传书籍、文件名、阅读记录或统计数据
- 不修改原始 EPUB、TXT、PDF 文件
- 阅读器功能和本地数据异常不应损坏用户书籍

完整产品约束参见 [ROXY_PRODUCT_SPEC.txt](./ROXY_PRODUCT_SPEC.txt)。

## 下载与 Windows SmartScreen

请只从本仓库的 [Releases](https://github.com/rudeus5128-art/roxy-bookshelf/releases) 页面下载安装包。

Roxy 当前是个人维护的开源项目，Windows 安装包尚未购买商业代码签名证书。因此 Microsoft Edge
或 Windows SmartScreen 可能提示“通常不会下载”“未知发布者”或“Windows 已保护你的电脑”。
这类提示通常表示该版本尚未积累下载信誉，并不等同于检测到病毒。

每个 Release 都附带 SHA-256 校验文件。只有在确认下载来源为本仓库、且文件哈希一致后，
才建议在 Edge 中选择“保留”，或在 SmartScreen 中选择“更多信息 → 仍要运行”。

```powershell
Get-FileHash -Algorithm SHA256 .\Roxy-Bookshelf-1.0.1-Setup.exe
```

## 开发环境

- Windows 10/11
- Node.js 20 或更高版本
- npm

```powershell
npm install
npm run dev
```

## 检查与构建

```powershell
npm run typecheck
npm test
npm run build
npm run package:win
```

`npm run package:win` 会生成 Windows NSIS 安装包。

## 技术栈

Electron、React、TypeScript、electron-vite、epub.js、PDF.js、sql.js。

## Credits

tai and codex

## 许可证与视觉素材

程序源代码采用 [MIT License](./LICENSE)。MIT 授权仅适用于程序源代码，
不适用于仓库中的第三方角色美术、插画、图标、参考图片或其他相关视觉素材。

这些视觉素材不以 MIT、CC0、CC BY 或其他开放内容许可证提供。本项目不主张
拥有其中涉及的第三方角色、名称、美术或其他知识产权，也不代表向使用者授予
相关权利；所有相关权利归各自权利人所有。详情见
[THIRD_PARTY_ASSETS.md](./THIRD_PARTY_ASSETS.md)。
