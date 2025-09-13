package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	groupRecipient = "group"
	// 为 websocket 写入设置超时
	writeWait = 10 * time.Second
)

// --- 修改 Client 结构体，增加一个专属的 channel ---
type Client struct {
	conn      *websocket.Conn
	nickname  string
	publicKey string
	// Buffered channel of outbound messages.
	send chan []byte
}

// ... 其他结构体不变 ...
type FileReference struct {
	Sender    string
	Recipient string
}
type FileInfo struct {
	OriginalFilename string
	Path             string
	References       []*FileReference
}
type Message struct {
	Type string `json:"type"`
	To   string `json:"to,omitempty"`
	From string `json:"from,omitempty"`
	Data string `json:"data,omitempty"`
}

var (
	clients      = make(map[*Client]bool)
	nicknames    = make(map[string]*Client)
	fileRegistry = make(map[string]*FileInfo)
	mutex        = &sync.Mutex{}
	upgrader     = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
)

// --- 新增：每个客户端专属的写入协程 (Write Pump) ---
// writePump pumps messages from the hub to the websocket connection.
func (c *Client) writePump() {
	// 确保在协程退出时关闭连接
	defer func() {
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			// 设置写入超时
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The channel was closed.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			err := c.conn.WriteMessage(websocket.TextMessage, message)
			if err != nil {
				// 如果写入失败，尝试关闭连接，并从循环退出
				log.Printf("Error writing message to client %s: %v", c.nickname, err)
				return
			}
		}
	}
}

// --- 新增：每个客户端专属的读取协程 (Read Pump) ---
// readPump pumps messages from the websocket connection to the hub.
func (c *Client) readPump() {
	// 确保在协程退出时注销客户端并关闭其发送通道
	defer func() {
		unregisterClient(c)
		close(c.send)
	}()

	for {
		_, msgBytes, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("Client disconnected: %v", err)
			}
			break
		}
		var msg Message
		json.Unmarshal(msgBytes, &msg)
		handleMessage(c, msg)
	}
}

// --- 修改：handleConnections 现在启动 read/write pumps ---
func handleConnections(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}

	// 为新客户端创建 channel
	client := &Client{conn: ws, send: make(chan []byte, 256)}

	// 启动专属的写入协程
	go client.writePump()
	// 在当前协程中运行读取逻辑
	client.readPump()
}

// --- 修改：所有的广播/发送函数现在都通过 channel 发送 ---
func sendMessageToClient(client *Client, message []byte) {
	// 使用 select 来避免在 channel 满时阻塞
	select {
	case client.send <- message:
	default:
		// 如果 channel 已满，说明客户端处理不过来，可能已断开
		log.Printf("Client %s's send channel is full. Closing connection.", client.nickname)
		unregisterClient(client)
		close(client.send)
	}
}

func broadcastMessage(message []byte, exclude *Client) {
	mutex.Lock()
	clientsToSend := make([]*Client, 0, len(clients))
	for c := range clients {
		if c != exclude {
			clientsToSend = append(clientsToSend, c)
		}
	}
	mutex.Unlock()

	for _, client := range clientsToSend {
		sendMessageToClient(client, message)
	}
}

func handleMessage(client *Client, msg Message) {
	switch msg.Type {
	case "publicKey":
		registerClient(client, msg.Data)
		sendWelcomeMessage(client)
		broadcastUserList()
		// Announce to others that a new user has joined
		broadcastPresenceChange("userJoined", client.nickname)

	case "privateMessage":
		mutex.Lock()
		recipient, ok := nicknames[msg.To]
		fromNickname := client.nickname
		mutex.Unlock()

		if ok {
			response := Message{Type: "privateMessage", From: fromNickname, Data: msg.Data}
			if msgBytes, err := json.Marshal(response); err == nil {
				sendMessageToClient(recipient, msgBytes)
			}
		}

	case "groupMessage":
		response := map[string]interface{}{"type": "groupMessage", "from": client.nickname, "data": msg.Data}
		if msgBytes, err := json.Marshal(response); err == nil {
			broadcastMessage(msgBytes, client)
		}

	case "changeNickname":
		mutex.Lock()
		oldNickname, newNickname := client.nickname, msg.Data
		_, exists := nicknames[newNickname]
		if !exists {
			delete(nicknames, oldNickname)
			client.nickname = newNickname
			nicknames[newNickname] = client
		}
		mutex.Unlock()

		if exists {
			response := map[string]string{"type": "nicknameError", "data": "昵称已被使用"}
			if msgBytes, err := json.Marshal(response); err == nil {
				sendMessageToClient(client, msgBytes)
			}
			return
		}
		broadcastNicknameChange(oldNickname, newNickname)
	}
}

