document.addEventListener("DOMContentLoaded", () => {
    // --- DOM元素获取 (保持不变) ---
    const messageInput = document.getElementById("message-input");
    const sendBtn = document.getElementById("send-btn");
    const messagesDiv = document.getElementById("messages");
    const userListUl = document.getElementById("user-list");
    const nicknameInput = document.getElementById("nickname-input");
    const changeNicknameBtn = document.getElementById("change-nickname-btn");
    const fileInput = document.getElementById("file-input");
    const fileBtn = document.getElementById("file-btn");
    const dropOverlay = document.getElementById("drop-overlay");
    const sidebar = document.getElementById("sidebar");
    const menuBtn = document.getElementById("menu-btn");
    const closeSidebarBtn = document.getElementById("close-sidebar-btn");
    const chatWithTitle = document.getElementById("chat-with-title");

    let ws;
    let myNickname = "";
    let users = {};
    let selectedTarget = null;

    let messageStore = {}; // 格式: { 'chatId': [messageObject1, ...] }
    let unreadCounts = {}; // 格式: { 'chatId': count }

    // --- NEW HELPER CLASS 1: A TransformStream for AES-CTR encryption ---
    class EncryptionTransformer {
        constructor(key, iv) {
            this.key = CryptoJS.enc.Hex.parse(key);
            this.iv = CryptoJS.enc.Hex.parse(iv);
            this.cipher = CryptoJS.algo.AES.createEncryptor(this.key, {
                iv: this.iv,
                mode: CryptoJS.mode.CTR,
                padding: CryptoJS.pad.NoPadding
            });
        }

        transform(chunk, controller) {
            // Convert Uint8Array chunk to WordArray
            const wordArray = CryptoJS.lib.WordArray.create(chunk);
            // Encrypt the chunk
            const encrypted = this.cipher.process(wordArray);
            // Convert back to Uint8Array and enqueue
            if (encrypted.sigBytes > 0) {
                controller.enqueue(wordArrayToUint8Array(encrypted));
            }
        }

        flush(controller) {
            const final = this.cipher.finalize();
            if (final.sigBytes > 0) {
                controller.enqueue(wordArrayToUint8Array(final));
            }
        }
    }

    // --- NEW HELPER CLASS 2: A TransformStream for AES-CTR decryption ---
    class DecryptionTransformer {
        constructor(key, iv) {
            this.key = CryptoJS.enc.Hex.parse(key);
            this.iv = CryptoJS.enc.Hex.parse(iv);
            this.cipher = CryptoJS.algo.AES.createDecryptor(this.key, {
                iv: this.iv,
                mode: CryptoJS.mode.CTR,
                padding: CryptoJS.pad.NoPadding
            });
        }
        transform(chunk, controller) {
            const wordArray = CryptoJS.lib.WordArray.create(chunk);
            const decrypted = this.cipher.process(wordArray);
            if (decrypted.sigBytes > 0) {
                controller.enqueue(wordArrayToUint8Array(decrypted));
            }
        }
        flush(controller) {
            const final = this.cipher.finalize();
            if (final.sigBytes > 0) {
                controller.enqueue(wordArrayToUint8Array(final));
            }
        }
    }

    // --- 新增：创建并返回一个上传进度条的DOM元素 ---
    function createProgressIndicator(file) {
        const container = document.createElement("div");
        container.className = "system-message progress-container"; // 使用 system-message 以保持间距

        const textElement = document.createElement("span");
        textElement.className = "progress-text";
        textElement.textContent = `[准备中] "${file.name}"...`;

        const bar = document.createElement("div");
        bar.className = "progress-bar";

        const fillElement = document.createElement("div");
        fillElement.className = "progress-bar-fill";

        bar.appendChild(fillElement);
        container.appendChild(textElement);
        container.appendChild(bar);

        messagesDiv.appendChild(container);
        scrollToBottom();

        // 返回需要被更新的元素，方便后续操作
        return { container, textElement, fillElement };
    }

    // --- NEW HELPER FUNCTION: Converts a CryptoJS WordArray to a Uint8Array ---
    function wordArrayToUint8Array(wordArray) {
        const l = wordArray.sigBytes;
        const words = wordArray.words;
        const result = new Uint8Array(l);
        var i = 0,
            j = 0;
        while (i < l) {
            var w = words[j++];
            result[i++] = (w >> 24) & 0xff;
            if (i < l) result[i++] = (w >> 16) & 0xff;
            if (i < l) result[i++] = (w >> 8) & 0xff;
            if (i < l) result[i++] = w & 0xff;
        }
        return result;
    }
    // --- NEW HELPER 1: Basic UUID generator ---
    function generateUUID() {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
            /[xy]/g,
            function (c) {
                var r = (Math.random() * 16) | 0,
                    v = c == "x" ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            }
        );
    }

    // --- NEW HELPER 2: Get or create Client ID from sessionStorage ---
    function getClientID() {
        let clientID = sessionStorage.getItem("chat-clientID");
        if (!clientID) {
            clientID = generateUUID();
            sessionStorage.setItem("chat-clientID", clientID);
        }
        return clientID;
    }

    // --- NEW HELPER: Converts a Base64 data URL to a Blob ---
    function dataURLtoBlob(dataurl) {
        var arr = dataurl.split(","),
            mime = arr[0].match(/:(.*?);/)[1],
            bstr = atob(arr[1]),
            n = bstr.length,
            u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    }
    function storeAndDisplayMessage(chatId, messageObject, isReceived = false) {
        // 如果不存在，则初始化存储空间
        if (!messageStore[chatId]) {
            messageStore[chatId] = [];
        }
        if (!unreadCounts[chatId]) {
            unreadCounts[chatId] = 0;
        }

        // --- 核心修改：系统消息加上时间戳 ---
        if (messageObject.subType === "system" && !messageObject.timestamp) {
            messageObject.timestamp = new Date().toLocaleString(); // 例如 "2023/10/26 下午3:30:00"
        }

        messageStore[chatId].push(messageObject);

        const currentChatId =
            selectedTarget === null ? "group" : selectedTarget;

        if (chatId === currentChatId) {
            // 如果消息属于当前激活的聊天，立即渲染出来
            renderMessage(messageObject);
            scrollToBottom();
        } else if (isReceived) {
            // 如果是收到的、非当前激活聊天的消息，增加未读计数
            // 系统消息不计入未读角标
            if (messageObject.subType !== "system") {
                unreadCounts[chatId]++;
            }
            updateUserList(); // 更新用户列表以显示/更新未读角标
        }
    }

    // --- REPLACED: renderMessage to pass the correct objects to displayFileNotification ---
    function renderMessage(msg) {
        switch (msg.subType) {
            case "privateMessage":
                createMessageElement(msg.from, msg.data, msg.type, false);
                break;
            case "groupMessage":
                createMessageElement(msg.from, msg.data, msg.type, true);
                break;
            case "system":
                addSystemMessage(msg.data, msg.timestamp);
                break;
            case "file":
                // Pass the original filename from the now-decrypted fileInfo
                displayFileNotification(
                    msg.from,
                    msg.fileInfo.originalFilename,
                    msg.fileInfo,
                    msg.isSent
                );
                break;
        }
    }

    // --- REPLACED: handleFiles now creates a progress bar for each file ---
    async function handleFiles(fileList) {
        if (!fileList || fileList.length === 0) return;

        // 不再显示 "准备上传 X 个文件..."
        for (const file of fileList) {
            // 1. 为每个文件创建一个可视化的进度条
            const progressIndicator = createProgressIndicator(file);
            // 2. 将文件和它的进度条一起传递给上传函数
            // 使用 await 确保文件一个接一个地上传
            await uploadFile(file, progressIndicator);
        }
        // 不再显示 "所有文件上传任务已处理完毕。"
    }

    // --- REPLACED: uploadFile now encrypts all file metadata ---
    async function uploadFile(file, progressIndicator) {
        if (!file || !progressIndicator) return;

        const CHUNK_SIZE = 5 * 1024 * 1024;
        let uuid = "";

        try {
            progressIndicator.textElement.textContent = `[正在初始化上传...] "${file.name}"`;
            const startResponse = await fetch("/upload/start", {
                method: "POST"
            });
            if (!startResponse.ok) throw new Error("无法初始化上传。");
            const startResult = await startResponse.json();
            uuid = startResult.uuid;

            // Generate the key/IV for the FILE CONTENT
            const fileKey = CryptoJS.lib.WordArray.random(256 / 8).toString(
                CryptoJS.enc.Hex
            );
            const fileIV = CryptoJS.lib.WordArray.random(128 / 8).toString(
                CryptoJS.enc.Hex
            );
            const cipher = CryptoJS.algo.AES.createEncryptor(
                CryptoJS.enc.Hex.parse(fileKey),
                {
                    iv: CryptoJS.enc.Hex.parse(fileIV),
                    mode: CryptoJS.mode.CTR,
                    padding: CryptoJS.pad.NoPadding
                }
            );

            // Upload loop (unchanged)
            for (let start = 0; start < file.size; start += CHUNK_SIZE) {
                const chunk = file.slice(start, start + CHUNK_SIZE);
                const chunkBuffer = await chunk.arrayBuffer();
                const wordArray = CryptoJS.lib.WordArray.create(chunkBuffer);
                const encryptedChunk = cipher.process(wordArray);
                const encryptedBlob = new Blob([
                    wordArrayToUint8Array(encryptedChunk)
                ]);
                const chunkResponse = await fetch(
                    `/upload/chunk?uuid=${uuid}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/octet-stream" },
                        body: encryptedBlob
                    }
                );
                if (!chunkResponse.ok)
                    throw new Error(
                        `分片 ${start / CHUNK_SIZE + 1} 上传失败。`
                    );
                const progress = Math.round(
                    ((start + chunk.size) / file.size) * 100
                );
                progressIndicator.textElement.textContent = `[上传中 ${progress}%] "${file.name}"`;
                progressIndicator.fillElement.style.width = `${progress}%`;
            }
            const finalEncrypted = cipher.finalize();
            if (finalEncrypted.sigBytes > 0) {
                await fetch(`/upload/chunk?uuid=${uuid}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/octet-stream" },
                    body: new Blob([wordArrayToUint8Array(finalEncrypted)])
                });
            }
            const finishResponse = await fetch("/upload/finish", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ uuid: uuid })
            });
            if (!finishResponse.ok) throw new Error("无法完成文件上传。");

            // --- CORE FIX: Encrypt the metadata payload ---
            // 1. Create the plaintext metadata object, including the file's key and IV
            const plaintextMetadata = JSON.stringify({
                uuid: uuid,
                originalFilename: file.name,
                fileKey: fileKey,
                fileIV: fileIV
            });

            // 2. Encrypt this metadata object just like a text message
            const metaKey = CryptoJS.lib.WordArray.random(128 / 8).toString();
            const encryptedData = CryptoJS.AES.encrypt(
                plaintextMetadata,
                metaKey
            ).toString();

            let encryptedPayload;
            const toTarget = selectedTarget ? selectedTarget : "group";
            const encryptor = new JSEncrypt();

            if (toTarget === "group") {
                const encryptedKeys = {};
                for (const nickname in users) {
                    encryptor.setPublicKey(users[nickname]);
                    encryptedKeys[nickname] = encryptor.encrypt(metaKey);
                }
                encryptedPayload = { encryptedData, encryptedKeys };
            } else {
                encryptor.setPublicKey(users[toTarget]);
                const encryptedKey = encryptor.encrypt(metaKey);
                encryptedPayload = { encryptedData, encryptedKey };
            }

            // 3. Send the WebSocket message with the encrypted payload
            ws.send(
                JSON.stringify({
                    type: "fileShare",
                    to: toTarget,
                    uuid: uuid, // Plaintext UUID for server-side tracking
                    data: JSON.stringify(encryptedPayload) // Fully encrypted metadata
                })
            );

            progressIndicator.textElement.textContent = `[成功] "${file.name}" 已发送。`;
            progressIndicator.fillElement.classList.add("success");
        } catch (error) {
            console.error(`File transfer error for ${file.name}:`, error);
            progressIndicator.textElement.textContent = `[失败] "${file.name}" 传输失败: ${error.message}`;
            progressIndicator.fillElement.classList.add("error");
        } finally {
            fileInput.value = "";
        }
    }
    // --- 核心修改 2：递归扫描文件夹的函数 ---
    // 这是处理拖拽文件夹的核心，它会遍历所有子目录
    async function traverseDirectoryTree(item) {
        let files = [];
        if (item.isDirectory) {
            const directoryReader = item.createReader();
            const entries = await new Promise((resolve, reject) => {
                directoryReader.readEntries(resolve, reject);
            });
            for (const entry of entries) {
                const nestedFiles = await traverseDirectoryTree(entry);
                files = files.concat(nestedFiles);
            }
        } else if (item.isFile) {
            const file = await new Promise((resolve, reject) =>
                item.file(resolve, reject)
            );
            if (file) {
                files.push(file);
            }
        }
        return files;
    }

    // --- 核心修改 3：更新事件监听器 ---

    // fileInput 的 'change' 事件现在处理多个文件
    fileInput.addEventListener("change", e => {
        // --- 核心修复：将“实时”的FileList转换为“静态”的Array ---
        // 这样，在循环内部清空fileInput时，就不会影响到我们正在遍历的列表。
        const filesToUpload = Array.from(e.target.files);
        handleFiles(filesToUpload);
    });

    // 'drop' 事件现在可以处理多个文件和文件夹
    window.addEventListener("drop", async e => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        dropOverlay.classList.remove("visible");

        const items = e.dataTransfer.items;
        if (items && items.length > 0) {
            let allFiles = [];
            // 使用 Promise.all 来等待所有文件/文件夹都被扫描完毕
            const scanningPromises = [];

            for (const item of items) {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    scanningPromises.push(
                        traverseDirectoryTree(entry).then(files => {
                            allFiles = allFiles.concat(files);
                        })
                    );
                }
            }
            await Promise.all(scanningPromises);
            handleFiles(allFiles);
        }
    });

    // --- 拖拽相关的其他监听器 (保持不变) ---
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

    function calculateFileHash(file) {
        return new Promise((resolve, reject) => {
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
    function copyTextToClipboard(text, buttonElement) {
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
            fallbackCopyText(text, buttonElement);
        }
    }
    function fallbackCopyText(text, buttonElement) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
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
    function selectTarget(nickname) {
        selectedTarget = nickname;
        const chatId = nickname === null ? "group" : nickname;

        // 1. 清空当前消息显示区
        messagesDiv.innerHTML = "";

        // 2. 从内存中加载并渲染对应聊天的历史消息
        const history = messageStore[chatId] || [];
        history.forEach(renderMessage);
        scrollToBottom(); // 渲染后滚动到底部

        // 3. 将此聊天的未读消息数清零
        unreadCounts[chatId] = 0;

        // 4. 更新用户列表（激活状态和移除未读角标）
        updateUserList();

        // 5. 更新UI提示信息
        if (nickname) {
            messageInput.placeholder = `发送给 ${nickname} (私聊)...`;
            chatWithTitle.textContent = nickname;
        } else {
            messageInput.placeholder = `在群聊中发言...`;
            chatWithTitle.textContent = "群聊";
        }
        messageInput.focus();
        if (sidebar.classList.contains("visible")) {
            sidebar.classList.remove("visible");
        }
    }
    menuBtn.addEventListener("click", () => {
        sidebar.classList.add("visible");
    });
    closeSidebarBtn.addEventListener("click", () => {
        sidebar.classList.remove("visible");
    });
    const keySize = 1024;
    const crypt = new JSEncrypt({ default_key_size: keySize });

    // --- 新增：初始化加密模块，加载或生成并存储私钥 ---
    function initializeCrypto() {
        let privateKey = sessionStorage.getItem("chat-privateKey");
        if (privateKey) {
            // 如果存在，则从 sessionStorage 加载私钥
            crypt.setPrivateKey(privateKey);
            console.log("Loaded existing private key from sessionStorage.");
        } else {
            // 如果不存在，则生成新密钥并存储私钥
            // getPrivateKey() 会在需要时触发密钥生成
            privateKey = crypt.getPrivateKey();
            sessionStorage.setItem("chat-privateKey", privateKey);
            console.log(
                "Generated and saved new private key to sessionStorage."
            );
        }
    }

    initializeCrypto(); // 页面加载时立即执行

    // getPublicKey() 必须在 setPrivateKey 或 getPrivateKey 之后调用
    const publicKey = crypt.getPublicKey();

    function handleServerMessage(msg) {
        switch (msg.type) {
            // ... 'welcome', 'userListUpdate', 'privateMessage', 'groupMessage' cases are IDENTICAL and correct ...
            case "welcome":
                const wasAlreadyConnected = myNickname !== "";
                myNickname = msg.nickname;
                sessionStorage.setItem("chat-nickname", myNickname);
                nicknameInput.value = myNickname;
                users = msg.users;
                setUIEnabled(true);
                if (!wasAlreadyConnected) {
                    messageStore["group"] = [];
                    unreadCounts["group"] = 0;
                    storeAndDisplayMessage(
                        "group",
                        {
                            subType: "system",
                            data: `欢迎你, ${myNickname}！已连接到聊天室。`
                        },
                        false
                    );
                    selectTarget(null);
                } else {
                    const currentChatId =
                        selectedTarget === null ? "group" : selectedTarget;
                    storeAndDisplayMessage(
                        currentChatId,
                        { subType: "system", data: `✅ 已重新连接到聊天室。` },
                        false
                    );
                    updateUserList();
                }
                break;
            case "userListUpdate":
                users = msg.users;
                updateUserList();
                break;
            case "privateMessage":
                try {
                    const payload = JSON.parse(msg.data);
                    const decryptedSymmetricKey = crypt.decrypt(
                        payload.encryptedKey
                    );
                    if (!decryptedSymmetricKey)
                        throw new Error("Failed to decrypt symmetric key.");
                    const bytes = CryptoJS.AES.decrypt(
                        payload.encryptedData,
                        decryptedSymmetricKey
                    );
                    const plainContent = bytes.toString(CryptoJS.enc.Utf8);
                    if (!plainContent)
                        throw new Error(
                            "AES decryption resulted in empty content."
                        );
                    storeAndDisplayMessage(
                        msg.from,
                        {
                            subType: "privateMessage",
                            type: "received",
                            from: msg.from,
                            data: plainContent
                        },
                        true
                    );
                } catch (e) {
                    console.error("Private message handling error:", e);
                    storeAndDisplayMessage(
                        msg.from,
                        {
                            subType: "privateMessage",
                            type: "received",
                            from: msg.from,
                            data: "!! 消息解密失败 !!"
                        },
                        true
                    );
                }
                break;
            case "groupMessage":
                try {
                    const payload = JSON.parse(msg.data);
                    const myEncryptedKey = payload.encryptedKeys[myNickname];
                    if (!myEncryptedKey)
                        throw new Error(
                            "No encrypted key found for me in this group message."
                        );
                    const decryptedSymmetricKey = crypt.decrypt(myEncryptedKey);
                    if (!decryptedSymmetricKey)
                        throw new Error(
                            "Failed to decrypt symmetric key for group message."
                        );
                    const bytes = CryptoJS.AES.decrypt(
                        payload.encryptedData,
                        decryptedSymmetricKey
                    );
                    const plainContent = bytes.toString(CryptoJS.enc.Utf8);
                    if (!plainContent)
                        throw new Error(
                            "AES decryption resulted in empty content."
                        );
                    storeAndDisplayMessage(
                        "group",
                        {
                            subType: "groupMessage",
                            type: "received",
                            from: msg.from,
                            data: plainContent
                        },
                        true
                    );
                } catch (e) {
                    console.error("Group message handling error:", e);
                }
                break;

            case "fileShare": {
                try {
                    // 1. Decrypt the metadata payload, just like a text message
                    const encryptedPayload = JSON.parse(msg.data);
                    let metaKey;
                    if (encryptedPayload.encryptedKey) {
                        // Private share
                        metaKey = crypt.decrypt(encryptedPayload.encryptedKey);
                    } else {
                        // Group share
                        metaKey = crypt.decrypt(
                            encryptedPayload.encryptedKeys[myNickname]
                        );
                    }
                    if (!metaKey) throw new Error("无法解密文件元数据密钥。");

                    const plaintextMetadata = CryptoJS.AES.decrypt(
                        encryptedPayload.encryptedData,
                        metaKey
                    ).toString(CryptoJS.enc.Utf8);
                    const fileInfo = JSON.parse(plaintextMetadata);

                    // 2. Determine chatId and store the notification
                    const isSent = msg.from === myNickname;
                    let chatId;
                    if (msg.to === "group") {
                        chatId = "group";
                    } else {
                        chatId = isSent ? msg.to : msg.from;
                    }

                    storeAndDisplayMessage(
                        chatId,
                        {
                            subType: "file",
                            from: msg.from,
                            // Pass the fully decrypted fileInfo object
                            fileInfo: fileInfo,
                            isSent: isSent
                        },
                        !isSent
                    );
                } catch (e) {
                    console.error("Failed to handle fileShare message:", e);
                }
                break;
            }

            case "userJoined":
                if (msg.nickname !== myNickname) {
                    storeAndDisplayMessage(
                        "group",
                        {
                            subType: "system",
                            data: `👋 ${msg.nickname} 加入了聊天室。`
                        },
                        true
                    );
                    storeAndDisplayMessage(
                        msg.nickname,
                        {
                            subType: "system",
                            data: `🟢 ${msg.nickname} 现在在线。`
                        },
                        true
                    );
                }
                break;
            case "userLeft":
                storeAndDisplayMessage(
                    "group",
                    {
                        subType: "system",
                        data: `👋 ${msg.nickname} 离开了聊天室。`
                    },
                    true
                );
                storeAndDisplayMessage(
                    msg.nickname,
                    { subType: "system", data: `🔴 ${msg.nickname} 已离线。` },
                    true
                );
                break;
            case "nicknameChanged":
                users = msg.users;
                if (msg.oldNickname === myNickname) {
                    myNickname = msg.newNickname;
                    sessionStorage.setItem("chat-nickname", myNickname);
                }
                const systemMessage = `👤 '${msg.oldNickname}' 已将昵称修改为 '${msg.newNickname}'.`;
                storeAndDisplayMessage(
                    "group",
                    { subType: "system", data: systemMessage },
                    true
                );
                if (messageStore[msg.oldNickname]) {
                    storeAndDisplayMessage(
                        msg.oldNickname,
                        { subType: "system", data: systemMessage },
                        true
                    );
                }
                if (messageStore[msg.oldNickname]) {
                    messageStore[msg.newNickname] =
                        messageStore[msg.oldNickname];
                    delete messageStore[msg.oldNickname];
                }
                if (unreadCounts[msg.oldNickname]) {
                    unreadCounts[msg.newNickname] =
                        unreadCounts[msg.oldNickname];
                    delete unreadCounts[msg.oldNickname];
                }
                if (selectedTarget === msg.oldNickname) {
                    selectTarget(msg.newNickname);
                } else {
                    updateUserList();
                }
                break;
            case "nicknameError":
                alert(msg.data);
                nicknameInput.value = myNickname;
                break;
        }
    }

    function setUIEnabled(enabled) {
        messageInput.disabled = !enabled;
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

    // --- REPLACED: displayFileNotification to use the decrypted key/IV from fileInfo ---
    function displayFileNotification(from, fileName, fileInfo, isSent) {
        const messageElement = document.createElement("div");
        messageElement.classList.add("message", isSent ? "sent" : "received");
        const info = document.createElement("div");
        info.className = "info";
        info.textContent = `${from} - ${new Date().toLocaleTimeString()}`;
        messageElement.appendChild(info);
        const content = document.createElement("div");
        content.className = "content";
        const downloadLink = document.createElement("a");
        downloadLink.href = "#";
        downloadLink.className = "file-link";
        downloadLink.textContent = `📄 ${fileName}`;

        downloadLink.onclick = async e => {
            e.preventDefault();
            downloadLink.textContent = `[准备下载...]`;
            try {
                // --- CORE FIX: Use the key and IV directly from the decrypted fileInfo object ---
                const keyPayload = {
                    key: fileInfo.fileKey,
                    iv: fileInfo.fileIV
                };

                const response = await fetch(`/download/${fileInfo.uuid}`);
                if (!response.ok) throw new Error("下载加密文件失败。");

                const decryptionStream = new TransformStream(
                    new DecryptionTransformer(keyPayload.key, keyPayload.iv)
                );
                const fileStream = streamSaver.createWriteStream(fileName);
                await response.body
                    .pipeThrough(decryptionStream)
                    .pipeTo(fileStream);
                downloadLink.textContent = `[下载完成] ${fileName}`;
            } catch (err) {
                console.error("File decryption/download failed:", err);
                downloadLink.textContent = `[下载失败] ${fileName}`;
                alert(err.message);
            }
        };

        const label = isSent ? "已发送文件: " : "收到文件: ";
        content.innerHTML = label;
        content.appendChild(downloadLink);
        messageElement.appendChild(content);
        messagesDiv.appendChild(messageElement);
        scrollToBottom();
    }
    // --- REPLACED: initWebSocket now sends the Client ID ---
    function initWebSocket() {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

        ws.onopen = () => {
            console.log("WebSocket connected. Sending registration info...");
            const storedNickname = sessionStorage.getItem("chat-nickname");
            const clientID = getClientID(); // Get the persistent client ID

            ws.send(
                JSON.stringify({
                    type: "register",
                    clientID: clientID, // Send the client ID
                    publicKey: publicKey,
                    proposedNickname: storedNickname || ""
                })
            );
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
        userListUl.innerHTML = "";

        // --- 群聊项 ---
        const groupLi = document.createElement("li");
        const groupTextSpan = document.createElement("span");
        groupTextSpan.textContent = "📢 群聊 (所有人)";
        groupLi.appendChild(groupTextSpan);
        groupLi.onclick = () => selectTarget(null);

        if (selectedTarget === null) {
            groupLi.classList.add("active");
        }
        const groupUnread = unreadCounts["group"] || 0;
        if (groupUnread > 0) {
            const badge = document.createElement("span");
            badge.className = "unread-badge";
            badge.textContent = groupUnread;
            groupLi.appendChild(badge);
        }
        userListUl.appendChild(groupLi);

        // --- 用户列表项 ---
        // 收集所有需要显示的用户：当前在线的和有聊天记录的
        const allDisplayUsers = new Set();
        for (const nickname in users) {
            // 添加当前在线用户
            if (nickname !== myNickname) {
                allDisplayUsers.add(nickname);
            }
        }
        for (const chatId in messageStore) {
            // 添加有聊天记录的用户
            if (chatId !== "group" && chatId !== myNickname) {
                allDisplayUsers.add(chatId);
            }
        }

        // 排序用户列表
        const sortedDisplayUsers = Array.from(allDisplayUsers).sort((a, b) =>
            a.localeCompare(b)
        );

        for (const nickname of sortedDisplayUsers) {
            const li = document.createElement("li");

            // --- 核心修改：将状态指示器和用户名包裹在一个 div 中 ---
            const userInfoWrapper = document.createElement("div");
            userInfoWrapper.style.display = "flex"; // 使指示器和用户名在一行
            userInfoWrapper.style.alignItems = "center"; // 垂直居中

            const statusIndicator = document.createElement("span");
            statusIndicator.className = "status-indicator";

            const userTextSpan = document.createElement("span");
            userTextSpan.textContent = nickname;

            if (users[nickname]) {
                // 如果该昵称存在于 'users' 映射中，表示在线
                statusIndicator.textContent = "🟢"; // 在线
            } else {
                statusIndicator.textContent = "🔴"; // 离线
            }

            userInfoWrapper.appendChild(statusIndicator);
            userInfoWrapper.appendChild(userTextSpan);
            li.appendChild(userInfoWrapper); // 将包裹元素添加到 li 中

            li.dataset.nickname = nickname;
            li.onclick = () => selectTarget(nickname);

            if (selectedTarget === nickname) {
                li.classList.add("active");
            }
            const userUnread = unreadCounts[nickname] || 0;
            if (userUnread > 0) {
                const badge = document.createElement("span");
                badge.className = "unread-badge";
                badge.textContent = userUnread;
                li.appendChild(badge); // 未读角标作为 li 的另一个直接子元素
            }
            userListUl.appendChild(li);
        }
    }
    function addSystemMessage(message, timestamp = null) {
        const messageElement = document.createElement("div");
        messageElement.className = "system-message";
        // 如果有时间戳，就显示在消息前面
        messageElement.textContent = timestamp
            ? `[${timestamp}] ${message}`
            : message;
        messagesDiv.appendChild(messageElement);
        scrollToBottom();
    }
    function sendMessage() {
        const text = messageInput.value.trim();
        if (!text) return;

        // 1. Generate a single random symmetric key for this message
        const symmetricKey = CryptoJS.lib.WordArray.random(128 / 8).toString();
        // 2. Encrypt the message content once with the symmetric key
        const encryptedData = CryptoJS.AES.encrypt(
            text,
            symmetricKey
        ).toString();

        if (selectedTarget) {
            // --- Sending a Private Message ---
            if (users[selectedTarget]) {
                const recipientPublicKey = users[selectedTarget];
                const encryptor = new JSEncrypt();
                encryptor.setPublicKey(recipientPublicKey);

                // 3a. Encrypt the symmetric key for the single recipient
                const encryptedKey = encryptor.encrypt(symmetricKey);

                if (encryptedKey) {
                    const payload = {
                        encryptedData: encryptedData,
                        encryptedKey: encryptedKey // A single key for private chat
                    };
                    ws.send(
                        JSON.stringify({
                            type: "privateMessage",
                            to: selectedTarget,
                            data: JSON.stringify(payload)
                        })
                    );
                    storeAndDisplayMessage(selectedTarget, {
                        subType: "privateMessage",
                        type: "sent",
                        from: myNickname,
                        data: text
                    });
                    messageInput.value = "";
                } else {
                    alert("消息加密失败！无法加密会话密钥。");
                }
            }
        } else {
            // --- Sending a Group Message ---
            const encryptedKeys = {};
            const encryptor = new JSEncrypt();

            // 3b. Encrypt the symmetric key for every user in the chat, including myself
            for (const nickname in users) {
                const publicKey = users[nickname];
                encryptor.setPublicKey(publicKey);
                const encryptedKeyForUser = encryptor.encrypt(symmetricKey);
                if (encryptedKeyForUser) {
                    encryptedKeys[nickname] = encryptedKeyForUser;
                }
            }

            // Ensure we have at least one key successfully encrypted
            if (Object.keys(encryptedKeys).length > 0) {
                const payload = {
                    encryptedData: encryptedData,
                    encryptedKeys: encryptedKeys // An object of keys for group chat
                };
                ws.send(
                    JSON.stringify({
                        type: "groupMessage",
                        data: JSON.stringify(payload)
                    })
                );
                storeAndDisplayMessage("group", {
                    subType: "groupMessage",
                    type: "sent",
                    from: myNickname,
                    data: text
                });
                messageInput.value = "";
            } else {
                alert("群消息加密失败！没有找到可用的接收者公钥。");
            }
        }
    }
    fileBtn.addEventListener("click", () => fileInput.click());
    sendBtn.addEventListener("click", sendMessage);
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

    function requestNicknameChange() {
        const newNickname = nicknameInput.value.trim();
        if (newNickname && newNickname !== myNickname) {
            ws.send(
                JSON.stringify({ type: "changeNickname", data: newNickname })
            );
        }
    }

    changeNicknameBtn.addEventListener("click", requestNicknameChange);

    // --- 新增：在昵称输入框中按下 Enter 键 ---
    nicknameInput.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            e.preventDefault(); // 防止触发表单提交等默认行为
            requestNicknameChange();
        }
    });

    setUIEnabled(false);
    initWebSocket();
});
function scrollToBottom() {
    const messagesDiv = document.getElementById("messages");
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
