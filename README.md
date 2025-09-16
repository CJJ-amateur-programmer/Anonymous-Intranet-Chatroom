# Intranet Chatroom

> This project is fully created and crafted by Gemini 2.5 Pro in Google AI Studio, and tested and verified by human. 

A simple, end-to-end encrypted chatroom for local networks written in Go.

## ✨ Features

*   **End-to-End Encryption**: Utilizes RSA+AES encryption to secure private messages, ensuring only the sender and receiver can read them.
*   **Peer-to-Peer File Transfer**: Files are uploaded via the server and delivered directly to the recipient, with server acting as a relay. Supports "instant upload" (or "resume") for files that have already been uploaded by someone else.
*   **File Deduplication & Automatic Cleanup**: Uploaded files are stored using their SHA256 hash as the filename. The server tracks file references, and files are automatically deleted when no longer referenced by any user or when the server shuts down gracefully.
*   **Drag & Drop File Upload**: Seamlessly upload files by dragging them anywhere onto the chat interface.
*   **Responsive Design**: Optimized for both desktop and mobile (specifically tested for iPhone Safari compatibility).
*   **Configurable Port**: Run the server on any desired port using a command-line flag (`--port`).
*   **No Server-Side Storage**: The server does not store any chat history or user data, promoting privacy and simplicity.
*   **Cross-Platform**: Works on Windows, macOS, and Linux.

## 🚀 Getting Started

### 1. Prerequisites

