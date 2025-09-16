package main

import (
	"crypto/rand"
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
	sessionTimeout = 5 * time.Minute //24 * time.Hour
)

type Session struct {
	ClientID  string
	Nickname  string
	PublicKey string
	Client    *Client
	// --- 新增：最后活跃时间戳 ---
	LastSeen  time.Time
}

type Client struct {
	conn      *websocket.Conn
	clientID  string // --- NEW: Add ClientID to the active connection struct ---
	nickname  string
	publicKey string
	send      chan []byte
}

type FileReference struct {
	Sender    string
	Recipient string
}
type FileInfo struct {
	OriginalFilename string
	Path             string // Path on disk
	References       []*FileReference
}
// --- UPDATED: Message struct now includes a top-level UUID for file shares ---
type Message struct {
	Type             string `json:"type"`
	ClientID         string `json:"clientID,omitempty"`
	To               string `json:"to,omitempty"`
	From             string `json:"from,omitempty"`
	UUID             string `json:"uuid,omitempty"` // For file reference tracking
	Data             string `json:"data,omitempty"` // Now always an encrypted payload
	PublicKey        string `json:"publicKey,omitempty"`
	ProposedNickname string `json:"proposedNickname,omitempty"`
}

var (
	clients      = make(map[*Client]bool)
	nicknames    = make(map[string]*Client)
	sessions     = make(map[string]*Session)
	fileRegistry = make(map[string]*FileInfo) // <-- 确保这一行存在！
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

// --- REPLACED: handleMessage to handle the new fileShare message format ---
func handleMessage(client *Client, msg Message) {
	switch msg.Type {
	// ... all other cases (register, privateMessage, etc.) remain IDENTICAL ...
	case "register":
		mutex.Lock()
		defer mutex.Unlock()
		if session, ok := sessions[msg.ClientID]; ok {
			if session.PublicKey != msg.PublicKey {
				log.Printf("ClientID hijacking attempt! ID: %s", msg.ClientID)
				client.conn.Close()
				return
			}
			session.LastSeen = time.Now()
			log.Printf("Client reconnected: %s (Nickname: %s)", msg.ClientID, session.Nickname)
			session.Client = client
			client.clientID = session.ClientID
			client.nickname = session.Nickname
			client.publicKey = session.PublicKey
			clients[client] = true
			nicknames[session.Nickname] = client
			go func() {
				sendWelcomeMessage(client)
				broadcastUserList()
				broadcastPresenceChange("userJoined", client.nickname)
			}()
			return
		}
		finalNickname := msg.ProposedNickname
		_, exists := nicknames[finalNickname]
		if finalNickname == "" || exists {
			for {
				newNickname := generateNickname()
				if _, exists := nicknames[newNickname]; !exists {
					finalNickname = newNickname
					break
				}
			}
		}
		client.clientID = msg.ClientID
		client.nickname = finalNickname
		client.publicKey = msg.PublicKey
		newSession := &Session{
			ClientID: msg.ClientID, Nickname: finalNickname, PublicKey: msg.PublicKey, Client: client, LastSeen: time.Now(),
		}
		sessions[msg.ClientID] = newSession
		clients[client] = true
		nicknames[finalNickname] = client
		log.Printf("New client registered: %s (Nickname: %s)", msg.ClientID, finalNickname)
		go func() {
			sendWelcomeMessage(client)
			broadcastUserList()
			broadcastPresenceChange("userJoined", client.nickname)
		}()
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
		response := Message{Type: "groupMessage", From: client.nickname, Data: msg.Data}
		if msgBytes, err := json.Marshal(response); err == nil {
			broadcastMessage(msgBytes, client)
		}

	// --- CORE FIX is in this case ---
	case "fileShare":
		// The client is sending metadata about an already-uploaded file.
		// The only plaintext info we need is the UUID for tracking.
		if msg.UUID == "" {
			log.Printf("Received fileShare message with no UUID from %s", client.nickname)
			return
		}

		// We need to find the original filename for the reference, which is now encrypted.
		// For simplicity, we'll store "encrypted filename" in the reference log.
		// A more complex solution would be to have the client send a separate confirmation
		// message after a successful share, but this is sufficient for cleanup.
		finalPath := filepath.Join("uploads", msg.UUID)
		addFileReference(client.nickname, msg.To, msg.UUID, "encrypted filename", finalPath)

		// Broadcast the original, complete message to the recipient(s)
		// The `msg` object already has all the necessary fields (From, To, UUID, Data).
		msgBytes, _ := json.Marshal(msg)

		if msg.To == "group" {
			broadcastMessage(msgBytes, nil)
		} else {
			mutex.Lock()
			recipient, ok := nicknames[msg.To]
			mutex.Unlock()
			if ok {
				sendMessageToClient(recipient, msgBytes)
			}
			sendMessageToClient(client, msgBytes)
		}
	
	// ... other cases remain IDENTICAL ...
	case "changeNickname":
		mutex.Lock()
		oldNickname, newNickname := client.nickname, msg.Data
		_, exists := nicknames[newNickname]
		if !exists && newNickname != "" {
			if session, ok := sessions[client.clientID]; ok {
				session.Nickname = newNickname
			}
			client.nickname = newNickname
			delete(nicknames, oldNickname)
			nicknames[newNickname] = client
		}
		mutex.Unlock()
		if exists || newNickname == "" {
			response := map[string]string{"type": "nicknameError", "data": "昵称已被使用或无效"}
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
	recipient := to
	if to == "" || to == "group" {
		recipient = groupRecipient
	}

	// 核心改动：在JSON负载中增加了 "to" 字段
	notification := map[string]string{
		"type":             "fileNotification",
		"from":             from,
		"to":               recipient, // 这个字段告诉客户端消息的目的地
		"sha256":           sha256,
		"originalFilename": originalFilename,
	}

	msgBytes, err := json.Marshal(notification)
	if err != nil {
		log.Printf("Error marshalling file notification: %v", err)
		return
	}

	mutex.Lock()
	defer mutex.Unlock()

	if recipient == groupRecipient {
		// 广播给除了发送者以外的所有人
		for c := range clients {
			if c.nickname != from {
				go sendMessageToClient(c, msgBytes)
			}
		}
	} else if recipientClient, ok := nicknames[recipient]; ok {
		// 发送给特定接收者
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
	go cleanupInactiveSessions()

	// --- 新增：程序退出时的清理逻辑 ---
	setupGracefulShutdown(uploadsDir)

	mux := http.NewServeMux()
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("./static"))))
	mux.HandleFunc("/ws", handleConnections)

	// --- REVISED: Replace single upload handler with three chunk-based handlers ---
	mux.HandleFunc("/upload/start", handleUploadStart)
	mux.HandleFunc("/upload/chunk", handleUploadChunk)
	mux.HandleFunc("/upload/finish", handleUploadFinish)

	mux.HandleFunc("/download/", handleFileDownload)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "static/index.html")
	})

	addr := "0.0.0.0:" + *port

	// We no longer need H2C, but keeping the configured server is good practice for timeouts
	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  10 * time.Minute,
		WriteTimeout: 10 * time.Minute,
		MaxHeaderBytes: 1 << 20,
	}

	log.Printf("Server started on %s", addr)
	log.Fatal(server.ListenAndServe())
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