func broadcastPresenceChange(eventType, nickname string) {
	if nickname == "" { return }
	response := map[string]string{"type": eventType, "nickname": nickname}
	if msgBytes, err := json.Marshal(response); err == nil {
		// 广播给所有人，除了事件的主体自己
		mutex.Lock()
		clientToExclude, _ := nicknames[nickname]
		mutex.Unlock()
		broadcastMessage(msgBytes, clientToExclude)
	}
}

func sendWelcomeMessage(client *Client) {
	mutex.Lock()
	userMap := make(map[string]string)
	for nickname, c := range nicknames { userMap[nickname] = c.publicKey }
	nickname := client.nickname
	mutex.Unlock()
	welcomeMsg := map[string]interface{}{"type": "welcome", "nickname": nickname, "users": userMap}
	if msgBytes, err := json.Marshal(welcomeMsg); err == nil {
		sendMessageToClient(client, msgBytes)
	}
}

func broadcastUserList() {
	mutex.Lock()
	userMap := make(map[string]string)
	for nickname, c := range nicknames { userMap[nickname] = c.publicKey }
	mutex.Unlock()
	response := map[string]interface{}{"type": "userListUpdate", "users": userMap}
	if msgBytes, err := json.Marshal(response); err == nil {
		broadcastMessage(msgBytes, nil) // Broadcast to all
	}
}

func broadcastNicknameChange(oldNickname, newNickname string) {
	mutex.Lock()
	userMap := make(map[string]string)
	for nickname, c := range nicknames { userMap[nickname] = c.publicKey }
	mutex.Unlock()
	response := map[string]interface{}{"type": "nicknameChanged", "oldNickname": oldNickname, "newNickname": newNickname, "users": userMap}
	if msgBytes, err := json.Marshal(response); err == nil {
		broadcastMessage(msgBytes, nil) // Broadcast to all
	}
}

func broadcastFileNotification(from, to, sha256, originalFilename string) {
	notification := map[string]string{"type": "fileNotification", "from": from, "sha256": sha256, "originalFilename": originalFilename}
	msgBytes, err := json.Marshal(notification)
	if err != nil { return }
	recipient := to
	if to == "" || to == "group" { recipient = groupRecipient }
	
	mutex.Lock()
	defer mutex.Unlock()
	
	if recipient == groupRecipient {
		for c := range clients {
			if c.nickname != from {
				// Must use sendMessageToClient inside lock, careful
				// To be safer, collect clients and send outside lock.
				go sendMessageToClient(c, msgBytes)
			}
		}
	} else if recipientClient, ok := nicknames[recipient]; ok {
		go sendMessageToClient(recipientClient, msgBytes)
	}
}

func main() {
	port := flag.String("port", "5000", "Port for the server to listen on")
	flag.Parse()

	// 确保 uploads 目录存在
	uploadsDir := "./uploads"
	if _, err := os.Stat(uploadsDir); os.IsNotExist(err) {
		os.Mkdir(uploadsDir, 0755)
	}

	// --- 新增：程序退出时的清理逻辑 ---
	setupGracefulShutdown(uploadsDir)

	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("./static"))))
	http.HandleFunc("/ws", handleConnections)
	http.HandleFunc("/check-file", handleFileCheck)
	http.HandleFunc("/upload", handleFileUpload)
	http.HandleFunc("/download/", handleFileDownload)
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "static/index.html")
	})

	addr := "0.0.0.0:" + *port
	log.Printf("Server started on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

// --- 新增：优雅关机与文件清理 ---
func setupGracefulShutdown(dir string) {
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt) // 监听 Ctrl+C
	go func() {
		<-c
		log.Println("Shutdown signal received. Cleaning up files...")
		// 直接删除整个 uploads 文件夹
		if err := os.RemoveAll(dir); err != nil {
			log.Printf("Error cleaning up uploads directory: %v", err)
		} else {
			log.Println("Uploads directory cleaned up successfully.")
		}
		os.Exit(0)
	}()
}

