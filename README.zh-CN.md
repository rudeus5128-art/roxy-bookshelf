<p align="center">
  <img src="./build/roxy-app-icon-character-v9-large.png" width="180" alt="Roxy 的书架图标">
</p>

<h1 align="center">Roxy 的书架</h1>

<p align="center">
  面向 Windows 的本地优先私人阅读器。让书留在你的电脑里，让阅读回到正文。
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <a href="https://github.com/rudeus5128-art/roxy-bookshelf/actions/workflows/ci.yml"><img src="https://github.com/rudeus5128-art/roxy-bookshelf/actions/workflows/ci.yml/badge.svg" alt="Windows CI"></a>
  <img src="https://img.shields.io/badge/platform-Windows-1769FF" alt="Windows">
  <img src="https://img.shields.io/badge/version-1.0.2-1769FF" alt="Version 1.0.2">
</p>

<p align="center">
  <strong><a href="https://github.com/rudeus5128-art/roxy-bookshelf/releases/latest">下载最新版 Windows 安装包</a></strong>
</p>

![Roxy 的书架](./docs/screenshots/bookshelf-v1.0.2-zh-CN.png)

## 项目介绍

Roxy 的书架是一款克制、安静的本地桌面阅读器，适合管理和阅读自己的电子书文件。它专注于快速打开本地书籍、可靠恢复阅读位置，并尽量让界面在阅读时退到后台。

核心阅读功能完全离线可用。Roxy 不需要账户，不包含广告、推荐流、遥测或云端依赖，也不会修改原始 EPUB、TXT、PDF 文件。

## 功能

- EPUB、TXT、PDF 本地书架与阅读
- English (`en-US`) / 简体中文 (`zh-CN`) 界面切换，设置本地保存
- 网格与列表视图、书架搜索、阅读状态分类和最近阅读
- 自定义颜色子书架、拖拽整理与批量移动
- 目录、正文搜索、书签、高亮和高亮擦除
- 三种格式统一、可靠的阅读位置恢复
- EPUB / TXT 自适应单页与双页布局，兼顾全屏和窗口阅读
- 只在真实阅读活动期间累计的本地阅读统计
- 完整明暗主题
- Windows 文件关联，可从资源管理器直接打开书籍

## 支持格式

<table>
  <tr>
    <td align="center" width="33%"><img src="./build/epub-large.png" width="150" alt="EPUB 文件图标"></td>
    <td align="center" width="33%"><img src="./build/txt-large.png" width="150" alt="TXT 文件图标"></td>
    <td align="center" width="33%"><img src="./build/pdf-large.png" width="150" alt="PDF 文件图标"></td>
  </tr>
  <tr>
    <td align="center"><strong>EPUB</strong><br>封面、目录、插图、正文搜索、自适应单双页和阅读主题</td>
    <td align="center"><strong>TXT</strong><br>UTF-8、UTF-16、GBK、GB18030、章节识别和大文件索引</td>
    <td align="center"><strong>PDF</strong><br>连续、单页、双页、目录、搜索、缩放和页面适配</td>
  </tr>
</table>

安装并启用文件关联后，Windows 资源管理器中的 `.epub`、`.txt` 和 `.pdf` 文件会分别使用上方展示的对应子图标。

## 界面截图

### 阅读界面

![Roxy TXT 阅读界面](./docs/screenshots/reader.png)

### 本地阅读统计

![Roxy 阅读统计](./docs/screenshots/statistics-v1.0.1.png)

阅读时长只会在阅读页面位于前台、窗口保持焦点且近期存在滚动、翻页或章节跳转等阅读行为时累计。

## 安装

1. 打开 [GitHub 最新发布页](https://github.com/rudeus5128-art/roxy-bookshelf/releases/latest)。
2. 下载 `Roxy-Bookshelf-1.0.2-Setup.exe`。
3. 可选择将安装包 SHA-256 与 Release 中提供的校验值比较。
4. 运行安装程序并选择安装位置。

Roxy 目前是未使用商业代码签名的个人开源应用。Microsoft Edge 或 Windows SmartScreen 可能显示“通常不会下载”或“未知发布者”。这表示安装包尚未积累签名信誉，本身不等于检测到恶意软件。请只从本仓库下载并核对 Release 校验值。

```powershell
Get-FileHash -Algorithm SHA256 .\Roxy-Bookshelf-1.0.2-Setup.exe
```

## 系统要求

- 64 位 Windows 10 或 Windows 11
- 支持普通窗口和全屏自适应布局
- 核心阅读功能不需要网络连接

## 从源码构建

需要 Windows 10/11、Node.js 20 或更高版本和 npm。

```powershell
git clone https://github.com/rudeus5128-art/roxy-bookshelf.git
cd roxy-bookshelf
npm install
npm run typecheck
npm test
npm run build
npm run package:win
```

正式 NSIS 安装包生成在 `release/` 目录。

技术栈：Electron、React、TypeScript、epub.js、PDF.js、sql.js。

## 隐私与文件安全

- Roxy 默认只读取原始 EPUB、TXT、PDF 文件
- 元数据覆盖、进度、子书架、标注和统计存储在应用本地数据库
- 不上传书籍内容、文件名、阅读记录或统计数据
- 卸载 Roxy 不会删除用户原始电子书目录

## 已知限制

- 仅支持 Windows，暂不提供 macOS 或 Linux 安装包
- 安装包尚未代码签名，可能触发 Windows SmartScreen
- PDF 搜索和高亮依赖文档本身包含可用文本层
- 不支持 DRM 或受密码保护的电子书
- 损坏或不符合标准的 EPUB 仍可能存在兼容问题

## 许可证

项目有权授权的程序源代码采用 [MIT License](./LICENSE)。

仓库内第三方角色美术、插画、图标、参考图片和其他相关视觉素材明确不包含在 MIT 授权范围内，也不会自动以 MIT、CC0、CC BY 或其他开放内容许可证提供。涉及第三方 IP 的角色、名称、美术及其他知识产权归各自权利人所有。详情见 [THIRD_PARTY_ASSETS.md](./THIRD_PARTY_ASSETS.md)。

## Credits

tai and codex
