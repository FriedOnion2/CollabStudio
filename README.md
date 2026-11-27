<p align="center">
  <img src="assets/icon.png" alt="CollabStudio" width="108" />
</p>

<h1 align="center">CollabStudio</h1>

<p align="center">
  <strong>Antigravity (Gemini) × Claude × Codex (GPT) 三端 AI 协同开发桌面控制台</strong><br/>
  主/子项目树形工作区 · 需求讨论与文件导入 · 内置三端 CLI 直跑 · 分阶段模型与思考强度路由 · SSOT 文件驱动交接
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.1.0-3b82f6?style=flat-square" alt="version" />
  <img src="https://img.shields.io/badge/runtime-Electron%20%7C%20Node.js%2018%2B-10b981?style=flat-square" alt="runtime" />
  <img src="https://img.shields.io/badge/dependencies-Zero%20Runtime%20Deps-f59e0b?style=flat-square" alt="zero-deps" />
  <img src="https://img.shields.io/badge/license-MIT-64748b?style=flat-square" alt="license" />
</p>

---

## 核心理念：把多模型协作做成管理学

没有单一模型在所有维度都是完美答案。**CollabStudio** 把三家顶级模型放到各自最擅长的工位上，用仓库内的规则文件与标准文档（SSOT）彻底消除口头传话与上下文漂移，并在同一个桌面工作台里打通「**先讨论敲定方案 → 分阶段派给合适模型 → 直接调用 CLI 执行与验收**」的完整闭环。

| 模型 / 工具 | 最佳工位 | 核心强项 | 规则文件定向约束 |
| :--- | :--- | :--- | :--- |
| **Antigravity (Gemini)** | 军师 · 总体规划 · 文案 / UX 顾问 | 可沟通性第一、创意发散、产品文案去机械味 | `GEMINI.md`：未核实事实须标「推测」，验收只开结构化返工单 |
| **Claude** | 高审美前端 / 动效 · 编排主控 · 独立复审 | 前端视觉 / 动效王中王、工具编排、双方案合并 | `CLAUDE.md`：强约束「改全与核实」，列全同类一次改齐并实测 |
| **Codex (GPT)** | 硬核后端 · 切片编码 · 分级代码审查 | 后端 / 算法 / 查修 Bug 极其严谨 | `AGENTS.md`：两级审查（Blocker vs Suggestion）+ 最多 2 轮防死循环 |

---

## 核心功能

### 1. 主项目 × 多子项目树形工作区（Monorepo 友好）
- **树形项目导航 + 实时筛选**：左侧支持主项目折叠/展开管理任意数量子项目，实时显示汇总任务进度、子项目阶段（`S1`~`S5`）与契约冻结状态。
- **层级面包屑 + 同级速切**：顶部清晰定位 `主项目 / 子项目`，支持一键返回主项目或下拉秒切同级子项目；主项目视图提供可折叠的**子项目总览看板**。
- **手动新建 + 一键扫描批量导入**：自动扫描主项目 1~2 级子目录（自动跳过 `node_modules`、`.git`、`dist` 等），识别 `Collab` / `Node` / `Python` / `Rust` / `Go` / `Docs` 等技术栈标签，一键批量纳入管理。
- **独立闭环 + 规则继承**：每个子项目拥有独立的 `.collab-state.json`、`docs/01~05`、`.collab-discussion.json` 与分阶段模型配置，同时默认自动继承主项目根目录的 `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`（需要时可一键保存为子项目独立覆盖版）。

### 2. 需求与方案讨论区（先聊透再生产）
- **提需求输入框 + 多轮方案打磨**：在正式写代码前，直接在「需求与方案讨论」标签内输入需求与约束，与选中的模型多轮对齐方案（明确约束讨论期**不提前改动业务源码**）。
- **导入参考文件**：支持点击「+ 导入文件」（原生多选文件对话框）或直接**拖拽文件**到讨论区，文本/代码/PRD 文档内容自动注入模型上下文，非文本文件自动附带路径引用。
- **中途自由切换模型接力**：讨论过程中可随时切换 `Antigravity` / `Claude` / `Codex`、具体模型与思考强度，带着完整讨论记录无缝让不同模型补充或复审。
- **一键定稿进入生产**：点击「确认方案并进入生产」，预览/微调定稿内容后一键写入 `docs/01-brief.md`，自动勾选阶段 1 门禁并推进到指定生产阶段。

### 3. 工具内直接调用三端 CLI（按需手动切换）
- **自动探测本机 CLI**：自动发现本机 `Codex CLI`、`Claude Code CLI` 与 `Antigravity (agy) CLI`，并支持在「⚙ 配置」弹窗中自定义路径与默认附加参数（数据保存在独立用户目录，与 **CC Switch** 等环境切换工具完全隔离兼容）。
- **随时手动切换执行端**：左侧口令框支持直接编辑与一键恢复模板；执行栏默认跟随当前阶段配置，也可随时点击手动改派给任意 CLI。
- **双执行模式**：
  - **内置直跑（实时流式输出）**：直接在右侧「CLI 终端输出」面板通过 SSE 实时查看输出，支持一键停止、历史多轮输出下拉对比，结束后自动刷新项目文档与任务进度。
  - **外部终端（交互会话）**：一键在 Windows Terminal（自动回退 PowerShell）中定位到目标项目/子项目目录并带入口令启动交互式 TUI 会话。
- **3 档权限策略**：按需切换 `默认` / `自动写文件` / `跳过确认`。