*   **Go 1.18+**: Make sure you have Go installed on your system. You can download it from [https://go.dev/dl/](https://go.dev/dl/).

### 2. Project Setup

1.  Clone the repository:
    ```bash
    git clone <your-repository-url>
    cd intranet-chatroom
    ```
2.  Create a `static` directory in the project root.
3.  Download the necessary JavaScript libraries (already included):
    *   `jsencrypt.min.js`: [https://github.com/travist/jsencrypt/blob/master/bin/jsencrypt.min.js](https://github.com/travist/jsencrypt/blob/master/bin/jsencrypt.min.js)
    *   `sha256.min.js`: [https://raw.githubusercontent.com/emn178/js-sha256/master/build/sha256.min.js](https://raw.githubusercontent.com/emn178/js-sha256/master/build/sha256.min.js)
4.  Place both downloaded `.js` files into the `static` directory.

### 3. Build and Run

1.  Compile the Go server:
    ```bash
    go build -gcflags="-l=4" -ldflags="-s -w"
    ```
2.  Run the server:
    *   **Default port (5000)**:
        *   Windows: `./chatroom.exe`
        *   Linux/macOS: `./chatroom`
    *   **Custom port (e.g., 3333)**:
        *   Windows: `./chatroom.exe --port 3333`
        *   Linux/macOS: `./chatroom --port 3333`

### 4. Access the Chatroom

Open your web browser on any computer within the same local network and navigate to:

`http://<server-ip-address>:<port>`

(e.g., `http://192.168.1.100:5000`)

### 5. Usage

*   **Nickname**: Upon first visit, a random nickname will be assigned. You can change it using the input field and button in the sidebar.
*   **Chatting**:
    *   Click on a username in the left sidebar (or "群聊" for group chat) to select a conversation target.
    *   Type your message in the input box and press Enter or click "Send".
    *   Private messages are end-to-end encrypted. Group messages are sent in plain text.
*   **File Transfer**:
    *   Select a recipient (user or group chat).
    *   Click the "📎" button or drag and drop files anywhere onto the page.
    *   The server will handle deduplication and cleanup. Files are downloaded using their original filenames.
*   **Copy Message**: Hover over a message bubble to reveal a "Copy" button.

## 💡 To-Do List

*   [ ] Implement typing indicators.
*   [ ] Add support for sending emojis or other rich text formatting.
*   [ ] Add a "read receipts" feature for private messages.
*   [ ] Enhance mobile UI for better responsiveness and gesture support.
*   [ ] Consider adding user-defined ports through environment variables.
*   [ ] Explore more robust error handling and logging.
*   [ ] Add basic input validation on the frontend (e.g., nickname length).
*   [ ] Add file upload progress indicator for large files.

# 内网聊天室

>本项目完全由 Google AI Studio 中的 Gemini 2.5 Pro 创建和打磨，并经过人工测试和验证。

一个用 Go 编写的简单、端到端加密的本地网络聊天室。

## ✨ 特点

*   **端到端加密**: 使用 RSA+AES 加密保护私密消息，确保只有发送者和接收者能够读取。
*   **点对点文件传输**: 文件通过服务器上传，并直接传输给接收者，服务器充当中继。支持对已被他人上传过的文件进行“即时上传”（或“续传”）。
*   **文件去重与自动清理**: 上传的文件以其 SHA256 哈希值作为文件名存储。服务器会跟踪文件的引用，当没有任何用户引用文件或服务器正常关闭时，文件将被自动删除。
*   **拖放文件上传**: 通过将文件拖放到聊天界面上的任何位置，即可无缝上传。
*   **响应式设计**: 针对桌面和移动设备进行了优化（特别测试了 iPhone Safari 兼容性）。
*   **可配置端口**: 使用命令行标志 (`--port`) 在任何所需的端口上运行服务器。
*   **无服务器端存储**: 服务器不存储任何聊天记录或用户信息，从而增强隐私和简洁性。
*   **跨平台**: 可在 Windows、macOS 和 Linux 上运行。

## 🚀 入门指南

### 1. 先决条件

*   **Go 1.18+**: 确保您的系统已安装 Go。您可以从 [https://go.dev/dl/](https://go.dev/dl/) 下载。

### 2. 项目设置

1.  克隆仓库：

    ```bash
    git clone <your-repository-url>
    cd intranet-chatroom
    ```

2.  在项目根目录下创建一个 `static` 目录。

3.  下载必要的 JavaScript 库（已包含）：

    *   `jsencrypt.min.js`: [https://github.com/travist/jsencrypt/blob/master/bin/jsencrypt.min.js](https://github.com/travist/jsencrypt/blob/master/bin/jsencrypt.min.js)
    *   `sha256.min.js`: [https://raw.githubusercontent.com/emn178/js-sha256/master/build/sha256.min.js](https://raw.githubusercontent.com/emn178/js-sha256/master/build/sha256.min.js)

4.  将下载的两个 `.js` 文件放入 `static` 目录。

### 3. 构建和运行

1.  编译 Go 服务器：

    ```bash
    go build -gcflags="-l=4" -ldflags="-s -w"
    ```

2.  运行服务器：

    *   **默认端口（5000）**:
        *   Windows: `./chatroom.exe`
        *   Linux/macOS: `./chatroom`
    *   **自定义端口（例如 3333）**:
        *   Windows: `./chatroom.exe --port 3333`
        *   Linux/macOS: `./chatroom --port 3333`

### 4. 访问聊天室

在同一本地网络中的任何计算机上打开您的网络浏览器，然后导航到：

`http://<server-ip-address>:<port>`

（例如 `http://192.168.1.100:5000`）

### 5. 使用方法

*   **昵称**: 首次访问时，将自动分配一个随机昵称。您可以使用侧边栏中的输入字段和按钮进行更改。
*   **聊天**:
    *   单击左侧边栏中的用户名（或“群聊”）来选择对话目标。
    *   在输入框中键入您的消息，然后按 Enter 键或单击“发送”。
    *   私聊消息是端到端加密的。群聊消息是明文发送的。
*   **文件传输**:
    *   选择一个接收者（用户或群聊）。
    *   单击“📎”按钮或将文件拖放到页面上的任何位置。
    *   服务器将处理文件去重和清理。文件将使用其原始文件名下载。
*   **复制消息**: 将鼠标悬停在消息气泡上，会显示一个“复制”按钮。

## 💡 待办事项列表

*   [ ] 实现输入状态指示器。
*   [ ] 添加发送表情符号或其他富文本格式的支持。
*   [ ] 为私聊消息添加“已读回执”功能。
*   [ ] 增强移动 UI，以提高响应速度和手势支持。
*   [ ] 考虑通过环境变量添加用户自定义端口。
*   [ ] 探索更健壮的错误处理和日志记录。
*   [ ] 在前端添加基本的输入验证（例如，昵称长度）。
*   [ ] 为大文件添加文件上传进度指示器。

# Screenshot / 截图

![demo](https://github.com/user-attachments/assets/0f871505-3e79-4df7-a7b6-c9c1d57b82d4)