// --- 核心修改：重构 unregisterClient 实现所有文件清理逻辑 ---
func unregisterClient(client *Client) {
	mutex.Lock()
	defer mutex.Unlock()

	nickname := client.nickname

	// Announce to others that this user has left, before removing them
	// We run this in a goroutine so it doesn't block the unregister process
	go broadcastPresenceChange("userLeft", nickname)

	if _, ok := clients[client]; !ok {
		return // Client already unregistered
	}

	// 1. 从在线列表中移除
	if nickname != "" {
		delete(nicknames, nickname)
	}
	delete(clients, client)
	log.Printf("User '%s' disconnected. %d users remaining.", nickname, len(clients))

	// 2. 核心清理逻辑：移除与该用户相关的所有文件引用
	shasToDelete := []string{}
	for sha, info := range fileRegistry {
		var newReferences []*FileReference
		// 遍历所有引用，只保留与该掉线用户无关的
		for _, ref := range info.References {
			if ref.Sender != nickname && ref.Recipient != nickname {
				newReferences = append(newReferences, ref)
			} else {
				log.Printf("Removing reference for file '%s' due to user '%s' disconnecting. Context: %s->%s", info.OriginalFilename, nickname, ref.Sender, ref.Recipient)
			}
		}
		info.References = newReferences

		// 如果清理后引用为空，则标记待删除
		if len(info.References) == 0 {
			shasToDelete = append(shasToDelete, sha)
		}
	}

	// 3. 如果所有人都已离线，额外清理所有群聊文件引用
	if len(clients) == 0 {
		log.Println("All users have disconnected. Cleaning up group chat files.")
		for sha, info := range fileRegistry {
			var newReferences []*FileReference
			// 遍历所有引用，只保留非群聊的
			for _, ref := range info.References {
				if ref.Recipient != groupRecipient {
					newReferences = append(newReferences, ref)
				} else {
					log.Printf("Removing group reference for file '%s' because chat room is empty.", info.OriginalFilename)
				}
			}
			info.References = newReferences

			// 检查是否需要删除
			if len(info.References) == 0 {
				isAlreadyMarked := false
				for _, existingSha := range shasToDelete {
					if existingSha == sha {
						isAlreadyMarked = true
						break
					}
				}
				if !isAlreadyMarked {
					shasToDelete = append(shasToDelete, sha)
				}
			}
		}
	}
	
	// 4. 执行删除
	for _, sha := range shasToDelete {
		if info, ok := fileRegistry[sha]; ok {
			log.Printf("Reference count for '%s' is zero. Deleting file from disk: %s", info.OriginalFilename, info.Path)
			if err := os.Remove(info.Path); err != nil {
				log.Printf("Failed to delete file %s: %v", info.Path, err)
			}
			delete(fileRegistry, sha)
		}
	}
}

// --- 修改：添加文件引用 ---
func addFileReference(from, to, sha256, originalFilename, path string) {
	mutex.Lock()
	defer mutex.Unlock()

	recipient := to
	if to == "" || to == "group" {
		recipient = groupRecipient
	}
	
	newRef := &FileReference{Sender: from, Recipient: recipient}

	if info, exists := fileRegistry[sha256]; exists {
		info.References = append(info.References, newRef)
		log.Printf("Added new reference to existing file '%s'. Context: %s->%s. Total refs: %d", originalFilename, from, recipient, len(info.References))
	} else {
		fileRegistry[sha256] = &FileInfo{
			OriginalFilename: originalFilename,
			Path:             path,
			References:       []*FileReference{newRef},
		}
		log.Printf("Registered new file '%s' with initial reference. Context: %s->%s", originalFilename, from, recipient)
	}
}

