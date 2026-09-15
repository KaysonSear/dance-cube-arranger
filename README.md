# 舞立方谱面编辑器 (Dance Cube Arranger)

[中文](#舞立方谱面编辑器-dance-cube-arranger) | [English](#dance-cube-arranger-en) | [日本語](#dance-cube-arranger-ja)

---

## 舞立方谱面编辑器 (Dance Cube Arranger)

**作者**：Kayson / Antigravity

专为 **舞立方（Dance Cube / Malody V 6 键立方体模式）** 打造的可视化谱面制作与排键工具。提供直观高效的交互体验，帮助谱师和玩家轻松制作、微调与试玩舞立方谱面。

### 🌟 主要功能概况

- **可视化排键与编辑**：
  - 6 键位自由排键，支持 单点 (Tap)、长按 (Hold)、双押及多押；
  - 采音点拖拽、吸附、批量选择与多段剪贴板复制粘贴；
  - 采音点标记与互换排键（快速对调两点排键）；
  - 快捷整点删除与谱面镜像翻转（水平镜像 / 垂直镜像）。
- **智能排键冲突诊断**：
  - **长条重叠警报**：自动识别非法长条重合，一键快速定位跳转；
  - **超负荷多押警报**：智能提示超过双手负荷的三押及以上配置，辅助合理排键。
- **内置模拟器试玩**：
  - 支持键盘映射与自定义键位，随时进行手元模拟试玩；
  - 实时音画同步，提供落点打击音效与流畅的节奏反馈。
- **工程与素材管理**：
  - 支持直接导入与导出 Malody V `.mcz` 整合包及 `.mc` 谱面文件；
  - 完备的撤销/重做（Ctrl+Z / Ctrl+Y）与历史快照版本回滚；
  - 导入后素材自动在工程中留存副本，移动外部素材不影响已有工程。

### 📥 下载与安装

- **最新绿色免安装版发布页**：[GitHub Releases](https://github.com/KaysonSear/dance-cube-arranger/releases)
- **v260915 绿色压缩包直链**：[dance-cube-arranger-260915.zip](https://github.com/KaysonSear/dance-cube-arranger/releases/download/v260915/dance-cube-arranger-260915.zip)
- **说明**：免安装版本内置 Node.js、Python 与 ffmpeg 完整独立运行时，纯小白 100% 解压即用，无需配置任何开发环境。

### 🚀 使用说明

1. **解压与放置**：
   - 请将压缩包解压到一个**拥有读写权限的本地文件夹**（例如 `D:\Games\` 或用户桌面），**请勿直接在压缩包内双击打开**。
   - 请保持文件夹内部结构完整，如需移动程序，请整体移动整个 `dance-cube-arranger` 文件夹。
2. **启动程序**：
   - 双击文件夹中的 **`启动编辑器.exe`**（或执行 **`启动编辑器.bat`**）。程序将在后台启动并自动在默认浏览器中打开编辑器界面。
3. **退出程序**：
   - 使用完毕后，双击同一文件夹下的 **`停止编辑器.exe`**（或执行 **`停止编辑器.bat`**）即可安全退出后台服务。
4. **工程数据与安全**：
   - 编辑器中所有的工程素材副本、排键进度和历史快照均自动保存在 **`artifacts`** 文件夹中。
   - **请勿随意删除 `artifacts` 文件夹**，建议定期备份该文件夹以防数据丢失。

### 🔄 更新方式

1. **自动检查更新**：
   - 编辑器界面内置“检查更新”功能，当有新版本发布时会提示更新，并支持一键热升级。
2. **绿色版更新迁移**：
   - 前往 [GitHub Releases](https://github.com/KaysonSear/dance-cube-arranger/releases) 下载最新版本的压缩包并解压；
   - 将旧版本目录中的 **`artifacts`** 文件夹复制并覆盖到新版本目录中，即可无缝继承所有历史工程和编辑进度。

### 💬 问题反馈与交流

如果您在使用过程中遇到任何 Bug、排键异常或有改进建议，欢迎通过以下渠道与作者联系：

- **GitHub Issues**：[提交 Issue 反馈](https://github.com/KaysonSear/dance-cube-arranger/issues)
- **QQ 联系方式**：`1159239254` (Kayson)

### 📄 开源许可证

本项目采用 **[GNU General Public License v3.0 (GPL-3.0)](LICENSE)** 强传染性开源协议开放源代码。任何修改、分发或基于本项目的衍生作品均必须以相同的 GPL-3.0 协议完整开源。

---

## Dance Cube Arranger (EN)

**Author**: Kayson

A dedicated visual chart creation and arrangement tool designed for **Dance Cube (Malody V 6-Column Cube Mode)**. It provides an intuitive and efficient interactive experience, helping chart creators and rhythm game players easily design, fine-tune, and playtest Dance Cube charts.

### 🌟 Key Features

- **Visual Chart Arranging & Editing**:
  - Full 6-column arranging with support for Taps, Holds, simultaneous hits, and complex patterns;
  - Dragging, snapping, multi-selection, and clipboard copy/paste for note timing points;
  - Note marking and key swap (quickly swap arrangement between two points);
  - Quick note deletion and chart mirroring (horizontal / vertical mirror).
- **Intelligent Conflict Diagnosis**:
  - **Hold Overlap Warning**: Automatically identifies overlapping hold notes with one-click navigation;
  - **Overload Simultaneous Hits Warning**: Highlights patterns exceeding two hands' physical limits (3+ simultaneous hits) to aid ergonomic charting.
- **Built-in Simulator Playtest**:
  - Customizable keyboard bindings for instant simulator playtesting;
  - Real-time audio-visual synchronization with responsive hit sounds.
- **Project & File Management**:
  - Import and export Malody V `.mcz` packages and `.mc` chart files directly;
  - Full undo/redo support (Ctrl+Z / Ctrl+Y) and historical snapshot recovery;
  - Local caching of media assets so moving external files won't disrupt ongoing projects.

### 📥 Download & Installation

- **Releases Page**: [GitHub Releases](https://github.com/KaysonSear/dance-cube-arranger/releases)
- **v260915 Portable Package**: [dance-cube-arranger-260915.zip](https://github.com/KaysonSear/dance-cube-arranger/releases/download/v260915/dance-cube-arranger-260915.zip)
- **Note**: The portable edition bundles Node.js, Python, and ffmpeg. It is 100% plug-and-play with zero external dependencies required.

### 🚀 Getting Started

1. **Preparation & Extraction**:
   - Please extract the entire archive into a **writable local directory** (e.g., `D:\Games\` or Desktop). **Do NOT run the program directly inside the archive**.
   - Keep the folder structure intact. If you need to move the app, please move the entire `dance-cube-arranger` directory.
2. **Launch**:
   - Double-click **`启动编辑器.exe`** (or run **`启动编辑器.bat`**) inside the folder. The program will start in the background and automatically open the editor interface in your default browser.
3. **Exit**:
   - When finished, double-click **`停止编辑器.exe`** (or run **`停止编辑器.bat`**) in the same folder to safely close background services.
4. **Data & Project Safety**:
   - All projects, arrange states, and snapshots are stored in the **`artifacts`** folder.
   - **Do NOT delete the `artifacts` folder**. We recommend backing it up periodically.

### 🔄 Update Guide

1. **Check for Updates**:
   - The editor includes a built-in "Check for Updates" button that alerts you when a new release is available on GitHub and supports one-click hot updates.
2. **Upgrading Portable Editions**:
   - Download the latest package from [GitHub Releases](https://github.com/KaysonSear/dance-cube-arranger/releases) and extract it.
   - Simply copy the **`artifacts`** folder from your old version into the new folder to carry over all your projects and progress.

### 💬 Bug Reports & Contact

If you encounter any bugs, unexpected behavior, or have feature suggestions, please feel free to reach out:

- **GitHub Issues**: [Submit an Issue](https://github.com/KaysonSear/dance-cube-arranger/issues)
- **QQ**: `1159239254` (Kayson)

### 📄 License

This project is licensed under the **[GNU General Public License v3.0 (GPL-3.0)](LICENSE)** copyleft license. Any modifications, distributions, or derivative works based on this project must also be open-sourced under the same GPL-3.0 terms.

---

## Dance Cube Arranger (JA)

**作者**: Kayson

**Dance Cube（Malody V 6鍵キューブモード / 舞立方）** 専用のビジュアル譜面制作・キー配置エディタです。直感的で快適な操作性を提供し、譜面制作者やプレイヤーが手軽に譜面の制作・微調整・テストプレイを行えるよう設計されています。

### 🌟 主な機能

- **ビジュアル配置と直感的な編集**:
  - 6レーンの自由なノーツ配置（Tap、Hold、同時押し、多重押し対応）；
  - ノーツのドラッグ移動、吸着、一括選択、クリップボードのコピー＆ペースト；
  - ノーツマーキングと配置交換機能（2つのタイミングポイントの配置をワンタッチで交換）；
  - ワンキー削除および譜面反転機能（水平ミラー / 垂直ミラー）。
- **インテリジェントな配置競合チェック**:
  - **ロングノーツ重複警告**: 不正に重なったロングノーツを自動検出し、ワンクリックで該当箇所へジャンプ；
  - **過負荷同時押し警告**: 両手の負担を超える3つ以上の同時押しをハイライト表示し、無理のない譜面制作をサポート。
- **シミュレータ試玩機能**:
  - キーボードマッピングとキーコンフィグに対応し、エディタ上でいつでも手元テストプレイが可能；
  - 正確な音画同期と打鍵効果音による快適なリズムフィードバック。
- **プロジェクトとファイル管理**:
  - Malody V `.mcz` パックおよび `.mc` 谱面ファイルの直接インポート／エクスポート；
  - アンドゥ／リドゥ（Ctrl+Z / Ctrl+Y）および履歴スナップショットからの復元；
  - 楽曲やジャケット画像はプロジェクト内に複製保存されるため、外部ファイルを移動・削除しても作業中の譜面に影響しません。

### 📥 ダウンロードとインストール

- **最新ポータブル版公開ページ**: [GitHub Releases](https://github.com/KaysonSear/dance-cube-arranger/releases)
- **v260915 ポータブル版直リンク**: [dance-cube-arranger-260915.zip](https://github.com/KaysonSear/dance-cube-arranger/releases/download/v260915/dance-cube-arranger-260915.zip)
- **特徴**: Node.js、Python、ffmpeg をあらかじめ内包しているため、PC環境の追加設定なしで解凍後すぐに動作します。

### 🚀 使い方

1. **解凍と準備**:
   - 圧縮ファイルを**書き込み権限のあるローカルフォルダ**（例：`D:\Games\` や デスクトップ）に解凍してください。**圧縮ファイル内で直接実行しないでください**。
   - フォルダ内の構成は変更せず、移動する際は `dance-cube-arranger` フォルダ全体を移動してください。
2. **起動方法**:
   - フォルダ内の **`启动编辑器.exe`**（または **`启动编辑器.bat`**）をダブルクリックします。バックグラウンドで起動し、既定のブラウザでエディタ画面が自動的に開きます。
3. **終了方法**:
   - 作業終了後、同じフォルダ内の **`停止编辑器.exe`**（または **`停止编辑器.bat`**）をダブルクリックすると安全に終了します。
4. **プロジェクトデータの保護**:
   - すべてのプロジェクト、編集進行状況、履歴スナップショットは **`artifacts`** フォルダに保存されます。
   - **`artifacts` フォルダは削除しないでください**。定期的にバックアップを取ることをおすすめします。

### 🔄 アップデート方法

1. **自動更新確認**:
   - エディタ内に「更新確認」機能があり、新バージョンが公開されると通知され、ワンクリックでの更新に対応しています。
2. **ポータブル版のデータ移行**:
   - [GitHub Releases](https://github.com/KaysonSear/dance-cube-arranger/releases) から最新バージョンの圧縮ファイルをダウンロードして解凍します；
   - 旧バージョンのフォルダ内にある **`artifacts`** フォルダを、新しいバージョンのフォルダにコピー＆上書きするだけで、これまでのプロジェクトをすべて引き継ぐことができます。

### 💬 不具合報告・お問い合わせ

使用中に不具合（バグ）や動作の異常を発見された場合、または機能改善のご要望がございましたら、以下の窓口までお気軽にご連絡ください：

- **GitHub Issues**: [Issue を作成して報告](https://github.com/KaysonSear/dance-cube-arranger/issues)
- **QQ**: `1159239254` (Kayson)

### 📄 ライセンス

本プロジェクトは強力なコピーレフト型（伝染性）オープンソースライセンスである **[GNU General Public License v3.0 (GPL-3.0)](LICENSE)** のもとで公開されています。本プロジェクトを変更・派生した成果物はすべて同じ GPL-3.0 ライセンスに基づいて公開する必要があります。