// --- UPDATED: unregisterClient must use the UUID as the key for deletion ---
func unregisterClient(client *Client) {
	mutex.Lock()
	defer mutex.Unlock()

	if session, ok := sessions[client.clientID]; ok {
		if session.Client != client {
			log.Printf("Stale disconnect event for %s. New session is active. Aborting cleanup.", session.Nickname)
			delete(clients, client)
			return
		}
	}

	if _, ok := clients[client]; ok {
		delete(clients, client)
		if client.nickname != "" {
			delete(nicknames, client.nickname)
		}
	} else {
		return
	}

	if session, ok := sessions[client.clientID]; ok {
		session.Client = nil
		session.LastSeen = time.Now()
		log.Printf("Client disconnected: %s (Nickname: %s). Session preserved.", client.clientID, session.Nickname)
	}

	go broadcastPresenceChange("userLeft", client.nickname)
	go broadcastUserList()
	
	nickname := client.nickname
	uuidsToDelete := []string{}
	for uuid, info := range fileRegistry {
		var newReferences []*FileReference
		for _, ref := range info.References {
			if ref.Sender != nickname && ref.Recipient != nickname {
				newReferences = append(newReferences, ref)
			} else {
				log.Printf("Removing reference for file '%s' (UUID: %s) due to user '%s' disconnecting.", info.OriginalFilename, uuid, nickname)
			}
		}
		info.References = newReferences
		if len(info.References) == 0 {
			uuidsToDelete = append(uuidsToDelete, uuid)
		}
	}

    // ... (The rest of the file deletion logic, like checking for an empty room, remains the same but uses UUIDs) ...

	for _, uuid := range uuidsToDelete {
		if info, ok := fileRegistry[uuid]; ok {
			log.Printf("Reference count for '%s' (UUID: %s) is zero. Deleting file from disk.", info.OriginalFilename, uuid)
			if err := os.Remove(info.Path); err != nil {
				log.Printf("Failed to delete file %s: %v", info.Path, err)
			}
			delete(fileRegistry, uuid)
		}
	}
}