func handleFileCheck(w http.ResponseWriter, r *http.Request) {
	sha256sum := r.URL.Query().Get("sha256")
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")

	mutex.Lock()
	info, exists := fileRegistry[sha256sum]
	mutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	if exists {
		// 秒传：文件已存在，只需添加新的引用
		addFileReference(from, to, sha256sum, info.OriginalFilename, info.Path)
		// 触发文件通知
		broadcastFileNotification(from, to, sha256sum, info.OriginalFilename)
		json.NewEncoder(w).Encode(map[string]bool{"exists": true})
	} else {
		json.NewEncoder(w).Encode(map[string]bool{"exists": false})
	}
}
// --- REPLACE THE ENTIRE handleFileUpload FUNCTION WITH THIS CORRECTED VERSION ---
func handleFileUpload(w http.ResponseWriter, r *http.Request) {
	// 1. 获取 multipart reader
	reader, err := r.MultipartReader()
	if err != nil {
		sendJSONError(w, "Failed to get multipart reader", http.StatusBadRequest)
		return
	}

	// 2. 声明变量以暂存所有 part 的信息
	var fromNickname, toNickname, clientSha256 string
	var serverSha256, originalFilename, tempFilePath string

	// 3. 循环读取每一个 part
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break // 所有 part 都已读取完毕
		}
		if err != nil {
			sendJSONError(w, "Error reading multipart part", http.StatusInternalServerError)
			return
		}

		formName := part.FormName()
		if formName == "" {
			part.Close()
			continue
		}
		
		// 4. 根据 FormName 判断是文件还是普通字段
		if formName == "file" {
			originalFilename = part.FileName()
			if originalFilename == "" {
				part.Close()
				continue
			}

			tempFile, err := os.CreateTemp("uploads", "upload-*.tmp")
			if err != nil {
				sendJSONError(w, "Could not create temporary file", http.StatusInternalServerError)
				return
			}

			hasher := sha256.New()
			writer := io.MultiWriter(hasher, tempFile)

			if _, err := io.Copy(writer, part); err != nil {
				tempFile.Close()
				os.Remove(tempFile.Name())
				sendJSONError(w, "Error while processing file stream", http.StatusInternalServerError)
				return
			}
			
			// 暂存临时文件路径和服务器计算的哈希
			tempFilePath = tempFile.Name()
			serverSha256 = hex.EncodeToString(hasher.Sum(nil))
			
			tempFile.Close() // 必须关闭才能在后续重命名

		} else {
			// 这是普通表单字段
			fieldValue, err := io.ReadAll(part)
			if err != nil {
				sendJSONError(w, "Error reading form field", http.StatusInternalServerError)
				return
			}
			switch formName {
			case "from":
				fromNickname = string(fieldValue)
			case "to":
				toNickname = string(fieldValue)
			case "sha256":
				clientSha256 = string(fieldValue)
			}
		}
		part.Close()
	}

	// 5. 在循环结束后，我们拥有了所有信息，现在开始验证和处理
	// 检查是否真的收到了文件
	if tempFilePath == "" {
		sendJSONError(w, "No file part found in request", http.StatusBadRequest)
		return
	}
	
	// 验证哈希
	if serverSha256 != clientSha256 {
		os.Remove(tempFilePath) // 清理临时文件
		sendJSONError(w, "File hash mismatch", http.StatusBadRequest)
		return
	}

	// 哈希匹配，重命名文件
	ext := filepath.Ext(originalFilename)
	finalPath := filepath.Join("uploads", serverSha256+ext)
	if err := os.Rename(tempFilePath, finalPath); err != nil {
		os.Remove(tempFilePath) // 如果重命名失败，还是尝试清理
		sendJSONError(w, "Could not move file to final destination", http.StatusInternalServerError)
		return
	}
	
	// 6. 成功！注册引用、广播通知、发送成功响应
	addFileReference(fromNickname, toNickname, serverSha256, originalFilename, finalPath)
	broadcastFileNotification(fromNickname, toNickname, serverSha256, originalFilename)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "File uploaded successfully"})
}


// --- 以下函数保持不变或只有微小改动 ---
func handleFileDownload(w http.ResponseWriter, r *http.Request) { /* ... 不变 ... */
	shaWithExt := strings.TrimPrefix(r.URL.Path, "/download/")
	sha := strings.TrimSuffix(shaWithExt, filepath.Ext(shaWithExt))
	mutex.Lock()
	info, ok := fileRegistry[sha]
	if !ok {
		mutex.Unlock()
		http.NotFound(w, r)
		return
	}
	filePath := info.Path
	originalFilename := info.OriginalFilename
	mutex.Unlock()
	w.Header().Set("Content-Disposition", "attachment; filename=\""+originalFilename+"\"")
	http.ServeFile(w, r, filePath)
}
func sendJSONError(w http.ResponseWriter, message string, statusCode int) { /* ... 不变 ... */
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func registerClient(client *Client, publicKey string) { /* ... 不变 ... */
	mutex.Lock()
	defer mutex.Unlock()
	client.publicKey = publicKey
	for {
		nickname := generateNickname()
		if _, exists := nicknames[nickname]; !exists {
			client.nickname = nickname
			nicknames[nickname] = client
			clients[client] = true
			break
		}
	}
}

func broadcastGroupMessage(sender *Client, message string) { /* ... 不变 ... */
	mutex.Lock()
	senderNickname := sender.nickname
	clientsToSend := make([]*Client, 0, len(clients))
	for c := range clients {
		if c != sender {
			clientsToSend = append(clientsToSend, c)
		}
	}
	mutex.Unlock()
	response := map[string]interface{}{"type": "groupMessage", "from": senderNickname, "data": message}
	for _, client := range clientsToSend {
		if err := client.conn.WriteJSON(response); err != nil {
			log.Printf("error broadcasting group message: %v", err)
		}
	}
}

func generateNickname() string { /* ... 不变 ... */
	adjectives := []string{"快乐的", "勇敢的", "聪明的", "神秘的", "安静的", "活泼的"}
	nouns := []string{"老虎", "海豚", "雄鹰", "开发者", "探险家", "思想家"}
	b := make([]byte, 2)
	rand.Read(b)
	num := fmt.Sprintf("%04d", (int(b[0])<<8|int(b[1]))%10000)
	adj := adjectives[int(b[0])%len(adjectives)]
	noun := nouns[int(b[1])%len(nouns)]
	return fmt.Sprintf("%s%s%s", adj, noun, num)
}