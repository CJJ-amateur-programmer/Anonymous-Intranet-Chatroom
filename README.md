# Intranet Chatroom

> This project is fully created and crafted by Gemini 2.5 Pro in Google AI Studio, and tested and verified by human. 

A simple, end-to-end encrypted chatroom for local networks written in Go.

## ✨ Features

*   **End-to-End Encryption**: Utilizes RSA encryption to secure private messages, ensuring only the sender and receiver can read them.
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
3.  Download the necessary JavaScript libraries:
    *   `jsencrypt.min.js`: [https://github.com/travist/jsencrypt/blob/master/bin/jsencrypt.min.js](https://github.com/travist/jsencrypt/blob/master/bin/jsencrypt.min.js)
    *   `sha256.min.js`: [https://raw.githubusercontent.com/emn178/js-sha256/master/build/sha256.min.js](https://raw.githubusercontent.com/emn178/js-sha256/master/build/sha256.min.js)
4.  Place both downloaded `.js` files into the `static` directory.

### 3. Build and Run

1.  Compile the Go server:
    *   **Windows**:
        ```bash
        go build -o chat-server.exe .
        ```
    *   **Linux/macOS**:
        ```bash
        go build -o chat-server .
        ```
2.  Run the server:
    *   **Default port (5000)**:
        *   Windows: `./chat-server.exe`
        *   Linux/macOS: `./chat-server`
    *   **Custom port (e.g., 3333)**:
        *   Windows: `./chat-server.exe --port 3333`
        *   Linux/macOS: `./chat-server --port 3333`

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
*   [ ] Implement a user presence status (online/offline) more explicitly.
*   [ ] Add a "read receipts" feature for private messages.
*   [ ] Enhance mobile UI for better responsiveness and gesture support.
*   [ ] Consider adding user-defined ports through environment variables.
*   [ ] Explore more robust error handling and logging.
*   [ ] Add basic input validation on the frontend (e.g., nickname length).
*   [ ] Add file upload progress indicator for large files.

---

## README.md (中文版)

# 内网聊天室

> 本项目完全由Google AI Studio中的Gemini 2.5 Pro开发，人类对其进行了测试和验证。

一个使用 Go 语言编写的、用于局域网的简易端到端加密聊天室。

## ✨ 主要亮点

*   **端到端加密**: 使用 RSA 加密保护私聊消息，确保只有发送者和接收者能阅读。
*   **点对点文件传输**: 文件通过服务器上传，然后由服务器作为中转递送给接收者。支持“秒传”（或“断点续传”）功能，即如果文件已被其他人上传过，则直接引用。
*   **文件去重与自动清理**: 上传的文件以其 SHA256 哈希值作为文件名存储。服务器会追踪文件的引用，当文件不再被任何用户引用或服务器正常退出时，文件会被自动删除。
*   **拖拽文件上传**: 可将文件直接拖拽到聊天界面任意位置进行上传。
*   **响应式设计**: 优化了桌面和移动端（特别测试了iPhone Safari兼容性）的体验。
*   **可配置端口**: 可通过命令行参数 (`--port`) 在任何所需端口上运行服务器。
*   **无服务器端存储**: 服务器不存储任何聊天记录或用户信息，注重隐私和简洁性。
*   **跨平台支持**: 可在 Windows, macOS, Linux 上运行。

## 🚀 如何开始

### 1. 前置条件

*   **Go 1.18+**: 确保您的系统已安装 Go。可从 [https://go.dev/dl/](https://go.dev/dl/) 下载。

### 2. 项目设置

1.  克隆仓库:
    ```bash
    git clone <your-repository-url>
    cd intranet-chatroom
    ```
2.  在项目根目录下创建一个 `static` 文件夹。
3.  下载所需的 JavaScript 库:
    *   `jsencrypt.min.js`: [https://github.com/travist/jsencrypt/blob/master/bin/jsencrypt.min.js](https://github.com/travist/jsencrypt/blob/master/bin/jsencrypt.min.js)
    *   `sha256.min.js`: [https://raw.githubusercontent.com/emn178/js-sha256/master/build/sha256.min.js](https://raw.githubusercontent.com/emn178/js-sha256/master/build/sha256.min.js)
4.  将这两个下载的 `.js` 文件放入 `static` 文件夹。

### 3. 构建与运行

1.  编译 Go 服务器:
    *   **Windows**:
        ```bash
        go build -o chat-server.exe .
        ```
    *   **Linux/macOS**:
        ```bash
        go build -o chat-server .
        ```
2.  运行服务器:
    *   **默认端口 (5000)**:
        *   Windows: `./chat-server.exe`
        *   Linux/macOS: `./chat-server`
    *   **自定义端口 (例如 3333)**:
        *   Windows: `./chat-server.exe --port 3333`
        *   Linux/macOS: `./chat-server --port 3333`

### 4. 访问聊天室

在同一局域网内的任何一台电脑上，打开浏览器访问：

`http://<服务器IP地址>:<端口>`

(例如：`http://192.168.1.100:5000`)

### 5. 使用说明

*   **昵称**: 首次访问时会自动分配一个随机昵称。您可以在侧边栏的输入框和按钮中修改它。
*   **聊天**:
    *   点击左侧边栏的用户名（或“群聊”）来选择聊天对象。
    *   在输入框中输入消息，按回车键或点击“发送”按钮。
    *   私聊消息是端到端加密的。群聊消息是明文传输。
*   **文件传输**:
    *   选择一个接收者（用户或群聊）。
    *   点击“📎”按钮或将文件拖拽到页面任意位置。
    *   服务器将处理文件的去重和自动清理。文件将以其原始文件名下载。
*   **复制消息**: 将鼠标悬停在聊天气泡上，会出现“复制”按钮。

## 💡 待办事项 (To-Do List)

*   [ ] 实现输入状态提示 (Typing indicators)。
*   [ ] 添加发送表情符号或其他富文本格式的功能。
*   [ ] 实现更明确的用户在线/离线状态指示。
*   [ ] 为私聊消息添加已读回执功能。
*   [ ] 进一步优化移动端UI，增加手势支持。
*   [ ] 考虑通过环境变量配置用户自定义端口。
*   [ ] 增强错误处理和日志记录机制。
*   [ ] 添加前端基础输入验证（例如昵称长度）。
*   [ ] 为大文件上传添加进度条。

# Screenshot / 截图

![demo](https://github.com/user-attachments/assets/0f871505-3e79-4df7-a7b6-c9c1d57b82d4)