### 4. 分阶段模型与思考强度管理
- 为 1~5 每个阶段分别指定 **执行 CLI + 具体模型 + 思考强度（`默认 / low / medium / high / xhigh / max`）**。
- 支持**阶段卡片内联速切**与**「⚙ 阶段模型矩阵」一屏统一配置**，并自动探测可用模型列表（亦支持手动输入自定义模型名）。
- 切换阶段时左侧执行栏自动套用对应配置，并真实透传至各 CLI 原生参数：

| CLI | 模型参数 | 思考 / 推理强度参数 | 自动写文件 / 跳过确认 |
| :--- | :--- | :--- | :--- |
| **Codex CLI** | `-m <model>` | `-c model_reasoning_effort="<effort>"` | `--full-auto` / `--dangerously-bypass-approvals-and-sandbox` |
| **Claude CLI** | `--model <model>` | `--effort <effort>` | `--permission-mode acceptEdits` / `--dangerously-skip-permissions` |
| **Antigravity (`agy`)** | `--model <model>` | `--effort <effort>` | `--mode accept-edits` / `--dangerously-skip-permissions` |

### 5. 内置多模型协作方法论
- **独立双方案合并（Blind Draft）**：大规划时让 Gemini 与 Claude 各自只看原始需求独立出方案，核实后再合并，避免锚定偏差。
- **界面文案与交互润色**：初版 UI 完成后一键发给 Gemini 去掉 AI 机械解释文案，改成说人话的产品表达。
- **两级分级审查（≤ 2 轮防死循环）**：只有会导致算错钱、丢数据、越权、发错消息或发布事故且有明确复现路径的问题才算 Blocker 挡上线；其余作为 Suggestion 记录。
- **错一次 → 硬检查（Mistake → Guardrail）**：每次人类纠正或审查退回，优先转成类型检查或守卫测试永久拦截同类错误。
- **统一「先问清单」**：删数据、停服、花钱、对外发消息、改方向、换密钥、改权限必须先问人类，其余自主推进。

---

## 仓库交接骨架（SSOT）

在 CollabStudio 中初始化主项目（及可选的多子项目）后，自动生成零覆盖的标准目录：

```text
<your-workspace>/
├── AGENTS.md                   # Codex (GPT) 行为铁律与两级审查规范
├── CLAUDE.md                   # Claude 改全与核实铁律
├── GEMINI.md                   # Antigravity (Gemini) 防幻觉与文案顾问铁律
├── .collab-state.json          # 主项目阶段、门禁、分阶段模型路由与子项目清单
├── .collab-discussion.json     # 需求讨论记录与导入的参考文件清单
├── prototypes/                 # 可选：静态高保真视觉原型
├── docs/
│   ├── 01-brief.md             # 总体架构、V1 非目标与双方案合并/定稿记录
│   ├── 02-frontend-spec.md     # Design Tokens、页面状态矩阵与文案润色
│   ├── 03-api-contract.md      # 前后端接口契约（冻结后三端严格遵守）
│   ├── 03b-backend-design.md   # 后端详细设计、Schema 与异常处理
│   ├── 04-tasks.md             # 垂直切片 Milestone 清单（CollabStudio 实时解析进度）
│   └── 05-review-log.md        # 分级审查记录、设计验收单与硬检查欠账表
└── apps/web/                   # 可选：任意子项目（默认继承根目录三份规则文件）
    ├── .collab-state.json      # 子项目独立阶段、门禁与分阶段模型路由
    ├── .collab-discussion.json # 子项目独立需求讨论与附件
    └── docs/01~05*.md          # 子项目独立交接文档
```

---

## 快速开始

### 环境要求
- **零运行时外部依赖**（服务端与核心逻辑基于纯 Node.js 标准库，需 Node.js >= 18）
- 打包桌面端需安装 devDependencies（Electron）

### 1. 开发运行（Electron 独立桌面窗口）
```bash
git clone https://github.com/FriedOnion2/CollabStudio.git
cd CollabStudio
npm install
npm start
```

### 2. 打包 Windows 独立客户端（`CollabStudio.exe`）
```bash
npm run build:win
# 产物位于 dist/CollabStudio-win32-x64/CollabStudio.exe
```
> 若 Windows PowerShell 禁用了 `npm.ps1` 脚本执行策略，直接使用 `npm.cmd install` 与 `npm.cmd run build:win` 即可。

### 3. 纯浏览器 / 服务器模式（不依赖 Electron）
```bash
npm run dev:web
# 默认监听 http://127.0.0.1:43980，支持通过环境变量指定地址与端口：
# HOST=0.0.0.0 PORT=43980 node server.mjs
```

---

## 代码结构

```text
CollabStudio/
├── electron/
│   ├── main.mjs                # Electron 主进程、单实例锁与原生目录/多文件选择器 IPC
│   └── preload.cjs             # 安全 contextBridge 桥接
├── lib/
│   ├── store.mjs               # 主/子项目注册表、子目录扫描、任务解析与状态持久化
│   ├── scaffold.mjs            # 零覆盖 SSOT 骨架生成器（支持主项目与子项目规则继承）
│   ├── prompts.mjs             # 父子上下文感知的三端交接口令模板
│   ├── cli.mjs                 # 三端 CLI 自动探测、模型目录、参数透传与流式/终端调度
│   └── discussion.mjs          # 需求讨论记录、附件上下文构建与一键定稿落盘
├── public/                     # 零构建原生前端（树形工作区、讨论区、SSOT 编辑器、CLI 控制台）
├── server.mjs                  # 轻量本地 HTTP + SSE 服务
└── skill/SKILL.md              # 配套 Antigravity 协同技能定义
```

---

## License

MIT
