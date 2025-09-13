document.addEventListener("DOMContentLoaded", () => {
    // ... 其他DOM元素获取 ...
    const fileInput = document.getElementById("file-input");
    const fileBtn = document.getElementById("file-btn");
    const dropOverlay = document.getElementById("drop-overlay");
    const messagesDiv = document.getElementById("messages");
    const userListUl = document.getElementById("user-list");
    const nicknameInput = document.getElementById("nickname-input");
    const changeNicknameBtn = document.getElementById("change-nickname-btn");

    // 新增：移动端UI元素
    const sidebar = document.getElementById("sidebar");
    const menuBtn = document.getElementById("menu-btn");
    const closeSidebarBtn = document.getElementById("close-sidebar-btn");
    const chatWithTitle = document.getElementById("chat-with-title");

    let ws;
    let myNickname = "";
    let users = {};
    let selectedTarget = null;

    // --- 新增：兼容HTTP的复制文本函数 ---
    function copyTextToClipboard(text, buttonElement) {
        // 优先使用 navigator.clipboard (适用于HTTPS, localhost)
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard
                .writeText(text)
                .then(() => {
                    buttonElement.textContent = "已复制!";
                    setTimeout(() => {
                        buttonElement.textContent = "复制";
                    }, 2000);
                })
                .catch(err => {
                    console.error(
                        "Clipboard API failed, trying fallback:",
                        err
                    );
                    fallbackCopyText(text, buttonElement);
                });
        } else {
            // 回退到 document.execCommand (适用于HTTP)
            fallbackCopyText(text, buttonElement);
        }
    }

    function fallbackCopyText(text, buttonElement) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        // 样式设置，使其在屏幕外，不可见
        textArea.style.position = "fixed";
        textArea.style.top = 0;
        textArea.style.left = 0;
        textArea.style.width = "2em";
        textArea.style.height = "2em";
        textArea.style.padding = 0;
        textArea.style.border = "none";
        textArea.style.outline = "none";
        textArea.style.boxShadow = "none";
        textArea.style.background = "transparent";

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            const successful = document.execCommand("copy");
            if (successful) {
                buttonElement.textContent = "已复制!";
                setTimeout(() => {
                    buttonElement.textContent = "复制";
                }, 2000);
            } else {
                alert("复制失败！");
            }
        } catch (err) {
            console.error("Fallback copy failed:", err);
            alert("复制失败！");
        }
        document.body.removeChild(textArea);
    }

    // --- 修改：createMessageElement 使用新的复制函数 ---
    function createMessageElement(from, textContent, type, isGroup = false) {
        const messageElement = document.createElement("div");
        messageElement.classList.add("message", type);

        const info = document.createElement("div");
        info.className = "info";
        let fromText = from;
        if (isGroup && type === "received") {
            fromText += " (群聊)";
        }
        info.textContent = `${fromText} - ${new Date().toLocaleTimeString()}`;

        const content = document.createElement("div");
        content.className = "content";
        content.textContent = textContent;

        const copyBtn = document.createElement("button");
        copyBtn.className = "copy-btn";
        copyBtn.textContent = "复制";
        copyBtn.onclick = () => {
            copyTextToClipboard(textContent, copyBtn);
        };

        messageElement.appendChild(info);
        messageElement.appendChild(content);
        messageElement.appendChild(copyBtn);

        messagesDiv.appendChild(messageElement);
        scrollToBottom();
    }

    // --- 修改：selectTarget 更新移动端UI，并在选择后自动关闭侧边栏 ---
    function selectTarget(nickname) {
        selectedTarget = nickname;
        updateUserList();

        if (nickname) {
            messageInput.placeholder = `发送给 ${nickname} (私聊)...`;
            chatWithTitle.textContent = nickname;
        } else {
            messageInput.placeholder = `在群聊中发言...`;
            chatWithTitle.textContent = "群聊";
        }
        messageInput.focus();

        // 如果侧边栏是可见的（在移动端），选择后自动关闭它
        if (sidebar.classList.contains("visible")) {
            sidebar.classList.remove("visible");
        }
    }

    // --- 新增：移动端侧边栏的显示/隐藏事件 ---
    menuBtn.addEventListener("click", () => {
        sidebar.classList.add("visible");
    });

    closeSidebarBtn.addEventListener("click", () => {
        sidebar.classList.remove("visible");
    });

    // --- 以下代码保持原样，仅为完整性提供 ---
    const keySize = 1024;
    const crypt = new JSEncrypt({ default_key_size: keySize });
    const privateKey = crypt.getPrivateKey();
    const publicKey = crypt.getPublicKey();
    async function uploadFile(file) {
        /* ... 不变 ... */
        if (!file) return;
        addSystemMessage(`正在计算文件 "${file.name}" 的哈希值...`);
        try {
            const sha256sum = await calculateFileHash(file);
            addSystemMessage(`哈希计算完成。正在检查服务器...`);
            const toTarget = selectedTarget ? selectedTarget : "group";
            const checkUrl = `/check-file?sha256=${sha256sum}&filename=${encodeURIComponent(
                file.name
            )}&from=${encodeURIComponent(myNickname)}&to=${encodeURIComponent(
                toTarget
            )}`;
            const checkResponse = await fetch(checkUrl);
            const result = await checkResponse.json();
            if (result.exists) {
                addSystemMessage(
                    `文件 "${file.name}" 已秒传至 ${
                        toTarget === "group" ? "群聊" : toTarget
                    }。`
                );
                return;
            }
            addSystemMessage(`正在上传文件 "${file.name}"...`);
            const formData = new FormData();
            formData.append("file", file);
            formData.append("to", toTarget);
            formData.append("from", myNickname);
            formData.append("sha256", sha256sum);
            const uploadResponse = await fetch("/upload", {
                method: "POST",
                body: formData
            });
            if (uploadResponse.ok) {
                addSystemMessage(
                    `文件 "${file.name}" 已成功发送至 ${
                        toTarget === "group" ? "群聊" : toTarget
                    }。`
                );
            } else {
                const errorResult = await uploadResponse.json();
                throw new Error(errorResult.error || "上传失败");
            }
        } catch (error) {
            console.error("File transfer error:", error);
            alert("文件传输失败: " + error.message);
            addSystemMessage(`文件 "${file.name}" 传输失败。`);
        } finally {
            fileInput.value = "";
        }
    }
    fileInput.addEventListener("change", e => {
        const file = e.target.files[0];
        uploadFile(file);
    });
    let dragCounter = 0;
    window.addEventListener("dragenter", e => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter++;
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            dropOverlay.classList.add("visible");
        }
    });
    window.addEventListener("dragover", e => {
        e.preventDefault();
        e.stopPropagation();
    });
    window.addEventListener("dragleave", e => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter--;
        if (dragCounter === 0) {
            dropOverlay.classList.remove("visible");
        }
    });
    window.addEventListener("drop", e => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        dropOverlay.classList.remove("visible");
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            const file = files[0];
            uploadFile(file);
        }
    });
    function calculateFileHash(file) {
        /* ... 不变 ... */ return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
                const buffer = e.target.result;
                const hash = sha256(buffer);
                resolve(hash);
            };
            reader.onerror = e => {
                reject(e);
            };
            reader.readAsArrayBuffer(file);
        });
    }
    function handleServerMessage(msg) {
        /* ... 不变 ... */ switch (msg.type) {
            case "welcome":
                myNickname = msg.nickname;
                nicknameInput.value = myNickname;
                users = msg.users;
                selectTarget(null);
                addSystemMessage(`欢迎你, ${myNickname}！已连接到聊天室。`);
                setUIEnabled(true);
                break;
            case "userListUpdate":
                users = msg.users;
                if (selectedTarget && !users[selectedTarget]) {
                    selectTarget(null);
                }
                updateUserList();
                break;
            case "privateMessage":
                displayPrivateMessage(msg.from, msg.data, "received");
                break;
            case "groupMessage":
                createMessageElement(msg.from, msg.data, "received", true);
                break;
            case "nicknameChanged":
                if (msg.oldNickname === myNickname) {
                    myNickname = msg.newNickname;
                    addSystemMessage(`你的昵称已成功修改为: ${myNickname}`);
                }
                if (selectedTarget === msg.oldNickname) {
                    selectTarget(msg.newNickname);
                } else {
                    users = msg.users;
                    updateUserList();
                }
                break;
            case "nicknameError":
                alert(msg.data);
                nicknameInput.value = myNickname;
                break;
            case "fileNotification":
                const ext = msg.originalFilename.split(".").pop();
                const fileURL = `/download/${msg.sha256}.${ext}`;
                displayFileNotification(
                    msg.from,
                    msg.originalFilename,
                    fileURL
                );
                break;
            case "userJoined":
                // Don't show a notification for yourself
                if (msg.nickname !== myNickname) {
                    addSystemMessage(`👋 ${msg.nickname} 加入了聊天室。`);
                    // If we are in a private chat with this user, notify us they are back online
                    if (selectedTarget === msg.nickname) {
                        addSystemMessage(`🟢 ${msg.nickname} 现在在线。`);
                    }
                }
                break;

            case "userLeft":
                addSystemMessage(`👋 ${msg.nickname} 离开了聊天室。`);
                // If we are in a private chat with this user, notify us they went offline
                if (selectedTarget === msg.nickname) {
                    addSystemMessage(`🔴 ${msg.nickname} 已离线。`);
                }
                break;
        }
    }
    function setUIEnabled(enabled) {
        /* ... 不变 ... */ messageInput.disabled = !enabled;
        sendBtn.disabled = !enabled;
        nicknameInput.disabled = !enabled;
        changeNicknameBtn.disabled = !enabled;
        fileBtn.disabled = !enabled;
        fileBtn.style.display = enabled ? "inline-block" : "none";
        if (enabled) {
            messageInput.placeholder = "选择用户或群聊，开始聊天...";
        } else {
            messageInput.placeholder = "正在连接服务器...";
        }
    }
    function displayFileNotification(from, fileName, fileURL) {
        /* ... 不变 ... */ const messageElement = document.createElement("div");
        messageElement.classList.add("message", "received");
        const info = document.createElement("div");
        info.className = "info";
        info.textContent = `${from} - ${new Date().toLocaleTimeString()}`;
        messageElement.appendChild(info);
        const content = document.createElement("div");
        content.className = "content";
        content.innerHTML = `收到文件: <a href="${fileURL}" class="file-link" download="${fileName}">${fileName}</a>`;
        messageElement.appendChild(content);
        messagesDiv.appendChild(messageElement);
        scrollToBottom();
    }
    function initWebSocket() {
        /* ... 不变 ... */ const protocol =
            window.location.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
        ws.onopen = () => {
            console.log("WebSocket connected. Sending public key...");
            ws.send(JSON.stringify({ type: "publicKey", data: publicKey }));
        };
        ws.onmessage = event => {
            const msg = JSON.parse(event.data);
            handleServerMessage(msg);
        };
        ws.onclose = () => {
            console.log("WebSocket disconnected. Attempting to reconnect...");
            addSystemMessage("与服务器断开连接，正在尝试重连...");
            setUIEnabled(false);
            setTimeout(initWebSocket, 3000);
        };
        ws.onerror = error => {
            console.error("WebSocket error:", error);
            addSystemMessage("WebSocket 连接出错。");
            setUIEnabled(false);
            ws.close();
        };
    }
    function updateUserList() {
        /* ... 不变 ... */ userListUl.innerHTML = "";
        const groupLi = document.createElement("li");
        groupLi.textContent = "📢 群聊 (所有人)";
        groupLi.onclick = () => selectTarget(null);
        if (selectedTarget === null) {
            groupLi.classList.add("active");
        }
        userListUl.appendChild(groupLi);
        for (const nickname in users) {
            if (nickname !== myNickname) {
                const li = document.createElement("li");
                li.textContent = nickname;
                li.dataset.nickname = nickname;
                li.onclick = () => selectTarget(nickname);
                if (selectedTarget === nickname) {
                    li.classList.add("active");
                }
                userListUl.appendChild(li);
            }
        }
    }
    function addSystemMessage(message) {
        /* ... 不变 ... */ const messageElement = document.createElement("div");
        messageElement.className = "system-message";
        messageElement.textContent = message;
        messagesDiv.appendChild(messageElement);
        scrollToBottom();
    }
    function displayPrivateMessage(from, encryptedData, type) {
        /* ... 不变 ... */ let content = "";
        try {
            content = crypt.decrypt(encryptedData);
            if (!content) {
                throw new Error("Decryption failed");
            }
        } catch (e) {
            console.error("Decryption error:", e);
            content = "!! 消息解密失败 !!";
        }
        createMessageElement(from, content, type, false);
    }
    function sendMessage() {
        /* ... 不变 ... */ const text = messageInput.value.trim();
        if (!text) return;
        if (selectedTarget) {
            if (users[selectedTarget]) {
                const recipientPublicKey = users[selectedTarget];
                const encryptor = new JSEncrypt();
                encryptor.setPublicKey(recipientPublicKey);
                const encrypted = encryptor.encrypt(text);
                if (encrypted) {
                    ws.send(
                        JSON.stringify({
                            type: "privateMessage",
                            to: selectedTarget,
                            data: encrypted
                        })
                    );
                    createMessageElement(myNickname, text, "sent", false);
                    messageInput.value = "";
                } else {
                    alert("消息加密失败！");
                }
            }
        } else {
            ws.send(JSON.stringify({ type: "groupMessage", data: text }));
            createMessageElement(myNickname, text, "sent", true);
            messageInput.value = "";
        }
    }
    fileBtn.addEventListener("click", () => fileInput.click());
    const sendBtn = document.getElementById("send-btn");
    sendBtn.addEventListener("click", sendMessage);
    const messageInput = document.getElementById("message-input");
    messageInput.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    messageInput.addEventListener("input", () => {
        messageInput.style.height = "auto";
        messageInput.style.height = messageInput.scrollHeight + "px";
    });
    changeNicknameBtn.addEventListener("click", () => {
        const newNickname = nicknameInput.value.trim();
        if (newNickname && newNickname !== myNickname) {
            ws.send(
                JSON.stringify({ type: "changeNickname", data: newNickname })
            );
        }
    });
    setUIEnabled(false);
    initWebSocket();
});
function scrollToBottom() {
    const messagesDiv = document.getElementById("messages");
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