// The old handleFileUpload function should be DELETED.

// --- NEW HANDLER 1: Initiates an upload and creates a temporary file ---
func handleUploadStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		sendJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		sendJSONError(w, "Could not generate file UUID", http.StatusInternalServerError)
		return
	}
	uuid := hex.EncodeToString(b)
	filePath := filepath.Join("uploads", uuid+".part") // Create a temporary part file

	dst, err := os.Create(filePath)
	if err != nil {
		sendJSONError(w, "Could not create destination file on server", http.StatusInternalServerError)
		return
	}
	dst.Close() // Close immediately, we will append to it later

	log.Printf("Starting upload for UUID: %s", uuid)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"uuid": uuid})
}

// --- NEW HANDLER 2: Appends an uploaded chunk to the temporary file ---
func handleUploadChunk(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		sendJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get UUID from query parameter
	uuid := r.URL.Query().Get("uuid")
	if uuid == "" {
		sendJSONError(w, "Missing upload UUID", http.StatusBadRequest)
		return
	}

	filePath := filepath.Join("uploads", uuid+".part")

	// Open the file in append mode
	dst, err := os.OpenFile(filePath, os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		sendJSONError(w, "Invalid upload UUID or file not found", http.StatusNotFound)
		return
	}
	defer dst.Close()

	// Append the request body (the chunk) to the file
	_, err = io.Copy(dst, r.Body)
	if err != nil {
		sendJSONError(w, "Could not write chunk to file", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "chunk received"})
}

// --- NEW HANDLER 3: Finalizes the upload by renaming the file ---
func handleUploadFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		sendJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var data struct {
		UUID string `json:"uuid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		sendJSONError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	partPath := filepath.Join("uploads", data.UUID+".part")
	finalPath := filepath.Join("uploads", data.UUID)

	if err := os.Rename(partPath, finalPath); err != nil {
		sendJSONError(w, "Could not finalize file", http.StatusInternalServerError)
		return
	}
	log.Printf("Finished upload for UUID: %s", data.UUID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "upload finished"})
}



func handleFileDownload(w http.ResponseWriter, r *http.Request) {
	uuid := strings.TrimPrefix(r.URL.Path, "/download/")
	
	mutex.Lock()
	// We check the registry primarily to ensure the file reference exists,
	// preventing downloads of orphaned or invalid files.
	info, ok := fileRegistry[uuid]
	if !ok {
		mutex.Unlock()
		http.NotFound(w, r)
		return
	}
	filePath := info.Path
	mutex.Unlock()

	// Serve the raw (encrypted) file blob
	http.ServeFile(w, r, filePath)
}

// --- UPDATED: addFileReference now uses UUID as the key ---
func addFileReference(from, to, uuid, originalFilename, path string) {
	mutex.Lock()
	defer mutex.Unlock()

	recipient := to
	if to == "" || to == "group" {
		recipient = groupRecipient
	}
	
	newRef := &FileReference{Sender: from, Recipient: recipient}

	if info, exists := fileRegistry[uuid]; exists {
		info.References = append(info.References, newRef)
		log.Printf("Added new reference to existing file UUID '%s'. Context: %s->%s. Total refs: %d", uuid, from, recipient, len(info.References))
	} else {
		fileRegistry[uuid] = &FileInfo{
			OriginalFilename: originalFilename,
			Path:             path,
			References:       []*FileReference{newRef},
		}
		log.Printf("Registered new file UUID '%s' with initial reference. Context: %s->%s", uuid, from, recipient)
	}
}

func sendJSONError(w http.ResponseWriter, message string, statusCode int) { /* ... 不变 ... */
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func registerClient(client *Client, publicKey string, finalNickname string) {
	mutex.Lock()
	defer mutex.Unlock()

	client.publicKey = publicKey
	client.nickname = finalNickname
	nicknames[finalNickname] = client
	clients[client] = true
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
// --- 新增：定期清理不活跃会话的函数 ---
func cleanupInactiveSessions() {
	// 创建一个定时器，例如每 5 分钟触发一次
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		mutex.Lock()
		now := time.Now()
		// 遍历所有会话
		for clientID, session := range sessions {
			// 检查会话是否已断开连接，并且不活跃时间超过了阈值
			if session.Client == nil && now.Sub(session.LastSeen) > sessionTimeout {
				log.Printf("Session timed out. Removing ClientID: %s (Nickname: %s)", clientID, session.Nickname)
				// 从 map 中删除会话
				delete(sessions, clientID)
			}
		}
		mutex.Unlock()
	}
}
